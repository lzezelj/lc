import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import { messages, users } from "../../../../db/schema";
import {
  auditAdmin,
  type AdminTransaction,
} from "../../../../server/admin-audit";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const { editChannelMessage } =
    await import("../../../../server/edit-message");
  return editChannelMessage(request, context);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const session = await auth();
  const { messageId } = await params;
  if (!session)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [message] = await db
    .select({
      authorId: messages.authorId,
      channelId: messages.channelId,
      createdBy: users.createdBy,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.id, messageId));
  const allowed =
    message &&
    (message.authorId === session.user.id ||
      (session.user.role === "owner" && message.createdBy === session.user.id));
  if (!allowed)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    permanent?: boolean;
  };
  const permanent = body.permanent === true;
  const remove = (connection: typeof db | AdminTransaction) =>
    permanent
      ? connection
          .delete(messages)
          .where(
            and(
              eq(messages.id, messageId),
              eq(messages.authorId, message.authorId),
            ),
          )
          .returning({ id: messages.id })
      : connection
          .update(messages)
          .set({ content: "", deletedAt: new Date(), editedAt: new Date() })
          .where(
            and(
              eq(messages.id, messageId),
              eq(messages.authorId, message.authorId),
            ),
          )
          .returning({ id: messages.id });
  const [deleted] =
    message.authorId === session.user.id
      ? await remove(db)
      : await db.transaction(async (tx) => {
          const deleted = await remove(tx);
          if (deleted.length)
            await auditAdmin(
              tx,
              session.user.id,
              permanent ? "message.delete-permanently" : "message.delete",
              "channel-message",
              messageId,
              { userId: message.authorId, channelId: message.channelId },
            );
          return deleted;
        });
  if (!deleted) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const signalingUrl =
    process.env.SIGNALING_INTERNAL_URL ?? "http://localhost:3001";
  const internalSecret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (internalSecret) {
    try {
      await fetch(`${signalingUrl}/internal/message-deleted`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${internalSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId: message.channelId,
          messageId: deleted.id,
          permanent,
        }),
      });
    } catch {
      // The deletion is stored; reconnecting clients reload current history.
    }
  }
  return NextResponse.json({ id: deleted.id, permanent });
}
