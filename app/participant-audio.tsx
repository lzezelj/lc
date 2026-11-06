"use client";
import { useState } from "react";

import type { ParticipantAudio } from "./remote-audio-volume";
export type { ParticipantAudio } from "./remote-audio-volume";
const normal: ParticipantAudio = { volume: 100, muted: false };
export function useParticipantAudio(accountId?: string) {
  const [state, setState] = useState<{
    accountId?: string;
    values: Record<string, ParticipantAudio>;
  }>({ accountId, values: {} });
  // Playback choices last for this workspace session and never cross accounts.
  if (state.accountId !== accountId) setState({ accountId, values: {} });
  const values = state.accountId === accountId ? state.values : {};
  function change(userId: string, patch: Partial<ParticipantAudio>) {
    setState((current) => {
      if (!accountId || current.accountId !== accountId) return current;
      const next = { ...(current.values[userId] ?? normal), ...patch };
      next.volume = Math.max(
        0,
        Math.min(100, Number.isFinite(next.volume) ? next.volume : 100),
      );
      return { accountId, values: { ...current.values, [userId]: next } };
    });
  }
  return { values, change };
}
export function ParticipantAudioControls({
  value = normal,
  onChange,
}: {
  value?: ParticipantAudio;
  onChange: (patch: Partial<ParticipantAudio>) => void;
}) {
  return (
    <div className="participantAudioControls">
      <small>Personal audio controls</small>
      <div className="participantAudioActions">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={value.muted}
          onClick={() => onChange({ muted: !value.muted })}
        >
          {value.muted ? "Unmute person" : "Mute person"}
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={Boolean(value.deafened)}
          onClick={() => onChange({ deafened: !value.deafened })}
        >
          {value.deafened ? "Undeafen person" : "Deafen person"}
        </button>
      </div>
      <small>
        Mute stops you hearing them. Deafen blocks audio both ways between you
        two.
      </small>
      <label>
        Person volume: {value.volume}%
        <input
          aria-label="Person volume"
          type="range"
          min="0"
          max="100"
          value={value.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}
