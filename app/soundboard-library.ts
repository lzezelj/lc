import { SoundCache } from "./soundboard-audio";
import { useEffect, useState } from "react";

export function useSoundboardRefresh(serverId?: string) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => {
      if (
        event.type === "focus" ||
        (event as CustomEvent<{ serverId: string }>).detail?.serverId ===
          serverId
      )
        setVersion((current) => current + 1);
    };
    window.addEventListener("lc-soundboard-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("lc-soundboard-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [serverId]);
  return version;
}

export type Sound = {
  id: string;
  name: string;
  serverId: string;
  custom?: boolean;
  durationMs?: number;
};
const cache = new SoundCache();

// Warm visible tiles without churning the existing 4 MiB encoded cache.
// One in-flight download may finish after cancellation, but cannot start audio.
export async function preloadSoundAudio(
  sounds: Sound[],
  warm: (bytes: ArrayBuffer) => Promise<void>,
  signal: AbortSignal,
) {
  let remaining = 4 * 1024 * 1024;
  for (const sound of sounds.slice(0, 6)) {
    if (signal.aborted) return;
    const upperBytes = 44 + (sound.durationMs ?? 10010) * 192;
    if (upperBytes > remaining) continue;
    try {
      const bytes = await loadSoundAudio(sound.serverId, sound.id);
      if (signal.aborted) return;
      remaining -= bytes.byteLength;
      await warm(bytes);
    } catch {
      // Foreground playback retains its own retry and error message.
    }
  }
}

export async function loadSoundAudio(serverId: string, clipId: string) {
  return cache.get(`${serverId}/${clipId}`, async () => {
    const response = await fetch(
      `/api/servers/${serverId}/soundboard?clip=${encodeURIComponent(clipId)}`,
    );
    if (!response.ok) throw new Error("Could not load sound");
    return response.arrayBuffer();
  });
}
