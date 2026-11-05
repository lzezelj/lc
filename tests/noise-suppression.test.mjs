import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  readMicrophoneMode,
  saveMicrophoneMode,
} from "../app/microphone-preferences.mjs";

test("processing modes migrate old choices and persist independently of echo cancellation", () => {
  const old = new Map(
    ["localStorage", "window"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
  try {
    assert.equal(readMicrophoneMode(), "rnnoise");
    values.set("lc.rnnoise", "off");
    assert.equal(readMicrophoneMode(), "browser");
    values.set("lc.microphoneProcessing", "off");
    assert.equal(readMicrophoneMode(), "raw");
    values.set("lc.echoCancellation", "off");
    for (const mode of ["raw", "browser", "rnnoise"]) {
      saveMicrophoneMode(mode);
      assert.equal(readMicrophoneMode(), mode);
      assert.equal(values.get("lc.echoCancellation"), "off");
    }
    assert.throws(() => saveMicrophoneMode("invalid"), /Invalid/);
    assert.equal(readMicrophoneMode(), "rnnoise");
  } finally {
    for (const [key, descriptor] of old) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("RNNoise waits for ready, shares module loading and cleans up failed/cancelled worklets", async () => {
  const nodes = [];
  let mode = "ready",
    loads = 0,
    failures = 0;
  class Node extends EventTarget {
    constructor() {
      super();
      nodes.push(this);
      this.sent = [];
      this.port = {
        postMessage: (message) => {
          this.sent.push(message);
          if (message === "stop") this.port.onmessage?.({ data: "stopped" });
        },
        close: () => {
          this.closed = true;
        },
      };
      if (mode !== "pending")
        queueMicrotask(() => this.port.onmessage?.({ data: mode }));
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const source = (
    await readFile(
      new URL("../app/noise-suppression.ts", import.meta.url),
      "utf8",
    )
  ).replace('new URL("./rnnoise-worklet.js", import.meta.url)', '"worklet.js"');
  const exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      AudioWorkletNode: Node,
      setTimeout,
      clearTimeout,
      Error,
    },
  );
  const context = {
    audioWorklet: {
      addModule: async () => {
        loads++;
      },
    },
  };
  const create = (abort = new AbortController()) =>
    exports.createNoiseSuppression(context, abort.signal, () => failures++);
  const [a, b] = await Promise.all([create(), create()]);
  assert.equal(loads, 1);
  a.node.dispatchEvent(new Event("processorerror"));
  assert.equal(failures, 1);
  a.stop();
  a.stop();
  b.stop();
  assert.deepEqual(a.node.sent, ["stop"]);
  assert.ok(a.node.closed && a.node.disconnected);
  a.node.dispatchEvent(new Event("processorerror"));
  assert.equal(failures, 1);
  mode = "failed";
  await assert.rejects(create(), /could not start/);
  assert.ok(nodes.at(-1).closed);
  mode = "pending";
  const abort = new AbortController(),
    pending = create(abort);
  await Promise.resolve();
  abort.abort();
  await assert.rejects(pending, /cancelled|aborted/i);
  assert.ok(nodes.at(-1).closed);
});

test("RNNoise frame bridge preserves samples across render blocks and releases late initialization", async () => {
  const source = (
    await readFile(
      new URL("../app/rnnoise-worklet.js", import.meta.url),
      "utf8",
    )
  ).replace(/^import .*;$/m, "");
  let Processor,
    frames = 0,
    destroyed = 0,
    allocated = 0;
  let resolveEngine;
  const loading = new Promise((resolve) => {
    resolveEngine = resolve;
  });
  const library = {
    frameSize: 480,
    createDenoiseState: () => {
      allocated++;
      return {
        processFrame: (frame) => {
          frames++;
          assert.equal(frame[0], 8192);
          frame.fill(4096);
        },
        destroy: () => destroyed++,
      };
    },
  };
  vm.runInNewContext(source, {
    AudioWorkletProcessor: class {
      constructor() {
        this.messages = [];
        this.port = { postMessage: (message) => this.messages.push(message) };
      }
    },
    registerProcessor: (_id, implementation) => {
      Processor = implementation;
    },
    sampleRate: 48000,
    Rnnoise: { load: () => loading },
    Float32Array,
  });
  const early = new Processor();
  early.port.onmessage({ data: "stop" });
  const active = new Processor();
  resolveEngine(library);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(allocated, 1, "stopped worklets cannot allocate a late model");
  assert.ok(active.messages.includes("ready"));
  const input = new Float32Array(128).fill(0.25),
    output = new Float32Array(128);
  for (let i = 0; i < 4; i++) active.process([[input]], [[output]]);
  assert.equal(frames, 1);
  assert.equal(output[95], 0, "first buffered frame is silent");
  assert.equal(output[96], 0.125, "processed PCM is scaled back to Web Audio");
  active.port.onmessage({ data: "stop" });
  assert.equal(destroyed, 1);
  assert.equal(active.process([[input]], [[output]]), false);
});
