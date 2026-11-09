import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import {
  serverInvitations,
  serverMembers,
  serverPictures,
  servers,
} from "../../../../../db/schema";
import { readAvatar } from "../../../../../server/profile-pictures";
import { checkRateLimit } from "../../../../../server/rate-limit";
import { notifyUser } from "../../../../../server/notify-user";

type Context = { params: Promise<{ serverId: string }> };
const validId = (id: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);

export async function GET(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  if (!validId(serverId))
    return Response.json({ error: "Invalid server" }, { status: 400 });
  // A pending recipient can see the picture without receiving membership access.
  const [picture] = await db
    .select({ data: serverPictures.data })
    .from(serverPictures)
    .innerJoin(servers, eq(servers.id, serverPictures.serverId))
    .leftJoin(
      serverMembers,
      and(
        eq(serverMembers.serverId, servers.id),
        eq(serverMembers.userId, session.user.id),
      ),
    )
    .leftJoin(
      serverInvitations,
      and(
        eq(serverInvitations.serverId, servers.id),
        eq(serverInvitations.recipientId, session.user.id),
        eq(serverInvitations.inviterId, servers.createdBy),
      ),
    )
    .where(
      and(
        eq(servers.id, serverId),
        or(
          eq(serverMembers.userId, session.user.id),
          eq(serverInvitations.recipientId, session.user.id),
        ),
      ),
    )
    .limit(1);
  if (!picture)
    return Response.json({ error: "Picture not found" }, { status: 404 });
  return new Response(new Uint8Array(picture.data), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function change(request: Request, { params }: Context, remove: boolean) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  if (!validId(serverId))
    return Response.json({ error: "Invalid server" }, { status: 400 });
  const limit = checkRateLimit(`server-picture:${session.user.id}`, {
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
  const [owner] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(
      and(eq(servers.id, serverId), eq(servers.createdBy, session.user.id)),
    );
  if (!owner) return Response.json({ error: "Forbidden" }, { status: 403 });
  const data = remove ? null : await readAvatar(request);
  if (data instanceof Response) return data;
  const image = remove
    ? null
    : `/api/servers/${serverId}/picture?v=${randomUUID()}`;
  const changed = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: servers.id })
      .from(servers)
      .where(
        and(eq(servers.id, serverId), eq(servers.createdBy, session.user.id)),
      )
      .for("update");
    if (!current) return false;
    if (data)
      await tx
        .insert(serverPictures)
        .values({ serverId, data })
        .onConflictDoUpdate({ target: serverPictures.serverId, set: { data } });
    else
      await tx
        .delete(serverPictures)
        .where(eq(serverPictures.serverId, serverId));
    await tx.update(servers).set({ image }).where(eq(servers.id, serverId));
    return true;
  });
  if (!changed) return Response.json({ error: "Forbidden" }, { status: 403 });
  const [members, invites] = await Promise.all([
    db
      .select({ userId: serverMembers.userId })
      .from(serverMembers)
      .where(eq(serverMembers.serverId, serverId)),
    db
      .select({ userId: serverInvitations.recipientId })
      .from(serverInvitations)
      .where(eq(serverInvitations.serverId, serverId)),
  ]);
  await Promise.allSettled(
    [...new Set([...members, ...invites].map((row) => row.userId))].map(
      (userId) =>
        notifyUser(userId, { type: "server-picture-updated", serverId, image }),
    ),
  );
  return Response.json({ image });
}
export function PUT(request: Request, context: Context) {
  return change(request, context, false);
}
export function DELETE(request: Request, context: Context) {
  return change(request, context, true);
}
