import assert from "node:assert/strict";
import test from "node:test";
import {
  createGateState,
  createMicrophoneGate,
  createVoiceThresholdProcessor,
  readVoiceThreshold,
  readMicrophoneVolume,
  setMicrophoneDeafened,
} from "../app/microphone-gate.ts";

test("voice gate blocks quiet input, opens for speech, and releases without chatter", () => {
  const gate = createGateState();
  assert.equal(gate.update(-65, -45, 0), false);
  assert.equal(gate.update(-40, -45, 20), true);
  assert.equal(
    gate.update(-49, -45, 40),
    true,
    "hysteresis keeps syllables open",
  );
  assert.equal(gate.update(-65, -45, 100), true, "short pauses remain open");
  assert.equal(
    gate.update(-65, -45, 230),
    true,
    "quiet word endings retain a longer release",
  );
  assert.equal(gate.update(-65, -45, 430), false);
  assert.equal(gate.update(-80, -80, 450), true, "off means always transmit");
});

test("gate controls actual output gain, follows live threshold changes, and cleans up processors", async () => {
  const keys = ["window", "localStorage", "MediaStream"];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const callbacks = new Map();
  let threshold = "-45";
  let microphoneVolume = "100";
  let level = 0.001;
  const gains = [];
  const outputs = [];
  let disconnected = 0;
  const node = () => ({
    connect() {},
    disconnect() {
      disconnected++;
    },
  });
  const context = Object.assign(new EventTarget(), {
    state: "running",
    currentTime: 0,
    createMediaStreamSource: node,
    createAnalyser: () => ({
      ...node(),
      getFloatTimeDomainData: (samples) => samples.fill(level),
    }),
    createGain: () => {
      const gain = {
        value: 0,
        setTargetAtTime(value) {
          this.value = value;
        },
      };
      gains.push(gain);
      return { ...node(), gain };
    },
    createMediaStreamDestination: () => {
      const track = {
        stopped: false,
        stop() {
          this.stopped = true;
        },
      };
      outputs.push(track);
      return {
        stream: { getAudioTracks: () => [track], getTracks: () => [track] },
      };
    },
  });
  const track = Object.assign(new EventTarget(), {
    enabled: true,
    muted: false,
    readyState: "live",
  });
  try {
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key) =>
          key === "lc.voiceThreshold"
            ? threshold
            : key === "lc.microphoneVolume"
              ? microphoneVolume
              : null,
      },
      MediaStream: class {},
      window: {
        setInterval(callback) {
          const id = callbacks.size + 1;
          callbacks.set(id, callback);
          return id;
        },
        clearInterval(id) {
          callbacks.delete(id);
        },
      },
    });
    assert.equal(readVoiceThreshold(), -45);
    threshold = "invalid";
    assert.equal(readVoiceThreshold(), -50);
    threshold = "-45";
    const gate = createMicrophoneGate(track, context);
    callbacks.get(1)();
    assert.equal(gains[0].value, 0, "quiet audio must be blocked in the graph");
    level = 0.1;
    callbacks.get(1)();
    assert.equal(gains[0].value, 1);
    microphoneVolume = "25";
    callbacks.get(1)();
    assert.equal(
      gains[0].value,
      0.25,
      "input volume applies to an existing transmitted track",
    );
    setMicrophoneDeafened(true);
    callbacks.get(1)();
    assert.equal(
      gains[0].value,
      0,
      "deafen blocks transmission even when capture remains enabled",
    );
    setMicrophoneDeafened(false);
    callbacks.get(1)();
    assert.equal(
      gains[0].value,
      0.25,
      "undeafen restores the saved microphone level",
    );
    microphoneVolume = "0";
    callbacks.get(1)();
    assert.equal(gains[0].value, 0);
    microphoneVolume = "invalid";
    assert.equal(readMicrophoneVolume(), 100);
    microphoneVolume = "100";
    track.muted = true;
    track.dispatchEvent(new Event("mute"));
    assert.equal(gains[0].value, 0, "capture interruptions close output");
    track.muted = false;
    threshold = "-80";
    level = 0;
    callbacks.get(1)();
    assert.equal(
      gains[0].value,
      1,
      "threshold changes apply to an existing graph",
    );
    gate.stop();
    assert.equal(callbacks.size, 0);
    assert.equal(outputs[0].stopped, true);
    assert.equal(disconnected, 3);

    const processor = createVoiceThresholdProcessor();
    await processor.init({ track, audioContext: context });
    const oldOutput = processor.processedTrack;
    await processor.restart({ track, audioContext: context });
    assert.equal(oldOutput.stopped, true);
    assert.equal(callbacks.size, 1);
    const currentOutput = processor.processedTrack;
    await processor.destroy();
    assert.equal(currentOutput.stopped, true);
    assert.equal(callbacks.size, 0);
    assert.equal(processor.processedTrack, undefined);
  } finally {
    setMicrophoneDeafened(false);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
