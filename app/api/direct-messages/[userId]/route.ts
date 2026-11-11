import { and, desc, eq, lt, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import {
  readMessageRequest,
  saveAttachedMessage,
} from "../../../../server/message-attachments";
import { db } from "../../../../db";
import { directMessages, friendships, users } from "../../../../db/schema";
import { areFriends } from "../../../../server/friends";
import {
  checkRateLimit,
  rateLimits,
  rateLimitMessage,
} from "../../../../server/rate-limit";
import { notifyUser } from "../../../../server/notify-user";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  const { userId } = await params;
  if (!session || !(await areFriends(session.user.id, userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const beforeCreatedAt = query.get("beforeCreatedAt");
  const beforeId = query.get("beforeId");
  const cursorDate = beforeCreatedAt ? new Date(beforeCreatedAt) : null;
  if (
    (query.has("beforeCreatedAt") || query.has("beforeId")) &&
    (!cursorDate ||
      Number.isNaN(cursorDate.getTime()) ||
      !beforeId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        beforeId,
      ))
  )
    return NextResponse.json(
      { error: "Invalid message cursor" },
      { status: 400 },
    );
  const rows = await db
    .select({
      id: directMessages.id,
      text: directMessages.content,
      attachments: directMessages.attachments,
      editedAt: directMessages.editedAt,
      editedByAdmin: directMessages.editedByAdmin,
      createdAt: directMessages.createdAt,
      authorId: directMessages.senderId,
      author: users.name,
      authorImage: users.image,
      kind: directMessages.kind,
      callDurationSeconds: directMessages.callDurationSeconds,
      deletedAt: directMessages.deletedAt,
    })
    .from(directMessages)
    .innerJoin(users, eq(users.id, directMessages.senderId))
    .where(
      and(
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
        cursorDate && beforeId
          ? or(
              lt(directMessages.createdAt, cursorDate),
              and(
                eq(directMessages.createdAt, cursorDate),
                lt(directMessages.id, beforeId),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(directMessages.createdAt), desc(directMessages.id))
    .limit(51);
  const hasMore = rows.length > 50;
  const page = rows.slice(0, 50);
  const oldest = page.at(-1);
  return NextResponse.json({
    messages: page.reverse().map((message) => ({
      ...message,
      attachments: message.deletedAt ? [] : message.attachments,
    })),
    nextCursor:
      hasMore && oldest
        ? {
            beforeCreatedAt: oldest.createdAt.toISOString(),
            beforeId: oldest.id,
          }
        : null,
  });
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
      {
        error: rateLimitMessage(
          "You are sending messages too quickly.",
          rateLimit.retryAfterSeconds,
        ),
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  const body = await readMessageRequest(request);
  if (body instanceof Response) return body;
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
          : (body.text?.trim() ?? "");
  if ((!text && !body.files.length) || text.length > 4000)
    return NextResponse.json(
      {
        error:
          "Add text or an attachment. Text can contain up to 4000 characters.",
      },
      { status: 400 },
    );
  const message = await saveAttachedMessage(
    session.user.id,
    body.files,
    true,
    async (connection, attachments) => {
      const [saved] = await connection
        .insert(directMessages)
        .values({
          senderId: session.user.id,
          recipientId: userId,
          content: text,
          attachments,
          kind: isCallEvent ? "call" : "message",
          callDurationSeconds: durationSeconds,
        })
        .returning({
          id: directMessages.id,
          createdAt: directMessages.createdAt,
        });
      return saved;
    },
  );
  if (message instanceof Response) return message;
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
    attachments: body.files.map((file) => file.metadata),
    authorId: session.user.id,
    author: session.user.name ?? "User",
    authorImage: session.user.image ?? null,
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
