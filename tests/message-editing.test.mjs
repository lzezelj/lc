import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resolveReplyTarget } from "../app/reply-navigation.ts";

test("reply composer focuses at the end of the draft and respects disabled or busy state", async () => {
  const source = await readFile(
    new URL("../app/message-composer.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "message-composer.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let effect;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useLayoutEffect" &&
      node.arguments[0].getText(ast).includes("!replyId")
    )
      effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect);
  for (const state of [
    { replyId: "original", disabled: false, busy: false },
    { replyId: undefined, disabled: false, busy: false },
    { replyId: "original", disabled: true, busy: false },
    { replyId: "original", disabled: false, busy: true },
  ]) {
    let focused = false,
      selection;
    const textarea = {
      current: {
        value: "existing draft",
        focus: () => {
          focused = true;
        },
        setSelectionRange: (...args) => {
          selection = args;
        },
      },
    };
    vm.runInNewContext(`(${effect})();`, { ...state, textarea });
    assert.equal(focused, !!state.replyId && !state.disabled && !state.busy);
    if (focused) assert.deepEqual(selection, [14, 14]);
  }
});

test("reply navigation reuses loaded messages and requests scoped history only when needed", async () => {
  const controller = new AbortController();
  let request;
  const fetcher = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ messages: [{ id: "original", text: "hello" }] }),
    };
  };
  assert.equal(
    await resolveReplyTarget({
      targetId: "original",
      messages: [{ id: "original" }],
      channelId: "channel",
      signal: controller.signal,
      fetcher,
    }),
    null,
  );
  assert.equal(request, undefined);
  const rows = await resolveReplyTarget({
    targetId: "original",
    messages: [],
    channelId: "channel",
    signal: controller.signal,
    fetcher,
  });
  assert.equal(rows[0].id, "original");
  const params = new URL(request.url, "https://local.test").searchParams;
  assert.equal(params.get("channelId"), "channel");
  assert.equal(params.get("contextId"), "original");
  assert.equal(request.options.signal, controller.signal);
});

test("reply navigation rejects deleted targets and ignores responses after cancellation", async () => {
  const controller = new AbortController();
  const options = {
    targetId: "original",
    messages: [],
    channelId: "channel",
    signal: controller.signal,
  };
  await assert.rejects(
    resolveReplyTarget({
      ...options,
      messages: [{ id: "original", deleted: true }],
    }),
    /no longer available/,
  );
  await assert.rejects(
    resolveReplyTarget({
      ...options,
      fetcher: async () => ({
        ok: false,
        json: async () => ({ error: "This message is no longer available." }),
      }),
    }),
    /no longer available/,
  );
  await assert.rejects(
    resolveReplyTarget({
      ...options,
      fetcher: async () => {
        controller.abort();
        return {
          ok: true,
          json: async () => ({ messages: [{ id: "original" }] }),
        };
      },
    }),
    { name: "AbortError" },
  );
});
import * as attachmentTypes from "../app/attachment-types.ts";
import {
  applyMessageEdit,
  applyMessageRemoval,
} from "../app/message-updates.ts";

const actor = "10000000-0000-4000-8000-000000000001",
  friend = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
const channelId = "30000000-0000-4000-8000-000000000001",
  otherChannel = "30000000-0000-4000-8000-000000000002";
const id = (number) =>
  `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
async function moduleAt(path, deps, extra = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (key) => {
        assert.ok(key in deps, key);
        return deps[key];
      },
      URL,
      Request,
      Response,
      Buffer,
      Uint8Array,
      process: { env: { SIGNALING_INTERNAL_SECRET: "fixture-secret" } },
      ...extra,
    },
  );
  return exports;
}
const fieldNames = [
  "id",
  "content",
  "createdAt",
  "editedAt",
  "attachments",
  "deletedAt",
  "senderId",
  "recipientId",
  "authorId",
  "channelId",
  "replyToId",
  "kind",
  "callDurationSeconds",
];
const messages = Object.fromEntries(fieldNames.map((name) => [name, name])),
  directMessages = { ...messages };
const channels = { id: "channelId", type: "channelType", serverId: "serverId" },
  members = { serverId: "serverId", userId: "memberUserId" };
const schema = {
  messages,
  directMessages,
  channels,
  serverMembers: members,
  users: { id: "authorId", name: "author" },
};
const numeric = (value) =>
  value && typeof value.getTime === "function" ? value.getTime() : value;
const orm = {
  eq: (field, value) => (row) => numeric(row[field]) === numeric(value),
  lt: (field, value) => (row) => numeric(row[field]) < numeric(value),
  gt: (field, value) => (row) => numeric(row[field]) > numeric(value),
  and:
    (...predicates) =>
    (row) =>
      predicates.filter(Boolean).every((predicate) => predicate(row)),
  or:
    (...predicates) =>
    (row) =>
      predicates.filter(Boolean).some((predicate) => predicate(row)),
  isNull: (field) => (row) => row[field] === null,
  inArray: (field, values) => (row) => values.includes(row[field]),
  asc: (field) => ({ field, sign: 1 }),
  desc: (field) => ({ field, sign: -1 }),
  ilike: (field, pattern) => (row) =>
    String(row[field])
      .toLowerCase()
      .includes(pattern.slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase()),
  sql: (strings, ...values) =>
    strings.join("").includes("exists")
      ? (row) =>
          row[values[0]].some((file) =>
            file.name
              .toLowerCase()
              .includes(
                values[1].slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase(),
              ),
          )
      : strings.join("").includes("::timestamptz")
        ? new Date(values[0])
        : () => true,
};
const reader = await moduleAt("../server/message-attachments.ts", {
  "./notify-user": { notifyUser: async () => {} },
  "node:crypto": { randomUUID },
  "drizzle-orm": orm,
  "../db": { db: {} },
  "../db/schema": schema,
  "../app/attachment-types": attachmentTypes,
});

async function fixture({
  direct = false,
  account = actor,
  member = true,
  friends = true,
  limited = false,
  removedOnUpdate = false,
} = {}) {
  const rows = Array.from({ length: 125 }, (_, index) => ({
    id: id(index + 1),
    content: `Needle message ${index + 1}`,
    text: `Needle message ${index + 1}`,
    createdAt: new Date("2026-11-04T10:00:00Z"),
    sortTimestamp: "2026-11-04T10:00:00.000000Z",
    editedAt: null,
    attachments: [],
    deletedAt: null,
    senderId: index % 2 ? actor : friend,
    recipientId: index % 2 ? friend : actor,
    authorId: actor,
    author: "Actor",
    channelId,
    replyToId: null,
    kind: "message",
    callDurationSeconds: null,
    memberUserId: member ? actor : stranger,
  }));
  rows.push({
    ...rows[0],
    id: id(500),
    channelId: otherChannel,
    senderId: stranger,
    recipientId: actor,
  });
  rows.push({
    ...rows[0],
    id: id(501),
    deletedAt: new Date(),
    content: "Needle removed",
    text: "Needle removed",
  });
  const writes = [],
    notices = [],
    queries = [];
  const db = {
    select() {
      return {
        from(table) {
          let predicate = () => true,
            order = [];
          const selected = () => {
            let result =
              table === channels
                ? [
                    {
                      channelId,
                      channelType: "text",
                      memberUserId: member ? actor : stranger,
                    },
                  ]
                : rows;
            result = result.filter(predicate).slice();
            result.sort((a, b) => {
              for (const { field, sign } of order) {
                const x = numeric(a[field]),
                  y = numeric(b[field]);
                if (x !== y) return (x < y ? -1 : 1) * sign;
              }
              return 0;
            });
            return result;
          };
          const query = {
            innerJoin() {
              return query;
            },
            where(value) {
              predicate = value;
              queries.push(value);
              return query;
            },
            orderBy(...value) {
              order = value;
              return query;
            },
            async limit(count) {
              return selected().slice(0, count);
            },
            then(resolve, reject) {
              return Promise.resolve(selected()).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
    update() {
      return {
        set(values) {
          return {
            where(predicate) {
              return {
                async returning() {
                  if (removedOnUpdate) return [];
                  const found = rows.filter(predicate);
                  writes.push(values);
                  found.forEach((row) =>
                    Object.assign(row, values, { text: values.content }),
                  );
                  return found.map((row) => ({
                    id: row.id,
                    text: row.content,
                    editedAt: row.editedAt,
                  }));
                },
              };
            },
          };
        },
      };
    },
  };
  const common = { "drizzle-orm": orm };
  const edits = await moduleAt(
    "../server/edit-message.ts",
    {
      ...common,
      "../auth": {
        auth: async () =>
          account ? { user: { id: account, role: "owner" } } : null,
      },
      "../db": { db },
      "../db/schema": schema,
      "./direct-conversations": { canMessage: async () => friends },
      "./message-attachments": reader,
      "./rate-limit": {
        checkRateLimit: () => ({ allowed: !limited, retryAfterSeconds: 3 }),
        rateLimits: { message: {} },
        rateLimitMessage: () => "wait",
      },
      "./notify-user": {
        notifyUser: async (userId, event) => {
          assert.ok(writes.length, "notification preceded persistence");
          notices.push({ userId, event });
        },
      },
    },
    {
      fetch: async (url, options) => {
        assert.ok(writes.length);
        notices.push({ url, event: JSON.parse(options.body) });
        return new Response(null, { status: 204 });
      },
    },
  );
  const search = await moduleAt("../app/api/message-search/route.ts", {
    ...common,
    "../../../auth": {
      auth: async () => (account ? { user: { id: account } } : null),
    },
    "../../../db": { db },
    "../../../db/schema": schema,
    "../../../server/direct-conversations": { canMessage: async () => friends },
    "../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed: !limited, retryAfterSeconds: 3 }),
      rateLimitMessage: () => "wait",
    },
  });
  return {
    rows,
    writes,
    notices,
    queries,
    edit: (text, messageId = id(2), userId = friend) =>
      edits[direct ? "editDirectMessage" : "editChannelMessage"](
        new Request("http://localhost/message", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }),
        {
          params: Promise.resolve({ messageId, ...(direct ? { userId } : {}) }),
        },
      ),
    search: (params) =>
      search.GET(
        new Request(
          `http://localhost/api/message-search?${new URLSearchParams({ ...(direct ? { userId: friend } : { channelId }), ...params })}`,
        ),
      ),
  };
}

test("edits enforce author, current access, friendship, deletion and call-event boundaries", async () => {
  for (const direct of [false, true]) {
    for (const options of [
      { account: null },
      { account: stranger },
      { ...(direct ? { friends: false } : { member: false }) },
    ]) {
      const f = await fixture({ direct, ...options });
      assert.equal((await f.edit("changed")).status, 403);
      assert.equal(f.writes.length, 0);
    }
    const f = await fixture({ direct });
    assert.equal((await f.edit("changed", id(501))).status, 403);
    if (direct) {
      f.rows[1].kind = "call";
      assert.equal((await f.edit("changed")).status, 403);
      f.rows[1].kind = "message";
      assert.equal((await f.edit("changed", id(2), stranger)).status, 403);
    }
  }
});
test("edits trim text, preserve attachments and notify both DM users only after persistence", async () => {
  for (const direct of [false, true]) {
    const f = await fixture({ direct });
    f.rows[1].attachments = [{ id: "file", name: "photo.png" }];
    const response = await f.edit("  changed\ntext  ");
    assert.equal(response.status, 200);
    const message = await response.json();
    assert.equal(message.text, "changed\ntext");
    assert.ok(Date.parse(message.editedAt));
    assert.equal(f.rows[1].attachments[0].id, "file");
    assert.equal(f.notices.length, direct ? 2 : 1);
    if (direct)
      assert.deepEqual(
        f.notices.map((notice) => notice.userId).sort(),
        [actor, friend].sort(),
      );
    assert.equal(
      (await f.edit("")).status,
      200,
      "Attachment captions may be removed",
    );
  }
});
test("invalid, rate-limited and concurrently deleted edits cannot save or broadcast", async () => {
  for (const direct of [false, true]) {
    const f = await fixture({ direct });
    for (const text of [" ", "x".repeat(4001), 42, null])
      assert.equal((await f.edit(text)).status, 400);
    assert.equal((await f.edit("valid", "bad-id")).status, 400);
    assert.equal(f.writes.length, 0);
    const limited = await fixture({ direct, limited: true });
    const response = await limited.edit("change");
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "3");
    assert.equal(limited.writes.length, 0);
    const removed = await fixture({ direct, removedOnUpdate: true });
    assert.equal((await removed.edit("change")).status, 404);
    assert.equal(removed.notices.length, 0);
  }
});
test("search pages stored history with stable timestamp ties and excludes foreign/deleted messages", async () => {
  for (const direct of [false, true]) {
    const f = await fixture({ direct });
    const first = await (await f.search({ q: "needle" })).json();
    assert.equal(first.messages.length, 50);
    assert.equal(first.messages[0].id, id(125));
    assert.equal(first.nextCursor.beforeId, id(76));
    const second = await (
      await f.search({ q: "needle", ...first.nextCursor })
    ).json();
    assert.equal(second.messages.length, 50);
    assert.equal(second.messages[0].id, id(75));
    const third = await (
      await f.search({ q: "needle", ...second.nextCursor })
    ).json();
    assert.equal(third.messages.length, 25);
    assert.equal(third.nextCursor, null);
    assert.equal(
      new Set(
        [...first.messages, ...second.messages, ...third.messages].map(
          (row) => row.id,
        ),
      ).size,
      125,
    );
  }
});
test("search supports literal wildcard text and attachment filenames; context remains scoped", async () => {
  for (const direct of [false, true]) {
    const f = await fixture({ direct });
    f.rows[1].attachments = [{ id: "file", name: "Report%_2026.pdf" }];
    const result = await (await f.search({ q: "%_" })).json();
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, id(2));
    const context = await (await f.search({ contextId: id(60) })).json();
    assert.equal(context.messages.length, 51);
    assert.equal(context.messages[25].id, id(60));
    assert.equal(context.messages[0].id, id(35));
    assert.equal(context.messages.at(-1).id, id(85));
    assert.equal((await f.search({ contextId: id(500) })).status, 404);
    assert.equal((await f.search({ contextId: id(501) })).status, 404);
  }
});
test("search rejects missing access, malformed scope/cursors and excessive query text", async () => {
  for (const direct of [false, true]) {
    for (const options of [
      { account: null },
      direct ? { friends: false } : { member: false },
    ]) {
      const f = await fixture({ direct, ...options });
      assert.equal((await f.search({ q: "needle" })).status, 403);
    }
    const f = await fixture({ direct });
    for (const params of [
      { q: "x" },
      { q: "x".repeat(101) },
      { q: "needle", beforeId: id(60) },
      { q: "needle", beforeId: id(60), beforeCreatedAt: "bad" },
      { contextId: "bad" },
    ])
      assert.equal((await f.search(params)).status, 400);
    const limited = await fixture({ direct, limited: true });
    assert.equal((await limited.search({ q: "needle" })).status, 429);
  }
});
test("live edits retain ordering/media and cannot resurrect deletions or overwrite a newer edit", () => {
  const rows = [
    {
      id: "one",
      text: "old",
      editedAt: null,
      attachments: ["file"],
      replyTo: null,
    },
    { id: "reply", text: "reply", replyTo: { id: "one", text: "old" } },
  ];
  const latest = { id: "one", text: "new", editedAt: "2026-11-04T12:00:00Z" };
  const updated = applyMessageEdit(rows, latest);
  assert.deepEqual(
    updated.map((row) => row.id),
    ["one", "reply"],
  );
  assert.equal(updated[1].replyTo.text, "new");
  assert.deepEqual(updated[0].attachments, ["file"]);
  assert.equal(
    applyMessageEdit(updated, {
      ...latest,
      text: "stale",
      editedAt: "2026-11-04T11:00:00Z",
    })[0].text,
    "new",
  );
  const deleted = applyMessageRemoval(updated, "one", false);
  assert.equal(deleted[0].deleted, true);
  assert.deepEqual(deleted[0].attachments, []);
  assert.equal(applyMessageEdit(deleted, latest)[0].text, "Deleted message");
  assert.equal(deleted[1].replyTo.text, "Deleted message");
  const removed = applyMessageRemoval(updated, "one", true);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].replyTo, null);
});

test("actual Home send handlers edit through the current composer, preserve drafts, and update existing rows/caches", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const home = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "Home",
  );
  const functions = home.body.statements
    .filter(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        [
          "sendDirectMessage",
          "submit",
          "saveMessageEdit",
          "updateContext",
        ].includes(node.name?.text),
    )
    .map((node) => node.getText(ast))
    .join("\n");
  for (const direct of [false, true]) {
    const row = {
      id: id(2),
      text: "before",
      editedAt: null,
      attachments: [{ id: "file" }],
    };
    const edit = {
      id: row.id,
      text: "after",
      editedAt: "2026-11-04T12:00:00Z",
    };
    const key = `${actor}:${direct ? `direct:${friend}` : `channel:${channelId}`}`;
    const editing = {
      key,
      message: row,
      ...(direct ? { userId: friend } : { channelId }),
    };
    let active = editing,
      rows = [row],
      context = { key, messages: [row] },
      cached = { messages: [row] },
      draftCleared = false;
    const requests = [];
    const scope = {
      activeEdit: editing,
      editDraft: "after",
      draft: "unsent draft",
      files: [],
      session: { user: { id: actor } },
      sendingMessageRef: { current: false },
      messageCooldown: { blocked: () => false, handleResponse: () => false },
      setSendingMessage: () => {},
      setErrorMessage: (message) => assert.fail(message),
      loadFriends: async () => {},
      selectedFriendId: { current: friend },
      lastTextChannelId: { current: channelId },
      setDirectMessages: (action) => {
        rows = action(rows);
      },
      setMessages: (action) => {
        rows = action(rows);
      },
      setHistoryContext: (action) => {
        context = action(context);
      },
      setEditingMessage: (action) => {
        active = action(active);
      },
      setDraft: () => {
        draftCleared = true;
      },
      conversationCache: {
        current: {
          get: () => cached,
          set: (userId, cacheKey, value) => {
            assert.equal(userId, actor);
            assert.equal(
              cacheKey,
              direct ? `direct:${friend}` : `channel:${channelId}`,
            );
            cached = value;
          },
        },
      },
      applyMessageEdit,
      readJsonResponse: (response) => response.json(),
      apiErrorMessage: () => "failed",
      fetch: async (url, options) => {
        requests.push({ url, options });
        return Response.json(edit);
      },
    };
    vm.runInNewContext(
      ts.transpile(
        `${functions}\nthis.send=sendDirectMessage;this.submitChannel=submit;`,
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      ),
      scope,
    );
    await scope[direct ? "send" : "submitChannel"]({ preventDefault() {} });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, "PATCH");
    assert.equal(
      requests[0].url,
      direct
        ? `/api/direct-messages/${friend}/${row.id}`
        : `/api/messages/${row.id}`,
    );
    assert.equal(rows[0].text, "after");
    assert.equal(context.messages[0].text, "after");
    assert.equal(cached.messages[0].text, "after");
    assert.equal(active, null);
    assert.equal(draftCleared, false);
    assert.equal(scope.sendingMessageRef.current, false);
  }
});
