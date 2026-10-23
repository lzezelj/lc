// One context is unlocked by a user gesture before asynchronous call setup.
let audioContext: AudioContext | null = null;

export function microphoneProcessing() {
  const enabled = localStorage.getItem("lc.microphoneProcessing") !== "off";
  return {
    echoCancellation: enabled,
    noiseSuppression: enabled,
    autoGainControl: enabled,
  };
}

export function prepareVoiceActivity() {
  audioContext ??= new AudioContext();
  if (audioContext.state !== "running")
    void audioContext.resume().catch(() => {});
  return audioContext;
}

export function monitorVoiceActivity(
  track: MediaStreamTrack,
  onChange: (speaking: boolean) => void,
  enabled: () => boolean = () => true,
) {
  const context = prepareVoiceActivity();
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silent);
  silent.connect(context.destination);
  const samples = new Float32Array(analyser.fftSize);
  let active = false;
  let lastLoud = -Infinity;
  let floor = 0.001;
  const publish = (next: boolean) => {
    if (active === next) return;
    active = next;
    onChange(next);
  };
  const reset = () => {
    lastLoud = -Infinity;
    publish(false);
  };
  const sample = () => {
    if (
      context.state !== "running" ||
      track.readyState !== "live" ||
      track.muted ||
      !track.enabled ||
      !enabled()
    ) {
      reset();
      return;
    }
    analyser.getFloatTimeDomainData(samples);
    let power = 0;
    for (const value of samples) power += value * value;
    const level = Math.sqrt(power / samples.length);
    const loud = level > Math.max(0.0035, floor * (active ? 1.45 : 1.8));
    if (!active && !loud) floor = floor * 0.96 + level * 0.04;
    if (loud) lastLoud = performance.now();
    publish(loud || (active && performance.now() - lastLoud < 180));
  };
  const resume = () => {
    prepareVoiceActivity();
  };
  const interval = window.setInterval(sample, 30);
  track.addEventListener("mute", reset);
  track.addEventListener("ended", reset);
  context.addEventListener("statechange", sample);
  document.addEventListener("pointerdown", resume);
  document.addEventListener("keydown", resume);
  return () => {
    window.clearInterval(interval);
    track.removeEventListener("mute", reset);
    track.removeEventListener("ended", reset);
    context.removeEventListener("statechange", sample);
    document.removeEventListener("pointerdown", resume);
    document.removeEventListener("keydown", resume);
    source.disconnect();
    analyser.disconnect();
    silent.disconnect();
    reset();
  };
}
