import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { auth } from "../../../auth";
import { db } from "../../../db";
import {
  channels,
  directMessages,
  messages,
  serverMembers,
  users,
} from "../../../db/schema";
import { areFriends } from "../../../server/friends";
import { checkRateLimit, rateLimitMessage } from "../../../server/rate-limit";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const channelId = query.get("channelId"),
    userId = query.get("userId");
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (
    Boolean(channelId) === Boolean(userId) ||
    !uuid.test((channelId || userId)!)
  )
    return Response.json(
      { error: "Select one conversation." },
      { status: 400 },
    );
  if (userId) {
    if (!(await areFriends(session.user.id, userId)))
      return Response.json({ error: "Forbidden" }, { status: 403 });
  } else {
    const [access] = await db
      .select({ id: channels.id })
      .from(channels)
      .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
      .where(
        and(
          eq(channels.id, channelId!),
          eq(channels.type, "text"),
          eq(serverMembers.userId, session.user.id),
        ),
      );
    if (!access) return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const limit = checkRateLimit(`message-search:${session.user.id}`, {
    limit: 60,
    windowMs: 60000,
  });
  if (!limit.allowed)
    return Response.json(
      {
        error: rateLimitMessage("Too many searches.", limit.retryAfterSeconds),
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const table = userId ? directMessages : messages;
  const scope = userId
    ? or(
        and(
          eq(directMessages.senderId, session.user.id),
          eq(directMessages.recipientId, userId),
        ),
        and(
          eq(directMessages.senderId, userId),
          eq(directMessages.recipientId, session.user.id),
        ),
      )
    : eq(messages.channelId, channelId!);
  const author = userId ? directMessages.senderId : messages.authorId;
  const select = () =>
    db
      .select({
        id: table.id,
        text: table.content,
        createdAt: table.createdAt,
        // Keep PostgreSQL's microseconds for ordering; Date only retains milliseconds.
        sortTimestamp: sql<string>`to_char(${table.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        editedAt: table.editedAt,
        editedByAdmin: table.editedByAdmin,
        attachments: table.attachments,
        mentions: userId
          ? sql<import("../../notification-types").Mention[]>`'[]'::jsonb`
          : messages.mentions,
        deletedAt: table.deletedAt,
        authorId: author,
        author: users.name,
        authorImage: users.image,
        kind: userId ? directMessages.kind : sql<string>`'message'`,
        callDurationSeconds: userId
          ? directMessages.callDurationSeconds
          : sql<number | null>`null`,
        replyToId: userId ? sql<string | null>`null` : messages.replyToId,
      })
      .from(table)
      .innerJoin(users, eq(users.id, author));
  const contextId = query.get("contextId");
  let rows;
  let nextCursor = null;
  if (contextId) {
    if (!uuid.test(contextId))
      return Response.json({ error: "Invalid message ID" }, { status: 400 });
    const [target] = await select()
      .where(and(scope, eq(table.id, contextId), isNull(table.deletedAt)))
      .limit(1);
    if (!target)
      return Response.json(
        { error: "This message is no longer available." },
        { status: 404 },
      );
    const targetTimestamp = sql`${target.sortTimestamp}::timestamptz`;
    const [older, newer] = await Promise.all([
      select()
        .where(
          and(
            scope,
            or(
              lt(table.createdAt, targetTimestamp),
              and(
                eq(table.createdAt, targetTimestamp),
                lt(table.id, target.id),
              ),
            ),
          ),
        )
        .orderBy(desc(table.createdAt), desc(table.id))
        .limit(25),
      select()
        .where(
          and(
            scope,
            or(
              gt(table.createdAt, targetTimestamp),
              and(
                eq(table.createdAt, targetTimestamp),
                gt(table.id, target.id),
              ),
            ),
          ),
        )
        .orderBy(asc(table.createdAt), asc(table.id))
        .limit(25),
    ]);
    rows = [...older.reverse(), target, ...newer];
  } else {
    const text = query.get("q")?.trim() ?? "";
    if (text.length < 2 || text.length > 100)
      return Response.json(
        { error: "Search for 2–100 characters." },
        { status: 400 },
      );
    const beforeId = query.get("beforeId"),
      beforeText = query.get("beforeCreatedAt");
    const before = beforeText ? new Date(beforeText) : null;
    if (
      (query.has("beforeId") || query.has("beforeCreatedAt")) &&
      (!beforeId ||
        !uuid.test(beforeId) ||
        !before ||
        !Number.isFinite(before.getTime()) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(
          beforeText!,
        ) ||
        before.toISOString().slice(0, 19) !== beforeText!.slice(0, 19))
    )
      return Response.json({ error: "Invalid search cursor" }, { status: 400 });
    const beforeTimestamp = beforeText
      ? sql`${beforeText}::timestamptz`
      : undefined;
    const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
    const matches = await select()
      .where(
        and(
          scope,
          isNull(table.deletedAt),
          userId ? eq(directMessages.kind, "message") : undefined,
          or(
            ilike(table.content, pattern),
            sql`exists (select 1 from jsonb_array_elements(${table.attachments}) as attachment where attachment->>'name' ilike ${pattern})`,
          ),
          before && beforeId
            ? or(
                lt(table.createdAt, beforeTimestamp!),
                and(
                  eq(table.createdAt, beforeTimestamp!),
                  lt(table.id, beforeId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(table.createdAt), desc(table.id))
      .limit(51);
    rows = matches.slice(0, 50);
    const oldest = rows.at(-1);
    if (matches.length > 50 && oldest)
      nextCursor = {
        beforeCreatedAt: oldest.sortTimestamp,
        beforeId: oldest.id,
      };
  }
  const replyIds = userId
    ? []
    : rows.flatMap((row) => (row.replyToId ? [row.replyToId] : []));
  const replies = replyIds.length
    ? await db
        .select({
          id: messages.id,
          text: messages.content,
          author: users.name,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.authorId))
        .where(
          and(
            eq(messages.channelId, channelId!),
            inArray(messages.id, replyIds),
          ),
        )
    : [];
  return Response.json({
    messages: rows.map((row) => ({
      ...row,
      sortTimestamp: undefined,
      text: row.deletedAt ? "Deleted message" : row.text,
      deleted: !!row.deletedAt,
      attachments: row.deletedAt ? [] : row.attachments,
      replyTo: row.replyToId
        ? (() => {
            const reply = replies.find((item) => item.id === row.replyToId);
            return reply
              ? {
                  id: reply.id,
                  text: reply.deletedAt
                    ? "Deleted message"
                    : reply.text || "Attachment",
                  author: reply.author,
                }
              : null;
          })()
        : null,
    })),
    nextCursor,
  });
}
