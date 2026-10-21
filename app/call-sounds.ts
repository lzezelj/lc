"use client";

let audioContext: AudioContext | null = null;

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

export function playVoiceSound(type: "join" | "leave") {
  const context = getAudioContext();
  if (!context) return;

  void context.resume();
  const start = context.currentTime;
  const frequencies = type === "join" ? [440, 660] : [550, 330];

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const toneStart = start + index * 0.09;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(0.12, toneStart + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + 0.14);
  });
}
