import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, messages, servers, users } from "../../../../../db/schema";
import {
  auditAdmin,
  type AdminTransaction,
} from "../../../../../server/admin-audit";

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
        attachments: messages.attachments,
        createdAt: messages.createdAt,
        channelName: channels.name,
        serverName: servers.name,
        serverId: servers.id,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(servers, eq(servers.id, channels.serverId))
      .where(and(eq(messages.authorId, userId), isNull(messages.deletedAt)))
      .orderBy(asc(messages.createdAt)),
  );
}

export async function DELETE(
  request: Request,
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

  const query = new URL(request.url).searchParams;
  const serverId = query.get("serverId");
  if (
    query.has("serverId") &&
    (!serverId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        serverId,
      ))
  ) {
    return NextResponse.json({ error: "Invalid server" }, { status: 400 });
  }
  const deletedAt = new Date();
  const remove = (connection: typeof db | AdminTransaction) =>
    connection
      .update(messages)
      .set({ content: "", deletedAt, editedAt: deletedAt })
      .where(
        and(
          eq(messages.authorId, userId),
          isNull(messages.deletedAt),
          serverId
            ? inArray(
                messages.channelId,
                db
                  .select({ id: channels.id })
                  .from(channels)
                  .where(eq(channels.serverId, serverId)),
              )
            : undefined,
        ),
      )
      .returning({ id: messages.id, channelId: messages.channelId });
  const deleted =
    session.user.id === userId
      ? await remove(db)
      : await db.transaction(async (tx) => {
          const deleted = await remove(tx);
          await auditAdmin(
            tx,
            session.user.id,
            "demo.messages.delete",
            "user",
            userId,
            { userId, ...(serverId ? { serverId } : {}) },
          );
          return deleted;
        });

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
