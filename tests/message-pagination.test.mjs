import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const actor = "10000000-0000-4000-8000-000000000001";
const friend = "10000000-0000-4000-8000-000000000002";
const uuid = (number) =>
  `20000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
const sources = await Promise.all(
  [
    "../app/api/direct-messages/[userId]/route.ts",
    "../app/api/channels/[channelId]/messages/route.ts",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")),
);
function fixture({
  channel = false,
  authenticated = true,
  authorized = true,
} = {}) {
  const rows = Array.from({ length: 125 }, (_, index) => ({
    id: uuid(index + 1),
    text: `Message ${index + 1}`,
    createdAt: new Date("2026-11-01T12:00:00Z"),
    sender: index % 2 ? actor : friend,
    recipient: index % 2 ? friend : actor,
    channelId: "channel",
    author: "Sender",
    authorId: actor,
    replyToId: null,
    deletedAt: null,
    kind: index === 4 ? "call" : "message",
  }));
  rows.push({
    ...rows[0],
    id: uuid(999),
    sender: "stranger",
    recipient: actor,
    channelId: "private",
  });
  const limits = [];
  let queries = 0;
  const op =
    (operation) =>
    (...args) => ({ operation, args });
  function match(predicate, row) {
    if (!predicate) return true;
    const { operation, args } = predicate;
    const value = row[args[0]];
    if (operation === "and") return args.every((arg) => match(arg, row));
    if (operation === "or") return args.some((arg) => match(arg, row));
    if (operation === "lt") return value < args[1];
    if (operation === "eq")
      return value instanceof Date
        ? value.getTime() === new Date(args[1]).getTime()
        : value === args[1];
    throw new Error(operation);
  }
  const prefix = channel ? "../../../../../" : "../../../../";
  const dependencies = {
    "drizzle-orm": Object.fromEntries(
      ["and", "or", "eq", "lt", "desc", "inArray"].map((name) => [
        name,
        op(name),
      ]),
    ),
    "drizzle-orm/pg-core": { alias: (table) => table },
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    [`${prefix}auth`]: {
      auth: async () => (authenticated ? { user: { id: actor } } : null),
    },
    [`${prefix}db/schema`]: {
      directMessages: {
        id: "id",
        createdAt: "createdAt",
        senderId: "sender",
        recipientId: "recipient",
      },
      messages: { id: "id", createdAt: "createdAt", channelId: "channelId" },
      friendships: {},
      users: {},
      channels: "channels",
      serverMembers: {},
    },
    [`${prefix}server/friends`]: { areFriends: async () => authorized },
    [`${prefix}server/rate-limit`]: {},
    [`${prefix}server/notify-user`]: {},
    [`${prefix}db`]: {
      db: {
        select: () => ({
          from: (table) => ({
            innerJoin: () => ({
              where: (predicate) => {
                if (table === "channels")
                  return Promise.resolve(authorized ? [{ id: "channel" }] : []);
                return {
                  orderBy: (...order) => ({
                    limit: async (limit) => {
                      queries++;
                      limits.push(limit);
                      return rows
                        .filter((row) => match(predicate, row))
                        .sort((a, b) => {
                          for (const sort of order) {
                            const key = sort.args[0];
                            if (a[key] < b[key]) return 1;
                            if (a[key] > b[key]) return -1;
                          }
                          return 0;
                        })
                        .slice(0, limit);
                    },
                  }),
                };
              },
            }),
          }),
        }),
      },
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(sources[channel ? 1 : 0], {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      URL,
      require: (key) => {
        assert.ok(key in dependencies, key);
        return dependencies[key];
      },
    },
  );
  return {
    rows,
    limits,
    queries: () => queries,
    get: (query = "") =>
      exports.GET(new Request(`http://localhost/messages${query}`), {
        params: Promise.resolve(
          channel ? { channelId: "channel" } : { userId: friend },
        ),
      }),
  };
}

test("direct and channel history return the latest 50 messages in chronological order", async () => {
  for (const channel of [false, true]) {
    const f = fixture({ channel });
    const response = await f.get();
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.messages.length, 50);
    assert.equal(page.messages[0].id, uuid(76));
    assert.equal(page.messages.at(-1).id, uuid(125));
    assert.equal(page.nextCursor.beforeId, uuid(76));
    assert.deepEqual(f.limits, [51]);
  }
});
test("cursor pages handle shared timestamps and concurrent new arrivals without duplicates or gaps", async () => {
  for (const channel of [false, true]) {
    const f = fixture({ channel });
    let page = await (await f.get()).json();
    const ids = page.messages.map((message) => message.id);
    f.rows.push({ ...f.rows[0], id: uuid(126) });
    while (page.nextCursor) {
      page = await (
        await f.get(`?${new URLSearchParams(page.nextCursor)}`)
      ).json();
      assert.ok(page.messages.length <= 50);
      ids.unshift(...page.messages.map((message) => message.id));
    }
    assert.deepEqual(
      ids,
      Array.from({ length: 125 }, (_, index) => uuid(index + 1)),
    );
  }
});
test("history cursors reject partial, empty and invalid input before querying messages", async () => {
  for (const channel of [false, true]) {
    const f = fixture({ channel });
    for (const query of [
      "?beforeId=",
      `?beforeId=${uuid(2)}`,
      "?beforeCreatedAt=bad&beforeId=bad",
      "?beforeCreatedAt=2026-11-01&beforeId=invalid",
    ]) {
      assert.equal((await f.get(query)).status, 400);
    }
    assert.equal(f.queries(), 0);
  }
});
test("history requires membership or friendship and an authenticated account", async () => {
  for (const channel of [false, true])
    for (const options of [{ authenticated: false }, { authorized: false }]) {
      const f = fixture({ channel, ...options });
      assert.equal((await f.get()).status, 403);
      assert.equal(f.queries(), 0);
    }
});

const pageSource = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const pageAst = ts.createSourceFile(
  "page.tsx",
  pageSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const historyCode = {};
function visitPage(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    ["mergeChatMessages", "loadOlderDirectMessages", "toChatMessage"].includes(
      node.name?.text,
    )
  )
    historyCode[node.name.text] = node.getText(pageAst);
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(pageAst) === "useEffect" &&
    node.arguments[0]
      .getText(pageAst)
      .includes("const userId = selectedFriend?.id")
  )
    historyCode.effect = node.arguments[0].getText(pageAst);
  ts.forEachChild(node, visitPage);
}
visitPage(pageAst);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function historyFixture() {
  const requests = [];
  const context = {
    selectedFriend: { id: friend },
    directHistoryGeneration: { current: 0 },
    directMessages: [],
    directMessageCursor: null,
    loadingOlderDirect: false,
    URLSearchParams,
    fetch: (url) =>
      new Promise((resolve) =>
        requests.push({
          url,
          resolve: (page) => resolve({ ok: true, json: async () => page }),
        }),
      ),
    readJsonResponse: (response) => response.json(),
    apiErrorMessage: () => "Request failed",
  };
  for (const key of [
    "DirectMessages",
    "DirectMessageCursor",
    "LoadingOlderDirect",
    "DirectHistoryLoaded",
    "ErrorMessage",
  ]) {
    const state = key[0].toLowerCase() + key.slice(1);
    context[`set${key}`] = (value) => {
      context[state] =
        typeof value === "function" ? value(context[state]) : value;
    };
  }
  vm.runInNewContext(
    ts.transpile(
      `${historyCode.mergeChatMessages}\n${historyCode.toChatMessage}\n${historyCode.loadOlderDirectMessages}`,
      { target: ts.ScriptTarget.ES2022 },
    ),
    context,
  );
  return {
    context,
    requests,
    start: () =>
      vm.runInNewContext(
        ts.transpile(`(${historyCode.effect})();`, {
          target: ts.ScriptTarget.ES2022,
        }),
        context,
      ),
  };
}
test("late direct history responses cannot overwrite another conversation", async () => {
  const f = historyFixture();
  const cleanup = f.start();
  await settle();
  cleanup();
  f.context.selectedFriend = { id: "another" };
  f.start();
  await settle();
  f.requests[1].resolve({
    messages: [
      {
        id: uuid(2),
        text: "Current",
        author: "Current",
        authorId: "another",
        createdAt: "2026-11-01T12:00:00Z",
      },
    ],
    nextCursor: null,
  });
  await settle();
  f.requests[0].resolve({
    messages: [
      {
        id: uuid(1),
        text: "Old conversation",
        createdAt: "2026-11-01T12:00:00Z",
      },
    ],
    nextCursor: null,
  });
  await settle();
  assert.equal(f.context.directMessages[0].text, "Current");
  assert.equal(f.context.directHistoryLoaded, "another");
  f.context.directMessageCursor = {
    beforeCreatedAt: "2026-11-01T12:00:00Z",
    beforeId: uuid(2),
  };
  const older = f.context.loadOlderDirectMessages();
  f.context.directHistoryGeneration.current++;
  f.requests[2].resolve({
    messages: [
      {
        id: uuid(1),
        text: "Stale older page",
        createdAt: "2026-11-01T12:00:00Z",
      },
    ],
    nextCursor: null,
  });
  await older;
  assert.equal(f.context.directMessages.length, 1);
});
test("initial history merges real-time messages without duplicates or losing newer content", async () => {
  const f = historyFixture();
  f.start();
  await settle();
  f.context.directMessages = [{ id: uuid(2), text: "Newer live content" }];
  f.requests[0].resolve({
    messages: [
      { id: uuid(1), text: "Older", createdAt: "2026-11-01T12:00:00Z" },
      { id: uuid(2), text: "Stale content", createdAt: "2026-11-01T12:00:00Z" },
    ],
    nextCursor: null,
  });
  await settle();
  assert.equal(f.context.directMessages.length, 2);
  assert.equal(f.context.directMessages[0].id, uuid(1));
  assert.equal(f.context.directMessages[1].text, "Newer live content");
});
