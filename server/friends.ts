import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { friendships } from "../db/schema";

export async function areFriends(userId: string, otherUserId: string) {
  const [friendship] = await db
    .select({ requesterId: friendships.requesterId })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(
          and(
            eq(friendships.requesterId, userId),
            eq(friendships.recipientId, otherUserId),
          ),
          and(
            eq(friendships.requesterId, otherUserId),
            eq(friendships.recipientId, userId),
          ),
        ),
      ),
    );
  return Boolean(friendship);
}
