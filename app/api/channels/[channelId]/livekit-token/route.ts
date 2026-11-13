import { and, eq } from "drizzle-orm";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { readVoicePolicies } from "../../../../../server/voice-moderation";
import { voiceBlocked } from "../../../../voice-policy";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";
import {
  checkRateLimit,
  rateLimits,
  rateLimitMessage,
} from "../../../../../server/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
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
      {
        error: rateLimitMessage(
          "Too many connection attempts.",
          rateLimit.retryAfterSeconds,
        ),
      },
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

  const body = await request.json().catch(() => null);
  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(sessionId))
    return NextResponse.json(
      { error: "Invalid voice session" },
      { status: 400 },
    );
  const signalingUrl =
    process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001";
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Voice coordination is unavailable" },
      { status: 503 },
    );
  try {
    const claim = await fetch(`${signalingUrl}/internal/claim-voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: session.user.id,
        roomId: channel.id,
        sessionId,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!claim.ok) throw new Error("Voice transfer failed");
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not connect or transfer your call. The voice services (signaling or LiveKit) may be unavailable. Please try again.",
      },
      { status: 503 },
    );
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: `${session.user.id}:${sessionId}`,
    name: session.user.name ?? "LZRelay user",
    ttl: "30s",
  });
  const voicePolicies = await readVoicePolicies(channel.serverId);
  token.addGrant({
    roomJoin: true,
    room: `channel-${channel.id}`,
    canSubscribe: !voicePolicies[session.user.id]?.voiceDeafened,
    ...(voiceBlocked(voicePolicies[session.user.id])
      ? {
          canPublish: true,
          canPublishSources: [TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
        }
      : {}),
  });

  return NextResponse.json(
    {
      server_url: serverUrl,
      participant_token: await token.toJwt(),
      voicePolicies,
    },
    { status: 201 },
  );
}
