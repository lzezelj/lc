import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import {
  channels,
  messages,
  serverMembers,
  users,
} from "../../../../../db/schema";

const repliedMessages = alias(messages, "replied_messages");
const repliedAuthors = alias(users, "replied_authors");

async function canAccess(userId: string, channelId: string) {
  const [result] = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
    .where(and(eq(channels.id, channelId), eq(serverMembers.userId, userId)));
  return Boolean(result);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  const { channelId } = await params;
  if (!session || !(await canAccess(session.user.id, channelId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await db
    .select({
      id: messages.id,
      text: messages.content,
      createdAt: messages.createdAt,
      author: users.name,
      authorId: users.id,
      deletedAt: messages.deletedAt,
      replyToId: messages.replyToId,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.channelId, channelId))
    .orderBy(desc(messages.createdAt))
    .limit(100);
  const replyIds = result.flatMap((message) =>
    message.replyToId ? [message.replyToId] : [],
  );
  const replyRows = replyIds.length
    ? await db
        .select({
          id: repliedMessages.id,
          text: repliedMessages.content,
          deletedAt: repliedMessages.deletedAt,
          author: repliedAuthors.name,
        })
        .from(repliedMessages)
        .innerJoin(
          repliedAuthors,
          eq(repliedAuthors.id, repliedMessages.authorId),
        )
        .where(inArray(repliedMessages.id, replyIds))
    : [];
  const replies = new Map(
    replyRows.map((message) => [
      message.id,
      {
        id: message.id,
        text: message.deletedAt ? "Deleted message" : message.text,
        author: message.author,
      },
    ]),
  );
  return NextResponse.json(
    result.reverse().map((message) => ({
      ...message,
      text: message.deletedAt ? "Deleted message" : message.text,
      deleted: Boolean(message.deletedAt),
      replyTo: message.replyToId
        ? (replies.get(message.replyToId) ?? null)
        : null,
    })),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  const { channelId } = await params;
  if (!session || !(await canAccess(session.user.id, channelId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json()) as { text?: string; replyToId?: string };
  const text = body.text?.trim();
  if (!text || text.length > 4000)
    return NextResponse.json(
      { error: "Message must be 1-4000 characters" },
      { status: 400 },
    );
  let replyTo: { id: string; text: string; author: string } | null = null;
  if (body.replyToId) {
    const [parent] = await db
      .select({
        id: messages.id,
        text: messages.content,
        deletedAt: messages.deletedAt,
        author: users.name,
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(
        and(eq(messages.id, body.replyToId), eq(messages.channelId, channelId)),
      );
    if (!parent) {
      return NextResponse.json(
        { error: "Reply target was not found" },
        { status: 400 },
      );
    }
    replyTo = {
      id: parent.id,
      text: parent.deletedAt ? "Deleted message" : parent.text,
      author: parent.author,
    };
  }
  const [message] = await db
    .insert(messages)
    .values({
      channelId,
      authorId: session.user.id,
      content: text,
      replyToId: replyTo?.id,
    })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  const canonicalMessage = {
    ...message,
    text,
    author: session.user.name ?? "User",
    authorId: session.user.id,
    deleted: false,
    replyTo,
  };
  const signalingUrl =
    process.env.SIGNALING_INTERNAL_URL ?? "http://localhost:3001";
  const internalSecret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (internalSecret) {
    try {
      await fetch(`${signalingUrl}/internal/text-message`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${internalSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channelId, message: canonicalMessage }),
      });
    } catch {
      // The message remains safely stored; reconnecting clients reload history.
    }
  }
  return NextResponse.json(canonicalMessage, { status: 201 });
}
