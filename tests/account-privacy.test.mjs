import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const me = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  group = "33333333-3333-4333-8333-333333333333",
  channel = "44444444-4444-4444-8444-444444444444";
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
