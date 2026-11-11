import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

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
const handlers = new Map();
function visit(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    ["toggleAudio", "toggleDeafen", "toggleVideo"].includes(node.name?.text)
  )
    handlers.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
function control(name, additions = {}) {
  const sounds = [],
    errors = [];
  const scope = {
    takeVoiceToggle: () => true,
    peerGeneration: { current: 0 },
    cameraSource: (track) => track,
    captureCamera: (...args) =>
      scope.navigator.mediaDevices.getUserMedia(...args),
    microphoneMuted: false,
    deafened: false,
    voiceBlocked: (policy) =>
      Boolean(policy?.voiceMuted || policy?.voiceDeafened),
    ownVoicePolicy: {},
    cameraOff: true,
    muted: false,
    screenSharing: false,
    deafenedRef: { current: false },
    effectiveMutedRef: { current: false },
    activeGroupChannelId: { current: "" },
    stream: { current: null },
    remoteAudio: { current: {} },
    screenStream: { current: null },
    localVideo: { current: null },
    connection: { current: null },
    setMuted() {},
    setDeafened() {},
    setMicrophoneDeafened() {},
    setCameraOff() {},
    setLocalVideoQuality() {},
    setFocusedDirectVideo() {},
    send() {},
    playVoiceSound: (type) => sounds.push(type),
    setErrorMessage: (error) => errors.push(error),
    ...additions,
  };
  const run = vm.runInNewContext(
    `${ts.transpile(handlers.get(name), { target: ts.ScriptTarget.ES2022 })}; ${name}`,
    scope,
  );
  return { run, sounds, errors };
}

test("native and idle microphone mute/unmute actions sound once, while deafen-blocked actions stay quiet", () => {
  for (const microphoneMuted of [false, true]) {
    const idle = control("toggleAudio", { microphoneMuted });
    idle.run();
    assert.deepEqual(idle.sounds, [microphoneMuted ? "unmute" : "mute"]);
    const track = { enabled: !microphoneMuted };
    const active = control("toggleAudio", {
      microphoneMuted,
      stream: { current: { getAudioTracks: () => [track] } },
    });
    active.run();
    assert.deepEqual(active.sounds, [microphoneMuted ? "unmute" : "mute"]);
  }
  const blocked = control("toggleAudio", { deafened: true });
  blocked.run();
  assert.deepEqual(blocked.sounds, []);
});

test("deafen and undeafen each play one confirmation without an extra microphone tone", () => {
  for (const deafened of [false, true]) {
    const fixture = control("toggleDeafen", { deafened });
    fixture.run();
    assert.deepEqual(fixture.sounds, [deafened ? "undeafen" : "deafen"]);
  }
});

test("self undeafen cannot clear server deafen or reopen a server-muted microphone", () => {
  const capture = { enabled: false },
    audio = { muted: true },
    changes = [];
  const blocked = control("toggleDeafen", {
    ownVoicePolicy: { voiceDeafened: true },
    deafened: true,
    stream: { current: { getAudioTracks: () => [capture] } },
    remoteAudio: { current: audio },
    setDeafened: (value) => changes.push(value),
  });
  blocked.run();
  assert.equal(capture.enabled, false);
  assert.equal(audio.muted, true);
  assert.deepEqual(changes, []);
  assert.deepEqual(blocked.sounds, []);
  const muted = control("toggleDeafen", {
    ownVoicePolicy: { voiceMuted: true },
    deafened: true,
    stream: { current: { getAudioTracks: () => [capture] } },
    remoteAudio: { current: audio },
  });
  muted.run();
  assert.equal(audio.muted, false);
  assert.equal(capture.enabled, false);
});

test("camera enable and disable sound for successful actions, but not failed permission", async () => {
  for (const enabled of [false, true]) {
    const track = { enabled };
    const fixture = control("toggleVideo", {
      stream: { current: { getVideoTracks: () => [track] } },
    });
    await fixture.run();
    assert.deepEqual(fixture.sounds, [enabled ? "camera-off" : "camera-on"]);
  }
  const capture = { enabled: true };
  const success = control("toggleVideo", {
    cameraId: "",
    cameraConstraints: () => ({}),
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getVideoTracks: () => [capture] }),
      },
    },
    MediaStream: class {
      addTrack() {}
    },
  });
  await success.run();
  assert.deepEqual(success.sounds, ["camera-on"]);
  const failed = control("toggleVideo", {
    cameraId: "",
    cameraConstraints: () => ({}),
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          throw new Error("denied");
        },
      },
    },
  });
  await failed.run();
  assert.deepEqual(failed.sounds, []);
  assert.equal(failed.errors.length, 1);
});

test("action tones use distinct brief envelopes routed only to local output", async () => {
  const tones = [],
    gains = [];
  const destination = {};
  const exports = {};
  vm.runInNewContext(
    ts.transpile(
      await readFile(new URL("../app/call-sounds.ts", import.meta.url), "utf8"),
      { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    ),
    {
      exports,
      window: {
        AudioContext: class {
          currentTime = 10;
          destination = destination;
          resume() {
            return Promise.resolve();
          }
          createOscillator() {
            const tone = {
              frequency: { value: 0 },
              connect(gain) {
                return gain;
              },
              start(time) {
                this.started = time;
              },
              stop(time) {
                this.stopped = time;
              },
            };
            tones.push(tone);
            return tone;
          }
          createGain() {
            const levels = [];
            gains.push(levels);
            return {
              gain: {
                setValueAtTime: (value) => levels.push(value),
                exponentialRampToValueAtTime: (value) => levels.push(value),
              },
              connect: (target) => {
                assert.equal(target, destination);
              },
            };
          }
        },
      },
    },
  );
  const signatures = [];
  for (const type of [
    "mute",
    "unmute",
    "deafen",
    "undeafen",
    "camera-on",
    "camera-off",
  ]) {
    const first = tones.length;
    exports.playVoiceSound(type);
    const created = tones.slice(first);
    const frequencies = created.map((tone) => tone.frequency.value);
    assert.ok(
      created.every(
        (tone) => tone.stopped > tone.started && tone.stopped - 10 < 0.5,
      ),
    );
    assert.ok(
      ["unmute", "undeafen", "camera-on"].includes(type)
        ? frequencies.at(-1) > frequencies[0]
        : frequencies.at(-1) < frequencies[0],
    );
    signatures.push(frequencies.join(","));
  }
  assert.equal(new Set(signatures).size, 6);
  assert.ok(gains.flat().every((level) => level > 0 && level < 0.2));
});
