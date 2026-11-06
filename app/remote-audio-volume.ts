import type { RemoteAudioTrack } from "livekit-client";

export function applyRemoteAudioVolume(
  track: RemoteAudioTrack,
  volume: number,
) {
  // LiveKit fades its Web Audio gain from 1 when attaching a new track. Disable
  // the receiver track as well so a muted short clip cannot leak during that fade.
  track.mediaStreamTrack.enabled = volume > 0;
  track.setVolume(volume);
}
export type ParticipantAudio = {
  volume: number;
  muted: boolean;
  deafened?: boolean;
};
export function participantGain(
  settings: Record<string, ParticipantAudio>,
  userId?: string,
) {
  // LiveKit identities include a session suffix; preferences belong to accounts.
  const value = userId ? settings[userId.split(":")[0]] : undefined;
  return value?.muted || value?.deafened ? 0 : (value?.volume ?? 100) / 100;
}
