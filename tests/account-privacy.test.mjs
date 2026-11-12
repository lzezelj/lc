import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { cropSquare, centeredCrop } from "../app/profile-crop.ts";

test("profile crops preserve square proportions, clamp controls and reach image edges", () => {
  assert.deepEqual(cropSquare(500, 300, centeredCrop), {
    size: 300,
    x: 100,
    y: 0,
  });
  assert.deepEqual(cropSquare(500, 300, { zoom: 2, x: 100, y: 100 }), {
    size: 150,
    x: 350,
    y: 150,
  });
  assert.deepEqual(cropSquare(300, 500, { zoom: 0, x: -20, y: 200 }), {
    size: 300,
    x: 0,
    y: 200,
  });
  assert.deepEqual(cropSquare(300, 300, { zoom: NaN, x: NaN, y: NaN }), {
    size: 300,
    x: 0,
    y: 0,
  });
});

const me = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  group = "33333333-3333-4333-8333-333333333333",
  channel = "44444444-4444-4444-8444-444444444444";

const avatarPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=",
  "base64",
);
async function avatarModule(path, deps) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      Buffer,
      Response,
      Request,
      Uint8Array,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
    },
  );
  return exports;
}
test("profile pictures bound raw PNG bytes and dimensions before storage", async () => {
  const helpers = await avatarModule("../server/profile-pictures.ts", {
    "node:crypto": { randomUUID: () => "version" },
    "drizzle-orm": {},
    "../db": {},
    "../db/schema": {},
    "./notify-user": {},
  });
  const request = (body, type = "image/png") =>
    new Request("https://lc.test", {
      method: "PUT",
      headers: { "Content-Type": type },
      body,
    });
  assert.equal(
    (await helpers.readAvatar(request(avatarPng))).equals(avatarPng),
    true,
  );
  assert.equal(
    (await helpers.readAvatar(request("<svg/>", "image/svg+xml"))).status,
    415,
  );
  assert.equal((await helpers.readAvatar(request("not an image"))).status, 400);
  const hugeDimensions = Buffer.from(avatarPng);
  hugeDimensions.writeUInt32BE(513, 16);
  assert.equal((await helpers.readAvatar(request(hugeDimensions))).status, 400);
  assert.equal(
    (
      await helpers.readAvatar(
        request(Buffer.alloc(helpers.avatarMaxBytes + 1)),
      )
    ).status,
    413,
  );
  assert.match(
    helpers.avatarUrl(me),
    new RegExp(`/api/users/${me}/avatar\\?v=`),
  );
});
test("profile picture changes use the authenticated account and notify after commit", async () => {
  let authenticated = false,
    allowed = true;
  const events = [];
  const table = { id: "id", image: "image" },
    avatarTable = { userId: "userId" };
  const database = {
    select: () => ({
      from: () => ({ where: () => ({ for: async () => [{ id: me }] }) }),
    }),
    insert: () => ({
      values: (value) => ({
        onConflictDoUpdate: async () => events.push(["bytes", value.userId]),
      }),
    }),
    update: () => ({
      set: (value) => ({
        where: async () => events.push(["image", value.image]),
      }),
    }),
    delete: () => ({ where: async () => events.push(["remove"]) }),
    transaction: async (work) => {
      const result = await work(database);
      events.push(["commit"]);
      return result;
    },
  };
  const route = await avatarModule("../app/api/users/me/avatar/route.ts", {
    "drizzle-orm": {
      eq: (_column, userId) => {
        assert.equal(userId, me);
      },
    },
    "../../../../../auth": {
      auth: async () => (authenticated ? { user: { id: me } } : null),
    },
    "../../../../../db": { db: database },
    "../../../../../db/schema": { users: table, userAvatars: avatarTable },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed, retryAfterSeconds: 10 }),
    },
    "../../../../../server/profile-pictures": {
      avatarUrl: (id) => `/api/users/${id}/avatar?v=test`,
      readAvatar: async () => avatarPng,
      notifyProfilePicture: async (id, image) =>
        events.push(["notify", id, image]),
    },
  });
  const request = () =>
    new Request("https://lc.test/api/users/me/avatar?userId=" + other, {
      method: "PUT",
      body: avatarPng,
    });
  assert.equal((await route.PUT(request())).status, 401);
  assert.equal(events.length, 0);
  authenticated = true;
  assert.equal((await route.PUT(request())).status, 200);
  assert.deepEqual(
    events.map((event) => event[0]),
    ["bytes", "image", "commit", "notify"],
  );
  assert.equal(events[0][1], me);
  assert.equal(events.at(-1)[1], me);
  events.length = 0;
  assert.equal((await route.DELETE(request())).status, 200);
  assert.deepEqual(
    events.map((event) => event[0]),
    ["remove", "image", "commit", "notify"],
  );
  assert.equal(events[1][1], null);
  allowed = false;
  assert.equal((await route.PUT(request())).status, 429);
});
test("profile picture reads require authentication and an authorized audience", async () => {
  let authenticated = true,
    allowed = false,
    conversationAllowed = false,
    present = true,
    reads = 0;
  const route = await avatarModule(
    "../app/api/users/[userId]/avatar/route.ts",
    {
      "drizzle-orm": { eq() {} },
      "../../../../../auth": {
        auth: async () => (authenticated ? { user: { id: me } } : null),
      },
      "../../../../../db": {
        db: {
          select: () => ({
            from: () => ({
              where: async () => {
                reads++;
                return present ? [{ data: avatarPng }] : [];
              },
            }),
          }),
        },
      },
      "../../../../../db/schema": {
        userAvatars: { data: "data", userId: "userId" },
      },
      "../../../../../server/profile-pictures": {
        profileAudience: async () => new Set(allowed ? [me] : []),
      },
      "../../../../../server/direct-conversations": {
        canMessage: async () => conversationAllowed,
      },
    },
  );
  const get = (userId = other) =>
    route.GET(new Request("https://lc.test"), {
      params: Promise.resolve({ userId }),
    });
  assert.equal((await get()).status, 403);
  assert.equal(reads, 0);
  conversationAllowed = true;
  assert.equal(
    (await get()).status,
    200,
    "Historical conversations retain avatar access without friendship/shared servers",
  );
  conversationAllowed = false;
  allowed = true;
  const picture = await get();
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get("content-type"), "image/png");
  assert.equal(picture.headers.get("cache-control"), "private, no-store");
  assert.equal(
    Buffer.from(await picture.arrayBuffer()).equals(avatarPng),
    true,
  );
  present = false;
  assert.equal((await get(me)).status, 404);
  authenticated = false;
  assert.equal((await get()).status, 401);
});
async function fixture({
  authenticated = true,
  owned = false,
  history = false,
} = {}) {
  const tables = Object.fromEntries(
    [
      "users",
      "servers",
      "serverMembers",
      "channels",
      "messages",
      "directMessages",
      "friendships",
      "accounts",
      "sessions",
    ].map((name) => [
      name,
      new Proxy(
        { name },
        { get: (target, key) => (key === "name" ? target.name : String(key)) },
      ),
    ]),
  );
  const data = {
    users: [{ id: me, name: "Person", email: "test@example.invalid" }],
    servers: owned ? [{ id: group, createdBy: me }] : [],
    serverMembers: [{ serverId: group, userId: me }],
    channels: [
      { id: channel, serverId: group, type: "voice_group", userId: me },
    ],
    messages: [
      { id: "own", authorId: me, channelId: channel },
      { id: "others", authorId: other, channelId: channel },
    ],
    directMessages: [
      { id: "sent", senderId: me, recipientId: other, kind: "message" },
      { id: "received", senderId: other, recipientId: me, kind: "message" },
    ],
    friendships: [{ requesterId: me, recipientId: other }],
    accounts: [{ userId: me }],
    sessions: [{ userId: me }],
  };
  const mutations = [],
    notifications = [];
  const op =
    (name) =>
    (...args) => ({ name, args });
  function matches(predicate, row) {
    if (!predicate) return true;
    const { name, args } = predicate;
    if (name === "and") return args.every((value) => matches(value, row));
    if (name === "or") return args.some((value) => matches(value, row));
    if (name === "eq") return row[args[0]] === args[1];
    if (name === "inArray")
      return args[1]
        .values()
        .map((item) => Object.values(item)[0])
        .includes(row[args[0]]);
    throw new Error(name);
  }
  const project = (rows, fields) =>
    rows.map((row) =>
      fields
        ? Object.fromEntries(
            Object.entries(fields).map(([key, column]) => [key, row[column]]),
          )
        : row,
    );
  const db = {
    select(fields) {
      let table,
        predicate,
        limit = Infinity;
      const query = {
        from(value) {
          table = value.name;
          return query;
        },
        innerJoin() {
          return query;
        },
        where(value) {
          predicate = value;
          return query;
        },
        orderBy() {
          return query;
        },
        limit(value) {
          limit = value;
          return query;
        },
        for() {
          return query;
        },
        values: () =>
          project(
            data[table]
              .filter((row) => matches(predicate, row))
              .slice(0, limit),
            fields,
          ),
        then(resolve, reject) {
          return Promise.resolve(query.values()).then(resolve, reject);
        },
      };
      return query;
    },
    delete(table) {
      return {
        where(predicate) {
          const removed = data[table.name].filter((row) =>
            matches(predicate, row),
          );
          data[table.name] = data[table.name].filter(
            (row) => !matches(predicate, row),
          );
          mutations.push(table.name);
          const result = {
            returning: async (fields) => project(removed, fields),
            then(resolve, reject) {
              return Promise.resolve().then(resolve, reject);
            },
          };
          return result;
        },
      };
    },
    update(table) {
      return {
        set(value) {
          return {
            async where(predicate) {
              mutations.push(table.name);
              data[table.name].forEach((row) => {
                if (matches(predicate, row)) Object.assign(row, value);
              });
            },
          };
        },
      };
    },
    transaction: async (callback) => callback(db),
  };
  const prefix = history ? "../../../../../" : "../../../../";
  const deps = {
    "drizzle-orm": Object.fromEntries(
      ["and", "or", "eq", "desc", "inArray"].map((name) => [name, op(name)]),
    ),
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    [`${prefix}auth`]: {
      auth: async () => (authenticated ? { user: { id: me } } : null),
    },
    [`${prefix}db`]: { db },
    [`${prefix}db/schema`]: tables,
    [`${prefix}server/disconnect-user`]: {
      disconnectUserEverywhere: async (...args) => notifications.push(args),
    },
    [`${prefix}server/message-removals`]: {
      notifyMessageRemovals: async (...args) => notifications.push(args),
    },
    [`${prefix}server/notify-server`]: { notifyServer: async () => {} },
    [`${prefix}server/notify-user`]: { notifyUser: async () => {} },
    [`${prefix}server/profile-pictures`]: {
      profileAudience: async () => new Set([me]),
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(
      await readFile(
        new URL(
          `../app/api/users/me/${history ? "message-history/" : ""}route.ts`,
          import.meta.url,
        ),
        "utf8",
      ),
      { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    ),
    {
      exports,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      Error,
    },
  );
  return {
    data,
    mutations,
    notifications,
    run: (body = { confirm: "DELETE", deleteMessages: false }) =>
      exports.DELETE(
        new Request("https://lc.test/api", {
          method: "DELETE",
          body: JSON.stringify(body),
        }),
      ),
  };
}
test("self-account deletion requires authentication, explicit confirmation and no owned servers", async () => {
  for (const [options, body, status] of [
    [{ authenticated: false }, {}, 401],
    [{}, {}, 400],
    [{ owned: true }, { confirm: "DELETE", deleteMessages: true }, 409],
  ]) {
    const state = await fixture(options);
    assert.equal((await state.run(body)).status, status);
    assert.deepEqual(state.mutations, []);
  }
});
test("retaining messages removes account access and anonymizes their author", async () => {
  const state = await fixture();
  assert.equal((await state.run()).status, 200);
  assert.equal(state.data.users[0].name, "Deleted user");
  assert.equal(state.data.users[0].email, null);
  assert.ok(state.data.users[0].disabledAt);
  assert.equal(state.data.accounts.length, 0);
  assert.equal(state.data.sessions.length, 0);
  assert.equal(state.data.serverMembers.length, 0);
  assert.equal(state.data.friendships.length, 0);
  assert.equal(state.data.messages.length, 2);
  assert.equal(state.data.directMessages.length, 2);
  assert.ok(state.notifications.length);
});
test("delete-all removes only messages sent by the account and preserves incoming messages", async () => {
  const state = await fixture();
  assert.equal(
    (
      await state.run({
        confirm: "DELETE",
        deleteMessages: true,
        userId: other,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    state.data.messages.map((row) => row.id),
    ["others"],
  );
  assert.deepEqual(
    state.data.directMessages.map((row) => row.id),
    ["received"],
  );
});
test("personal-message deletion rejects missing filters and cannot delete another sender's messages", async () => {
  const invalid = await fixture({ history: true });
  assert.equal((await invalid.run({ kind: "direct" })).status, 400);
  assert.deepEqual(invalid.mutations, []);
  const direct = await fixture({ history: true });
  assert.equal(
    (await direct.run({ kind: "direct", groupId: other })).status,
    200,
  );
  assert.deepEqual(
    direct.data.directMessages.map((row) => row.id),
    ["received"],
  );
  const server = await fixture({ history: true });
  assert.equal(
    (await server.run({ kind: "server", groupId: group })).status,
    200,
  );
  assert.deepEqual(
    server.data.messages.map((row) => row.id),
    ["others"],
  );
});
