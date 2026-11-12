import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { normalizeUserHandle } from "../user-handle.ts";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const actorId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const source = await readFile(
  new URL("../app/api/friends/route.ts", import.meta.url),
  "utf8",
);

test("shared friendship actions require confirmation, retain errors, and disable pending requests", async () => {
  const slots = [];
  let cursor = 0,
    calls = 0;
  const exports = {},
    jsx = (type, props) => ({ type, props });
  vm.runInNewContext(
    ts.transpile(
      await readFile(
        new URL("../app/friendship-actions.tsx", import.meta.url),
        "utf8",
      ),
      { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    ),
    {
      exports,
      Error,
      require(name) {
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        return {
          useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = initial;
            return [
              slots[index],
              (value) => {
                slots[index] = value;
              },
            ];
          },
        };
      },
    },
  );
  const nodes = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(nodes)
        : [node, ...nodes(node.props?.children)];
  const props = {
    name: "Alex",
    onRemoveFriend: async () => {
      calls++;
      throw new Error("Try again");
    },
  };
  const render = (value = props) => {
    cursor = 0;
    return nodes(exports.FriendshipActions(value));
  };
  render()
    .find((node) => node.type === "button")
    .props.onClick();
  assert.equal(calls, 0);
  const confirmation = render().find(
    (node) => node.props?.children === "Confirm remove friend",
  );
  confirmation.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.ok(
    render().some(
      (node) =>
        node.props?.role === "alert" && node.props.children === "Try again",
    ),
  );
  assert.ok(
    render({ name: "Alex", requestPending: true }).some(
      (node) => node.type === "button" && node.props.disabled,
    ),
  );
  assert.equal(
    render({
      name: "Alex",
      unavailable: true,
      onAddFriend: async () => {},
    }).filter((node) => node.type === "button").length,
    0,
  );
});

test("friend discovery debounces typing and ignores responses after cancellation", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let search, effect;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "searchFriends"
    )
      search = node.initializer.arguments[0].getText(ast);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0].getText(ast).includes("friendSearchTimer.current =")
    )
      effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const timers = new Map(),
    requests = [];
  let results = [];
  const scope = {
    friendSearch: "alice",
    session: { user: { id: actorId } },
    friendSearchTimer: { current: null },
    friendSearchRequest: { current: null },
    AbortController,
    SEARCH_DEBOUNCE_MS: 500,
    setTimeout: (callback, delay) => {
      const id = {};
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: (url, options) =>
      new Promise((resolve) => requests.push({ url, options, resolve })),
    setFriendResults: (value) => {
      results = value;
    },
    setErrorMessage: () =>
      assert.fail("Cancelled searches must not show errors"),
  };
  scope.searchFriends = vm.runInNewContext(ts.transpile(`(${search})`), scope);
  const start = vm.runInNewContext(ts.transpile(`(${effect})`), scope);
  let cleanup = start();
  assert.equal(requests.length, 0);
  assert.equal([...timers.values()][0].delay, 500);
  cleanup();
  assert.equal(timers.size, 0);
  scope.friendSearch = "alicia";
  cleanup = start();
  [...timers.values()][0].callback();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /q=alicia$/);
  cleanup();
  requests[0].resolve({ ok: true, json: async () => [{ id: "obsolete" }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(results, []);
  scope.friendSearch = "al";
  start();
  assert.equal(timers.size, 0);
  const immediate = scope.searchFriends("alice");
  assert.equal(requests.length, 2);
  requests[1].resolve({ ok: true, json: async () => [{ id: targetId }] });
  await immediate;
  assert.equal(results[0].id, targetId);
});

test("conversation APIs derive identity from the session and reject unauthorized peer resolution", async () => {
  const source = await readFile(
    new URL("../app/api/conversations/route.ts", import.meta.url),
    "utf8",
  );
  let authenticated = true,
    allowed = true;
  const lookups = [],
    checks = [],
    exports = {};
  const dependencies = {
    "../../../auth": {
      auth: async () => (authenticated ? { user: { id: actorId } } : null),
    },
    "../../../server/direct-conversations": {
      canMessage: async (actor, peer) => {
        checks.push([actor, peer]);
        return allowed;
      },
      conversationPeers: async (actor, peer) => {
        lookups.push([actor, peer]);
        return [
          {
            id: targetId,
            status: "none",
            canMessage: true,
            lastMessage: { text: "Kept history" },
          },
        ];
      },
    },
  };
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      Response,
      require: (name) => dependencies[name],
    },
  );
  const post = () =>
    exports.POST(
      new Request("http://lc.test/api/conversations", {
        method: "POST",
        body: JSON.stringify({ userId: targetId, actorId: "forged" }),
      }),
    );
  assert.equal((await post()).status, 200);
  assert.deepEqual(checks[0], [actorId, targetId]);
  assert.deepEqual(lookups[0], [actorId, targetId]);
  assert.equal((await (await exports.GET()).json())[0].status, "none");
  allowed = false;
  assert.equal((await post()).status, 403);
  assert.equal(
    lookups.length,
    2,
    "Forbidden requests cannot resolve profile metadata",
  );
  authenticated = false;
  assert.equal((await post()).status, 403);
  assert.equal((await exports.GET()).status, 403);
});

test("Friends list scopes metadata and bounded last-message previews to accepted friends", async () => {
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
    const previewQueries = [];
    const dependencies = {
      "drizzle-orm": Object.fromEntries([
        ...["eq", "and", "or"].map((op) => [op, (...args) => ({ op, args })]),
        ["sql", sql],
      ]),
      "next/server": { NextResponse: { json: Response.json } },
      "../../../auth": {
        auth: async () =>
          mode === "anonymous" ? null : { user: { id: actorId } },
      },
      "../../../db/schema": schema,
      "../../../db": {
        db: {
          execute: async (query) => {
            const compiled = new PgDialect().sqlToQuery(query);
            previewQueries.push(compiled);
            assert.match(compiled.sql, /f.status = 'accepted'/);
            assert.equal((compiled.sql.match(/limit 1/g) ?? []).length, 3);
            assert.match(compiled.sql, /left\(latest.content, 160\)/);
            assert.ok(compiled.params.every((value) => value === actorId));
            return {
              rows: [
                { id: targetId, senderId: targetId, text: "Latest message" },
              ],
            };
          },
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
    assert.equal(previewQueries.length, mode === "friends" ? 1 : 0);
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
        lastMessage: { senderId: targetId, text: "Latest message" },
      },
      {
        id: "incoming",
        name: "Requester",
        handle: "requester.0002",
        image: null,
        status: "pending",
        incoming: true,
        lastActivityAt: null,
        lastMessage: null,
      },
    ]);
  }
});

function fixture({
  role = "member",
  authenticated = true,
  target = targetId,
  existing = false,
  removeExists = true,
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
      friendships: {
        requesterId: "requesterId",
        recipientId: "recipientId",
        status: "status",
      },
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
        delete: () => ({
          where: (predicate) => ({
            returning: async () => {
              predicates.push(predicate);
              if (!removeExists) return [];
              writes.push({ removed: true });
              return [{ requesterId: actorId, recipientId: targetId }];
            },
          }),
        }),
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

test("removing friends scopes deletion to accepted relationships in either actor direction and notifies both accounts", async () => {
  const f = fixture();
  assert.equal(
    (await f.request({ action: "remove", userId: targetId })).status,
    200,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(f.predicates[0])), {
    op: "and",
    args: [
      { op: "eq", args: ["status", "accepted"] },
      {
        op: "or",
        args: [
          {
            op: "and",
            args: [
              { op: "eq", args: ["requesterId", actorId] },
              { op: "eq", args: ["recipientId", targetId] },
            ],
          },
          {
            op: "and",
            args: [
              { op: "eq", args: ["requesterId", targetId] },
              { op: "eq", args: ["recipientId", actorId] },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    f.notifications.map(([id]) => id).sort(),
    [actorId, targetId].sort(),
  );
  assert.ok(
    f.notifications.every(([, event]) => event.type === "friendship-changed"),
  );
});

test("friend removal rejects anonymous/demo actors, invalid IDs and absent relationships without notifications", async () => {
  for (const [options, userId, status] of [
    [{ authenticated: false }, targetId, 403],
    [{ role: "demo" }, targetId, 403],
    [{}, "invalid", 400],
    [{ removeExists: false }, targetId, 404],
  ]) {
    const f = fixture(options);
    assert.equal(
      (await f.request({ action: "remove", userId })).status,
      status,
    );
    assert.equal(f.writes.length, 0);
    assert.equal(f.notifications.length, 0);
  }
});

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
  assert.equal(f.notifications[0][1].notification, "friend-request");
  assert.equal(f.notifications[0][1].fromUserId, actorId);
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
