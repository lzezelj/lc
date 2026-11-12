import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { auth } from "../../../auth";
import { db } from "../../../db";
import {
  channels,
  serverMembers,
  messages,
  directMessages,
  channelMessageReactions,
  directMessageReactions,
  users,
} from "../../../db/schema";
import { canMessage } from "../../../server/direct-conversations";
import { checkRateLimit } from "../../../server/rate-limit";
import { notifyUser } from "../../../server/notify-user";
import { isReactionEmoji, type MessageReaction } from "../../emoji-catalog";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
async function scopeFor(actor: string, channelId: unknown, userId: unknown) {
  if (typeof channelId === "string" && uuid.test(channelId) && !userId) {
    const [member] = await db
      .select({ serverId: channels.serverId })
      .from(channels)
      .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
      .where(and(eq(channels.id, channelId), eq(serverMembers.userId, actor)));
    if (member)
      return {
        table: messages,
        reactions: channelMessageReactions,
        condition: eq(messages.channelId, channelId),
        channelId,
      };
  } else if (
    typeof userId === "string" &&
    uuid.test(userId) &&
    !channelId &&
    (await canMessage(actor, userId))
  ) {
    return {
      table: directMessages,
      reactions: directMessageReactions,
      condition: and(
        eq(directMessages.kind, "message"),
        or(
          and(
            eq(directMessages.senderId, actor),
            eq(directMessages.recipientId, userId),
          ),
          and(
            eq(directMessages.senderId, userId),
            eq(directMessages.recipientId, actor),
          ),
        ),
      ),
      userId,
    };
  }
  return null;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const ids = [...new Set((query.get("messageIds") ?? "").split(","))];
  if (!ids.length || ids.length > 100 || ids.some((id) => !uuid.test(id)))
    return Response.json({ error: "Invalid message IDs" }, { status: 400 });
  const scope = await scopeFor(
    session.user.id,
    query.get("channelId"),
    query.get("userId"),
  );
  if (!scope) return Response.json({ error: "Forbidden" }, { status: 403 });
  const allowed = await db
    .select({ id: scope.table.id })
    .from(scope.table)
    .where(
      and(
        scope.condition,
        inArray(scope.table.id, ids),
        isNull(scope.table.deletedAt),
      ),
    );
  const result: Record<string, MessageReaction[]> = Object.fromEntries(
    allowed.map(({ id }) => [id, []]),
  );
  if (query.get("details") === "1") {
    if (ids.length !== 1)
      return Response.json({ error: "Choose one message" }, { status: 400 });
    if (!allowed.length)
      return Response.json({ error: "Message unavailable" }, { status: 404 });
    const r = scope.reactions;
    const people = await db
      .select({ userId: r.userId, name: users.name, emoji: r.emoji })
      .from(r)
      .innerJoin(users, eq(users.id, r.userId))
      .where(eq(r.messageId, allowed[0].id))
      .orderBy(r.emoji, users.name, r.userId);
    return Response.json(
      {
        people: people.map((person) => ({
          ...person,
          me: person.userId === session.user.id,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (allowed.length) {
    const r = scope.reactions;
    const rows = await db
      .select({
        messageId: r.messageId,
        emoji: r.emoji,
        count: sql<number>`count(*)::int`,
        me: sql<boolean>`bool_or(${r.userId} = ${session.user.id})`,
      })
      .from(r)
      .where(
        inArray(
          r.messageId,
          allowed.map(({ id }) => id),
        ),
      )
      .groupBy(r.messageId, r.emoji)
      .orderBy(r.emoji);
    for (const { messageId, ...reaction } of rows)
      result[messageId].push(reaction);
  }
  return Response.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function mutate(request: Request, remove: boolean) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limit = checkRateLimit(`reaction:${session.user.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed)
    return Response.json(
      { error: "Too many reactions. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.messageId !== "string" ||
    !uuid.test(body.messageId) ||
    !isReactionEmoji(body.emoji)
  )
    return Response.json(
      { error: "Choose a supported emoji and message." },
      { status: 400 },
    );
  const scope = await scopeFor(session.user.id, body.channelId, body.userId);
  if (!scope) return Response.json({ error: "Forbidden" }, { status: 403 });
  const saved = await db.transaction(async (tx) => {
    const [message] = await tx
      .select({ id: scope.table.id })
      .from(scope.table)
      .where(
        and(
          scope.condition,
          eq(scope.table.id, body.messageId),
          isNull(scope.table.deletedAt),
        ),
      )
      .for("update");
    if (!message) return false;
    const r = scope.reactions;
    if (remove)
      await tx
        .delete(r)
        .where(
          and(
            eq(r.messageId, body.messageId),
            eq(r.userId, session.user.id),
            eq(r.emoji, body.emoji),
          ),
        );
    else
      await tx
        .insert(r)
        .values({
          messageId: body.messageId,
          userId: session.user.id,
          emoji: body.emoji,
        })
        .onConflictDoUpdate({
          target: [r.messageId, r.userId],
          set: { emoji: body.emoji },
        });
    return true;
  });
  if (!saved)
    return Response.json({ error: "Message unavailable" }, { status: 404 });
  const event = {
    type: "message-reactions-changed",
    messageId: body.messageId,
  };
  if (scope.userId)
    await Promise.all([
      notifyUser(session.user.id, event),
      notifyUser(scope.userId, event),
    ]);
  else {
    const secret =
      process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
    if (secret)
      try {
        await fetch(
          `${process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001"}/internal/message-reactions-changed`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channelId: scope.channelId,
              messageId: body.messageId,
            }),
          },
        );
      } catch {
        /* Authoritative counts recover on focus/navigation. */
      }
  }
  return Response.json({ ok: true });
}
export function POST(request: Request) {
  return mutate(request, false);
}
export function DELETE(request: Request) {
  return mutate(request, true);
}
