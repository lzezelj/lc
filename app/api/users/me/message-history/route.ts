import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import {
  channels,
  directMessages,
  messages,
  servers,
  users,
} from "../../../../../db/schema";
import { notifyMessageRemovals } from "../../../../../server/message-removals";

export async function GET() {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [channelRows, directRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        text: messages.content,
        createdAt: messages.createdAt,
        deletedAt: messages.deletedAt,
        groupId: servers.id,
        groupName: servers.name,
        channelName: channels.name,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(servers, eq(servers.id, channels.serverId))
      .where(eq(messages.authorId, session.user.id))
      .orderBy(desc(messages.createdAt)),
    db
      .select({
        id: directMessages.id,
        text: directMessages.content,
        createdAt: directMessages.createdAt,
        deletedAt: directMessages.deletedAt,
        groupId: users.id,
        groupName: users.name,
      })
      .from(directMessages)
      .innerJoin(users, eq(users.id, directMessages.recipientId))
      .where(
        and(
          eq(directMessages.senderId, session.user.id),
          eq(directMessages.kind, "message"),
        ),
      )
      .orderBy(desc(directMessages.createdAt)),
  ]);
  return NextResponse.json([
    ...channelRows.map((row) => ({ ...row, kind: "server" })),
    ...directRows.map((row) => ({ ...row, kind: "direct" })),
  ]);
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    groupId?: string;
    messageId?: string;
  } | null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !body ||
    !["server", "direct"].includes(body.kind ?? "") ||
    !uuid.test(body.groupId ?? "") ||
    (body.messageId !== undefined && !uuid.test(body.messageId))
  )
    return NextResponse.json(
      { error: "Invalid message selection" },
      { status: 400 },
    );
  if (body.kind === "server") {
    const removed = await db
      .delete(messages)
      .where(
        and(
          eq(messages.authorId, session.user.id),
          inArray(
            messages.channelId,
            db
              .select({ id: channels.id })
              .from(channels)
              .where(eq(channels.serverId, body.groupId!)),
          ),
          body.messageId ? eq(messages.id, body.messageId) : undefined,
        ),
      )
      .returning({ id: messages.id, channelId: messages.channelId });
    await notifyMessageRemovals(session.user.id, removed, []);
    return NextResponse.json({ deletedIds: removed.map((row) => row.id) });
  }
  const removed = await db
    .delete(directMessages)
    .where(
      and(
        eq(directMessages.senderId, session.user.id),
        eq(directMessages.recipientId, body.groupId!),
        eq(directMessages.kind, "message"),
        body.messageId ? eq(directMessages.id, body.messageId) : undefined,
      ),
    )
    .returning({
      id: directMessages.id,
      recipientId: directMessages.recipientId,
    });
  await notifyMessageRemovals(session.user.id, [], removed);
  return NextResponse.json({ deletedIds: removed.map((row) => row.id) });
}
