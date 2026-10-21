import { and, eq } from "drizzle-orm";
import { RoomServiceClient } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  const { serverId } = await params;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [membership] = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const groupChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(eq(channels.serverId, serverId), eq(channels.type, "voice_group")),
    );

  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "Group media server is not configured" },
      { status: 503 },
    );
  }

  const service = new RoomServiceClient(
    serverUrl.replace(/^ws/, "http"),
    apiKey,
    apiSecret,
  );
  const presence = Object.fromEntries(
    await Promise.all(
      groupChannels.map(async (channel) => {
        try {
          const participants = await service.listParticipants(
            `channel-${channel.id}`,
          );
          return [
            channel.id,
            participants.map((participant) => ({
              name: participant.name || "Guest",
              muted: false,
              camera: false,
              screen: false,
              speaking: false,
            })),
          ];
        } catch {
          return [channel.id, []];
        }
      }),
    ),
  );

  return NextResponse.json(presence);
}
