import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";
import { checkRateLimit, rateLimits } from "../../../../../server/rate-limit";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  const { channelId } = await params;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rateLimit = checkRateLimit(
    `livekit-token:${session.user.id}`,
    rateLimits.livekitToken,
  );
  if (!rateLimit.allowed)
    return NextResponse.json(
      { error: "Too many connection attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );

  const [channel] = await db
    .select({ id: channels.id, serverId: channels.serverId })
    .from(channels)
    .innerJoin(
      serverMembers,
      and(
        eq(serverMembers.serverId, channels.serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    )
    .where(and(eq(channels.id, channelId), eq(channels.type, "voice_group")));
  if (!channel) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "Group media server is not configured" },
      { status: 503 },
    );
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: `${session.user.id}:${randomUUID()}`,
    name: session.user.name ?? "LC user",
    ttl: "10m",
  });
  token.addGrant({ roomJoin: true, room: `channel-${channel.id}` });

  return NextResponse.json(
    {
      server_url: serverUrl,
      participant_token: await token.toJwt(),
    },
    { status: 201 },
  );
}
