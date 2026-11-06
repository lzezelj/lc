import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import {
  readMessageRequest,
  saveAttachedMessage,
} from "../../../../../server/message-attachments";
import { db } from "../../../../../db";
import {
  channels,
  messages,
  serverMembers,
  users,
} from "../../../../../db/schema";
import {
  checkRateLimit,
  rateLimits,
  rateLimitMessage,
} from "../../../../../server/rate-limit";

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
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  const { channelId } = await params;
  if (!session || !(await canAccess(session.user.id, channelId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const beforeCreatedAt = url.searchParams.get("beforeCreatedAt");
  const beforeId = url.searchParams.get("beforeId");
  const cursorDate = beforeCreatedAt ? new Date(beforeCreatedAt) : null;
  if (
    (url.searchParams.has("beforeCreatedAt") ||
      url.searchParams.has("beforeId")) &&
    (!beforeCreatedAt ||
      !beforeId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        beforeId,
      ) ||
      !cursorDate ||
      Number.isNaN(cursorDate.getTime()))
  )
    return NextResponse.json(
      { error: "Invalid message cursor" },
      { status: 400 },
    );
  const pageSize = 50;
  const result = await db
    .select({
      id: messages.id,
      text: messages.content,
      attachments: messages.attachments,
      editedAt: messages.editedAt,
      mentions: messages.mentions,
      createdAt: messages.createdAt,
      author: users.name,
      authorImage: users.image,
      authorId: users.id,
      deletedAt: messages.deletedAt,
      replyToId: messages.replyToId,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(
      and(
        eq(messages.channelId, channelId),
        cursorDate && beforeId
          ? or(
              lt(messages.createdAt, cursorDate),
              and(
                eq(messages.createdAt, cursorDate),
                lt(messages.id, beforeId),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(pageSize + 1);
  const hasMore = result.length > pageSize;
  const page = hasMore ? result.slice(0, pageSize) : result;
  const replyIds = page.flatMap((message) =>
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
  const oldestMessage = page.at(-1);
  return NextResponse.json({
    messages: page.reverse().map((message) => ({
      ...message,
      text: message.deletedAt ? "Deleted message" : message.text,
      deleted: Boolean(message.deletedAt),
      mentions: message.deletedAt ? [] : message.mentions,
      attachments: message.deletedAt ? [] : message.attachments,
      replyTo: message.replyToId
        ? (replies.get(message.replyToId) ?? null)
        : null,
    })),
    nextCursor:
      hasMore && oldestMessage
        ? {
            beforeCreatedAt: oldestMessage.createdAt.toISOString(),
            beforeId: oldestMessage.id,
          }
        : null,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  const { channelId } = await params;
  if (!session || !(await canAccess(session.user.id, channelId)))
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
  const text = body.text?.trim() ?? "";
  if ((!text && !body.files.length) || text.length > 4000)
    return NextResponse.json(
      {
        error:
          "Add text or an attachment. Text can contain up to 4000 characters.",
      },
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
  const mentionTools = text.includes("@")
    ? await import("../../../../../server/mentions")
    : null;
  const mentions = mentionTools
    ? await mentionTools.serverMentions(channelId, text, session.user.id)
    : [];
  const message = await saveAttachedMessage(
    session.user.id,
    body.files,
    false,
    async (connection, attachments) => {
      const [saved] = await connection
        .insert(messages)
        .values({
          channelId,
          authorId: session.user.id,
          content: text,
          mentions,
          attachments,
          replyToId: replyTo?.id,
        })
        .returning({ id: messages.id, createdAt: messages.createdAt });
      return saved;
    },
    mentions.length
      ? async (connection, saved) => {
          await mentionTools!.storeMentions(connection, saved.id, mentions);
        }
      : undefined,
  );
  if (message instanceof Response) return message;
  const canonicalMessage = {
    ...message,
    text,
    mentions,
    attachments: body.files.map((file) => file.metadata),
    author: session.user.name ?? "User",
    authorImage: session.user.image ?? null,
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
  if (mentions.length)
    await mentionTools!.notifyMentions(
      [...new Set(mentions.map((mention) => mention.userId))],
      { messageId: message.id, channelId, author: session.user.name ?? "User" },
    );
  return NextResponse.json(canonicalMessage, { status: 201 });
}
