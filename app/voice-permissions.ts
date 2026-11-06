import type { Room } from "livekit-client";
import type { ParticipantAudio } from "./remote-audio-volume";
import type { VoicePolicies, VoicePolicy } from "./voice-policy";

export function applyVoiceSubscriptions(
  room: Room,
  choices: Record<string, ParticipantAudio>,
  policies: VoicePolicies,
  ownPolicy?: VoicePolicy,
) {
  // The signal client can exist before its connection is ready. Apply the
  // latest choices after connect/reconnect instead of sending during setup.
  if (room.state !== "connected") return;
  const restrictAll = Boolean(
    ownPolicy?.voiceMuted || ownPolicy?.voiceDeafened,
  );
  const restricted =
    restrictAll ||
    Object.values(choices).some((choice) => choice.deafened) ||
    Object.values(policies).some((policy) => policy.voiceDeafened);
  if (!restricted) {
    room.localParticipant.setTrackSubscriptionPermissions(true);
    return;
  }
  const videoSids = [...room.localParticipant.trackPublications.values()]
    .filter(
      (publication) =>
        publication.kind === "video" || publication.track?.kind === "video",
    )
    .map((publication) => publication.trackSid);
  room.localParticipant.setTrackSubscriptionPermissions(
    false,
    [...room.remoteParticipants.values()].map((person) => {
      const userId = person.identity.split(":")[0];
      return restrictAll ||
        choices[userId]?.deafened ||
        policies[userId]?.voiceDeafened
        ? {
            participantIdentity: person.identity,
            allowAll: false,
            allowedTrackSids: videoSids,
          }
        : { participantIdentity: person.identity, allowAll: true };
    }),
  );
}
