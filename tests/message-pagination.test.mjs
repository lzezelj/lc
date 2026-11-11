import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { ConversationCache, SessionCache } from "../app/conversation-cache.ts";
import {
  readHistoryWindow,
  reconcileRecoveredHistory,
} from "../app/history-recovery.ts";
import {
  applyMessageEdit,
  applyMessageRemoval,
} from "../app/message-updates.ts";

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
    [`${prefix}server/message-attachments`]: {},
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
    ts.isVariableDeclaration(node) &&
    node.name.getText(pageAst) === "directConversationVisible"
  )
    historyCode.visible = node.initializer.getText(pageAst);
  if (
    ts.isFunctionDeclaration(node) &&
    [
      "mergeChatMessages",
      "loadOlderDirectMessages",
      "loadMoreMessages",
      "toChatMessage",
    ].includes(node.name?.text)
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
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(pageAst) === "useEffect"
  ) {
    const body = node.arguments[0].getText(pageAst);
    if (body.includes("const generation = ++channelHistoryGeneration.current"))
      historyCode.channelEffect = body;
    if (body.includes("directHistoryCacheable.current ==="))
      historyCode.persistDirect = body;
    if (body.includes("channelHistoryCacheable.current ==="))
      historyCode.persistChannel = body;
  }
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText(pageAst) === "onMessage" &&
    node.initializer
      .getText(pageAst)
      .includes("workspaceActivityRef.current.handle(message)")
  )
    historyCode.presenceMessage = node.initializer.getText(pageAst);
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText(pageAst) === "onOpen" &&
    node.initializer.getText(pageAst).includes('type: "get-user-status"')
  )
    historyCode.presenceOpen = node.initializer.getText(pageAst);
  ts.forEachChild(node, visitPage);
}
visitPage(pageAst);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function historyFixture(channel = false) {
  const requests = [];
  const cache = new ConversationCache();
  cache.scope(actor);
  const serverCache = new SessionCache();
  serverCache.scope(actor);
  const context = {
    session: { user: { id: actor } },
    currentUserId: actor,
    conversationCache: { current: cache },
    serverViewCache: { current: serverCache },
    directHistoryCacheable: { current: "" },
    channelHistoryCacheable: { current: "" },
    channelHistoryGeneration: { current: 0 },
    visibleChannelHistory: { current: null },
    visibleDirectHistory: { current: null },
    readHistoryWindow,
    reconcileRecoveredHistory,
    selectedChannelId: "channel-a",
    historyChannelType: "text",
    messages: [],
    nextMessageCursor: null,
    loadingMoreMessages: false,
    workspaceActivityRef: { current: { handle() {} } },
    notificationInboxRef: { current: { refresh() {} } },
    presenceHasConnected: { current: false },
    pendingVoiceChannel: { current: "" },
    voiceChannelIdsRef: { current: [] },
    activeGroupChannelId: { current: "" },
    refreshAccessRef: { current() {} },
    invalidateSignalingToken() {},
    setHistoryRefreshKey() {},
    loadFriends() {},
    selectedFriendId: { current: friend },
    friendsViewRef: { current: false },
    document: { visibilityState: "visible" },
    unreadDirectMessages: {},
    selectedFriend: { id: friend },
    directConversationVisible: true,
    directHistoryGeneration: { current: 0 },
    directMessages: [],
    directMessageCursor: null,
    loadingOlderDirect: false,
    historyContext: null,
    editingMessage: null,
    applyMessageEdit,
    applyMessageRemoval,
    URLSearchParams,
    AbortController,
    fetch: (url, options = {}) =>
      new Promise((resolve) =>
        requests.push({
          url,
          signal: options.signal,
          resolve: (page, ok = true, status = ok ? 200 : 503) =>
            resolve({ ok, status, json: async () => page }),
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
    "Messages",
    "NextMessageCursor",
    "LoadingMoreMessages",
    "ChannelHistoryLoaded",
    "ReadableHistoryChannel",
    "UnreadDirectMessages",
    "HistoryContext",
    "EditingMessage",
  ]) {
    const state = key[0].toLowerCase() + key.slice(1);
    context[`set${key}`] = (value) => {
      context[state] =
        typeof value === "function" ? value(context[state]) : value;
    };
  }
  vm.runInNewContext(
    ts.transpile(
      `${historyCode.mergeChatMessages}\n${historyCode.toChatMessage}\n${historyCode.loadOlderDirectMessages}\n${historyCode.loadMoreMessages}`,
      { target: ts.ScriptTarget.ES2022 },
    ),
    context,
  );
  return {
    context,
    requests,
    cache,
    reconnect: () => {
      context.window = { dispatchEvent() {} };
      context.CustomEvent = class {
        constructor(type) {
          this.type = type;
        }
      };
      context.workspaceActivityRef.current.refresh = () => {};
      context.openedSocket = { send() {} };
      context.activeVoiceServerRef = { current: "" };
      vm.runInNewContext(
        ts.transpile(`(${historyCode.presenceOpen})(openedSocket);`),
        context,
      );
    },
    persist: () =>
      vm.runInNewContext(
        ts.transpile(
          `(${channel ? historyCode.persistChannel : historyCode.persistDirect})();`,
        ),
        context,
      ),
    event: (message) => {
      context.serverOrderRequest ??= { current: 0 };
      context.channelOrderRequests ??= { current: new Map() };
      context.notificationSoundGate = { current: { take: () => null } };
      context.notificationPolicyRef = { current: { enabled: true } };
      context.deafenedRef = { current: false };
      context.incoming = { data: JSON.stringify(message) };
      vm.runInNewContext(
        ts.transpile(`(${historyCode.presenceMessage})(incoming);`),
        context,
      );
    },
    start: () =>
      vm.runInNewContext(
        ts.transpile(
          `(${channel ? historyCode.channelEffect : historyCode.effect})();`,
          {
            target: ts.ScriptTarget.ES2022,
          },
        ),
        context,
      ),
  };
}
test("targeted ordering events refresh lists without clearing histories or changing chat/call selection", async () => {
  const f = historyFixture();
  const calls = [];
  f.context.orderRefreshHandlers = {
    current: {
      servers: async () => calls.push("servers"),
      channels: async (id) => calls.push(id),
    },
  };
  const direct = [{ id: "direct-history" }],
    messages = [{ id: "channel-history" }];
  Object.assign(f.context, {
    directMessages: direct,
    messages,
    selectedChannelId: "selected-channel",
    selectedServerId: "selected-server",
    activeVoiceChannelId: "active-call",
  });
  f.event({ type: "server-order-updated" });
  f.event({ type: "channel-order-updated", serverId: "another-server" });
  await settle();
  assert.deepEqual(calls, ["servers", "another-server"]);
  assert.equal(f.context.directMessages, direct);
  assert.equal(f.context.messages, messages);
  assert.equal(f.context.selectedChannelId, "selected-channel");
  assert.equal(f.context.selectedServerId, "selected-server");
  assert.equal(f.context.activeVoiceChannelId, "active-call");
});

test("direct history is eligible only in the visible friend's chat, including a matching DM call", () => {
  const visible = (values) =>
    vm.runInNewContext(historyCode.visible, {
      friendsView: true,
      callViewOpen: false,
      selectedFriend: { id: friend },
      session: { user: { id: actor } },
      activeVoiceChannelId: "",
      conversationHasCall: (roomId, userId, otherId) =>
        roomId === `friend:${[userId, otherId].sort().join(":")}`,
      ...values,
    });
  assert.equal(visible({}), true);
  assert.equal(visible({ friendsView: false }), false);
  assert.equal(
    visible({ callViewOpen: true, activeVoiceChannelId: "server-voice" }),
    false,
  );
  assert.equal(
    visible({
      callViewOpen: true,
      activeVoiceChannelId: `friend:${actor}:${friend}`,
    }),
    true,
  );
});

test("visited DM and channel histories reuse loaded older pages and cursors across navigation", async () => {
  for (const channel of [false, true]) {
    const f = historyFixture(channel);
    const close = f.start();
    await settle();
    f.requests[0].resolve({
      messages: [
        { id: uuid(2), text: "Latest", createdAt: "2026-11-01T12:00:00Z" },
      ],
      nextCursor: {
        beforeCreatedAt: "2026-11-01T12:00:00Z",
        beforeId: uuid(2),
      },
    });
    await settle();
    const older = channel
      ? f.context.loadMoreMessages()
      : f.context.loadOlderDirectMessages();
    f.requests[1].resolve({
      messages: [
        { id: uuid(1), text: "Older", createdAt: "2026-11-01T11:00:00Z" },
      ],
      nextCursor: null,
    });
    await older;
    f.persist();
    close();
    if (channel) f.context.selectedChannelId = "channel-b";
    else {
      f.context.directConversationVisible = false;
    }
    const closeOther = f.start();
    await settle();
    closeOther?.();
    if (channel) f.context.selectedChannelId = "channel-a";
    else f.context.directConversationVisible = true;
    f.start();
    await settle();
    assert.equal(
      f.requests.length,
      channel ? 3 : 2,
      "Returning to a loaded conversation must not fetch it again",
    );
    const messages = channel ? f.context.messages : f.context.directMessages;
    assert.deepEqual(
      Array.from(messages, (message) => message.id),
      [uuid(1), uuid(2)],
    );
    assert.equal(
      channel ? f.context.nextMessageCursor : f.context.directMessageCursor,
      null,
    );
  }
});

test("live edit events update loaded DM histories/search context without unread changes and deletion cancels editing", () => {
  const f = historyFixture();
  const row = {
    id: uuid(1),
    text: "before",
    attachments: [{ id: "file" }],
    editedAt: null,
    deleted: false,
  };
  f.context.directMessages = [row];
  f.context.historyContext = {
    key: `${actor}:direct:${friend}`,
    messages: [row],
  };
  f.context.editingMessage = { message: row };
  f.cache.set(actor, `direct:${friend}`, { messages: [row], nextCursor: null });
  const unread = JSON.stringify(f.context.unreadDirectMessages);
  f.event({
    type: "direct-message-edited",
    fromUserId: friend,
    edit: { id: row.id, text: "corrected", editedAt: "2026-11-04T12:00:00Z" },
  });
  assert.equal(f.context.directMessages[0].text, "corrected");
  assert.equal(f.context.historyContext.messages[0].text, "corrected");
  assert.equal(
    f.cache.get(actor, `direct:${friend}`).messages[0].text,
    "corrected",
  );
  assert.equal(JSON.stringify(f.context.unreadDirectMessages), unread);
  f.event({
    type: "direct-message-edited",
    fromUserId: "unopened",
    edit: { id: uuid(9), text: "no cache", editedAt: "2026-11-04T12:00:00Z" },
  });
  assert.equal(f.cache.get(actor, "direct:unopened"), undefined);
  f.event({
    type: "direct-message-deleted",
    fromUserId: friend,
    messageId: row.id,
  });
  assert.equal(f.context.editingMessage, null);
  assert.equal(f.context.historyContext.messages[0].deleted, true);
  assert.deepEqual(f.context.historyContext.messages[0].attachments, []);
  f.cache.set(actor, "channel:channel-a", {
    messages: [row],
    nextCursor: null,
  });
  f.event({ type: "channel-history-changed", channelId: "channel-a" });
  assert.equal(f.cache.get(actor, "channel:channel-a"), undefined);
  assert.equal(JSON.stringify(f.context.unreadDirectMessages), unread);
});

test("live events update only previously opened DM caches and invalidate changed/deleted channel histories", async () => {
  const f = historyFixture();
  f.cache.set(actor, `direct:${friend}`, {
    messages: [{ id: uuid(1), text: "Old" }],
    nextCursor: null,
  });
  f.cache.set(actor, "channel:channel-a", {
    messages: [{ id: uuid(1), text: "Old" }],
    nextCursor: null,
  });
  f.event({
    type: "direct-message",
    fromUserId: friend,
    message: { id: uuid(2), text: "Live", createdAt: "2026-11-01T12:00:00Z" },
  });
  assert.equal(
    f.cache.get(actor, `direct:${friend}`).messages.at(-1).text,
    "Live",
  );
  f.event({
    type: "direct-message",
    fromUserId: "unopened",
    message: { id: uuid(3), text: "Unread", createdAt: "2026-11-01T12:00:00Z" },
  });
  assert.equal(f.cache.get(actor, "direct:unopened"), undefined);
  f.event({
    type: "channel-activity",
    channelId: "channel-a",
    messageId: uuid(1),
  });
  assert.ok(f.cache.get(actor, "channel:channel-a"));
  f.event({
    type: "channel-activity",
    channelId: "channel-a",
    messageId: uuid(2),
  });
  assert.equal(f.cache.get(actor, "channel:channel-a"), undefined);
  f.event({
    type: "direct-message-deleted",
    fromUserId: friend,
    messageId: uuid(1),
    permanent: true,
  });
  assert.equal(f.cache.get(actor, `direct:${friend}`), undefined);
  f.cache.set(actor, "channel:channel-a", { messages: [], nextCursor: null });
  f.event({ type: "access-changed" });
  assert.equal(f.cache.get(actor, "channel:channel-a"), undefined);
  assert.equal(
    f.requests.length,
    0,
    "Live invalidation must not fetch unopened history",
  );
});

test("conversation caches are bounded by bytes/count, isolated by account and empty after a reload", () => {
  const cache = new ConversationCache(300, 2);
  cache.scope(actor);
  const page = (id) => ({
    messages: [{ id, text: "Cached" }],
    nextCursor: null,
  });
  cache.set(actor, "direct:a", page("a"));
  cache.set(actor, "direct:b", page("b"));
  assert.ok(cache.get(actor, "direct:a"));
  cache.set(actor, "direct:c", page("c"));
  assert.equal(cache.get(actor, "direct:b"), undefined);
  cache.set(actor, "channel:large", {
    messages: [{ id: "large", text: "x".repeat(400) }],
    nextCursor: null,
  });
  assert.equal(cache.get(actor, "channel:large"), undefined);
  cache.scope(friend);
  assert.equal(cache.get(actor, "direct:a"), undefined);
  cache.set(actor, "direct:late", page("late"));
  assert.equal(cache.get(friend, "direct:late"), undefined);
  const reloaded = new ConversationCache();
  reloaded.scope(friend);
  assert.equal(reloaded.get(friend, "direct:c"), undefined);
  const byteBound = new ConversationCache(90, 10);
  byteBound.scope(actor);
  byteBound.set(actor, "direct:a", page("a"));
  byteBound.set(actor, "direct:b", page("b"));
  assert.equal(byteBound.get(actor, "direct:a"), undefined);
  assert.ok(byteBound.get(actor, "direct:b"));
});

test("reconnecting signaling discards cached histories so missed events are recovered", () => {
  const f = historyFixture();
  f.reconnect();
  f.cache.set(actor, `direct:${friend}`, {
    messages: [{ id: uuid(1), text: "Before disconnect" }],
    nextCursor: null,
  });
  f.reconnect();
  assert.equal(f.cache.get(actor, `direct:${friend}`), undefined);
});

test("reconnect recovery retains visible histories until authorized replacement is ready", async () => {
  for (const channel of [false, true]) {
    const f = historyFixture(channel);
    const previous = [{ id: uuid(1), text: "Before disconnect" }];
    if (channel) {
      f.context.messages = previous;
      f.context.channelHistoryLoaded = "channel-a";
      f.context.visibleChannelHistory.current = {
        accountId: actor,
        channelId: "channel-a",
        messages: previous,
        nextCursor: null,
      };
    } else {
      f.context.directMessages = previous;
      f.context.directHistoryLoaded = friend;
      f.context.visibleDirectHistory.current = {
        accountId: actor,
        userId: friend,
        messages: previous,
        nextCursor: null,
      };
    }
    const close = f.start();
    await settle();
    assert.equal(
      channel ? f.context.messages : f.context.directMessages,
      previous,
      "no empty loading frame while recovery waits",
    );
    assert.equal(
      channel ? f.context.channelHistoryLoaded : f.context.directHistoryLoaded,
      channel ? "channel-a" : friend,
    );
    f.requests[0].resolve({
      messages: [
        {
          id: uuid(1),
          text: "Edited while disconnected",
          createdAt: "2026-11-01T12:00:00Z",
        },
      ],
      nextCursor: null,
    });
    await settle();
    assert.equal(
      (channel ? f.context.messages : f.context.directMessages)[0].text,
      "Edited while disconnected",
    );
    close();
    f.cache.clear();
    f.start();
    await settle();
    f.requests.at(-1).resolve({ error: "Forbidden" }, false, 403);
    await settle();
    assert.equal(
      (channel ? f.context.messages : f.context.directMessages).length,
      0,
      "lost access removes retained content",
    );
  }
});

test("recovery reloads the loaded cursor range and retains concurrent live changes", async () => {
  const boundary = {
    beforeCreatedAt: "2026-11-01T12:00:00.000Z",
    beforeId: uuid(2),
  };
  const newer = {
    beforeCreatedAt: "2026-11-02T12:00:00.000Z",
    beforeId: uuid(3),
  };
  const calls = [];
  const result = await readHistoryWindow(async (cursor) => {
    calls.push(cursor);
    return cursor
      ? {
          messages: [{ id: uuid(2), text: "Older updated" }],
          nextCursor: boundary,
        }
      : { messages: [{ id: uuid(3), text: "Latest" }], nextCursor: newer };
  }, boundary);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    result.messages.map((row) => row.id),
    [uuid(2), uuid(3)],
  );
  assert.equal(result.nextCursor, boundary);
  const before = [
    { id: "a", text: "old" },
    { id: "b", text: "removed live" },
    { id: "c", text: "old" },
  ];
  const current = [
    before[0],
    { id: "c", text: "live edit" },
    { id: "d", text: "live new" },
  ];
  const rows = reconcileRecoveredHistory(
    [
      { id: "a", text: "recovered edit" },
      { id: "b", text: "stale" },
      { id: "c", text: "stale" },
    ],
    current,
    before,
  );
  assert.deepEqual(rows, [
    { id: "a", text: "recovered edit" },
    { id: "c", text: "live edit" },
    { id: "d", text: "live new" },
  ]);
});

test("failed history responses are not cached as empty conversations", async () => {
  for (const channel of [false, true]) {
    const f = historyFixture(channel);
    const close = f.start();
    await settle();
    f.requests[0].resolve({ error: "Unavailable" }, false);
    await settle();
    f.persist();
    assert.equal(
      f.cache.get(actor, channel ? "channel:channel-a" : `direct:${friend}`),
      undefined,
    );
    close();
    f.start();
    await settle();
    assert.equal(
      f.requests.length,
      2,
      "Returning after a failed request must retry the server",
    );
  }
});

test("retained friend selection does not fetch history or older pages until its chat opens", async () => {
  const f = historyFixture();
  f.context.directConversationVisible = false;
  f.context.directMessageCursor = {
    beforeCreatedAt: "2026-11-01T12:00:00Z",
    beforeId: uuid(2),
  };
  await f.context.loadOlderDirectMessages();
  f.start();
  await settle();
  assert.equal(f.requests.length, 0);
  f.context.directConversationVisible = true;
  const close = f.start();
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, `/api/direct-messages/${friend}`);
  assert.equal(f.requests[0].signal.aborted, false);
  close();
  assert.equal(f.requests[0].signal.aborted, true);
  f.context.directConversationVisible = false;
  f.start();
  f.requests[0].resolve({
    messages: [{ id: uuid(1), text: "Late hidden history" }],
    nextCursor: null,
  });
  await settle();
  assert.equal(f.context.directMessages.length, 0);
  assert.equal(f.context.directHistoryLoaded, "");
  assert.equal(f.requests.length, 1);
});

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
