import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../app/group-call.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "group-call.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "GroupCall",
);
const code = ts.transpile(declaration.getText(ast).replace(/^export /, ""), {
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.React,
});
const elements = (node) =>
  Array.isArray(node)
    ? node.flatMap(elements)
    : node && typeof node === "object"
      ? [node, ...elements(node.props?.children)]
      : [];

// Render the actual call component with named hook state and track attachment
// doubles, so no LiveKit server or physical capture device is required.
function renderCall(state = {}, options = {}) {
  const stateNames = [
    ...declaration.getText(ast).matchAll(/const \[(\w+),\s*\w+\] = useState/g),
  ].map((match) => match[1]);
  let stateIndex = 0;
  const refs = [];
  const effects = [];
  const attached = [];
  const detached = [];
  const opened = [];
  const events = [];
  const handlers = new Map();
  const stateWrites = {};
  const track = {
    attach: (element) => attached.push(element),
    detach: (element) => detached.push(element),
    stop: () => events.push("stop screen"),
  };
  const camera = {
    mediaStreamTrack: {},
    attach: (element) => events.push(["camera", element]),
    detach: () => events.push("detach camera"),
    stop: () => events.push("stop camera"),
  };
  const publications = new Map([
    ["screen", { source: "screen", track }],
    ["camera", { source: "camera", track: camera, videoTrack: camera }],
  ]);
  const room = options.room ?? {
    remoteParticipants: new Map(),
    on(event, handler) {
      handlers.set(event, handler);
      return this;
    },
    async connect() {},
    async switchActiveDevice() {},
    async disconnect(stopTracks) {
      events.push(["disconnect", stopTracks]);
      // LiveKit unpublishes tracks during disconnect, including the screen.
      handlers.get("LocalTrackUnpublished")?.(publications.get("screen"));
    },
    localParticipant: {
      trackPublications: publications,
      videoTrackPublications: publications,
      getTrackPublication: (source) =>
        source === "mic" && options.microphoneTrack
          ? { track: options.microphoneTrack }
          : (publications.get(source) ?? {}),
      async setScreenShareEnabled() {
        await options.screenPending;
      },
      async setCameraEnabled() {
        await options.cameraPending;
      },
      async setMicrophoneEnabled(enabled) {
        events.push(["microphone", enabled]);
      },
    },
  };
  const Component = vm.runInNewContext(`${code}; GroupCall`, {
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: { ...props, children },
      }),
    },
    useState(initial) {
      const name = stateNames[stateIndex++];
      const value = name in state ? state[name] : initial;
      return [
        value,
        (next) => {
          stateWrites[name] =
            typeof next === "function"
              ? next(name in stateWrites ? stateWrites[name] : value)
              : next;
        },
      ];
    },
    useRef(initial) {
      const ref = {
        current: refs.length === 0 ? (options.unjoined ? null : room) : initial,
      };
      refs.push(ref);
      return ref;
    },
    useEffect: (effect) => effects.push(effect),
    Track: {
      Kind: { Video: "video", Audio: "audio" },
      Source: { ScreenShare: "screen", Camera: "camera", Microphone: "mic" },
    },
    Room: class {
      constructor() {
        events.push("create room");
        return room;
      }
    },
    RoomEvent: new Proxy({}, { get: (_, name) => name }),
    TrackEvent: { Restarted: "restart" },
    monitorVoiceActivity: () => () => {},
    prepareVoiceActivity() {},
    voiceCaptureOptions: () => ({}),
    playVoiceSound() {},
    monitorTrackVideo: () => () => {},
    monitorRoomDiagnostics: () => () => {},
    fetch:
      options.fetch ??
      (async () => ({
        ok: true,
        json: async () => ({ server_url: "test", participant_token: "test" }),
      })),
    window: { setInterval: () => 1, clearInterval() {} },
    DeviceMenu: "DeviceMenu",
    RemoteTrackView: "RemoteTrackView",
    HideTileButton: "HideTileButton",
    HiddenTilesMenu: "HiddenTilesMenu",
    SelfViewButton: "SelfViewButton",
  });
  const tree = Component({
    channelId: "room-1",
    currentUserName: "Local user",
    deafened: options.deafened ?? false,
    initialMuted: options.initialMuted ?? false,
    outputVolume: 0.4,
    microphones: [],
    cameras: [],
    viewOpen: true,
    onConnectionChange: (present) => events.push(["present", present]),
    onPingChange() {},
    onMediaStateChange: (media) => events.push(["media", media]),
    onDiagnosticsChange() {},
    onError(message) {
      throw new Error(message);
    },
    onOpenView: () => opened.push(true),
  });
  for (const element of elements(tree)) {
    if (element.props?.ref && element.type === "video")
      element.props.ref.current = { preview: true };
  }
  return {
    tree,
    effects,
    attached,
    detached,
    opened,
    events,
    refs,
    handlers,
    stateWrites,
  };
}

test("hiding a camera retains media components and restores only the selected tile", () => {
  const participants = [{ id: "one", name: "Alex" }];
  const camera = {
    id: "camera",
    participantId: "one",
    participantName: "Alex",
    track: { kind: "video" },
    isScreen: false,
  };
  const screen = {
    id: "screen",
    participantId: "one",
    participantName: "Alex",
    track: { kind: "video" },
    isScreen: true,
  };
  const audio = { id: "audio", participantId: "one", track: { kind: "audio" } };
  const initial = { participants, remoteMedia: [camera, screen, audio] };
  const first = renderCall(initial);
  elements(first.tree)
    .find(
      (element) =>
        element.type === "RemoteTrackView" && element.props.media === camera,
    )
    .props.onHide();
  assert.deepEqual(Array.from(first.stateWrites.hiddenTiles), [
    "local",
    "local-screen",
    "one:camera",
  ]);
  assert.deepEqual(first.events, [], "hiding must not publish or disconnect");
  const hidden = renderCall({
    ...initial,
    hiddenTiles: first.stateWrites.hiddenTiles,
  });
  const views = elements(hidden.tree).filter(
    (element) => element.type === "RemoteTrackView",
  );
  assert.equal(views.length, 3, "all media components must stay mounted");
  assert.equal(
    views.find((element) => element.props.media === camera).props.hidden,
    true,
  );
  assert.equal(
    views.find((element) => element.props.media === screen).props.hidden,
    false,
  );
  assert.ok(views.some((element) => element.props.media === audio));
  const menu = elements(hidden.tree).find(
    (element) => element.type === "HiddenTilesMenu",
  );
  menu.props.onRestore("one:camera");
  assert.deepEqual(Array.from(hidden.stateWrites.hiddenTiles), [
    "local",
    "local-screen",
  ]);
});

test("own camera and screen start hidden and Show yourself preserves other hidden windows", () => {
  const state = {
    screenSharing: true,
    hiddenTiles: ["local", "local-screen", "one:camera"],
  };
  const first = renderCall(state);
  const ownTiles = elements(first.tree).filter((element) =>
    element.props?.className?.includes("videoCard"),
  );
  assert.equal(ownTiles.length, 2);
  assert.ok(
    ownTiles.every((tile) => tile.props.className.includes("videoHidden")),
  );
  const show = elements(first.tree).find(
    (element) => element.type === "SelfViewButton",
  );
  assert.equal(show.props.hidden, true);
  show.props.onToggle();
  assert.deepEqual(Array.from(first.stateWrites.hiddenTiles), ["one:camera"]);
  assert.deepEqual(
    first.events,
    [],
    "showing a preview must not change outgoing media",
  );
  const shown = renderCall({
    ...state,
    hiddenTiles: first.stateWrites.hiddenTiles,
  });
  assert.ok(
    elements(shown.tree)
      .filter((element) => element.props?.className?.includes("videoCard"))
      .every((tile) => !tile.props.className.includes("videoHidden")),
  );
  const hide = elements(shown.tree).find(
    (element) => element.type === "SelfViewButton",
  );
  assert.equal(hide.props.hidden, false);
  hide.props.onToggle();
  assert.deepEqual(Array.from(shown.stateWrites.hiddenTiles), [
    "one:camera",
    "local",
    "local-screen",
  ]);
  const defaultCall = renderCall({ screenSharing: true });
  assert.ok(
    elements(defaultCall.tree)
      .filter((element) => element.props?.className?.includes("videoCard"))
      .every((tile) => tile.props.className.includes("videoHidden")),
  );
});

test("hide buttons stop focus clicks and the restore menu lists only hidden windows", async () => {
  const controls = await readFile(
    new URL("../app/call-tile-controls.tsx", import.meta.url),
    "utf8",
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpile(controls, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
    }),
    {
      exports,
      React: {
        createElement: (type, props, ...children) => ({
          type,
          props: { ...props, children },
        }),
      },
    },
  );
  let stopped = false;
  let hidden = false;
  const button = exports.HideTileButton({
    label: "Alex",
    onHide: () => {
      hidden = true;
    },
  });
  button.props.onClick({
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(stopped && hidden, true);
  const restored = [];
  const props = {
    tiles: [
      { id: "camera", label: "Alex" },
      { id: "screen", label: "Alex — screen" },
    ],
    hiddenIds: ["screen"],
    onRestore: (id) => restored.push(id),
  };
  const menu = exports.HiddenTilesMenu(props);
  const buttons = elements(menu).filter((element) => element.type === "button");
  assert.equal(buttons.length, 1);
  buttons[0].props.onClick();
  assert.deepEqual(restored, ["screen"]);
  assert.equal(exports.HiddenTilesMenu({ ...props, hiddenIds: [] }), null);
  const self = exports.SelfViewButton({ hidden: true, onToggle() {} });
  assert.equal(self.props.children[0], "Show yourself");
  assert.equal(self.props["aria-pressed"], false);
  assert.equal(
    exports.SelfViewButton({ hidden: false, onToggle() {} }).props.children[0],
    "Hide yourself",
  );
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("group deafen controls microphone and incoming tracks for each mute preference", async () => {
  const media = { id: "audio", participantId: "one", track: { kind: "audio" } };
  const deafened = renderCall(
    { joined: true, remoteMedia: [media] },
    { deafened: true },
  );
  const mic = elements(deafened.tree).find(
    (element) =>
      element.type === "DeviceMenu" && element.props.kind === "microphone",
  );
  assert.equal(mic.props.disabled, true);
  assert.equal(mic.props.actionUnavailable, true);
  assert.equal(
    elements(deafened.tree).find(
      (element) => element.type === "RemoteTrackView",
    ).props.volume,
    0,
  );
  const cleanups = deafened.effects.map((effect) => effect());
  await settle();
  assert.ok(
    deafened.events.some(
      (event) => event[0] === "microphone" && event[1] === false,
    ),
  );
  cleanups.forEach((cleanup) => cleanup?.());
  for (const initialMuted of [false, true]) {
    const restored = renderCall(
      { joined: true, remoteMedia: [media] },
      { initialMuted },
    );
    assert.equal(
      elements(restored.tree).find(
        (element) =>
          element.type === "DeviceMenu" && element.props.kind === "microphone",
      ).props.disabled,
      initialMuted,
    );
    assert.equal(
      elements(restored.tree).find(
        (element) => element.type === "RemoteTrackView",
      ).props.volume,
      0.4,
    );
  }
});

test("unmuting a previously muted group microphone enables its actual capture track", async () => {
  const microphoneTrack = {
    mediaStreamTrack: { enabled: false },
    on() {},
    off() {},
  };
  const result = renderCall(
    { joined: true },
    { initialMuted: true, microphoneTrack },
  );
  const microphone = elements(result.tree).find(
    (element) =>
      element.type === "DeviceMenu" && element.props.kind === "microphone",
  );
  microphone.props.onAction();
  await settle();
  assert.equal(microphoneTrack.mediaStreamTrack.enabled, true);
  assert.equal(result.stateWrites.userMuted, false);
  assert.ok(
    result.events.some(
      (event) => event[0] === "microphone" && event[1] === true,
    ),
  );
});

test("the direct deafen control restores the user's previous mute choice", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const pageAst = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let toggle;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "toggleDeafen")
      toggle = node;
    ts.forEachChild(node, visit);
  }
  visit(pageAst);
  for (const microphoneMuted of [false, true]) {
    for (const deafened of [false, true]) {
      const capture = { enabled: false };
      const audio = { muted: deafened };
      const updates = [];
      const change = vm.runInNewContext(
        `${ts.transpile(toggle.getText(pageAst))}; toggleDeafen`,
        {
          microphoneMuted,
          deafened,
          setMicrophoneDeafened() {},
          setDeafened: (value) => updates.push(value),
          effectiveMutedRef: { current: true },
          stream: { current: { getAudioTracks: () => [capture] } },
          remoteAudio: { current: audio },
          cameraOff: true,
          screenSharing: false,
          send() {},
        },
      );
      change();
      assert.equal(audio.muted, !deafened);
      assert.equal(capture.enabled, !(microphoneMuted || !deafened));
      assert.deepEqual(updates, [!deafened]);
    }
  }
});
const action = (tree, text) =>
  elements(tree).find(
    (element) =>
      element.type === "button" && element.props.children[0] === text,
  );

test("group call controls are disabled in the joining state and enabled in the ready state", () => {
  for (const joining of [false, true]) {
    const pending = renderCall({ joining });
    const devices = elements(pending.tree).filter(
      (element) => element.type === "DeviceMenu",
    );
    assert.equal(devices.length, 2);
    assert.ok(devices.every((device) => device.props.unavailable));
    assert.equal(action(pending.tree, "Share screen").props.disabled, true);
  }
  const ready = renderCall({ joined: true });
  assert.ok(
    elements(ready.tree)
      .filter((element) => element.type === "DeviceMenu")
      .every((device) => !device.props.unavailable),
  );
  assert.equal(action(ready.tree, "Share screen").props.disabled, false);
});

test("workspace channel highlights follow the displayed view and connecting labels cover both call modes", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const pageAst = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let textClass, voiceClass, label, directDock;
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.text === "className" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression?.getText(pageAst);
      if (
        expression?.startsWith("`channel ${") &&
        expression.includes("selectedChannelId")
      )
        textClass = expression;
      if (
        expression?.startsWith("`channel ${") &&
        expression.includes("activeVoiceChannelId")
      )
        voiceClass = expression;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(pageAst) === "connectionLabel"
    )
      label = node.initializer.getText(pageAst);
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.text === "className" &&
          attribute.initializer?.getText(pageAst) === '"controls voiceDock"',
      )
    )
      directDock = node;
    ts.forEachChild(node, visit);
  }
  visit(pageAst);
  for (const callViewOpen of [false, true]) {
    const context = {
      callViewOpen,
      selectedChannelId: "text",
      activeVoiceChannelId: "voice",
    };
    assert.equal(
      vm
        .runInNewContext(textClass, { ...context, channel: { id: "text" } })
        .includes("active"),
      !callViewOpen,
    );
    assert.equal(
      vm
        .runInNewContext(voiceClass, { ...context, channel: { id: "voice" } })
        .includes("active"),
      callViewOpen,
    );
  }
  {
    const activeVoiceChannel = { name: "Test room" };
    assert.match(
      vm.runInNewContext(label, { activeVoiceChannel, voiceReady: false }),
      /^Connecting to "Test room"/,
    );
    assert.equal(
      vm.runInNewContext(label, { activeVoiceChannel, voiceReady: true }),
      'Connected to "Test room"',
    );
  }
  const dock = vm.runInNewContext(
    ts.transpile(`const result = ${directDock.getText(pageAst)}; result;`, {
      jsx: ts.JsxEmit.React,
    }),
    {
      React: {
        createElement: (type, props, ...children) => ({
          type,
          props: { ...props, children },
        }),
      },
      DeviceMenu: "DeviceMenu",
      audioPlaybackBlocked: false,
      deafened: false,
      audioDeviceOptions: null,
      voiceReady: false,
      muted: false,
      microphones: [],
      microphoneId: "",
      toggleAudio() {},
      cameraOff: true,
      cameras: [],
      cameraId: "",
      screenSharing: false,
    },
  );
  assert.equal(
    elements(dock).filter(
      (element) => element.type === "DeviceMenu" && element.props.unavailable,
    ).length,
    2,
  );
  assert.equal(action(dock, "Share screen").props.disabled, true);
});

test("screen-first camera startup attaches the camera publication rather than the first video track", async () => {
  const result = renderCall({ joined: true, screenSharing: true });
  const cameraControl = elements(result.tree).find(
    (element) =>
      element.type === "DeviceMenu" && element.props.kind === "camera",
  );
  cameraControl.props.onAction();
  await settle();
  assert.equal(
    result.attached.length,
    0,
    "screen track must never attach to the camera preview",
  );
  assert.equal(
    result.events.find((event) => event[0] === "camera")[1].preview,
    true,
  );
});

test("leaving during screen sharing stops both captures and ignores disconnect unpublish events", async () => {
  const result = renderCall({}, { unjoined: true });
  const cleanups = result.effects.map((effect) => effect());
  action(result.tree, "Join group channel").props.onClick();
  await settle();
  assert.ok(
    result.events.some((event) => event[0] === "present" && event[1] === true),
  );
  const beforeLeave = result.events.length;
  cleanups.at(-1)();
  await settle();
  const afterLeave = result.events.slice(beforeLeave);
  assert.deepEqual(afterLeave[0], ["present", false]);
  assert.ok(afterLeave.includes("stop screen"));
  assert.ok(afterLeave.includes("stop camera"));
  assert.ok(
    afterLeave.some((event) => event[0] === "disconnect" && event[1] === true),
  );
  assert.equal(
    afterLeave.some((event) => event[0] === "media"),
    false,
    "late screen-unpublish must not recreate voice membership",
  );
});

test("leaving before the media token arrives prevents a late room connection", async () => {
  let resolveToken;
  const result = renderCall(
    {},
    {
      unjoined: true,
      fetch: () =>
        new Promise((resolve) => {
          resolveToken = resolve;
        }),
    },
  );
  const cleanups = result.effects.map((effect) => effect());
  action(result.tree, "Join group channel").props.onClick();
  cleanups.at(-1)();
  resolveToken({
    ok: true,
    json: async () => ({ server_url: "test", participant_token: "test" }),
  });
  await settle();
  assert.equal(result.events.includes("create room"), false);
});

test("camera capture finishing after leave cannot attach a preview or publish media state", async () => {
  let finishCamera;
  const result = renderCall(
    { joined: true },
    {
      cameraPending: new Promise((resolve) => {
        finishCamera = resolve;
      }),
    },
  );
  const cleanups = result.effects.map((effect) => effect());
  const cameraControl = elements(result.tree).find(
    (element) =>
      element.type === "DeviceMenu" && element.props.kind === "camera",
  );
  cameraControl.props.onAction();
  cleanups.at(-1)();
  finishCamera();
  await settle();
  assert.equal(
    result.events.some(
      (event) => event[0] === "camera" || event[0] === "media",
    ),
    false,
  );
});

test("starting screen sharing requests the call grid without forcing self-view on", async () => {
  const result = renderCall({ joined: true });
  const share = elements(result.tree).find(
    (element) =>
      element.type === "button" && element.props.children[0] === "Share screen",
  );
  share.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result.opened, [true]);
  assert.equal(result.stateWrites.hiddenTiles, undefined);
});

test("screen picker completing after leave cannot reopen the call or restore presence", async () => {
  let finishScreen;
  const result = renderCall(
    { joined: true },
    {
      screenPending: new Promise((resolve) => {
        finishScreen = resolve;
      }),
    },
  );
  const cleanups = result.effects.map((effect) => effect());
  action(result.tree, "Share screen").props.onClick();
  cleanups.at(-1)();
  finishScreen();
  await settle();
  assert.deepEqual(result.opened, []);
  assert.equal(
    result.events.some((event) => event[0] === "media"),
    false,
  );
  assert.ok(result.events.includes("stop screen"));
});

test("call grid shows named tiles for audio-only participants, including duplicate names", () => {
  const { tree } = renderCall({
    participants: [
      { id: "one", name: "Alex" },
      { id: "two", name: "Alex" },
    ],
  });
  const tiles = elements(tree).filter((element) =>
    element.props?.className?.includes("videoCard"),
  );
  assert.equal(tiles.length, 3);
  assert.ok(tiles.every((tile) => tile.props.className.includes("nameOnly")));
  assert.equal(tiles[1].props.children[0].props.children[0], "Alex");
  assert.equal(tiles[2].props.children[0].props.children[0], "Alex");
});

test("camera publication replaces its participant placeholder and keeps the audio component rendered", () => {
  const media = [
    { id: "camera", participantId: "one", track: { kind: "video" } },
    { id: "audio", participantId: "one", track: { kind: "audio" } },
  ];
  const { tree } = renderCall({
    participants: [{ id: "one", name: "Alex" }],
    remoteMedia: media,
  });
  assert.equal(
    elements(tree).filter((element) =>
      element.props?.className?.includes("nameOnly"),
    ).length,
    1,
  );
  assert.equal(
    elements(tree).filter((element) => element.type === "RemoteTrackView")
      .length,
    2,
  );
});

test("local screen preview is muted, attaches the published screen and detaches on cleanup", () => {
  const result = renderCall({ joined: true, screenSharing: true });
  const screenTile = elements(result.tree).find((element) =>
    element.props?.className?.includes("screenShare"),
  );
  const preview = elements(screenTile).find(
    (element) => element.type === "video",
  );
  assert.equal(preview.props.muted, true);
  const cleanups = result.effects.map((effect) => effect());
  assert.deepEqual(result.attached, [preview.props.ref.current]);
  // Only the preview effect has attached a track; its cleanup must release it.
  cleanups.at(-2)();
  assert.deepEqual(result.detached, result.attached);
  const stop = elements(result.tree).find(
    (element) => element.props?.className === "stopSharing",
  );
  assert.equal(stop.props.children[0], "Stop sharing");
});

test("joining keeps the call grid closed and clicking the joined channel opens it without rejoining", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const pageAst = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let select;
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "selectVoiceChannel"
    )
      select = node;
    ts.forEachChild(node, visit);
  }
  visit(pageAst);
  const events = [];
  const selectChannel = vm.runInNewContext(
    `${ts.transpile(select.getText(pageAst))}; selectVoiceChannel`,
    {
      activeVoiceChannelId: "active",
      setCallViewOpen: (open) => events.push(open),
      leaveRoom: () => events.push("leave"),
      prepareVoiceActivity() {},
      prepareRemoteAudio() {},
      prepareVoiceSounds() {},
      setActiveVoiceChannelId() {},
      setActiveVoiceChannelSnapshot() {},
      setVoiceJoinTarget() {},
      setVoiceJoinKey() {},
      setCallPeerPresent() {},
    },
  );
  selectChannel({ id: "active" });
  assert.deepEqual(events, [true]);
  events.length = 0;
  selectChannel({ id: "next", type: "voice_group" });
  assert.deepEqual(events, ["leave", false]);
});

test("Friends is the initial workspace and LC returns to the list without leaving voice", async () => {
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
  let open, initial;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "openFriendsHome")
      open = node;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements[0]?.getText(ast) === "friendsView"
    )
      initial = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(initial, "true");
  const changes = {};
  const navigate = vm.runInNewContext(
    `${ts.transpile(open.getText(ast))}; openFriendsHome`,
    {
      setSelectedFriend: (value) => {
        changes.friend = value;
      },
      setFriendsView: (value) => {
        changes.friends = value;
      },
      setCallViewOpen: (value) => {
        changes.media = value;
      },
      leaveRoom() {
        throw new Error("Navigation must not leave voice");
      },
    },
  );
  navigate();
  assert.deepEqual(changes, { friend: null, friends: true, media: false });
});

test("opening a friend conversation switches workspace and hides media without leaving voice", async () => {
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
  let open;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "openFriend")
      open = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const changes = {};
  const navigate = vm.runInNewContext(
    `${ts.transpile(open.getText(ast))}; openFriend`,
    {
      setFriendsView: (value) => {
        changes.friends = value;
      },
      setCallViewOpen: (value) => {
        changes.media = value;
      },
      setSelectedFriend: (value) => {
        changes.friend = value;
      },
      setUnreadDirectMessages: (update) => {
        changes.unread = { ...update({ target: 3, other: 2 }) };
      },
      leaveRoom() {
        throw new Error("Opening a conversation must not leave voice");
      },
    },
  );
  const friend = { id: "target", name: "Friend" };
  navigate(friend);
  assert.deepEqual(changes, {
    friends: true,
    media: false,
    friend,
    unread: { other: 2 },
  });
});

test("session refresh preserves workspace readiness only while an authenticated session remains", async () => {
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
  let expression;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "authStatus"
    )
      expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression);
  for (const [sessionStatus, session, expected] of [
    ["loading", { user: { id: "user" } }, "authenticated"],
    ["loading", null, "loading"],
    ["unauthenticated", null, "unauthenticated"],
    ["unauthenticated", { user: { id: "user" } }, "unauthenticated"],
  ]) {
    assert.equal(
      vm.runInNewContext(expression, { sessionStatus, session }),
      expected,
    );
  }
});

test("microphone menu exposes the same actions before and after joining", async () => {
  const source = await readFile(
    new URL("../app/device-menu.tsx", import.meta.url),
    "utf8",
  );
  const preferences = new Map();
  let restarts = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    }),
    {
      exports,
      require: (name) =>
        name === "react"
          ? {
              useState: () => [true, () => {}],
              useEffect() {},
              useRef: () => ({ current: null }),
            }
          : name === "react/jsx-runtime"
            ? { jsx, jsxs: jsx }
            : { DeviceSelection: "DeviceSelection" },
      localStorage: {
        getItem: (key) => preferences.get(key) ?? null,
        setItem: (key, value) => preferences.set(key, value),
      },
    },
  );
  for (const active of [false, true]) {
    preferences.clear();
    const tree = exports.DeviceMenu({
      kind: "microphone",
      disabled: false,
      devices: [],
      selectedId: "",
      onAction() {},
      onSelect() {},
      onRestart: active
        ? () => {
            restarts++;
          }
        : undefined,
    });
    const restart = elements(tree).find(
      (element) =>
        element.type === "button" &&
        element.props.children === "Restart microphone",
    );
    assert.equal(restart.props.disabled, !active);
    const processing = elements(tree).find(
      (element) =>
        element.type === "button" &&
        Array.isArray(element.props.children) &&
        element.props.children.join("") === "Disable microphone processing",
    );
    assert.ok(processing);
    processing.props.onClick();
    assert.equal(preferences.get("lc.microphoneProcessing"), "off");
  }
  assert.equal(
    restarts,
    1,
    "idle processing changes must not request microphone capture",
  );
});
