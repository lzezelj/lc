import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { ownerSession } from "../../../../server/owner";
import { validAdminId } from "../../../../server/admin-read";
import { auditAdmin } from "../../../../server/admin-audit";
import { readAvatar } from "../../../../server/profile-pictures";
import { checkRateLimit, rateLimits } from "../../../../server/rate-limit";
import { notifyUser } from "../../../../server/notify-user";
import { db } from "../../../../db";
import { serverPictures, servers } from "../../../../db/schema";

export async function GET(request: Request) {
  if (!(await ownerSession())) return new Response(null, { status: 403 });
  const id = new URL(request.url).searchParams.get("serverId");
  if (!validAdminId(id)) return new Response(null, { status: 400 });
  const [picture] = await db
    .select({ data: serverPictures.data })
    .from(serverPictures)
    .where(eq(serverPictures.serverId, id));
  return picture
    ? new Response(new Uint8Array(picture.data), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      })
    : new Response(null, { status: 404 });
}
async function change(request: Request) {
  const session = await ownerSession();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (request.headers.get("X-Admin-Confirmed") !== "true")
    return Response.json({ error: "Confirmation required" }, { status: 400 });
  const id = new URL(request.url).searchParams.get("serverId");
  if (!validAdminId(id))
    return Response.json({ error: "Invalid server" }, { status: 400 });
  const limit = checkRateLimit(
    `admin-mutation:${session.user.id}`,
    rateLimits.adminMutation,
  );
  if (!limit.allowed)
    return Response.json(
      { error: "Too many admin changes. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const remove = request.method === "DELETE",
    data = remove ? null : await readAvatar(request);
  if (data instanceof Response) return data;
  const image = remove ? null : `/api/servers/${id}/picture?v=${randomUUID()}`;
  const changed = await db.transaction(async (tx) => {
    const [server] = await tx
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, id))
      .for("update");
    if (!server) return false;
    if (data)
      await tx
        .insert(serverPictures)
        .values({ serverId: id, data })
        .onConflictDoUpdate({ target: serverPictures.serverId, set: { data } });
    else await tx.delete(serverPictures).where(eq(serverPictures.serverId, id));
    await tx.update(servers).set({ image }).where(eq(servers.id, id));
    await auditAdmin(
      tx,
      session.user.id,
      remove ? "server.picture.remove" : "server.picture.change",
      "server",
      id,
      { serverId: id },
    );
    return true;
  });
  if (!changed)
    return Response.json({ error: "Server not found" }, { status: 404 });
  const audience = await db.execute(
    sql`SELECT user_id AS id FROM server_members WHERE server_id=${id} UNION SELECT recipient_id AS id FROM server_invitations WHERE server_id=${id}`,
  );
  await Promise.allSettled(
    audience.rows.map((member) =>
      notifyUser(String(member.id), {
        type: "server-picture-updated",
        serverId: id,
        image,
      }),
    ),
  );
  return Response.json({ image });
}
export { change as PUT, change as DELETE };
