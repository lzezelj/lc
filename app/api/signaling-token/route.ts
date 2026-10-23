import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { channels, friendships, serverMembers } from "../../../db/schema";
import { createSignalingToken } from "../../../server/signaling-auth.mjs";
import { checkRateLimit, rateLimits } from "../../../server/rate-limit";

export async function POST() {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rateLimit = checkRateLimit(
    `signaling-token:${session.user.id}`,
    rateLimits.signalingToken,
  );
  if (!rateLimit.allowed)
    return NextResponse.json(
      { error: "Too many connection attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Signaling authentication is not configured" },
      { status: 503 },
    );
  }
  const permittedChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
    .where(eq(serverMembers.userId, session.user.id));
  const memberships = await db
    .select({ id: serverMembers.serverId })
    .from(serverMembers)
    .where(eq(serverMembers.userId, session.user.id));
  const friendRows = await db
    .select({
      requesterId: friendships.requesterId,
      recipientId: friendships.recipientId,
      status: friendships.status,
    })
    .from(friendships)
    .where(
      or(
        eq(friendships.requesterId, session.user.id),
        eq(friendships.recipientId, session.user.id),
      ),
    );
  const friendIds = friendRows
    .filter((friendship) => friendship.status === "accepted")
    .map((friendship) =>
      friendship.requesterId === session.user.id
        ? friendship.recipientId
        : friendship.requesterId,
    );
  return NextResponse.json({
    token: createSignalingToken(
      {
        id: session.user.id,
        name: session.user.name ?? "User",
        channelIds: permittedChannels.map((channel) => channel.id),
        serverIds: memberships.map((membership) => membership.id),
        friendIds,
      },
      secret,
    ),
  });
}
