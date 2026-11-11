"use client";

import { MediaIcon } from "./device-menu";
import type { VoicePolicy } from "./voice-policy";

export function SoundboardIndicator({ playing }: { playing?: boolean }) {
  return playing ? (
    <span
      className="soundboardIndicator"
      title="Playing soundboard"
      aria-label="Playing soundboard"
    >
      ♫
    </span>
  ) : null;
}

export function ParticipantMediaIndicators({
  participant,
  selfState,
  serverPolicy,
  showCamera = true,
  onCamera,
  onWatch,
}: {
  participant: {
    soundboard?: boolean;
    name: string;
    muted: boolean;
    deafened?: boolean;
    camera: boolean;
    screen: boolean;
  };
  selfState?: { muted: boolean; deafened: boolean };
  serverPolicy?: VoicePolicy;
  showCamera?: boolean;
  onCamera: () => void;
  onWatch: () => void;
}) {
  const serverDeafened = Boolean(serverPolicy?.voiceDeafened);
  const serverMuted = Boolean(serverPolicy?.voiceMuted) || serverDeafened;
  const deafened =
    serverDeafened || (selfState?.deafened ?? participant.deafened ?? false);
  const muted =
    serverMuted || (selfState?.muted ?? participant.muted) || deafened;
  const deafenLabel = serverDeafened ? "Server deafened" : "Deafened";
  const muteLabel = serverMuted ? "Server muted" : "Muted";
  return (
    <em className="voiceIndicators">
      {deafened && (
        <span
          className={serverDeafened ? "serverModerated" : undefined}
          title={deafenLabel}
          aria-label={deafenLabel}
        >
          <MediaIcon kind="headphones" crossedOut />
        </span>
      )}
      {muted && (
        <span
          className={serverMuted ? "serverModerated" : undefined}
          title={muteLabel}
          aria-label={muteLabel}
        >
          <MediaIcon kind="microphone" crossedOut />
        </span>
      )}
      {participant.camera && showCamera && (
        <button
          type="button"
          className="participantMediaOpen"
          title="Open camera"
          aria-label={`Open ${participant.name}'s camera`}
          onClick={onCamera}
        >
          <MediaIcon kind="camera" crossedOut={false} />
        </button>
      )}
      {participant.screen && (
        <button
          type="button"
          className="participantMediaOpen participantWatch"
          title={
            selfState ? "Preview your shared screen" : "Open shared screen"
          }
          aria-label={
            selfState
              ? "Preview your shared screen"
              : `Watch ${participant.name}'s screen`
          }
          onClick={onWatch}
        >
          {selfState ? "Preview" : "Watch"}
        </button>
      )}
    </em>
  );
}
