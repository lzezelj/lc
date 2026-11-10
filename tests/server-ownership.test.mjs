import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const actor = "11111111-1111-4111-8111-111111111111",
  target = "22222222-2222-4222-8222-222222222222",
  serverId = "33333333-3333-4333-8333-333333333333";
const source = await readFile(
  new URL("../app/api/servers/[serverId]/ownership/route.ts", import.meta.url),
  "utf8",
);
const moderatorSource = await readFile(
  new URL("../app/api/servers/[serverId]/members/route.ts", import.meta.url),
  "utf8",
);
function fixture({
  authenticated = true,
  owner = true,
  member = true,
  role = "member",
  disabled = false,
  expired = false,
  count = 0,
  limited = false,
  actorRole,
  targetRole = "member",
} = {}) {
  const tables = Object.fromEntries(
    ["users", "servers", "serverMembers", "channels"].map((name) => [
      name,
      new Proxy(
        { name },
        { get: (item, key) => (key === "name" ? item.name : String(key)) },
      ),
    ]),
  );
  const rows = {
    channels: [],
    users: [
      { id: actor, role: "member" },
      {
        id: target,
        role,
        disabledAt: disabled ? new Date() : null,
        expiresAt: expired ? new Date(0) : null,
      },
    ],
    servers: [
      { id: serverId, createdBy: owner ? actor : target },
      ...Array.from({ length: count }, (_, index) => ({
        id: `extra-${index}`,
        createdBy: target,
      })),
    ],
    serverMembers: [
      {
        serverId,
        userId: actor,
        role: actorRole ?? (owner ? "owner" : "member"),
      },
      ...(member
        ? [
            {
              serverId,
              userId: target,
              role: targetRole,
              voiceMuted: true,
              voiceDeafened: true,
            },
          ]
        : []),
    ],
  };
  const mutations = [],
    locks = [],
    notifications = [];
  const matches = (predicate, row) =>
    !predicate ||
    (predicate.op === "and"
      ? predicate.args.every((item) => matches(item, row))
      : row[predicate.args[0]] === predicate.args[1]);
  const db = {
    select(fields) {
      let table, predicate;
      const query = {
        from(value) {
          table = value.name;
          return query;
        },
        where(value) {
          predicate = value;
          return query;
        },
        for() {
          locks.push([table, predicate]);
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve(
            rows[table]
              .filter((row) => matches(predicate, row))
              .map((row) =>
                Object.fromEntries(
                  Object.entries(fields).map(([key, column]) => [
                    key,
                    row[column],
                  ]),
                ),
              ),
          ).then(resolve, reject);
        },
      };
      return query;
    },
    update(table) {
      return {
        set(values) {
          return {
            where(predicate) {
              const apply = () => {
                mutations.push(table.name);
                const matching = rows[table.name].filter((row) =>
                  matches(predicate, row),
                );
                matching.forEach((row) => Object.assign(row, values));
                return matching;
              };
              return {
                then(resolve, reject) {
                  return Promise.resolve().then(apply).then(resolve, reject);
                },
                async returning(fields) {
                  return apply().map((row) =>
                    Object.fromEntries(
                      Object.entries(fields).map(([key, column]) => [
                        key,
                        row[column],
                      ]),
                    ),
                  );
                },
              };
            },
          };
        },
      };
    },
    delete(table) {
      return {
        where(predicate) {
          return {
            async returning(fields) {
              const matching = rows[table.name].filter((row) =>
                matches(predicate, row),
              );
              rows[table.name] = rows[table.name].filter(
                (row) => !matches(predicate, row),
              );
              return matching.map((row) =>
                Object.fromEntries(
                  Object.entries(fields).map(([key, column]) => [
                    key,
                    row[column],
                  ]),
                ),
              );
            },
          };
        },
      };
    },
    transaction: async (callback) => callback(db),
  };
  const dependencies = {
    "drizzle-orm": {
      and: (...args) => ({ op: "and", args }),
      eq: (...args) => ({ op: "eq", args }),
    },
    "next/server": {
      NextResponse: { json: (data, options) => Response.json(data, options) },
    },
    "../../../../../auth": {
      auth: async () => (authenticated ? { user: { id: actor } } : null),
    },
    "../../../../../db": { db },
    "../../../../../db/schema": tables,
    "../../../../../server/notify-server": {
      notifyServer: async (id) => notifications.push(id),
    },
    "../../../../../server/notify-user": { notifyUser: async () => {} },
    "../../../../../server/disconnect-user": {
      disconnectUserEverywhere: async () => {},
    },
    "../../../../../user-handle": {},
    "../../../../../server/server-invitations": {},
    "../../../../../server/voice-moderation": {
      applyGroupModeration: async () => {},
    },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed: !limited, retryAfterSeconds: 5 }),
      rateLimits: { serverMutation: {} },
      rateLimitMessage: () => "Please wait 5 seconds.",
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  const moderatorExports = {};
  vm.runInNewContext(
    ts.transpile(moderatorSource, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports: moderatorExports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  return {
    rows,
    mutations,
    locks,
    notifications,
    removeMember: () =>
      moderatorExports.DELETE(
        new Request("https://lc.test/api", {
          method: "DELETE",
          body: JSON.stringify({ userId: target }),
        }),
        { params: Promise.resolve({ serverId }) },
      ),
    changeRole: (body = { userId: target, role: "mod" }, scope = serverId) =>
      moderatorExports.PATCH(
        new Request("https://lc.test/api", {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ serverId: scope }) },
      ),
    transfer: (body = { userId: target, confirm: true }) =>
      exports.POST(
        new Request("https://lc.test/api", {
          method: "POST",
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ serverId }) },
      ),
  };
}
test("ownership transfer changes the server record and exactly one owner membership without global promotion", async () => {
  const state = fixture();
  assert.equal((await state.transfer()).status, 200);
  assert.equal(state.rows.servers[0].createdBy, target);
  assert.equal(
    state.rows.serverMembers.find((row) => row.userId === actor).role,
    "member",
  );
  assert.equal(
    state.rows.serverMembers.find((row) => row.userId === target).role,
    "owner",
  );
  assert.equal(
    state.rows.users.find((row) => row.id === target).role,
    "member",
  );
  assert.deepEqual(state.notifications, [serverId]);
  assert.equal(
    state.rows.serverMembers.find((row) => row.userId === target).voiceMuted,
    false,
  );
  assert.equal(
    state.rows.serverMembers.find((row) => row.userId === target).voiceDeafened,
    false,
  );
  assert.deepEqual(
    state.locks.slice(0, 2).map(([, predicate]) => predicate.args[1]),
    [actor, target],
  );
});

test("server owners promote and demote moderators without changing global roles or voice flags", async () => {
  const state = fixture();
  assert.equal((await state.changeRole()).status, 200);
  assert.equal(state.rows.serverMembers[1].role, "mod");
  assert.equal(state.rows.users[1].role, "member");
  assert.equal(state.rows.serverMembers[1].voiceMuted, true);
  assert.equal(state.rows.serverMembers[0].role, "owner");
  assert.deepEqual(state.notifications, [serverId]);
  assert.deepEqual(
    state.locks.slice(0, 3).map(([table]) => table),
    ["users", "users", "servers"],
  );
  assert.equal(
    (await state.changeRole({ userId: target, role: "member" })).status,
    200,
  );
  assert.equal(state.rows.serverMembers[1].role, "member");
});

test("moderator changes reject non-owners, demos, inactive or foreign members and ownership escalation", async () => {
  for (const [options, body, status] of [
    [{ authenticated: false }, undefined, 401],
    [{ actorRole: "mod" }, undefined, 403],
    [{ actorRole: "member" }, undefined, 403],
    [{ owner: false }, undefined, 403],
    [{ member: false }, undefined, 400],
    [{ role: "demo" }, undefined, 400],
    [{ disabled: true }, undefined, 400],
    [{ expired: true }, undefined, 400],
    [{ targetRole: "owner" }, undefined, 400],
    [{ limited: true }, undefined, 429],
    [{}, { userId: actor, role: "mod" }, 400],
    [{}, { userId: target, role: "owner" }, 400],
    [{}, { userId: "invalid", role: "mod" }, 400],
  ]) {
    const state = fixture(options);
    assert.equal((await state.changeRole(body)).status, status);
    assert.deepEqual(state.mutations, []);
    assert.deepEqual(state.notifications, []);
  }
  const foreign = fixture();
  assert.equal(
    (
      await foreign.changeRole(
        undefined,
        "44444444-4444-4444-8444-444444444444",
      )
    ).status,
    403,
  );
  assert.deepEqual(foreign.mutations, []);
});

test("a moderator can receive server ownership under the existing owner-only transfer rules", async () => {
  const state = fixture({ targetRole: "mod" });
  assert.equal((await state.transfer()).status, 200);
  assert.equal(state.rows.serverMembers[1].role, "owner");
});

test("owners can remove moderators while moderators cannot remove other members", async () => {
  const state = fixture({ targetRole: "mod" });
  assert.equal((await state.removeMember()).status, 200);
  assert.equal(
    state.rows.serverMembers.some((row) => row.userId === target),
    false,
  );
  const denied = fixture({ actorRole: "mod" });
  assert.equal((await denied.removeMember()).status, 403);
  assert.equal(denied.rows.serverMembers.length, 2);
});
test("ownership transfer rejects unauthenticated, non-owner, self and unconfirmed requests", async () => {
  for (const [options, body, status] of [
    [{ authenticated: false }, undefined, 401],
    [{ owner: false }, undefined, 403],
    [{}, { userId: actor, confirm: true }, 400],
    [{}, { userId: target }, 400],
    [{ limited: true }, undefined, 429],
  ]) {
    const state = fixture(options);
    assert.equal((await state.transfer(body)).status, status);
    assert.deepEqual(state.mutations, []);
  }
});
test("ownership can only move to active non-demo members", async () => {
  for (const options of [
    { member: false },
    { role: "demo" },
    { disabled: true },
    { expired: true },
  ]) {
    const state = fixture(options);
    assert.equal((await state.transfer()).status, 400);
    assert.deepEqual(state.mutations, []);
  }
});
test("recipient server limit applies to members with a global-owner exemption", async () => {
  const capped = fixture({ count: 3 });
  assert.equal((await capped.transfer()).status, 403);
  assert.deepEqual(capped.mutations, []);
  const globalOwner = fixture({ count: 3, role: "owner" });
  assert.equal((await globalOwner.transfer()).status, 200);
});
