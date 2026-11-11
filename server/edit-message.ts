import { and, eq, isNull, sql } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../db";
import {
  channels,
  directMessages,
  messages,
  serverMembers,
} from "../db/schema";
import { areFriends } from "./friends";
import { notifyUser } from "./notify-user";
import { readMessageRequest } from "./message-attachments";
import { checkRateLimit, rateLimits, rateLimitMessage } from "./rate-limit";

async function editMessage(
  request: Request,
  messageId: string,
  userId?: string,
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (!uuid.test(messageId) || (userId && !uuid.test(userId)))
    return Response.json({ error: "Invalid message ID" }, { status: 400 });
  const table = userId ? directMessages : messages;
  const [message] = userId
    ? await db
        .select()
        .from(directMessages)
        .where(
          and(
            eq(directMessages.id, messageId),
            eq(directMessages.senderId, session.user.id),
            eq(directMessages.recipientId, userId),
            isNull(directMessages.deletedAt),
            eq(directMessages.kind, "message"),
          ),
        )
    : await db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          attachments: messages.attachments,
          mentions: messages.mentions,
        })
        .from(messages)
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.authorId, session.user.id),
            eq(serverMembers.userId, session.user.id),
            isNull(messages.deletedAt),
          ),
        );
  if (!message || (userId && !(await areFriends(session.user.id, userId))))
    return Response.json(
      { error: "Message unavailable or you cannot edit it." },
      { status: 403 },
    );
  const limit = checkRateLimit(
    `message:${session.user.id}`,
    rateLimits.message,
  );
  if (!limit.allowed)
    return Response.json(
      {
        error: rateLimitMessage(
          "Too many message changes.",
          limit.retryAfterSeconds,
        ),
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json(
      { error: "Edits must contain JSON text." },
      { status: 400 },
    );
  const body = await readMessageRequest(request);
  if (body instanceof Response) return body;
  if (
    !body ||
    typeof body.text !== "string" ||
    body.text.trim().length > 4000 ||
    (!body.text.trim() && !message.attachments.length)
  )
    return Response.json(
      {
        error:
          "Add text, or keep an attachment. Text can contain up to 4000 characters.",
      },
      { status: 400 },
    );
  const text = body.text.trim();
  const editedAt = new Date();
  const channelMessage = message as {
    channelId: string;
    mentions?: import("../app/notification-types").Mention[];
  };
  const mentionTools =
    !userId && (text.includes("@") || channelMessage.mentions?.length)
      ? await import("./mentions")
      : null;
  const mentions = mentionTools
    ? await mentionTools.serverMentions(
        channelMessage.channelId,
        text,
        session.user.id,
      )
    : [];
  let notifiedUsers: string[] = [];
  const update = async (
    connection: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => {
    const [saved] = await connection
      .update(table)
      .set({
        content: text,
        editedAt,
        editedByAdmin: false,
        ...(!userId ? { mentions } : {}),
      })
      .where(
        and(
          eq(table.id, messageId),
          isNull(table.deletedAt),
          userId
            ? and(
                eq(directMessages.senderId, session.user.id),
                eq(directMessages.recipientId, userId),
                eq(directMessages.kind, "message"),
              )
            : eq(messages.authorId, session.user.id),
        ),
      )
      .returning({
        id: table.id,
        text: table.content,
        editedAt: table.editedAt,
        editedByAdmin: table.editedByAdmin,
        mentions: userId
          ? sql<import("../app/notification-types").Mention[]>`'[]'::jsonb`
          : messages.mentions,
      });
    return saved;
  };
  const saved = mentionTools
    ? await db.transaction(async (connection) => {
        const saved = await update(connection);
        if (saved)
          notifiedUsers = await mentionTools.storeMentions(
            connection,
            messageId,
            mentions,
            true,
          );
        return saved;
      })
    : await update(db);
  if (!saved)
    return Response.json(
      { error: "Message no longer exists." },
      { status: 404 },
    );
  if (userId) {
    await Promise.all([
      notifyUser(userId, {
        type: "direct-message-edited",
        fromUserId: session.user.id,
        edit: saved,
      }),
      notifyUser(session.user.id, {
        type: "direct-message-edited",
        fromUserId: userId,
        edit: saved,
      }),
    ]);
  } else {
    const secret =
      process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
    if (secret) {
      try {
        await fetch(
          `${process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001"}/internal/message-edited`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channelId: (message as { channelId: string }).channelId,
              edit: saved,
            }),
          },
        );
      } catch {
        /* Persisted edits recover through authorized history on reconnect. */
      }
    }
  }
  if (notifiedUsers.length)
    await mentionTools!.notifyMentions(notifiedUsers, {
      messageId,
      channelId: channelMessage.channelId,
      author: session.user.name ?? "User",
    });
  return Response.json(saved);
}

export async function editChannelMessage(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  return editMessage(request, (await params).messageId);
}
export async function editDirectMessage(
  request: Request,
  { params }: { params: Promise<{ messageId: string; userId: string }> },
) {
  const { messageId, userId } = await params;
  return editMessage(request, messageId, userId);
}
