import { randomInt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { buildUserHandle } from "../user-handle";

export async function ensureUserHandle(
  userId: string,
  name: string | null | undefined,
) {
  const [user] = await db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error("Cannot assign a handle to a missing user");
  if (user.handle) return user.handle;
  for (let attempt = 0; attempt < 30; attempt++) {
    const handle = buildUserHandle(name, randomInt(10000));
    try {
      const [updated] = await db
        .update(users)
        .set({ handle })
        .where(and(eq(users.id, userId), isNull(users.handle)))
        .returning({ handle: users.handle });
      if (updated) return updated.handle!;
      const [current] = await db
        .select({ handle: users.handle })
        .from(users)
        .where(eq(users.id, userId));
      if (current?.handle) return current.handle;
    } catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if ((failure.code ?? failure.cause?.code) !== "23505") throw error;
    }
  }
  throw new Error("Could not allocate a user handle");
}
