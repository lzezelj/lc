// Generated WAV fixtures for media and upload tests. These are not served by LC.
export const starterSounds = [
  { id: "chime-v1", name: "Chime", notes: [660, 880, 1100] },
  { id: "boop-v1", name: "Boop", notes: [440, 330] },
  { id: "celebrate-v1", name: "Celebrate", notes: [523, 659, 784, 1047] },
];

export function soundWave(id: string) {
  const sound = starterSounds.find((item) => item.id === id);
  if (!sound) return null;
  const rate = 24000;
  const noteSamples = rate / 5;
  const samples = noteSamples * sound.notes.length;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) =>
    [...value].forEach((letter, index) =>
      view.setUint8(offset + index, letter.charCodeAt(0)),
    );
  label(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  label(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const position = i % noteSamples;
    const envelope = Math.min(
      1,
      position / 240,
      (noteSamples - position) / 960,
    );
    const frequency = sound.notes[Math.floor(i / noteSamples)];
    view.setInt16(
      44 + i * 2,
      Math.round(
        Math.sin((2 * Math.PI * frequency * position) / rate) * envelope * 7000,
      ),
      true,
    );
  }
  return bytes;
}
