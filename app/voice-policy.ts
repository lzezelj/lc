export type VoicePolicy = { voiceMuted?: boolean; voiceDeafened?: boolean };
export type VoicePolicies = Record<string, VoicePolicy>;
export function voiceBlocked(policy?: VoicePolicy) {
  return Boolean(policy?.voiceMuted || policy?.voiceDeafened);
}
