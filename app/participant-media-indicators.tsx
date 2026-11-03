"use client";

import { MediaIcon } from "./device-menu";

export function ParticipantMediaIndicators({
  participant,
  selfState,
  showCamera = true,
  onCamera,
  onWatch,
}: {
  participant: {
    name: string;
    muted: boolean;
    deafened?: boolean;
    camera: boolean;
    screen: boolean;
  };
  selfState?: { muted: boolean; deafened: boolean };
  showCamera?: boolean;
  onCamera: () => void;
  onWatch: () => void;
}) {
  const deafened = selfState?.deafened ?? participant.deafened ?? false;
  const muted = (selfState?.muted ?? participant.muted) || deafened;
  return (
    <em className="voiceIndicators">
      {deafened && (
        <span title="Deafened" aria-label="Deafened">
          <MediaIcon kind="headphones" crossedOut />
        </span>
      )}
      {muted && (
        <span title="Muted" aria-label="Muted">
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
