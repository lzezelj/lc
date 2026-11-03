import { SoundCache } from "./soundboard-audio";

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
