import { RoomServiceClient } from "livekit-server-sdk";

export async function removeChannelMedia(
  serverId: string,
  channelId: string,
  type: string,
) {
  const url = process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001";
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (secret)
    await fetch(`${url}/internal/channel-deleted`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ serverId, channelId }),
    }).catch(() => undefined);
  const livekitUrl =
    process.env.LIVEKIT_INTERNAL_URL ?? process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY,
    apiSecret = process.env.LIVEKIT_API_SECRET;
  if (type === "voice_group" && livekitUrl && key && apiSecret) {
    const rooms = new RoomServiceClient(
      livekitUrl.replace(/^ws/, "http"),
      key,
      apiSecret,
    );
    await rooms.deleteRoom(`channel-${channelId}`).catch(() => undefined);
  }
}
