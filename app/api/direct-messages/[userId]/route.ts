import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import { directMessages, friendships, users } from "../../../../db/schema";
import { areFriends } from "../../../../server/friends";
import { checkRateLimit, rateLimits } from "../../../../server/rate-limit";
import { notifyUser } from "../../../../server/notify-user";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  const { userId } = await params;
  if (!session || !(await areFriends(session.user.id, userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await db
    .select({
      id: directMessages.id,
      text: directMessages.content,
      createdAt: directMessages.createdAt,
      authorId: directMessages.senderId,
      author: users.name,
      kind: directMessages.kind,
      callDurationSeconds: directMessages.callDurationSeconds,
      deletedAt: directMessages.deletedAt,
    })
    .from(directMessages)
    .innerJoin(users, eq(users.id, directMessages.senderId))
    .where(
      or(
        and(
          eq(directMessages.senderId, session.user.id),
          eq(directMessages.recipientId, userId),
        ),
        and(
          eq(directMessages.senderId, userId),
          eq(directMessages.recipientId, session.user.id),
        ),
      ),
    )
    .orderBy(asc(directMessages.createdAt))
    .limit(100);
  return NextResponse.json(rows);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  const { userId } = await params;
  if (!session || !(await areFriends(session.user.id, userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rateLimit = checkRateLimit(
    `message:${session.user.id}`,
    rateLimits.message,
  );
  if (!rateLimit.allowed)
    return NextResponse.json(
      { error: "You are sending messages too quickly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  const body = (await request.json()) as {
    text?: string;
    event?: "call-ended" | "call-declined" | "user-unavailable";
    durationSeconds?: number;
  };
  const isCallEvent = Boolean(body.event);
  const durationSeconds = isCallEvent
    ? Math.max(0, Math.min(86_400, Math.round(body.durationSeconds ?? 0)))
    : null;
  const text =
    body.event === "call-declined"
      ? "Call declined"
      : body.event === "user-unavailable"
        ? "User unavailable"
        : body.event === "call-ended"
          ? "Call ended"
          : body.text?.trim();
  if (!text || text.length > 4000)
    return NextResponse.json(
      { error: "Message must be 1-4000 characters" },
      { status: 400 },
    );
  const [message] = await db
    .insert(directMessages)
    .values({
      senderId: session.user.id,
      recipientId: userId,
      content: text,
      kind: isCallEvent ? "call" : "message",
      callDurationSeconds: durationSeconds,
    })
    .returning({ id: directMessages.id, createdAt: directMessages.createdAt });
  await db
    .update(friendships)
    .set({ lastActivityAt: message.createdAt })
    .where(
      or(
        and(
          eq(friendships.requesterId, session.user.id),
          eq(friendships.recipientId, userId),
        ),
        and(
          eq(friendships.requesterId, userId),
          eq(friendships.recipientId, session.user.id),
        ),
      ),
    );
  const canonicalMessage = {
    ...message,
    text,
    authorId: session.user.id,
    author: session.user.name ?? "User",
    kind: isCallEvent ? "call" : "message",
    callDurationSeconds: durationSeconds,
  };
  await notifyUser(userId, {
    type: "direct-message",
    fromUserId: session.user.id,
    message: canonicalMessage,
  });
  return NextResponse.json(canonicalMessage, { status: 201 });
}
