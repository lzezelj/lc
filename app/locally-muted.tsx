import { MediaIcon } from "./device-menu";
import type { VoicePolicy } from "./voice-policy";

export function LocallyMuted({
  muted,
  deafened,
  serverPolicy,
}: {
  muted?: boolean;
  deafened?: boolean;
  serverPolicy?: VoicePolicy;
}) {
  const showMute =
    muted && !serverPolicy?.voiceMuted && !serverPolicy?.voiceDeafened;
  const showDeafen = deafened && !serverPolicy?.voiceDeafened;
  return showMute || showDeafen ? (
    <span className="localAudioIndicators">
      {showDeafen && (
        <span
          className="locallyMuted"
          title="Deafened between you"
          aria-label="Deafened between you"
          role="img"
        >
          <MediaIcon kind="headphones" crossedOut />
        </span>
      )}
      {showMute && (
        <span
          className="locallyMuted"
          title="Muted for you"
          aria-label="Muted for you"
          role="img"
        >
          <MediaIcon kind="microphone" crossedOut />
        </span>
      )}
    </span>
  ) : null;
}
