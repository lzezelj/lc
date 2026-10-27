import type {
  AudioProcessorOptions,
  TrackProcessor,
  Track,
} from "livekit-client";

export const defaultVoiceThreshold = -50;

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
        thresholdDb <= -80 || levelDb >= thresholdDb - (open ? 6 : 0);
      if (loud) lastLoud = now;
      open = loud || (open && now - lastLoud < 180);
      return open;
    },
  };
}

export function createMicrophoneGate(
  track: MediaStreamTrack,
  context: AudioContext,
  onLevel?: (db: number, transmitting: boolean) => void,
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
      available && gate.update(db, readVoiceThreshold(), performance.now());
    gain.gain.setTargetAtTime(
      transmitting ? 1 : 0,
      context.currentTime,
      transmitting ? 0.003 : 0.008,
    );
    onLevel?.(db, transmitting);
  };
  const timer = window.setInterval(sample, 20);
  track.addEventListener("mute", sample);
  track.addEventListener("ended", sample);
  context.addEventListener("statechange", sample);
  return {
    track: destination.stream.getAudioTracks()[0],
    stop() {
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
