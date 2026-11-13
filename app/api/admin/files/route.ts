import { eq } from "drizzle-orm";
import { ownerSession } from "../../../../server/owner";
import { validAdminId } from "../../../../server/admin-read";
import { db } from "../../../../db";
import { userAvatars } from "../../../../db/schema";

export async function GET(request: Request) {
  if (!(await ownerSession())) return new Response(null, { status: 403 });
  const query = new URL(request.url).searchParams,
    id = query.get("id");
  if (!validAdminId(id)) return new Response(null, { status: 400 });
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (query.get("kind") === "avatar") {
    const [avatar] = await db
      .select({ data: userAvatars.data })
      .from(userAvatars)
      .where(eq(userAvatars.userId, id));
    return avatar
      ? new Response(new Uint8Array(avatar.data), {
          headers: { ...headers, "Content-Type": "image/png" },
        })
      : new Response(null, { status: 404 });
  }
  return new Response(null, { status: 403 });
}
