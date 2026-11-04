import { and, eq, gt, isNull, or, inArray } from "drizzle-orm";
import { db } from "../db";
import { channels, messageMentions, serverMembers, users } from "../db/schema";
import { resolveMentions } from "../app/mentions";
import type { Mention } from "../app/notification-types";
import { notifyUser } from "./notify-user";
type Connection =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function serverMentions(
  channelId: string,
  text: string,
  authorId: string,
) {
  if (!text.includes("@")) return [];
  const members = await db
    .select({ id: users.id, name: users.name, handle: users.handle })
    .from(channels)
    .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
    .innerJoin(users, eq(users.id, serverMembers.userId))
    .where(
      and(
        eq(channels.id, channelId),
        isNull(users.disabledAt),
        or(isNull(users.expiresAt), gt(users.expiresAt, new Date())),
      ),
    );
  return resolveMentions(text, members, authorId);
}
export async function storeMentions(
  connection: Connection,
  messageId: string,
  mentions: Mention[],
  editing = false,
) {
  const ids = [...new Set(mentions.map((mention) => mention.userId))];
  const existing = editing
    ? await connection
        .select({ userId: messageMentions.userId })
        .from(messageMentions)
        .where(eq(messageMentions.messageId, messageId))
    : [];
  if (editing) {
    const removed = existing
      .filter((item) => !ids.includes(item.userId))
      .map((item) => item.userId);
    if (removed.length)
      await connection
        .delete(messageMentions)
        .where(
          and(
            eq(messageMentions.messageId, messageId),
            inArray(messageMentions.userId, removed),
          ),
        );
  }
  const fresh = ids.filter(
    (id) => !existing.some((item) => item.userId === id),
  );
  if (fresh.length)
    await connection
      .insert(messageMentions)
      .values(fresh.map((userId) => ({ messageId, userId })));
  return fresh;
}
export async function notifyMentions(
  userIds: string[],
  data: {
    messageId: string;
    channelId: string;
    author: string;
    serverId?: string;
  },
) {
  await Promise.all(
    userIds.map((userId) =>
      notifyUser(userId, { type: "server-mention", ...data }),
    ),
  );
}
