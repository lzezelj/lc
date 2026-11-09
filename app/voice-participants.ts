import type { VoicePolicy } from "./voice-policy";

export function alphabeticalParticipants<
  T extends { name: string; userId?: string },
>(participants: readonly T[]): T[] {
  return [...participants].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }) ||
      (left.userId ?? left.name).localeCompare(right.userId ?? right.name),
  );
}

export function showParticipantSpeaking(
  participant: { speaking?: boolean; userId?: string },
  viewerId: string,
  deafened: boolean,
  personal?: { muted?: boolean; deafened?: boolean },
  serverPolicy?: VoicePolicy,
) {
  if (
    !participant.speaking ||
    serverPolicy?.voiceMuted ||
    serverPolicy?.voiceDeafened
  )
    return false;
  return (
    participant.userId === viewerId ||
    (!deafened && !personal?.muted && !personal?.deafened)
  );
}
