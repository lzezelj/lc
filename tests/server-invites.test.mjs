import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const actor = "11111111-1111-4111-8111-111111111111";
const person = "22222222-2222-4222-8222-222222222222";

test("invitation connection refresh accepts null CustomEvent detail without treating it as an acceptance", async () => {
  const source = await readFile(
    new URL("../app/use-server-invitations.ts", import.meta.url),
    "utf8",
  );
  const exports = {},
    effects = [],
    listeners = new Map(),
    joins = [];
  let requests = 0;
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      AbortController,
      fetch: async () => {
        requests++;
        return Response.json([]);
      },
      window: {
        addEventListener: (name, handler) => listeners.set(name, handler),
        removeEventListener() {},
      },
      document: {
        addEventListener() {},
        removeEventListener() {},
        visibilityState: "visible",
      },
      require: () => ({
        useRef: (current) => ({ current }),
        useState: (initial) => [initial, () => {}],
        useCallback: (callback) => callback,
        useEffect: (effect) => effects.push(effect),
      }),
    },
  );
  exports.useServerInvitations(actor, (...args) => joins.push(args));
  const cleanups = effects.map((effect) => effect());
  const changed = listeners.get("lc-server-invitations");
  for (const detail of [null, undefined, {}])
    assert.doesNotThrow(() => changed({ detail }));
  assert.equal(
    requests,
    4,
    "Every refresh, including null detail, reloads the inbox",
  );
  assert.deepEqual(joins, []);
  changed({
    detail: { invitationId: "invite", serverId: "server", userId: actor },
  });
  assert.deepEqual(joins, [["server", actor]]);
  for (const cleanup of cleanups) cleanup?.();
});

test("server invitation actions reject invalid, unauthenticated and rate-limited requests before writes", async () => {
  const source = await readFile(
    new URL("../app/api/server-invitations/route.ts", import.meta.url),
    "utf8",
  );
  for (const [authenticated, allowed, body, status] of [
    [false, true, {}, 401],
    [true, true, {}, 400],
    [true, true, { id: person, action: "join" }, 400],
    [true, false, { id: person, action: "accept" }, 429],
  ]) {
    const exports = {};
    const dependencies = {
      "drizzle-orm": {},
      "../../../auth": {
        auth: async () => (authenticated ? { user: { id: actor } } : null),
      },
      "../../../db": {
        db: new Proxy(
          {},
          {
            get: () => {
              throw new Error("Database must remain untouched");
            },
          },
        ),
      },
      "../../../db/schema": {},
      "../../../server/notify-user": {},
      "../../../server/rate-limit": {
        rateLimits: { serverMutation: {} },
        checkRateLimit: () => ({ allowed }),
      },
    };
    vm.runInNewContext(
      ts.transpile(source, { module: ts.ModuleKind.CommonJS }),
      { exports, Response, require: (name) => dependencies[name] },
    );
    assert.equal(
      (
        await exports.PATCH(
          new Request("http://local/invites", {
            method: "PATCH",
            body: JSON.stringify(body),
          }),
        )
      ).status,
      status,
    );
  }
});
async function fixture({
  authenticated = true,
  owner = true,
  active = true,
  friend = false,
  search = false,
} = {}) {
  const reads = [
    owner ? [{ role: "owner" }] : [],
    search ? [{ id: person, name: "Person" }] : active ? [{ id: person }] : [],
    friend ? [{ requesterId: actor, recipientId: person }] : [],
  ];
  const writes = [],
    limits = [],
    predicates = [];
  const table = (name) =>
    new Proxy({}, { get: (_, key) => `${name}.${String(key)}` });
  const db = {
    select() {
      const chain = {
        from() {
          return chain;
        },
        where(value) {
          predicates.push(value);
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit(value) {
          limits.push(value);
          return Promise.resolve(reads.shift());
        },
        then(resolve, reject) {
          return Promise.resolve(reads.shift()).then(resolve, reject);
        },
      };
      return chain;
    },
    insert() {
      return {
        values(values) {
          writes.push(...values);
          return {
            onConflictDoNothing() {
              return { returning: async () => values };
            },
          };
        },
      };
    },
  };
  const deps = {
    "../../../../../server/server-invitations": {
      createServerInvitations: async (serverId, inviterId, recipientIds) => {
        writes.push(
          ...recipientIds.map((recipientId) => ({
            serverId,
            inviterId,
            recipientId,
          })),
        );
        return { invited: recipientIds };
      },
    },
    "../../../../../server/notify-user": { notifyUser: async () => {} },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed: true }),
      rateLimits: { serverMutation: {} },
    },
    "drizzle-orm": Object.fromEntries(
      [
        "and",
        "asc",
        "eq",
        "gt",
        "ilike",
        "inArray",
        "isNull",
        "lte",
        "ne",
        "notInArray",
        "or",
      ].map((name) => [name, (...args) => ({ name, args })]),
    ),
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "../../../../../auth": {
      auth: async () => (authenticated ? { user: { id: actor } } : null),
    },
    "../../../../../db": { db },
    "../../../../../db/schema": {
      users: table("users"),
      serverMembers: table("members"),
      friendships: table("friends"),
      channels: table("channels"),
    },
    "../../../../../server/disconnect-user": {
      disconnectUserEverywhere: async () => {},
    },
    "../../../../../user-handle": {
      normalizeUserHandle: (value) => value.trim().toLowerCase(),
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(
      await readFile(
        new URL(
          `../app/api/servers/[serverId]/${search ? "invitees" : "members"}/route.ts`,
          import.meta.url,
        ),
        "utf8",
      ),
      { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    ),
    {
      exports,
      URL,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
    },
  );
  return {
    writes,
    limits,
    predicates,
    run: (body = { userIds: [person], mode: "people" }) =>
      exports[search ? "GET" : "POST"](
        search
          ? new Request(
              `https://lc.test/api/servers/server/invitees?q=${encodeURIComponent(body.query ?? "per")}`,
            )
          : new Request("https://lc.test/api", {
              method: "POST",
              body: JSON.stringify(body),
            }),
        { params: Promise.resolve({ serverId: "server" }) },
      ),
  };
}

test("inviting people requires authentication and server ownership", async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401],
    [{ owner: false }, 403],
  ]) {
    const state = await fixture(options);
    assert.equal((await state.run()).status, status);
    assert.deepEqual(state.writes, []);
  }
});
test("people mode permits active non-friends while default friends mode requires friendship", async () => {
  const people = await fixture();
  assert.equal((await people.run()).status, 201);
  assert.equal(people.writes[0].recipientId, person);
  const friends = await fixture();
  assert.equal((await friends.run({ userIds: [person] })).status, 403);
  assert.deepEqual(friends.writes, []);
  const accepted = await fixture({ friend: true });
  assert.equal(
    (await accepted.run({ userIds: [person], mode: "friends" })).status,
    201,
  );
});
test("inactive accounts and invalid invitation modes cannot create memberships", async () => {
  const inactive = await fixture({ active: false });
  assert.equal((await inactive.run()).status, 400);
  assert.deepEqual(inactive.writes, []);
  const invalid = await fixture();
  assert.equal(
    (await invalid.run({ userIds: [person], mode: "invalid" })).status,
    400,
  );
  assert.deepEqual(invalid.writes, []);
});
test("people search is owner-only, requires a query, and bounds matching results", async () => {
  const denied = await fixture({ owner: false, search: true });
  assert.equal((await denied.run()).status, 403);
  const empty = await fixture({ search: true });
  assert.deepEqual(await (await empty.run({ query: "pe" })).json(), []);
  assert.deepEqual(empty.limits, []);
  const matching = await fixture({ search: true });
  assert.equal((await matching.run()).status, 200);
  assert.deepEqual(matching.limits, [20]);
  assert.match(JSON.stringify(matching.predicates), /notInArray/);
  assert.match(JSON.stringify(matching.predicates), /demo/);
});
