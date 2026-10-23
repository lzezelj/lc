import { and, eq } from "drizzle-orm";
import { RoomServiceClient } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session?.user.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    channelId?: string;
  } | null;
  if (!body?.userId || !body.channelId || body.userId === session.user.id) {
    return NextResponse.json(
      { error: "Invalid voice target" },
      { status: 400 },
    );
  }
  const [owner] = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (owner?.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [channel] = await db
    .select({ id: channels.id, type: channels.type })
    .from(channels)
    .where(
      and(eq(channels.id, body.channelId), eq(channels.serverId, serverId)),
    );
  if (!channel || channel.type === "text")
    return NextResponse.json(
      { error: "Voice channel not found" },
      { status: 404 },
    );

  if (channel.type === "voice_direct") {
    const url = process.env.SIGNALING_INTERNAL_URL ?? "http://localhost:3001";
    const secret = process.env.SIGNALING_INTERNAL_SECRET;
    if (!secret)
      return NextResponse.json(
        { error: "Signaling unavailable" },
        { status: 503 },
      );
    const response = await fetch(`${url}/internal/kick-voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: body.userId, roomId: channel.id }),
    });
    if (!response.ok)
      return NextResponse.json(
        { error: "Voice disconnect failed" },
        { status: 502 },
      );
  } else {
    const url = process.env.LIVEKIT_INTERNAL_URL ?? process.env.LIVEKIT_URL;
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!url || !key || !secret)
      return NextResponse.json(
        { error: "LiveKit unavailable" },
        { status: 503 },
      );
    const service = new RoomServiceClient(
      url.replace(/^ws/, "http"),
      key,
      secret,
    );
    const roomName = `channel-${channel.id}`;
    const participants = await service
      .listParticipants(roomName)
      .catch(() => []);
    await Promise.all(
      participants
        .filter((participant) =>
          participant.identity.startsWith(`${body.userId}:`),
        )
        .map((participant) =>
          service.removeParticipant(roomName, participant.identity),
        ),
    );
    const signalingUrl =
      process.env.SIGNALING_INTERNAL_URL ?? "http://localhost:3001";
    const signalingSecret = process.env.SIGNALING_INTERNAL_SECRET;
    if (signalingSecret) {
      await fetch(`${signalingUrl}/internal/kick-voice`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${signalingSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: body.userId, roomId: channel.id }),
      });
    }
  }
  return NextResponse.json({ ok: true });
}
