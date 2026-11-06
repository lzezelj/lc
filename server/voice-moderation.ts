import { and, eq } from "drizzle-orm";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { db } from "../db";
import { channels, serverMembers } from "../db/schema";
import { voiceBlocked, type VoicePolicy } from "../app/voice-policy";

export async function readVoicePolicies(serverId: string) {
  const members = await db
    .select({
      userId: serverMembers.userId,
      voiceMuted: serverMembers.voiceMuted,
      voiceDeafened: serverMembers.voiceDeafened,
    })
    .from(serverMembers)
    .where(eq(serverMembers.serverId, serverId));
  return Object.fromEntries(
    members.map(({ userId, ...policy }) => [userId, policy]),
  );
}
export async function applyGroupModeration(
  serverId: string,
  userId: string,
  policy: VoicePolicy,
) {
  const rooms = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(eq(channels.serverId, serverId), eq(channels.type, "voice_group")),
    );
  if (!rooms.length) return;
  const url = process.env.LIVEKIT_INTERNAL_URL ?? process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY,
    secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return;
  const service = new RoomServiceClient(
    url.replace(/^ws/, "http"),
    key,
    secret,
  );
  for (const room of rooms) {
    const name = `channel-${room.id}`;
    const people = await service.listParticipants(name).catch((error) => {
      if (error?.status === 404 || error?.code === "not_found") return [];
      throw error;
    });
    for (const person of people.filter(
      (person) => person.identity.split(":")[0] === userId,
    )) {
      await service.updateParticipant(name, person.identity, {
        permission: {
          ...person.permission,
          canPublish: true,
          canPublishSources: voiceBlocked(policy)
            ? [TrackSource.CAMERA, TrackSource.SCREEN_SHARE]
            : [],
          canSubscribe: !policy.voiceDeafened,
        },
      });
    }
  }
}
