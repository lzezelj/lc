import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";
import { checkRateLimit, rateLimits } from "../../../../../server/rate-limit";

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
    destinationId?: string;
  } | null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    ![serverId, body?.userId, body?.channelId, body?.destinationId].every(
      (value) => typeof value === "string" && uuid.test(value),
    ) ||
    body?.userId === session.user.id ||
    body?.channelId === body?.destinationId
  )
    return NextResponse.json(
      { error: "Invalid voice target" },
      { status: 400 },
    );
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
  const limit = checkRateLimit(
    `voice-move:${session.user.id}`,
    rateLimits.adminMutation,
  );
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Too many voice moves. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const [target] = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, body!.userId!),
      ),
    );
  if (!target)
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  const [source] = await db
    .select({ id: channels.id, type: channels.type })
    .from(channels)
    .where(
      and(eq(channels.serverId, serverId), eq(channels.id, body!.channelId!)),
    );
  const [destination] = await db
    .select({ id: channels.id, name: channels.name, type: channels.type })
    .from(channels)
    .where(
      and(
        eq(channels.serverId, serverId),
        eq(channels.id, body!.destinationId!),
      ),
    );
  if (
    !source ||
    !destination ||
    source.type === "text" ||
    destination.type === "text"
  )
    return NextResponse.json(
      { error: "Voice channel not found" },
      { status: 404 },
    );
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Signaling unavailable" },
      { status: 503 },
    );
  try {
    const response = await fetch(
      `${process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001"}/internal/move-voice`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: body!.userId,
          roomId: source.id,
          channel: { ...destination, serverId },
        }),
      },
    );
    if (!response.ok)
      return NextResponse.json(
        {
          error:
            response.status === 409
              ? "Destination is full or the participant cannot be moved right now."
              : response.status === 404
                ? "Participant is no longer in that voice channel or is unavailable."
                : response.status === 426
                  ? "Voice moves require the signaling service to be restarted with the latest code."
                  : "The voice service could not deliver this move. Please try again.",
        },
        {
          status:
            response.status === 404 ? 404 : response.status === 409 ? 409 : 502,
        },
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Voice move could not be delivered" },
      { status: 502 },
    );
  }
}
