import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

async function moduleAt(path, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(
      await readFile(new URL(path, import.meta.url), "utf8"),
      {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
      path,
    ),
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      ...globals,
    },
  );
  return exports;
}

async function idleFixture(status = "online") {
  let now = 100_000,
    tick;
  const handlers = new Map(),
    saved = new Map(),
    changes = [],
    cleanups = [];
  let moves = 0,
    speaking = false;
  const options = {
    status,
    automaticAway: false,
    isSpeaking: () => speaking,
    onStatus(status, automaticAway) {
      changes.push({ status, automaticAway });
      Object.assign(options, { status, automaticAway });
    },
    onAfk() {
      moves++;
    },
  };
  const { useIdlePresence: runIdlePresence } = await moduleAt(
    "../app/use-idle-presence.ts",
    {
      react: {
        useRef: (current) => ({ current }),
        useEffect: (fn) => {
          const cleanup = fn();
          if (cleanup) cleanups.push(cleanup);
        },
      },
    },
    {
      Date: { now: () => now },
      clearInterval() {},
      localStorage: {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, value),
      },
      window: {
        setInterval: (fn) => {
          tick = fn;
          return 1;
        },
        addEventListener: (name, fn) => handlers.set(name, fn),
        removeEventListener: (name) => handlers.delete(name),
      },
    },
  );
  runIdlePresence("me", options);
  return {
    options,
    changes,
    saved,
    get moves() {
      return moves;
    },
    advance(ms) {
      now += ms;
      tick();
    },
    speak(value) {
      speaking = value;
    },
    activity(name = "keydown") {
      handlers.get(name)();
    },
    otherTab() {
      saved.set("lc.activity.me", String(now));
      handlers.get("storage")({ key: "lc.activity.me" });
    },
    cleanup() {
      for (const cleanup of cleanups) cleanup();
      assert.equal(handlers.size, 0);
    },
  };
}

test("idle thresholds mark automatic Away at ten minutes and request AFK at fifteen; activity restores Online", async () => {
  const f = await idleFixture();
  f.advance(599_999);
  assert.equal(f.changes.length, 0);
  f.advance(1);
  assert.deepEqual(f.changes, [{ status: "away", automaticAway: true }]);
  f.advance(300_000);
  assert.equal(f.moves, 1);
  f.activity();
  assert.equal(f.options.status, "online");
  assert.equal(f.options.automaticAway, false);
  f.advance(599_999);
  assert.equal(f.moves, 1);
  f.cleanup();
});

test("manual Away, DND and Invisible survive activity; sustained speech and other-tab input prevent AFK", async () => {
  for (const status of ["away", "dnd", "invisible"]) {
    const f = await idleFixture(status);
    f.activity("pointermove");
    f.advance(600_000);
    f.activity("touchstart");
    assert.equal(f.options.status, status);
    assert.equal(f.changes.length, 0);
  }
  const f = await idleFixture();
  f.speak(true);
  f.advance(900_000);
  assert.equal(f.moves, 0);
  assert.equal(f.changes.length, 0);
  f.speak(false);
  f.advance(600_000);
  assert.equal(f.options.status, "away");
  f.otherTab();
  assert.equal(f.options.status, "online");
  f.advance(899_999);
  assert.equal(f.moves, 0);
});

test("microphone and deafen share a 750 ms action cooldown", async () => {
  const { takeVoiceToggle } = await moduleAt("../app/voice-toggle-cooldown.ts");
  assert.equal(takeVoiceToggle(1000), true);
  assert.equal(takeVoiceToggle(1001), false);
  assert.equal(takeVoiceToggle(1749), false);
  assert.equal(takeVoiceToggle(1750), true);
});

test("relative moves support arbitrary drops and leave input unchanged", async () => {
  const { moveRelative } = await moduleAt("../lib/list-order.ts");
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const ids = (result) => Array.from(result, (row) => row.id);
  assert.deepEqual(ids(moveRelative(rows, "a", "d", "after")), [
    "b",
    "c",
    "d",
    "a",
  ]);
  assert.deepEqual(ids(moveRelative(rows, "d", "a", "before")), [
    "d",
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(ids(moveRelative(rows, "a", "c", "before")), [
    "b",
    "a",
    "c",
    "d",
  ]);
  assert.deepEqual(ids(moveRelative(rows, "d", "b", "after")), [
    "a",
    "b",
    "d",
    "c",
  ]);
  for (const [id, target] of [
    ["a", "a"],
    ["missing", "a"],
    ["a", "missing"],
  ])
    assert.deepEqual(ids(moveRelative(rows, id, target, "before")), [
      "a",
      "b",
      "c",
      "d",
    ]);
  assert.deepEqual(ids(rows), ["a", "b", "c", "d"]);
});

test("move failures tolerate empty or non-JSON responses and use the channel's own server", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const functions = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      ["moveChannel", "moveServer"].includes(node.name?.text)
    )
      functions.push(node.getText(tree));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(functions.length, 2);
  const requests = [],
    exports = {};
  let response;
  vm.runInNewContext(
    ts.transpile(
      functions.join("\n") +
        "\nexports.moveChannel=moveChannel; exports.moveServer=moveServer;",
      { target: ts.ScriptTarget.ES2022 },
    ),
    {
      exports,
      selectedServerId: "selected",
      fetch: async (url) => {
        requests.push(url);
        return response;
      },
      refreshChannelOrder: async () => {},
      refreshServerOrder: async () => {},
    },
  );
  for (const body of ["", "Upstream unavailable"]) {
    response = new Response(body, { status: 500 });
    await assert.rejects(
      exports.moveChannel(
        { id: "channel", serverId: "channel-server" },
        "target",
        "before",
      ),
      /Channel could not be moved/,
    );
    response = new Response(body, { status: 502 });
    await assert.rejects(
      exports.moveServer("server", "target", "before"),
      /Server could not be moved/,
    );
  }
  assert.equal(requests[0], "/api/servers/channel-server/channels/order");
});

test("notification cues obey DND/deafen and scoped mutes, exclude refreshes and own messages, and deduplicate mentions", async () => {
  const { NotificationSoundGate } = await moduleAt(
    "../app/notification-sounds.ts",
  );
  const gate = new NotificationSoundGate();
  const settings = {
    userId: "me",
    enabled: true,
    ready: true,
    deafened: false,
    channels: [{ id: "chat", serverId: "server" }],
    allowed: () => true,
  };
  const dm = {
    type: "direct-message",
    fromUserId: "other",
    message: { id: "one" },
  };
  for (const overrides of [
    { enabled: false },
    { ready: false },
    { deafened: true },
    { allowed: () => false },
  ])
    assert.equal(gate.take(dm, { ...settings, ...overrides }), null);
  assert.equal(gate.take(dm, settings), "message");
  assert.equal(gate.take(dm, settings), null);
  assert.equal(
    gate.take({ ...dm, fromUserId: "me", message: { id: "own" } }, settings),
    null,
  );
  assert.equal(gate.take({ type: "friendship-changed" }, settings), null);
  assert.equal(
    gate.take({ type: "server-invitations-changed" }, settings),
    null,
  );
  assert.equal(
    gate.take(
      {
        type: "friendship-changed",
        notification: "friend-request",
        fromUserId: "other",
      },
      settings,
    ),
    "request",
  );
  assert.equal(
    gate.take(
      {
        type: "server-invitations-changed",
        notification: "server-invite",
        serverId: "server",
      },
      settings,
    ),
    "request",
  );
  const message = {
    type: "channel-activity",
    channelId: "chat",
    messageId: "channel-one",
    authorId: "other",
  };
  assert.equal(gate.take(message, settings), "message");
  assert.equal(
    gate.take({ ...message, type: "server-mention" }, settings),
    null,
  );
  const mentionOnly = {
    ...settings,
    allowed: (_scope, _target, kind) => kind === "mentions",
  };
  assert.equal(
    gate.take({ ...message, messageId: "mention-only" }, mentionOnly),
    null,
  );
  assert.equal(
    gate.take(
      { ...message, type: "server-mention", messageId: "mention-only" },
      mentionOnly,
    ),
    "message",
  );
});

test("kicked workspace leaves revoked content, cancels stale history and preserves the friendly notice", async () => {
  const text = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let branch;
  function find(node) {
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(ast) === 'message.type === "access-changed"'
    )
      branch = node.thenStatement.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(branch);
  const state = {
    generation: { current: 3 },
    kicked: { current: new Set() },
    notice: "",
    error: "Forbidden",
    friendView: false,
    serverId: "server",
    channelId: "channel",
    refreshes: 0,
    leaves: 0,
  };
  const context = {
    message: {
      reason: "server-kicked",
      serverId: "server",
      serverName: "Hangout",
    },
    serverOrderRequest: { current: 0 },
    channelOrderRequests: { current: new Map() },
    kickedServers: state.kicked,
    channelHistoryGeneration: state.generation,
    activeVoiceServerRef: { current: "server" },
    selectedServerIdRef: { current: "server" },
    setNoticeMessage: (value) => (state.notice = value),
    setErrorMessage: (value) => (state.error = value),
    setSelectedServerId: (value) => (state.serverId = value),
    setSelectedChannelId: (value) => (state.channelId = value),
    setFriendsView: (value) => (state.friendView = value),
    closeCallViewRef: { current: () => state.leaves++ },
    refreshAccessRef: { current: () => state.refreshes++ },
    setChannels() {},
    setMembers() {},
    setMessages() {},
    setSelectedFriend() {},
    setHistoryContext() {},
    setEditingMessage() {},
    setHistoryRefreshKey() {},
    invalidateSignalingToken() {},
    conversationCache: { current: { clear() {} } },
    serverViewCache: { current: { clear() {} } },
  };
  vm.runInNewContext(
    ts.transpile(`(() => ${branch})()`, { target: ts.ScriptTarget.ES2022 }),
    context,
  );
  assert.equal(state.notice, "You have been kicked from Hangout.");
  assert.equal(state.error, "");
  assert.equal(state.serverId, "");
  assert.equal(state.channelId, "");
  assert.equal(state.friendView, true);
  assert.equal(state.generation.current, 4);
  assert.equal(state.kicked.current.has("server"), true);
  assert.equal(state.refreshes, 1);
  assert.equal(state.leaves, 1);
});

test("double-clicking a fullscreen tile exits and entering fullscreen selects a visible video", async () => {
  let enters = 0,
    exits = 0;
  const tile = {
    requestFullscreen: async () => {
      enters++;
    },
  };
  const document = {
    fullscreenElement: tile,
    exitFullscreen: async () => {
      exits++;
      document.fullscreenElement = null;
    },
  };
  const { fullscreenVideoTile } = await moduleAt(
    "../app/stream-info.tsx",
    { react: {}, "react/jsx-runtime": {} },
    { document },
  );
  await fullscreenVideoTile(tile);
  assert.equal(exits, 1);
  assert.equal(enters, 0);
  await fullscreenVideoTile({
    matches: () => false,
    querySelector: () => tile,
  });
  assert.equal(enters, 1);
});

test("soundboard preferences survive hook remounts; microphone mute blocks public sounds while allowing private preview", async () => {
  const saved = new Map([
    ["lc.soundboardVolume", "37"],
    ["lc.soundboardMuted", "true"],
  ]);
  let publications = 0,
    previews = 0;
  const effects = [];
  class Player {
    stop() {}
    async play(_context, _load, publish) {
      await publish({});
      previews++;
    }
  }
  const { useSoundboard: runSoundboard } = await moduleAt(
    "../app/soundboard.tsx",
    {
      react: {
        useRef: (current) => ({ current }),
        useCallback: (fn) => fn,
        useState: (value) => [
          typeof value === "function" ? value() : value,
          () => {},
        ],
        useEffect: (fn) => effects.push(fn),
      },
      "react/jsx-runtime": {},
      "./loading-skeleton": {},
      "./voice-activity": {
        monitorVoiceActivity() {},
        prepareVoiceActivity() {},
      },
      "./audio-output": { applyCallOutput: async () => {} },
      "./soundboard-audio": {
        SoundPlayer: Player,
        SoundCooldown: class {
          take() {
            return true;
          }
        },
      },
      "./soundboard-library": {},
      "./sound-manager": {},
      "./server-join-sound": {
        ServerJoinSound: class {
          stop() {}
          update() {}
        },
      },
    },
    {
      localStorage: {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, value),
      },
      window: {
        dispatchEvent() {},
        addEventListener() {},
        removeEventListener() {},
      },
      Event,
      document: {
        createElement: () => ({
          dataset: {},
          play: async () => {},
          remove() {},
        }),
        body: { append() {} },
      },
      MediaStream: class {},
      setTimeout: () => 1,
      clearTimeout() {},
      fetch: async () => ({ ok: true }),
    },
  );
  const board = runSoundboard("first", { microphoneMuted: true });
  for (const effect of effects.splice(0)) effect();
  assert.equal(board.volume, 37);
  assert.equal(board.muted, true);
  await board.playSound("server", "clip", async () => {
    publications++;
  });
  assert.equal(publications, 0);
  assert.equal(previews, 0);
  await board.playSound(
    "server",
    "clip",
    async () => {
      publications++;
    },
    true,
  );
  assert.equal(publications, 0);
  assert.equal(previews, 1);
  const reconnected = runSoundboard("reconnected", { microphoneMuted: false });
  for (const effect of effects.splice(0)) effect();
  assert.equal(reconnected.volume, 37);
  assert.equal(reconnected.muted, true);
  await reconnected.playSound("server", "clip", async () => {
    publications++;
    return () => {};
  });
  assert.equal(publications, 1);
});
