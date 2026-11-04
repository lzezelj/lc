import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  readWorkspaceLocation,
  saveWorkspaceLocation,
  restoredTextChannel,
} from "../app/workspace-location.ts";

const savedServer = {
  view: "server",
  serverId: "two",
  channelId: "second",
  friendId: "",
  friendTab: "online",
};
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
const effects = [];
const navigationHandlers = new Map();
function visit(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    ["switchServer", "selectTextChannel"].includes(node.name?.text)
  )
    navigationHandlers.set(node.name.text, node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect")
    effects.push(node.arguments[0].getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const bootstrap = effects.find((effect) =>
  effect.includes("readWorkspaceLocation("),
);
const loadChannels = effects.find((effect) =>
  effect.includes("const savedChannel"),
);
const persist = effects.find((effect) =>
  effect.includes("saveWorkspaceLocation("),
);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture({
  saved = savedServer,
  reload = true,
  servers = [{ id: "one" }, { id: "two" }],
  friends = [],
} = {}) {
  const stored = new Map(
    saved ? [["lc.workspace:actor", JSON.stringify(saved)]] : [],
  );
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  const context = {
    authStatus: "authenticated",
    session: { user: { id: "actor" } },
    location: {},
    locationUser: { current: "" },
    pendingLocation: { current: null },
    channelHistoryGeneration: { current: 0 },
    lastTextChannelId: { current: "" },
    performance: {
      getEntriesByType: () => [{ type: reload ? "reload" : "navigate" }],
    },
    window: { sessionStorage: storage },
    AbortController,
    readWorkspaceLocation,
    saveWorkspaceLocation,
    restoredTextChannel,
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url === "/api/servers"
          ? servers
          : url === "/api/friends"
            ? friends
            : url.endsWith("/channels")
              ? [
                  { id: "first", type: "text" },
                  { id: "second", type: "text" },
                  { id: "voice", type: "voice_group" },
                ]
              : [],
    }),
    selectedServerId: "",
    selectedChannelId: "",
    selectedFriend: null,
    friendsView: true,
    friendTab: "online",
    navigationReady: false,
    serversLoaded: false,
  };
  for (const name of [
    "Servers",
    "SelectedServerId",
    "Friends",
    "FriendsView",
    "SelectedFriend",
    "FriendTab",
    "NavigationReady",
    "ServersLoaded",
    "ErrorMessage",
    "Channels",
    "ServerChannelsLoaded",
    "Members",
    "SelectedChannelId",
    "OnlineUserIds",
    "Messages",
    "ChannelHistoryLoaded",
    "ReadableHistoryChannel",
    "NextMessageCursor",
    "LoadingMoreMessages",
    "CallViewOpen",
    "ReplyingTo",
    "MessageMenu",
  ]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = (value) => {
      context[key] =
        typeof value === "function" ? value(context[key] ?? []) : value;
    };
  }
  const run = (effect) =>
    vm.runInNewContext(
      ts.transpile(`(${effect})();`, {
        target: ts.ScriptTarget.ES2022,
      }),
      context,
    );
  return { context, stored, storage, run };
}

test("reload restores the authorized server and its selected text channel before persistence", async () => {
  const f = fixture();
  f.run(bootstrap);
  await settle();
  assert.equal(f.context.selectedServerId, "two");
  assert.equal(f.context.friendsView, false);
  assert.equal(f.context.navigationReady, false);
  f.run(persist);
  assert.equal(
    JSON.parse(f.stored.get("lc.workspace:actor")).channelId,
    "second",
  );
  f.run(loadChannels);
  await settle();
  assert.equal(f.context.selectedChannelId, "second");
  assert.equal(f.context.navigationReady, true);
  assert.equal(f.context.pendingLocation.current, null);
});

function invokeNavigation(fixture, name, id) {
  return vm.runInNewContext(
    ts.transpile(`(${navigationHandlers.get(name)})(${JSON.stringify(id)});`, {
      target: ts.ScriptTarget.ES2022,
    }),
    fixture.context,
  );
}

test("server selection changes immediately without fetching or waiting for destination data", () => {
  const f = fixture();
  Object.assign(f.context, {
    selectedServerId: "one",
    selectedChannelId: "old",
    channels: [{ id: "old" }],
    members: [{ id: "person" }],
    messages: [{ id: "message" }],
    callViewOpen: true,
  });
  f.context.fetch = () => {
    throw new Error("Only the server data effect should fetch");
  };
  invokeNavigation(f, "switchServer", "two");
  assert.equal(f.context.selectedServerId, "two");
  assert.equal(f.context.selectedChannelId, "");
  assert.equal(f.context.channels.length, 0);
  assert.equal(f.context.members.length, 0);
  assert.equal(f.context.messages.length, 0);
  assert.equal(f.context.callViewOpen, false);
  assert.equal(f.context.channelHistoryGeneration.current, 1);
});

test("server channels load without waiting for members; obsolete responses are ignored and aborted", async () => {
  const f = fixture();
  f.context.selectedServerId = "one";
  const requests = [];
  f.context.fetch = (url, options) =>
    new Promise((resolve) => requests.push({ url, options, resolve }));
  const cleanup = f.run(loadChannels);
  assert.equal(requests.length, 2, "one request each for channels and members");
  requests[0].resolve({
    ok: true,
    json: async () => [{ id: "text-one", type: "text" }],
  });
  await settle();
  assert.equal(f.context.selectedChannelId, "text-one");
  assert.equal(f.context.serverChannelsLoaded, "one");
  assert.equal(f.context.navigationReady, true);
  cleanup();
  assert.ok(requests.every((request) => request.options.signal.aborted));
  invokeNavigation(f, "switchServer", "two");
  f.run(loadChannels);
  requests[2].resolve({
    ok: true,
    json: async () => [{ id: "text-two", type: "text" }],
  });
  requests[3].resolve({ ok: true, json: async () => [{ id: "new-member" }] });
  await settle();
  requests[1].resolve({ ok: true, json: async () => [{ id: "old-member" }] });
  await settle();
  assert.equal(f.context.selectedChannelId, "text-two");
  assert.equal(f.context.members[0].id, "new-member");
});

test("channel selection clears stale history immediately and reselecting the same channel preserves it", () => {
  const f = fixture();
  Object.assign(f.context, {
    selectedChannelId: "old",
    channelHistoryLoaded: "old",
    readableHistoryChannel: "old",
    messages: [{ id: "previous-message" }],
    nextMessageCursor: { beforeId: "cursor" },
  });
  invokeNavigation(f, "selectTextChannel", "new");
  assert.equal(f.context.selectedChannelId, "new");
  assert.equal(f.context.channelHistoryLoaded, "");
  assert.equal(f.context.readableHistoryChannel, "");
  assert.equal(f.context.messages.length, 0);
  assert.equal(f.context.nextMessageCursor, null);
  assert.equal(f.context.channelHistoryGeneration.current, 1);
  f.context.messages = [{ id: "new-message" }];
  invokeNavigation(f, "selectTextChannel", "new");
  assert.equal(f.context.messages[0].id, "new-message");
  assert.equal(f.context.channelHistoryGeneration.current, 1);
});
test("fresh visits and inaccessible saved servers open Friends", async () => {
  for (const options of [{ reload: false }, { servers: [{ id: "one" }] }]) {
    const f = fixture(options);
    f.run(bootstrap);
    await settle();
    assert.equal(f.context.friendsView, true);
    assert.equal(f.context.selectedFriend, null);
    assert.equal(f.context.navigationReady, true);
  }
});
test("only accepted saved conversations are restored, including their Friends tab", async () => {
  for (const status of ["accepted", "pending", "missing"]) {
    const f = fixture({
      saved: {
        ...savedServer,
        view: "friends",
        friendId: "friend",
        friendTab: "offline",
      },
      friends: status === "missing" ? [] : [{ id: "friend", status }],
    });
    f.run(bootstrap);
    await settle();
    assert.equal(
      f.context.selectedFriend?.id ?? null,
      status === "accepted" ? "friend" : null,
    );
    assert.equal(f.context.friendTab, "offline");
    assert.equal(f.context.friendsView, true);
  }
});
test("deleted and voice channel IDs fall back to a text channel without joining a call", () => {
  const channels = [
    { id: "voice", type: "voice_group" },
    { id: "text", type: "text" },
  ];
  assert.equal(restoredTextChannel(channels, "deleted"), "text");
  assert.equal(restoredTextChannel(channels, "voice"), "text");
  assert.equal(restoredTextChannel([], "deleted"), "");
});
test("navigation storage is isolated by account and tolerates blocked/corrupt storage", () => {
  const f = fixture();
  saveWorkspaceLocation(f.storage, "another", {
    ...savedServer,
    channelId: "other",
  });
  assert.equal(
    readWorkspaceLocation(f.storage, "actor", true).channelId,
    "second",
  );
  assert.equal(
    readWorkspaceLocation(f.storage, "another", true).channelId,
    "other",
  );
  assert.equal(readWorkspaceLocation(f.storage, "actor", false), null);
  f.stored.set("lc.workspace:actor", "invalid json");
  assert.equal(readWorkspaceLocation(f.storage, "actor", true), null);
  f.stored.set("lc.workspace:actor", JSON.stringify({ view: "server" }));
  assert.equal(readWorkspaceLocation(f.storage, "actor", true), null);
  const blocked = {
    getItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Blocked");
    },
  };
  assert.equal(readWorkspaceLocation(blocked, "actor", true), null);
  assert.doesNotThrow(() =>
    saveWorkspaceLocation(blocked, "actor", savedServer),
  );
});
test("obsolete startup responses and a different account cannot overwrite navigation", async () => {
  const f = fixture();
  const cleanup = f.run(bootstrap);
  cleanup();
  await settle();
  assert.equal(f.context.serversLoaded, false);
  f.context.navigationReady = true;
  f.context.serversLoaded = true;
  f.context.locationUser.current = "other";
  f.run(persist);
  assert.equal(JSON.parse(f.stored.get("lc.workspace:actor")).serverId, "two");
});
