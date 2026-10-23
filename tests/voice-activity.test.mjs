import assert from "node:assert/strict";
import { test } from "node:test";
import {
  monitorVoiceActivity,
  prepareVoiceActivity,
} from "../app/voice-activity.ts";

test("voice activity resets on capture interruption and resumes after an audio-context interruption", () => {
  const previous = new Map(
    ["window", "document", "AudioContext", "MediaStream"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  let sample;
  let intervalCleared = false;
  let level = 0.02;
  class Context extends EventTarget {
    state = "suspended";
    destination = {};
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 512,
        connect() {},
        disconnect() {},
        getFloatTimeDomainData(samples) {
          samples.fill(level);
        },
      };
    }
  }
  try {
    Object.assign(globalThis, {
      window: {
        setInterval(callback) {
          sample = callback;
          return 1;
        },
        clearInterval() {
          intervalCleared = true;
        },
      },
      document: new EventTarget(),
      AudioContext: Context,
      MediaStream: class {},
    });
    const track = Object.assign(new EventTarget(), {
      enabled: true,
      muted: false,
      readyState: "live",
    });
    const changes = [];
    const context = prepareVoiceActivity();
    const stop = monitorVoiceActivity(track, (active) => changes.push(active));
    sample();
    assert.deepEqual(changes, [true]);
    track.muted = true;
    track.dispatchEvent(new Event("mute"));
    assert.equal(changes.at(-1), false);
    track.muted = false;
    sample();
    assert.equal(changes.at(-1), true);
    context.state = "suspended";
    context.dispatchEvent(new Event("statechange"));
    assert.equal(changes.at(-1), false);
    document.dispatchEvent(new Event("pointerdown"));
    sample();
    assert.equal(changes.at(-1), true);
    track.readyState = "ended";
    track.dispatchEvent(new Event("ended"));
    assert.equal(changes.at(-1), false);
    sample();
    assert.equal(
      changes.at(-1),
      false,
      "ended tracks must not reuse residual analyser audio",
    );
    level = 0;
    stop();
    assert.equal(intervalCleared, true);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
