import type {
  AudioProcessorOptions,
  TrackProcessor,
  Track,
} from "livekit-client";

export const defaultVoiceThreshold = -50;
import {
  readMicrophoneMode,
  microphoneProcessingChanged,
  readEchoCancellationEnabled,
} from "./microphone-preferences.mjs";
let microphoneDeafened = false;
const activeSamples = new Set<() => void>();

export function setMicrophoneDeafened(value: boolean) {
  microphoneDeafened = value;
  for (const sample of activeSamples) sample();
}

export function readMicrophoneVolume() {
  if (typeof localStorage === "undefined") return 100;
  const stored = localStorage.getItem("lc.microphoneVolume");
  const value = stored === null ? 100 : Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
}

export function readVoiceThreshold() {
  if (typeof localStorage === "undefined") return defaultVoiceThreshold;
  const stored = localStorage.getItem("lc.voiceThreshold");
  const value = stored === null ? defaultVoiceThreshold : Number(stored);
  return Number.isFinite(value)
    ? Math.max(-80, Math.min(0, value))
    : defaultVoiceThreshold;
}

// Separate gate state makes hysteresis and release independent of UI timers.
export function createGateState() {
  let open = false;
  let lastLoud = -Infinity;
  return {
    update(levelDb: number, thresholdDb: number, now: number) {
      const loud =
        thresholdDb <= -80 || levelDb >= thresholdDb - (open ? 10 : 0);
      if (loud) lastLoud = now;
      open = loud || (open && now - lastLoud < 350);
      return open;
    },
  };
}

export function createMicrophoneGate(
  track: MediaStreamTrack,
  context: AudioContext,
  onLevel?: (db: number, transmitting: boolean) => void,
  onProcessing?: (mode: "rnnoise" | "browser" | "raw") => void,
) {
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const gain = context.createGain();
  gain.gain.value = 0;
  const destination = context.createMediaStreamDestination();
  source.connect(analyser);
  analyser.connect(gain);
  gain.connect(destination);
  let stopped = false;
  let denoiser:
    | Awaited<
        ReturnType<typeof import("./noise-suppression").createNoiseSuppression>
      >
    | undefined;
  let abort = new AbortController();
  let revision = 0;
  let activeMode: "raw" | "browser" | "rnnoise" = "browser";
  const originalConstraints = track.getConstraints?.();
  function connectBrowser(processing: boolean) {
    activeMode = processing ? "browser" : "raw";
    if (denoiser) {
      source.disconnect();
      denoiser.stop();
      denoiser = undefined;
      source.connect(analyser);
    }
    void track
      .applyConstraints?.({
        ...originalConstraints,
        echoCancellation: processing && readEchoCancellationEnabled(),
        noiseSuppression: processing,
        autoGainControl: processing,
      })
      .catch(() => {});
    onProcessing?.(activeMode);
  }
  function updateProcessing() {
    if (stopped) return;
    const currentRevision = ++revision;
    abort.abort();
    abort = new AbortController();
    const signal = abort.signal;
    const selectedMode = readMicrophoneMode();
    const processing = selectedMode !== "raw";
    const fallback = () => {
      if (!stopped && revision === currentRevision) connectBrowser(processing);
    };
    connectBrowser(processing);
    // Keep browser audio connected until the selected worklet confirms ready.
    if (
      selectedMode === "rnnoise" &&
      context.audioWorklet &&
      context.sampleRate === 48000
    ) {
      void import("./noise-suppression")
        .then(async ({ createNoiseSuppression }) => {
          if (stopped || signal.aborted) return;
          const filter = await createNoiseSuppression(
            context,
            signal,
            fallback,
          );
          if (stopped || signal.aborted) {
            filter.stop();
            return;
          }
          denoiser = filter;
          activeMode = "rnnoise";
          source.disconnect();
          source.connect(filter.node);
          filter.node.connect(analyser);
          // Avoid stacking two denoisers or automatically amplifying background noise.
          void track
            .applyConstraints?.({
              ...originalConstraints,
              echoCancellation: processing && readEchoCancellationEnabled(),
              noiseSuppression: false,
              autoGainControl: false,
            })
            .catch(() => {});
          onProcessing?.("rnnoise");
        })
        .catch(fallback);
    }
  }
  function storageChanged(event: StorageEvent) {
    if (
      event.key === null ||
      event.key === "lc.rnnoise" ||
      event.key === "lc.microphoneMode" ||
      event.key === "lc.echoCancellation" ||
      event.key === "lc.microphoneProcessing"
    )
      updateProcessing();
  }
  updateProcessing();
  window.addEventListener?.(microphoneProcessingChanged, updateProcessing);
  window.addEventListener?.("storage", storageChanged);
  const samples = new Float32Array(analyser.fftSize);
  const gate = createGateState();
  const sample = () => {
    analyser.getFloatTimeDomainData(samples);
    let power = 0;
    for (const value of samples) power += value * value;
    const db = Math.max(
      -80,
      20 * Math.log10(Math.max(0.00001, Math.sqrt(power / samples.length))),
    );
    const available =
      track.readyState === "live" &&
      !track.muted &&
      track.enabled &&
      context.state === "running";
    const transmitting =
      available &&
      !microphoneDeafened &&
      // RNNoise already suppresses background audio; a second loudness gate
      // can chop quiet syllables after denoising has reduced their level.
      (activeMode !== "browser" ||
        gate.update(db, readVoiceThreshold(), performance.now()));
    gain.gain.setTargetAtTime(
      transmitting ? readMicrophoneVolume() / 100 : 0,
      context.currentTime,
      transmitting ? 0.003 : 0.008,
    );
    onLevel?.(db, transmitting);
  };
  const timer = window.setInterval(sample, 20);
  activeSamples.add(sample);
  track.addEventListener("mute", sample);
  track.addEventListener("ended", sample);
  context.addEventListener("statechange", sample);
  return {
    track: destination.stream.getAudioTracks()[0],
    stop() {
      if (stopped) return;
      stopped = true;
      activeSamples.delete(sample);
      abort.abort();
      window.removeEventListener?.(
        microphoneProcessingChanged,
        updateProcessing,
      );
      window.removeEventListener?.("storage", storageChanged);
      denoiser?.stop();
      window.clearInterval(timer);
      track.removeEventListener("mute", sample);
      track.removeEventListener("ended", sample);
      context.removeEventListener("statechange", sample);
      source.disconnect();
      analyser.disconnect();
      gain.disconnect();
      destination.stream.getTracks().forEach((output) => output.stop());
    },
  };
}

export function createVoiceThresholdProcessor(): TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  let gate: ReturnType<typeof createMicrophoneGate> | null = null;
  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: "lc-voice-threshold",
    async init({ track, audioContext }) {
      gate?.stop();
      gate = createMicrophoneGate(track, audioContext);
      processor.processedTrack = gate.track;
    },
    async restart(options) {
      await processor.init(options);
    },
    async destroy() {
      gate?.stop();
      gate = null;
      processor.processedTrack = undefined;
    },
  };
  return processor;
}

export async function captureThresholdMicrophone(
  constraints: MediaTrackConstraints,
  context: AudioContext,
) {
  const raw = await navigator.mediaDevices.getUserMedia({
    audio: constraints,
    video: false,
  });
  try {
    const gate = createMicrophoneGate(raw.getAudioTracks()[0], context);
    return {
      stream: new MediaStream([gate.track]),
      stop() {
        gate.stop();
        raw.getTracks().forEach((track) => track.stop());
      },
    };
  } catch (error) {
    raw.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
