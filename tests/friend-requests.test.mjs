import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { normalizeUserHandle } from "../user-handle.ts";

const actorId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const source = await readFile(
  new URL("../app/api/friends/route.ts", import.meta.url),
  "utf8",
);

test("Friends list fetches only scoped friendship and profile metadata, never DM history", async () => {
  for (const mode of ["friends", "empty", "anonymous"]) {
    const schema = {
      friendships: { requesterId: "requesterId", recipientId: "recipientId" },
      users: { id: "id", name: "name", handle: "handle", image: "image" },
    };
    const activity = "2026-11-04T10:00:00.000Z";
    const rows = [
      {
        requesterId: actorId,
        recipientId: targetId,
        status: "accepted",
        lastActivityAt: activity,
      },
      {
        requesterId: "incoming",
        recipientId: actorId,
        status: "pending",
        lastActivityAt: null,
      },
    ];
    const reads = [];
    const dependencies = {
      "drizzle-orm": Object.fromEntries(
        ["eq", "and", "or"].map((op) => [op, (...args) => ({ op, args })]),
      ),
      "next/server": { NextResponse: { json: Response.json } },
      "../../../auth": {
        auth: async () =>
          mode === "anonymous" ? null : { user: { id: actorId } },
      },
      "../../../db/schema": schema,
      "../../../db": {
        db: {
          select: () => ({
            from: (table) => ({
              where: async (predicate) => {
                assert.ok(
                  table === schema.friendships || table === schema.users,
                  "Friends must not query message storage",
                );
                reads.push({ table, predicate });
                return table === schema.friendships
                  ? mode === "empty"
                    ? []
                    : rows
                  : [
                      {
                        id: targetId,
                        name: "Friend",
                        handle: "friend.0001",
                        image: null,
                      },
                      {
                        id: "incoming",
                        name: "Requester",
                        handle: "requester.0002",
                        image: null,
                      },
                    ];
              },
            }),
          }),
        },
      },
      "../../../server/notify-user": {},
      "../../../user-handle": { normalizeUserHandle },
    };
    const exports = {};
    vm.runInNewContext(
      ts.transpile(source, { module: ts.ModuleKind.CommonJS }),
      {
        exports,
        require: (key) => {
          assert.ok(key in dependencies, key);
          return dependencies[key];
        },
      },
    );
    const response = await exports.GET();
    assert.equal(response.status, mode === "anonymous" ? 401 : 200);
    assert.equal(
      reads.length,
      mode === "anonymous" ? 0 : mode === "empty" ? 1 : 2,
    );
    if (mode === "anonymous") continue;
    assert.deepEqual(JSON.parse(JSON.stringify(reads[0].predicate)), {
      op: "or",
      args: [
        { op: "eq", args: ["requesterId", actorId] },
        { op: "eq", args: ["recipientId", actorId] },
      ],
    });
    const people = await response.json();
    if (mode === "empty") {
      assert.deepEqual(people, []);
      continue;
    }
    assert.deepEqual(people, [
      {
        id: targetId,
        name: "Friend",
        handle: "friend.0001",
        image: null,
        status: "accepted",
        incoming: false,
        lastActivityAt: activity,
      },
      {
        id: "incoming",
        name: "Requester",
        handle: "requester.0002",
        image: null,
        status: "pending",
        incoming: true,
        lastActivityAt: null,
      },
    ]);
  }
});

function fixture({
  role = "member",
  authenticated = true,
  target = targetId,
  existing = false,
} = {}) {
  const predicates = [],
    writes = [],
    notifications = [];
  let queries = 0;
  const dependencies = {
    "drizzle-orm": Object.fromEntries(
      ["and", "or", "eq", "desc"].map((op) => [
        op,
        (...args) => ({ op, args }),
      ]),
    ),
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "../../../auth": {
      auth: async () =>
        authenticated ? { user: { id: actorId, role } } : null,
    },
    "../../../db/schema": {
      users: { id: "users.id", handle: "users.handle" },
      friendships: {},
      directMessages: {},
    },
    "../../../user-handle": { normalizeUserHandle },
    "../../../server/notify-user": {
      notifyUser: async (...args) => notifications.push(args),
    },
    "../../../db": {
      db: {
        select: () => ({
          from: () => ({
            where: async (predicate) => {
              predicates.push(predicate);
              queries++;
              return queries === 1
                ? target
                  ? [{ id: target }]
                  : []
                : existing
                  ? [{ id: "friendship" }]
                  : [];
            },
          }),
        }),
        insert: () => ({ values: async (values) => writes.push(values) }),
      },
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
      require: (key) => {
        assert.ok(key in dependencies, key);
        return dependencies[key];
      },
    },
  );
  return {
    writes,
    predicates,
    notifications,
    request: (body) =>
      exports.POST(
        new Request("http://localhost/api/friends", {
          method: "POST",
          body: JSON.stringify({ action: "request", ...body }),
        }),
      ),
  };
}

test("profile friend requests resolve a user ID and notify only the target", async () => {
  const f = fixture();
  assert.equal((await f.request({ userId: targetId })).status, 201);
  assert.deepEqual(JSON.parse(JSON.stringify(f.predicates[0])), {
    op: "eq",
    args: ["users.id", targetId],
  });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].requesterId, actorId);
  assert.equal(f.writes[0].recipientId, targetId);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0][0], targetId);
  assert.equal(f.notifications[0][1].type, "friendship-changed");
});

test("handle-based requests remain supported", async () => {
  const f = fixture();
  assert.equal((await f.request({ handle: "lovro (0001)" })).status, 201);
  assert.deepEqual(JSON.parse(JSON.stringify(f.predicates[0])), {
    op: "eq",
    args: ["users.handle", normalizeUserHandle("lovro (0001)")],
  });
});

test("profile requests retain authentication and demo-account restrictions", async () => {
  for (const options of [{ authenticated: false }, { role: "demo" }]) {
    const f = fixture(options);
    assert.equal((await f.request({ userId: targetId })).status, 403);
    assert.equal(f.predicates.length, 0);
    assert.equal(f.writes.length, 0);
  }
});

test("self, missing, duplicate and malformed profile requests never create friendships", async () => {
  for (const [options, body, status] of [
    [{ target: actorId }, { userId: actorId }, 404],
    [{ target: null }, { userId: targetId }, 404],
    [{ existing: true }, { userId: targetId }, 409],
    [{}, { userId: "invalid" }, 400],
  ]) {
    const f = fixture(options);
    assert.equal((await f.request(body)).status, status);
    assert.equal(f.writes.length, 0);
    assert.equal(f.notifications.length, 0);
  }
});
