import { eq } from "drizzle-orm";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { userAvatars } from "../../../../../db/schema";
import { profileAudience } from "../../../../../server/profile-pictures";
import { canMessage } from "../../../../../server/direct-conversations";

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  if (!session) return new Response(null, { status: 401 });
  const { userId } = await context.params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId))
    return new Response(null, { status: 400 });
  if (
    session.user.id !== userId &&
    !(await profileAudience(userId)).has(session.user.id) &&
    !(await canMessage(session.user.id, userId))
  )
    return new Response(null, { status: 403 });
  const [avatar] = await db
    .select({ data: userAvatars.data })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId));
  if (!avatar) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
