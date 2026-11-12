import { eq, or } from "drizzle-orm";
import { db } from "../db";
import { channels, friendships, serverMembers, users } from "../db/schema";
import { isAccountActive } from "../auth-account.mjs";
import { messagingPeerIds } from "./direct-conversations";

export async function signalingPermissions(userId: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId))
    return null;
  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      disabledAt: users.disabledAt,
      expiresAt: users.expiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!isAccountActive(account)) return null;
  const [permitted, memberships, friends, messageIds] = await Promise.all([
    db
      .select({ id: channels.id })
      .from(channels)
      .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
      .where(eq(serverMembers.userId, userId)),
    db
      .select({ id: serverMembers.serverId })
      .from(serverMembers)
      .where(eq(serverMembers.userId, userId)),
    db
      .select({
        requesterId: friendships.requesterId,
        recipientId: friendships.recipientId,
        status: friendships.status,
      })
      .from(friendships)
      .where(
        or(
          eq(friendships.requesterId, userId),
          eq(friendships.recipientId, userId),
        ),
      ),
    messagingPeerIds(userId),
  ]);
  return {
    sub: userId,
    name: account.name ?? "User",
    channelIds: permitted.map((row) => row.id),
    serverIds: memberships.map((row) => row.id),
    friendIds: friends
      .filter((row) => row.status === "accepted")
      .map((row) =>
        row.requesterId === userId ? row.recipientId : row.requesterId,
      ),
    messageIds,
  };
}
