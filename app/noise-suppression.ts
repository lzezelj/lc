const modules = new WeakMap<AudioContext, Promise<void>>();

export async function createNoiseSuppression(
  context: AudioContext,
  signal: AbortSignal,
  onFailure: () => void,
) {
  let loading = modules.get(context);
  if (!loading) {
    loading = context.audioWorklet.addModule(
      new URL("./rnnoise-worklet.js", import.meta.url),
    );
    modules.set(context, loading);
    loading.catch(() => modules.delete(context));
  }
  await loading;
  signal.throwIfAborted();
  const node = new AudioWorkletNode(context, "lc-rnnoise", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: "explicit",
  });
  let stopped = false;
  const failed = () => {
    if (!stopped) onFailure();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const timeout = setTimeout(() => node.port.close(), 1000);
    node.port.onmessage = ({ data }) => {
      if (data === "stopped") {
        clearTimeout(timeout);
        node.port.close();
      }
    };
    node.port.postMessage("stop");
    node.disconnect();
    node.removeEventListener("processorerror", failed);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("RNNoise timed out")),
        8000,
      );
      const abort = () => finish(new Error("RNNoise cancelled"));
      function finish(error?: Error) {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        node.removeEventListener("processorerror", processorError);
        if (error) reject(error);
        else resolve();
      }
      signal.addEventListener("abort", abort, { once: true });
      node.port.onmessage = ({ data }) => {
        if (data === "ready") finish();
        if (data === "failed") finish(new Error("RNNoise could not start"));
      };
      function processorError() {
        finish(new Error("RNNoise processor failed"));
      }
      node.addEventListener("processorerror", processorError);
    });
    signal.throwIfAborted();
    node.port.onmessage = ({ data }) => {
      if (data === "failed" && !stopped) onFailure();
    };
    node.addEventListener("processorerror", failed);
    return { node, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
