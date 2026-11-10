export const maxSoundSourceBytes = 25 * 1024 * 1024;
export const maxSoundSourceSeconds = 300;
export const maxSoundClipSeconds = 10;
export const soundTrimLimitSeconds = 10;

export function adjustSoundTrim(
  duration: number,
  start: number,
  end: number,
  boundary: "start" | "end" | "selection",
  value: number,
) {
  if (!Number.isFinite(value)) return { start, end };
  const minimum = Math.min(0.01, duration);
  const maximum = Math.min(soundTrimLimitSeconds, duration);
  if (boundary === "selection") {
    const width = end - start;
    start = Math.max(0, Math.min(duration - width, value));
    return { start, end: Math.min(duration, start + width) };
  }
  if (boundary === "start") {
    start = Math.max(0, Math.min(duration - minimum, value));
    end = Math.min(duration, start + maximum, Math.max(end, start + minimum));
  } else {
    end = Math.max(minimum, Math.min(duration, value));
    start = Math.max(0, end - maximum, Math.min(start, end - minimum));
  }
  return { start, end };
}

type SoundSamples = Pick<
  AudioBuffer,
  "sampleRate" | "numberOfChannels" | "length" | "getChannelData"
>;

export async function decodeSoundFile(file: File) {
  if (!file.size || file.size > maxSoundSourceBytes)
    throw new Error("Choose a nonempty audio file up to 25 MiB.");
  // An offline context decodes locally without opening an audio output or a mic.
  const context = new OfflineAudioContext(2, 1, 48000);
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("This audio format could not be decoded. Try WAV or MP3.");
  }
  if (!buffer.length || buffer.duration > maxSoundSourceSeconds)
    throw new Error("Choose an audio file no longer than 5 minutes.");
  if (buffer.numberOfChannels > 2)
    throw new Error("Choose mono or stereo audio.");
  return buffer;
}

export function trimSoundWave(
  source: SoundSamples,
  startSeconds: number,
  endSeconds: number,
) {
  const rate = source.sampleRate;
  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    startSeconds < 0 ||
    endSeconds <= startSeconds ||
    endSeconds > source.length / rate ||
    endSeconds - startSeconds > maxSoundClipSeconds + 1e-9 ||
    ![1, 2].includes(source.numberOfChannels) ||
    rate < 8000 ||
    rate > 48000
  )
    throw new Error(
      "Select a start and end within the file, up to 10 seconds apart.",
    );
  const start = Math.round(startSeconds * rate);
  const end = Math.min(source.length, Math.round(endSeconds * rate));
  const frames = end - start;
  if (frames <= 0 || frames > rate * maxSoundClipSeconds)
    throw new Error("Select a nonempty clip up to 10 seconds.");
  const channels = source.numberOfChannels;
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  for (let channel = 0; channel < channels; channel++) {
    const samples = source.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++) {
      const sample = Math.max(-1, Math.min(1, samples[start + frame] || 0));
      view.setInt16(
        44 + (frame * channels + channel) * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
    }
  }
  return bytes;
}
