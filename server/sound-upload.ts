export const maxSoundBytes = 2 * 1024 * 1024;
export const maxServerSounds = 20;

export function validateSoundWave(audio: Uint8Array) {
  if (audio.byteLength < 44 || audio.byteLength > maxSoundBytes) return null;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...audio.subarray(offset, offset + 4));
  if (
    tag(0) !== "RIFF" ||
    tag(8) !== "WAVE" ||
    view.getUint32(4, true) !== audio.length - 8
  )
    return null;
  let format: { channels: number; rate: number; align: number } | null = null;
  let dataSize = 0,
    offset = 12;
  while (offset + 8 <= audio.length) {
    const size = view.getUint32(offset + 4, true),
      start = offset + 8;
    if (start + size + (size % 2) > audio.length) return null;
    if (tag(offset) === "fmt ") {
      if (
        format ||
        size < 16 ||
        view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 14, true) !== 16
      )
        return null;
      const channels = view.getUint16(start + 2, true),
        rate = view.getUint32(start + 4, true),
        align = view.getUint16(start + 12, true);
      if (
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 48000 ||
        align !== channels * 2 ||
        view.getUint32(start + 8, true) !== rate * align
      )
        return null;
      format = { channels, rate, align };
    } else if (tag(offset) === "data") {
      if (dataSize || !size) return null;
      dataSize = size;
    }
    offset = start + size + (size % 2);
  }
  if (
    offset !== audio.length ||
    !format ||
    !dataSize ||
    dataSize % format.align !== 0
  )
    return null;
  const durationMs = Math.ceil((dataSize / format.align / format.rate) * 1000);
  return durationMs > 0 && durationMs <= 10010 ? { durationMs } : null;
}

export async function readSoundBody(request: Request) {
  if (Number(request.headers.get("content-length")) > maxSoundBytes)
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSoundBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
