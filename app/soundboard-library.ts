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

export async function loadSoundAudio(serverId: string, clipId: string) {
  return cache.get(`${serverId}/${clipId}`, async () => {
    const response = await fetch(
      `/api/servers/${serverId}/soundboard?clip=${encodeURIComponent(clipId)}`,
    );
    if (!response.ok) throw new Error("Could not load sound");
    return response.arrayBuffer();
  });
}
