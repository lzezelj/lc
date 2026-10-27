import assert from "node:assert/strict";
import test from "node:test";
import {
  createGateState,
  createMicrophoneGate,
  createVoiceThresholdProcessor,
  readVoiceThreshold,
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
  assert.equal(gate.update(-65, -45, 230), false);
  assert.equal(gate.update(-80, -80, 250), true, "off means always transmit");
});

test("gate controls actual output gain, follows live threshold changes, and cleans up processors", async () => {
  const keys = ["window", "localStorage", "MediaStream"];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const callbacks = new Map();
  let threshold = "-45";
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
      localStorage: { getItem: () => threshold },
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
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
