/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import { Rnnoise } from "/api/audio/rnnoise/2025.1.5";

// The pinned Emscripten build tests for this worker marker. AudioWorklet has
// WebAssembly but no WorkerGlobalScope constructor; this private realm needs
// only the marker (the library does not construct or inspect it).
globalThis.WorkerGlobalScope ??= class {};
const engine = Rnnoise.load();
// Each node reports its own initialization failure to the main thread.
engine.catch(() => {});

class NoiseSuppression extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopped = false;
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") this.stop();
    };
    engine
      .then((library) => {
        if (this.stopped) return;
        if (sampleRate !== 48000) throw new Error("RNNoise requires 48 kHz");
        this.state = library.createDenoiseState();
        this.frame = new Float32Array(library.frameSize);
        this.output = new Float32Array(library.frameSize);
        this.port.postMessage("ready");
      })
      .catch(() => {
        this.port.postMessage("failed");
        this.stop();
      });
  }
  stop() {
    this.stopped = true;
    this.state?.destroy();
    this.state = null;
    this.port.postMessage("stopped");
  }
  process(inputs, outputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!this.state || !output) return true;
    try {
      // Bridge 128-sample render quanta to RNNoise's 480-sample PCM frames.
      // Output the preceding frame, for a fixed 10 ms buffering delay.
      for (let i = 0; i < output.length; i++) {
        output[i] = this.output[this.offset] / 32768;
        this.frame[this.offset++] = (input?.[i] ?? 0) * 32768;
        if (this.offset === this.frame.length) {
          this.state.processFrame(this.frame);
          this.output.set(this.frame);
          this.offset = 0;
        }
      }
    } catch {
      this.port.postMessage("failed");
      this.stop();
    }
    return !this.stopped;
  }
}
registerProcessor("lc-rnnoise", NoiseSuppression);
