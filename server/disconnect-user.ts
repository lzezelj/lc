import { RoomServiceClient } from "livekit-server-sdk";

export async function disconnectUserEverywhere(
  userId: string,
  groupChannelIds: string[],
) {
  const signalingUrl =
    process.env.SIGNALING_INTERNAL_URL ?? "http://localhost:3001";
  const internalSecret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (internalSecret) {
    await fetch(`${signalingUrl}/internal/disconnect-user`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${internalSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    }).catch(() => undefined);
  }

  const livekitUrl = process.env.LIVEKIT_INTERNAL_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) return;
  const rooms = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
  await Promise.allSettled(
    groupChannelIds.map(async (channelId) => {
      const roomName = `channel-${channelId}`;
      const participants = await rooms.listParticipants(roomName);
      await Promise.allSettled(
        participants
          .filter((participant) =>
            participant.identity.startsWith(`${userId}:`),
          )
          .map((participant) =>
            rooms.removeParticipant(roomName, participant.identity),
          ),
      );
    }),
  );
}
