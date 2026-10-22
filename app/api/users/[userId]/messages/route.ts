import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, messages, servers, users } from "../../../../../db/schema";

async function canManageMessages(
  actorId: string,
  actorRole: string,
  userId: string,
) {
  if (actorId === userId) return true;
  if (actorRole !== "owner") return false;
  const [demoUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.role, "demo"),
        eq(users.createdBy, actorId),
      ),
    );
  return Boolean(demoUser);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  const { userId } = await params;
  if (
    !session ||
    !(await canManageMessages(session.user.id, session.user.role, userId))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(
    await db
      .select({
        id: messages.id,
        text: messages.content,
        createdAt: messages.createdAt,
        channelName: channels.name,
        serverName: servers.name,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(servers, eq(servers.id, channels.serverId))
      .where(and(eq(messages.authorId, userId), isNull(messages.deletedAt)))
      .orderBy(asc(messages.createdAt)),
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  const { userId } = await params;
  if (
    !session ||
    !(await canManageMessages(session.user.id, session.user.role, userId))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deletedAt = new Date();
  const deleted = await db
    .update(messages)
    .set({ content: "", deletedAt, editedAt: deletedAt })
    .where(and(eq(messages.authorId, userId), isNull(messages.deletedAt)))
    .returning({ id: messages.id, channelId: messages.channelId });

  const signalingUrl =
    process.env.SIGNALING_INTERNAL_URL ?? "http://localhost:3001";
  const internalSecret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (internalSecret) {
    await Promise.allSettled(
      deleted.map((message) =>
        fetch(`${signalingUrl}/internal/message-deleted`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${internalSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channelId: message.channelId,
            messageId: message.id,
          }),
        }),
      ),
    );
  }
  return NextResponse.json({ deletedCount: deleted.length });
}
