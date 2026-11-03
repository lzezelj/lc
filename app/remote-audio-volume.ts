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
