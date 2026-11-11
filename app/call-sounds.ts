"use client";

let audioContext: AudioContext | null = null;

const toneFrequencies = {
  join: [440, 660],
  leave: [550, 330],
  ring: [660, 880],
  share: [523, 659, 784],
  "share-stop": [784, 659, 523],
  mute: [520, 390],
  unmute: [390, 520],
  deafen: [390, 310, 230],
  undeafen: [230, 310, 390],
  "camera-on": [620, 830],
  "camera-off": [830, 620],
  message: [740, 990],
  request: [587, 740, 880],
  notification: [660, 790],
};

function getAudioContext() {
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return null;

  audioContext ??= new AudioContextClass();
  return audioContext;
}

export function prepareVoiceSounds() {
  const context = getAudioContext();
  if (context) void context.resume();
}

export function playVoiceSound(type: keyof typeof toneFrequencies, volume = 1) {
  const context = getAudioContext();
  if (!context) return;

  void context.resume();
  const start = context.currentTime;
  const frequencies = toneFrequencies[type];

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const toneStart = start + index * 0.09;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, 0.12 * volume),
      toneStart + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + 0.14);
  });
}

export function playNotificationSound(
  type: "message" | "request" | "notification",
  volume: number,
) {
  if (volume <= 0) return;
  const now = Date.now();
  // Coalesce bursts and avoid a chime from every tab of the same browser.
  try {
    if (now - Number(localStorage.getItem("lc.notificationSoundAt")) < 350)
      return;
    localStorage.setItem("lc.notificationSoundAt", String(now));
  } catch {}
  playVoiceSound(type, Math.max(0, Math.min(1, volume / 100)));
}
