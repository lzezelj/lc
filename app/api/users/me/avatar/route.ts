import { eq } from "drizzle-orm";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { users, userAvatars } from "../../../../../db/schema";
import {
  avatarUrl,
  readAvatar,
  notifyProfilePicture,
} from "../../../../../server/profile-pictures";
import { checkRateLimit } from "../../../../../server/rate-limit";

async function change(request: Request, remove: boolean) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limit = checkRateLimit(`avatar:${session.user.id}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.allowed)
    return Response.json(
      { error: "Too many picture changes. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const data = remove ? null : await readAvatar(request);
  if (data instanceof Response) return data;
  const image = remove ? null : avatarUrl(session.user.id);
  const changed = await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, session.user.id))
      .for("update");
    if (!owner) return false;
    if (data)
      await tx
        .insert(userAvatars)
        .values({ userId: session.user.id, data })
        .onConflictDoUpdate({ target: userAvatars.userId, set: { data } });
    else
      await tx
        .delete(userAvatars)
        .where(eq(userAvatars.userId, session.user.id));
    await tx
      .update(users)
      .set({ image, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));
    return true;
  });
  if (!changed)
    return Response.json({ error: "Account unavailable" }, { status: 404 });
  await notifyProfilePicture(session.user.id, image);
  return Response.json({ image });
}
export function PUT(request: Request) {
  return change(request, false);
}
export function DELETE(request: Request) {
  return change(request, true);
}
