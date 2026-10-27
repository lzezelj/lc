import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { directMessages } from "../../../../../db/schema";
import { notifyUser } from "../../../../../server/notify-user";
import { checkRateLimit, rateLimits } from "../../../../../server/rate-limit";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string; messageId: string }> },
) {
  const session = await auth();
  if (!session?.user.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId, messageId } = await params;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(userId) || !uuid.test(messageId))
    return NextResponse.json(
      { error: "Invalid message or user ID" },
      { status: 400 },
    );
  const limit = checkRateLimit(
    `direct-delete:${session.user.id}`,
    rateLimits.message,
  );
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Too many deletions. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const body = (await request.json().catch(() => ({}))) as {
    permanent?: boolean;
  };
  const permanent = body?.permanent === true;
  const ownedMessage = and(
    eq(directMessages.id, messageId),
    eq(directMessages.senderId, session.user.id),
    eq(directMessages.recipientId, userId),
  );
  const [deleted] = permanent
    ? await db
        .delete(directMessages)
        .where(ownedMessage)
        .returning({ id: directMessages.id })
    : await db
        .update(directMessages)
        .set({ content: "", deletedAt: new Date() })
        .where(ownedMessage)
        .returning({ id: directMessages.id });
  if (!deleted)
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  await Promise.all([
    notifyUser(userId, {
      type: "direct-message-deleted",
      fromUserId: session.user.id,
      messageId,
      permanent,
    }),
    notifyUser(session.user.id, {
      type: "direct-message-deleted",
      fromUserId: userId,
      messageId,
      permanent,
    }),
  ]);
  return NextResponse.json({ id: messageId, permanent });
}
