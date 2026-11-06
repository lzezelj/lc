"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ParticipantAudioControls,
  type ParticipantAudio,
} from "./participant-audio";
import type { VoicePolicy } from "./voice-policy";

export function VoiceParticipantMenu({
  x,
  y,
  channels,
  onClose,
  onKick,
  onMove,
  canModerate = true,
  audio,
  onAudioChange,
  serverPolicy,
  onServerChange,
}: {
  x: number;
  y: number;
  channels: { id: string; name: string }[];
  onClose: () => void;
  onKick: () => void;
  onMove: (channelId: string) => void;
  canModerate?: boolean;
  audio?: ParticipantAudio;
  onAudioChange?: (patch: Partial<ParticipantAudio>) => void;
  serverPolicy?: VoicePolicy;
  onServerChange?: (patch: VoicePolicy) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function moderate(patch: VoicePolicy) {
    if (!onServerChange || saving) return;
    setSaving(true);
    setError("");
    try {
      await onServerChange(patch);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not change server voice controls.",
      );
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const top = Math.max(
    8,
    Math.min(y, window.innerHeight - (onAudioChange ? 410 : 110)),
  );
  let left = Math.max(8, Math.min(x, window.innerWidth - 188));
  const openLeft = left >= 188 && left + 360 > window.innerWidth - 8;
  if (!openLeft) left = Math.min(left, Math.max(8, window.innerWidth - 368));
  return (
    <div
      ref={root}
      role="menu"
      aria-label="Voice participant actions"
      className="messageContextMenu voiceParticipantMenu"
      style={{ left, top, "--voice-menu-top": `${top}px` } as CSSProperties}
    >
      {onAudioChange && (
        <ParticipantAudioControls value={audio} onChange={onAudioChange} />
      )}
      {canModerate && (
        <>
          {onServerChange && (
            <div className="participantAudioControls">
              <small>Server controls · everyone in this server</small>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={Boolean(serverPolicy?.voiceMuted)}
                disabled={saving}
                onClick={() =>
                  void moderate({ voiceMuted: !serverPolicy?.voiceMuted })
                }
              >
                {serverPolicy?.voiceMuted ? "Server unmute" : "Server mute"}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={Boolean(serverPolicy?.voiceDeafened)}
                disabled={saving}
                onClick={() =>
                  void moderate({ voiceDeafened: !serverPolicy?.voiceDeafened })
                }
              >
                {serverPolicy?.voiceDeafened
                  ? "Server undeafen"
                  : "Server deafen"}
              </button>
              <small>
                Server deafen blocks incoming media as well as outgoing audio.
              </small>
              {error && <small role="alert">{error}</small>}
            </div>
          )}
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onKick();
            }}
          >
            Kick
          </button>
          <div
            className={`voiceMoveItem ${openLeft ? "openLeft" : ""}`}
            onPointerEnter={() => setMoving(true)}
            onPointerLeave={() => setMoving(false)}
            onFocus={() => setMoving(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setMoving(false);
            }}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={moving}
              disabled={!channels.length}
              onClick={() => setMoving(true)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  setMoving(true);
                  requestAnimationFrame(() =>
                    root.current
                      ?.querySelector<HTMLButtonElement>(
                        ".voiceMoveMenu button",
                      )
                      ?.focus(),
                  );
                }
              }}
            >
              Move <span aria-hidden="true">›</span>
            </button>
            {moving && channels.length > 0 && (
              <div
                className="messageContextMenu voiceMoveMenu"
                role="menu"
                aria-label="Move to voice channel"
              >
                {channels.map((channel) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={channel.id}
                    onClick={() => {
                      onClose();
                      onMove(channel.id);
                    }}
                  >
                    {channel.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
