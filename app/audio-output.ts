export function readOutputVolume() {
  const stored =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem("lc.outputVolume");
  const value = stored === null ? 100 : Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
}

export async function applyCallOutput(
  audio: HTMLMediaElement,
  volume: number,
  deafened: boolean,
  deviceId: string,
) {
  audio.muted = deafened;
  audio.volume = Math.max(0, Math.min(1, volume / 100));
  if ("setSinkId" in audio)
    await (
      audio as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }
    ).setSinkId(deviceId);
}
