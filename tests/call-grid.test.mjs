import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { sharedAudioCapture, sharedAudioPublish } from "../app/shared-audio.ts";
import { participantGain } from "../app/remote-audio-volume.ts";
import { voiceBlocked } from "../app/voice-policy.ts";
import { applyVoiceSubscriptions } from "../app/voice-permissions.ts";
import { createAudioTransmissionGate } from "../app/audio-transmission.ts";
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("personal mute leaves publishing alone; personal and server deafen deny only audio to the relevant recipients", () => {
  const calls = [];
  const room = {
    state: "connected",
    localParticipant: {
      trackPublications: new Map([
        ["audio", { kind: "audio", trackSid: "mic" }],
        ["video", { kind: "video", trackSid: "camera" }],
      ]),
      setTrackSubscriptionPermissions: (...args) => calls.push(args),
    },
    remoteParticipants: new Map(
      ["alice:one", "alice:two", "bob:one"].map((identity) => [
        identity,
        { identity },
      ]),
    ),
  };
  applyVoiceSubscriptions(room, { alice: { volume: 50, muted: true } }, {});
  assert.deepEqual(calls.pop(), [true]);
  for (const state of [
    "disconnected",
    "connecting",
    "reconnecting",
    "signalReconnecting",
  ]) {
    room.state = state;
    applyVoiceSubscriptions(room, { alice: { deafened: true } }, {});
    assert.equal(
      calls.length,
      0,
      "No permission signals before the room is connected",
    );
  }
  room.state = "connected";
  for (const [choices, policies] of [
    [{ alice: { deafened: true } }, {}],
    [{}, { alice: { voiceDeafened: true } }],
  ]) {
    applyVoiceSubscriptions(room, choices, policies);
    const [all, rules] = calls.pop();
    assert.equal(all, false);
    assert.deepEqual(
      rules.slice(0, 2).map((rule) => rule.allowedTrackSids),
      [["camera"], ["camera"]],
    );
    assert.deepEqual(rules[2], {
      participantIdentity: "bob:one",
      allowAll: true,
    });
  }
  for (const ownPolicy of [{ voiceMuted: true }, { voiceDeafened: true }]) {
    applyVoiceSubscriptions(room, {}, {}, ownPolicy);
    assert.ok(
      calls
        .pop()[1]
        .every(
          (rule) => !rule.allowAll && rule.allowedTrackSids[0] === "camera",
        ),
    );
  }
  applyVoiceSubscriptions(room, {}, {});
  assert.deepEqual(calls.pop(), [true]);
  assert.equal(
    participantGain(
      { alice: { volume: 80, muted: false, deafened: true } },
      "alice:one",
    ),
    0,
  );
});

test("native audio transmission serializes rapid deafen changes without touching video or capture", async () => {
  let release;
  let parameters = { encodings: [{ active: true }] };
  const updates = [],
    track = { enabled: true };
  const peer = {
    signalingState: "stable",
    getTransceivers: () => [
      {
        receiver: { track: { kind: "audio" } },
        sender: {
          track,
          getParameters: () => structuredClone(parameters),
          setParameters: async (next) => {
            updates.push(next.encodings[0].active);
            if (updates.length === 1)
              await new Promise((resolve) => {
                release = resolve;
              });
            parameters = next;
          },
        },
      },
      {
        receiver: { track: { kind: "video" } },
        sender: {
          getParameters: () => {
            throw new Error("Video must remain untouched");
          },
        },
      },
    ],
  };
  let errors = 0;
  const gate = createAudioTransmissionGate(peer, () => errors++);
  const pending = gate.update(true);
  await gate.update(false);
  release();
  await pending;
  assert.deepEqual(updates, [false, true]);
  assert.equal(track.enabled, true);
  assert.equal(errors, 0);
  peer.signalingState = "closed";
  await gate.update(true);
  assert.deepEqual(updates, [false, true]);
});

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
const qualitySource = await readFile(
  new URL("../app/screen-share-options.tsx", import.meta.url),
  "utf8",
);
const screenShareResolutions = vm.runInNewContext(
  `(${qualitySource.match(/export const screenShareResolutions = ([\s\S]*?);/)[1]})`,
);
const cameraSource = await readFile(
  new URL("../app/camera-resolution.tsx", import.meta.url),
  "utf8",
);
const cameraResolutions = vm.runInNewContext(
  `(${cameraSource.match(/export const cameraResolutions = ([\s\S]*?);/)[1]})`,
);
const cameraHelpers = {};
vm.runInNewContext(
  ts.transpile(cameraSource, {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  }),
  { exports: cameraHelpers, require: () => ({}) },
);
const elements = (node) =>
  Array.isArray(node)
    ? node.flatMap(elements)
    : node && typeof node === "object"
      ? [node, ...elements(node.props?.children)]
      : [];

test("camera capture and encoder ceilings follow the requested 30 or 60 fps", () => {
  for (const fps of [30, 60]) {
    const constraints = cameraHelpers.cameraCaptureConstraints(
      "camera",
      "1080",
      fps,
    );
    assert.equal(constraints.frameRate.ideal, fps);
    assert.equal(constraints.frameRate.max, fps);
    const encoding = cameraHelpers.videoPublishEncoding(1080, fps);
    assert.equal(encoding.maxFramerate, fps);
    assert.equal(encoding.maxBitrate, fps === 60 ? 9000000 : 6000000);
  }
  assert.equal(cameraHelpers.readCameraFrameRate(), 30);
});

// Render the actual call component with named hook state and track attachment
// doubles, so no LiveKit server or physical capture device is required.
function renderCall(state = {}, options = {}) {
  const stateNames = [
    ...declaration.getText(ast).matchAll(/const \[(\w+),\s*\w+\] = useState/g),
  ].map((match) => match[1]);
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  const effectDeps = [];
  const refs = [];
  const effects = [];
  const attached = [];
  const detached = [];
  const opened = [];
  const events = [];
  const sounds = [];
  const handlers = new Map();
  const timeouts = new Map(),
    windowEvents = new Map();
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
      setTrackSubscriptionPermissions() {},
      trackPublications: publications,
      async publishTrack(track, settings) {
        events.push(["publish sound", track, settings]);
      },
      async unpublishTrack(track) {
        events.push(["unpublish sound", track]);
      },
      videoTrackPublications: publications,
      getTrackPublication: (source) =>
        source === "mic" && options.microphoneTrack
          ? { track: options.microphoneTrack }
          : (publications.get(source) ?? {}),
      async setScreenShareEnabled(enabled, options, publishOptions) {
        events.push(["screen capture", enabled, options, publishOptions]);
        await options.screenPending;
      },
      async setCameraEnabled() {
        await options.cameraPending;
      },
      async setMicrophoneEnabled(enabled) {
        events.push(["microphone", enabled]);
        await options.onMicrophoneUpdate?.(enabled);
      },
    },
  };
  const Component = vm.runInNewContext(`${code}; GroupCall`, {
    useCameraMirror: () => false,
    CameraMirrorControl: () => null,
    CameraMirrorProcessor: class {},
    takeVoiceToggle: () => true,
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: { ...props, children },
      }),
    },
    useState(initial) {
      const name = stateNames[stateIndex++];
      const value =
        name in stateWrites
          ? stateWrites[name]
          : name in state
            ? state[name]
            : initial;
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
      const index = refIndex++;
      if (refs[index]) return refs[index];
      const ref = {
        current: refs.length === 0 ? (options.unjoined ? null : room) : initial,
      };
      refs.push(ref);
      return ref;
    },
    useEffect(effect, deps) {
      const index = effectIndex++;
      const previous = effectDeps[index];
      if (
        !previous ||
        !deps ||
        deps.some((value, i) => !Object.is(value, previous.deps[i]))
      )
        effects.push(effect);
      effectDeps[index] = { deps };
    },
    Track: {
      Kind: { Video: "video", Audio: "audio" },
      Source: {
        ScreenShare: "screen",
        Camera: "camera",
        Microphone: "mic",
        Unknown: "unknown",
      },
    },
    Room: class {
      constructor() {
        events.push("create room");
        return room;
      }
    },
    RoomEvent: new Proxy({}, { get: (_, name) => name }),
    DisconnectReason: {
      CLIENT_INITIATED: 1,
      DUPLICATE_IDENTITY: 2,
      PARTICIPANT_REMOVED: 4,
      ROOM_DELETED: 5,
    },
    LocalAudioTrack: class {
      constructor(track) {
        this.mediaStreamTrack = track;
      }
    },
    TrackEvent: { Restarted: "restart" },
    monitorVoiceActivity: () => () => {},
    prepareVoiceActivity() {},
    voiceCaptureOptions: () => ({}),
    playVoiceSound: (type) => sounds.push(type),
    monitorTrackVideo: () => () => {},
    monitorRoomDiagnostics: () => () => {},
    fetch:
      options.fetch ??
      (async () => ({
        ok: true,
        json: async () => ({ server_url: "test", participant_token: "test" }),
      })),
    navigator: { onLine: options.online ?? true },
    window: {
      setInterval: () => 1,
      clearInterval() {},
      setTimeout(callback) {
        const id = timeouts.size + 1;
        timeouts.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timeouts.delete(id);
      },
      addEventListener(event, callback) {
        windowEvents.set(event, callback);
      },
      removeEventListener(event) {
        windowEvents.delete(event);
      },
    },
    DeviceMenu: "DeviceMenu",
    StreamInfo: "StreamInfo",
    StreamVolume: "StreamVolume",
    SoundboardButton: "SoundboardButton",
    sharedAudioCapture,
    participantGain,
    voiceBlocked,
    applyVoiceSubscriptions,
    sharedAudioPublish,
    useSoundboard: (_channel, settings) => {
      options.soundSettings = settings;
      return {
        player: { current: { stop() {} } },
        preview: { current: { stop() {} } },
        playJoinSound() {},
        stopJoinSound() {},
        volume: options.soundboardVolume ?? 100,
        muted: options.soundboardMuted ?? false,
      };
    },
    fullscreenVideoTile() {},
    ScreenShareOptions: "ScreenShareOptions",
    screenShareResolutions,
    cameraResolutions,
    videoPublishEncoding: cameraHelpers.videoPublishEncoding,
    CameraResolutionSelection: "CameraResolutionSelection",
    RemoteTrackView: "RemoteTrackView",
    HideTileButton: "HideTileButton",
    HiddenTilesMenu: "HiddenTilesMenu",
    SelfViewButton: "SelfViewButton",
  });
  const props = {
    channelId: "room-1",
    currentUserName: "Local user",
    cameraResolution: options.cameraResolution,
    currentUserId: options.currentUserId,
    focusTarget: options.focusTarget,
    deafened: options.deafened ?? false,
    initialMuted: options.initialMuted ?? false,
    outputVolume: 0.4,
    participantAudio: options.participantAudio,
    serverPolicy: options.serverPolicy,
    microphones: [],
    cameras: [],
    viewOpen: options.viewOpen ?? true,
    onConnectionChange: (present) => events.push(["present", present]),
    onReconnect: () => events.push("reconnected"),
    onLeave: () => events.push("leave"),
    onPingChange() {},
    onMediaStateChange: (media) => events.push(["media", media]),
    onDiagnosticsChange() {},
    onError(message) {
      if (options.onError) return options.onError(message);
      throw new Error(message);
    },
    onOpenView: () => opened.push(true),
  };
  const tree = Component(props);
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
    sounds,
    refs,
    handlers,
    timeouts,
    windowEvents,
    stateWrites,
    rerender() {
      stateIndex = refIndex = effectIndex = 0;
      effects.length = 0;
      return { tree: Component(props), effects: [...effects] };
    },
  };
}

test("LiveKit mute/unmute and camera on/off actions play local confirmation only when successful", async () => {
  const fixture = renderCall({ joined: true });
  const action = (kind) =>
    elements(fixture.rerender().tree)
      .find(
        (element) =>
          element.type === "DeviceMenu" && element.props.kind === kind,
      )
      .props.onAction();
  action("microphone");
  await settle();
  assert.deepEqual(fixture.sounds, ["mute"]);
  action("microphone");
  await settle();
  assert.deepEqual(fixture.sounds, ["mute", "unmute"]);
  action("camera");
  await settle();
  assert.deepEqual(fixture.sounds, ["mute", "unmute", "camera-on"]);
  action("camera");
  await settle();
  assert.deepEqual(fixture.sounds, [
    "mute",
    "unmute",
    "camera-on",
    "camera-off",
  ]);
});

test("failed LiveKit mute or camera actions do not play success tones", async () => {
  const errors = [];
  const fixture = renderCall(
    { joined: true },
    {
      onMicrophoneUpdate: async () => {
        throw new Error("unavailable");
      },
      onError: (message) => errors.push(message),
    },
  );
  elements(fixture.tree)
    .find(
      (element) =>
        element.type === "DeviceMenu" && element.props.kind === "microphone",
    )
    .props.onAction();
  await settle();
  assert.equal(errors.length, 1);
  assert.deepEqual(fixture.sounds, []);
  let rejectCamera;
  const camera = renderCall(
    { joined: true },
    {
      cameraPending: new Promise((_, reject) => {
        rejectCamera = reject;
      }),
      onError: (message) => errors.push(message),
    },
  );
  elements(camera.tree)
    .find(
      (element) =>
        element.type === "DeviceMenu" && element.props.kind === "camera",
    )
    .props.onAction();
  rejectCamera(new Error("denied"));
  await settle();
  assert.equal(errors.length, 2);
  assert.deepEqual(camera.sounds, []);
});

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

test("mute button, capture and presence stay aligned through SDK-triggered renders and repeated unmute", async () => {
  let finishUnmute;
  const microphoneTrack = {
    mediaStreamTrack: { enabled: false },
    on() {},
    off() {},
  };
  const result = renderCall(
    { joined: true },
    {
      initialMuted: true,
      microphoneTrack,
      onMicrophoneUpdate: (enabled) =>
        enabled
          ? new Promise((resolve) => {
              finishUnmute = resolve;
            })
          : Promise.resolve(),
    },
  );
  result.effects.forEach((effect) => effect());
  await settle();
  let tree = result.tree;
  const microphone = () =>
    elements(tree).find(
      (element) =>
        element.type === "DeviceMenu" && element.props.kind === "microphone",
    );
  const render = () => {
    const next = result.rerender();
    tree = next.tree;
    next.effects.forEach((effect) => effect());
  };
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal(
      microphone().props.disabled,
      true,
      "Red microphone must mean muted",
    );
    microphone().props.onAction();
    await settle();
    render();
    assert.equal(
      microphone().props.disabled,
      false,
      "Unmute intent must update before the SDK completes",
    );
    // LiveKit emits track callbacks while unmute is still pending.
    render();
    finishUnmute();
    await settle();
    assert.equal(microphoneTrack.mediaStreamTrack.enabled, true);
    assert.equal(
      result.events.filter((event) => event[0] === "media").at(-1)[1].muted,
      false,
    );
    microphone().props.onAction();
    render();
    await settle();
    assert.equal(microphone().props.disabled, true);
    assert.equal(microphoneTrack.mediaStreamTrack.enabled, false);
    assert.equal(
      result.events.filter((event) => event[0] === "media").at(-1)[1].muted,
      true,
    );
  }
});

test("group soundboard publishes a named separate track and removes that same publication", async () => {
  const result = renderCall({ joined: true, muted: true });
  const board = elements(result.tree).find(
    (element) => element.type === "SoundboardButton",
  );
  const track = { id: "generated-sound" };
  const release = await board.props.publish(track);
  const published = result.events.find((event) => event[0] === "publish sound");
  assert.equal(published[1].mediaStreamTrack, track);
  assert.equal(published[2].name, "lc-soundboard");
  assert.equal(published[2].source, "unknown");
  release();
  assert.equal(
    result.events.find((event) => event[0] === "unpublish sound")[1],
    published[1],
  );
});

test("published soundboard activity announces a distinct flag and clears on completion", () => {
  const options = {};
  const result = renderCall({ joined: true, userMuted: false }, options);
  options.soundSettings.onSpeakingChange(true);
  options.soundSettings.onPlayingChange(true);
  const active = result.events
    .filter((event) => event[0] === "media")
    .at(-1)[1];
  assert.equal(active.speaking, true);
  assert.equal(active.muted, false);
  assert.equal(active.soundboard, true);
  assert.equal(active.microphoneSpeaking, false);
  options.soundSettings.onSpeakingChange(false);
  assert.equal(
    result.events.filter((event) => event[0] === "media").at(-1)[1].soundboard,
    true,
    "Silence in a clip keeps the playback indicator visible",
  );
  options.soundSettings.onPlayingChange(false);
  assert.equal(
    result.events.filter((event) => event[0] === "media").at(-1)[1].speaking,
    false,
  );
});

test("direct speaking combines microphone and soundboard without one source clearing the other", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const source = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let declaration;
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "updateDirectSpeaking"
    )
      declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const directMicSpeaking = { current: false },
    directSoundSpeaking = { current: true };
  const emitted = [],
    indicators = [];
  const update = vm.runInNewContext(
    `${ts.transpile(declaration.getText(source))}; updateDirectSpeaking`,
    {
      directMicSpeaking,
      directSoundSpeaking,
      directSoundPlaying: { current: true },
      effectiveMutedRef: { current: true },
      stream: { current: null },
      screenSharing: false,
      session: { user: { id: "me" } },
      setDirectLocalSpeaking: (value) => indicators.push(value),
      setDirectParticipantSpeaking() {},
      send: (value) => emitted.push(value),
    },
  );
  update();
  assert.equal(emitted.at(-1).speaking, true);
  assert.equal(emitted.at(-1).muted, true);
  directMicSpeaking.current = true;
  directSoundSpeaking.current = false;
  update();
  assert.equal(indicators.at(-1), true);
  directMicSpeaking.current = false;
  update();
  assert.equal(indicators.at(-1), false);
});

test("per-person playback affects only that person's voice, screen and soundboard tracks", () => {
  const media = [
    {
      id: "a-voice",
      participantId: "a:session-one",
      track: { kind: "audio" },
      isScreen: false,
    },
    {
      id: "a-screen",
      participantId: "a",
      track: { kind: "audio" },
      isScreen: true,
    },
    {
      id: "a-sound",
      participantId: "a",
      track: { kind: "audio" },
      isScreen: false,
      isSoundboard: true,
    },
    {
      id: "b-voice",
      participantId: "b",
      track: { kind: "audio" },
      isScreen: false,
    },
  ];
  for (const [setting, expected] of [
    [{ volume: 50, muted: false }, 0.2],
    [{ volume: 50, muted: true }, 0],
  ]) {
    const result = renderCall(
      { joined: true, muted: false, remoteMedia: media },
      { participantAudio: { a: setting } },
    );
    const views = elements(result.tree).filter(
      (element) => element.type === "RemoteTrackView",
    );
    assert.equal(
      views.find((view) => view.props.media.id === "a-voice").props.volume,
      expected,
    );
    assert.equal(
      views.find((view) => view.props.media.id === "a-screen").props.volume,
      expected,
    );
    assert.equal(
      views.find((view) => view.props.media.id === "a-sound").props.volume,
      expected,
    );
    assert.equal(
      views.find((view) => view.props.media.id === "b-voice").props.volume,
      0.4,
    );
  }
});

test("soundboard gain, mute and deafen are independent of microphone and media-panel visibility", () => {
  const media = [
    { id: "voice", track: { kind: "audio" }, isScreen: false },
    {
      id: "sound",
      track: { kind: "audio" },
      isScreen: false,
      isSoundboard: true,
    },
  ];
  for (const [options, voice, sound] of [
    [{ soundboardVolume: 25, viewOpen: false }, 0.4, 0.1],
    [{ soundboardMuted: true }, 0.4, 0],
    [{ deafened: true }, 0, 0],
  ]) {
    const result = renderCall(
      { joined: true, muted: true, remoteMedia: media },
      options,
    );
    const views = elements(result.tree).filter(
      (element) => element.type === "RemoteTrackView",
    );
    assert.equal(
      views.find((view) => view.props.media.id === "voice").props.volume,
      voice,
    );
    assert.equal(
      views.find((view) => view.props.media.id === "sound").props.volume,
      sound,
    );
  }
});

test("screen audio volume is independent from voices and participant shortcuts reveal the matching tile", async () => {
  const media = [
    {
      id: "voice",
      participantId: "person:session",
      participantName: "Person",
      track: { kind: "audio" },
      isScreen: false,
    },
    {
      id: "screen-audio",
      participantId: "person:session",
      participantName: "Person",
      track: { kind: "audio" },
      isScreen: true,
    },
    {
      id: "screen-video",
      participantId: "person:session",
      participantName: "Person",
      track: { kind: "video" },
      isScreen: true,
    },
  ];
  const result = renderCall(
    {
      joined: true,
      remoteMedia: media,
      streamVolumes: { "person:session": 25 },
      hiddenTiles: ["person:session:screen"],
    },
    { focusTarget: { userId: "person", kind: "screen", requestId: 1 } },
  );
  const views = elements(result.tree).filter(
    (element) => element.type === "RemoteTrackView",
  );
  assert.equal(
    views.find((view) => view.props.media.id === "voice").props.volume,
    0.4,
  );
  assert.equal(
    views.find((view) => view.props.media.id === "screen-audio").props.volume,
    0,
  );
  result.effects.forEach((effect) => effect());
  await settle();
  assert.equal(result.stateWrites.focusedVideo, "screen-video");
  assert.deepEqual(Array.from(result.stateWrites.hiddenTiles), []);
  for (const [options, state, expected] of [
    [{ viewOpen: true }, { focusedVideo: "screen-video" }, 0.1],
    [{ viewOpen: false }, {}, 0],
    [{ viewOpen: true }, { focusedVideo: "camera-video" }, 0],
  ]) {
    const updated = renderCall(
      {
        joined: true,
        remoteMedia: media,
        streamVolumes: { "person:session": 25 },
        ...state,
      },
      options,
    );
    const updatedViews = elements(updated.tree).filter(
      (element) => element.type === "RemoteTrackView",
    );
    assert.equal(
      updatedViews.find((view) => view.props.media.id === "screen-audio").props
        .volume,
      expected,
    );
    assert.equal(
      updatedViews.find((view) => view.props.media.id === "voice").props.volume,
      0.4,
    );
  }
  const deafened = renderCall(
    {
      joined: true,
      remoteMedia: media,
      streamVolumes: { "person:session": 25 },
    },
    { deafened: true },
  );
  assert.ok(
    elements(deafened.tree)
      .filter((element) => element.type === "RemoteTrackView")
      .every((view) => view.props.volume === 0),
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
          ownVoicePolicy: {},
          takeVoiceToggle: () => true,
          deafened,
          deafenedRef: { current: deafened },
          activeGroupChannelId: { current: "" },
          setMicrophoneDeafened() {},
          setDeafened: (value) => updates.push(value),
          effectiveMutedRef: { current: true },
          stream: { current: { getAudioTracks: () => [capture] } },
          remoteAudio: { current: audio },
          cameraOff: true,
          screenSharing: false,
          send() {},
          playVoiceSound() {},
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
      ownVoicePolicy: {},
      voiceBlocked,
      audioDeviceOptions: null,
      cameraResolutionOptions: null,
      voiceReady: false,
      muted: false,
      microphones: [],
      microphoneId: "",
      toggleAudio() {},
      cameraOff: true,
      cameras: [],
      cameraId: "",
      screenSharing: false,
      directSoundboard: {
        type: "button",
        props: { disabled: true, children: ["Soundboard"] },
      },
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

test("LiveKit failures show an error and retry on internet return; replacement never retries", async () => {
  for (const reason of [9, 4]) {
    const errors = [];
    const result = renderCall(
      {},
      {
        unjoined: true,
        initialMuted: true,
        onError: (message) => errors.push(message),
      },
    );
    const cleanups = result.effects.map((effect) => effect());
    const button = elements(result.tree).find(
      (element) => element.props?.className === "primary",
    );
    button.props.onClick();
    await settle();
    assert.equal(result.stateWrites.joined, true);
    result.handlers.get("Reconnected")();
    assert.ok(result.events.includes("reconnected"));
    result.handlers.get("Disconnected")(reason);
    if (reason === 9) {
      assert.match(errors[0], /LiveKit.*unavailable/);
      assert.equal(result.events.includes("leave"), false);
      assert.equal(result.timeouts.size, 1);
      const latest = result.rerender();
      const retry = elements(latest.tree).find(
        (element) => element.props?.className === "primary",
      );
      retry.props.ref.current = { click: () => retry.props.onClick() };
      result.windowEvents.get("online")();
      await settle();
      assert.equal(result.stateWrites.joined, true);
      assert.equal(result.timeouts.size, 0);
      assert.equal(
        result.stateWrites.userMuted,
        undefined,
        "reconnection does not unmute the user's microphone",
      );
    } else {
      assert.ok(result.events.includes("leave"));
      assert.deepEqual(errors, []);
      assert.equal(result.timeouts.size, 0);
    }
    cleanups.filter(Boolean).forEach((cleanup) => cleanup());
    assert.equal(result.timeouts.size, 0);
    assert.equal(result.windowEvents.has("online"), false);
  }
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
  assert.equal(result.stateWrites.screenShareOptionsOpen, true);
  assert.deepEqual(
    result.opened,
    [],
    "Opening resolution options must not start capture",
  );
  const selected = renderCall({ joined: true, screenShareOptionsOpen: true });
  elements(selected.tree)
    .find((element) => element.type === "ScreenShareOptions")
    .props.onShare("1440", 60);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(selected.opened, [true]);
  assert.equal(selected.stateWrites.hiddenTiles, undefined);
  const capture = selected.events.find(
    (event) => event[0] === "screen capture",
  );
  assert.equal(capture[2].resolution.width, 2560);
  assert.equal(capture[2].resolution.height, 1440);
  assert.equal(capture[2].resolution.frameRate, 60);
  assert.equal(capture[2].contentHint, "motion");
  assert.deepEqual(capture[2].audio, sharedAudioCapture);
  assert.deepEqual(JSON.parse(JSON.stringify(capture[3])), {
    ...sharedAudioPublish,
    screenShareEncoding: { maxBitrate: 15000000, maxFramerate: 60 },
    degradationPreference: "maintain-framerate",
  });
});

test("screen picker completing after leave cannot reopen the call or restore presence", async () => {
  let finishScreen;
  const result = renderCall(
    { joined: true, screenShareOptionsOpen: true },
    {
      screenPending: new Promise((resolve) => {
        finishScreen = resolve;
      }),
    },
  );
  const cleanups = result.effects.map((effect) => effect());
  elements(result.tree)
    .find((element) => element.type === "ScreenShareOptions")
    .props.onShare("1080");
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
  let voiceSnapshot;
  const selectChannel = vm.runInNewContext(
    `${ts.transpile(select.getText(pageAst))}; selectVoiceChannel`,
    {
      activeVoiceChannelId: "active",
      voiceSessionId: { current: "active-session" },
      crypto: { randomUUID: () => "next-session" },
      selectedServerId: "server-a",
      servers: [{ id: "server-a", name: "Server A" }],
      setMediaFocusTarget() {},
      setCallViewOpen: (open) => events.push(open),
      leaveRoom: () => events.push("leave"),
      prepareVoiceActivity() {},
      prepareRemoteAudio() {},
      prepareVoiceSounds() {},
      updatePendingVoice() {},
      setActiveVoiceChannelId() {},
      setActiveVoiceChannelSnapshot(value) {
        voiceSnapshot = value;
      },
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
  assert.equal(voiceSnapshot.serverId, "server-a");
  selectChannel({ id: "other", type: "voice_group", serverId: "server-b" });
  assert.equal(
    voiceSnapshot.serverId,
    "server-b",
    "The channel's server wins over the viewed workspace",
  );
});

test("Friends is the initial workspace and LZRelay preserves the selected DM without leaving voice", async () => {
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
  assert.deepEqual(changes, { friends: true, media: false });
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

test("microphone menu shares the processing selector and omits retired capture actions", async () => {
  const source = await readFile(
    new URL("../app/device-menu.tsx", import.meta.url),
    "utf8",
  );
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
              useState: (initial) => [
                initial === false ? true : { parent: {}, style: {} },
                () => {},
              ],
              useEffect() {},
              useLayoutEffect() {},
              useId: () => "device-menu",
              useRef: () => ({ current: null }),
            }
          : name === "react-dom"
            ? { createPortal: (children) => children }
            : name === "react/jsx-runtime"
              ? { jsx, jsxs: jsx }
              : name === "./microphone-processing"
                ? {
                    MicrophoneModeSelector: "MicrophoneModeSelector",
                    EchoCancellationToggle: "EchoCancellationToggle",
                  }
                : { DeviceSelection: "DeviceSelection" },
    },
  );
  for (const kind of ["microphone", "headphones", "camera"]) {
    const tree = exports.DeviceMenu({
      kind,
      disabled: false,
      devices: [],
      selectedId: "",
      onAction() {},
      onSelect() {},
    });
    assert.equal(
      elements(tree).some(
        (element) => element.type === "MicrophoneModeSelector",
      ),
      kind === "microphone",
    );
    assert.ok(
      !elements(tree).some(
        (element) =>
          element.type === "button" &&
          /Restart microphone|microphone processing/.test(
            String(element.props.children),
          ),
      ),
    );
    assert.equal(
      elements(tree).some(
        (element) => element.type === "EchoCancellationToggle",
      ),
      kind === "microphone",
    );
    assert.equal(
      elements(tree).some((element) => element.type === "DeviceSelection"),
      kind !== "headphones",
    );
  }
});
