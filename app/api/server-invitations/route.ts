import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { auth } from "../../../auth";
import { db } from "../../../db";
import {
  serverInvitations,
  serverMembers,
  servers,
  users,
} from "../../../db/schema";
import { notifyUser } from "../../../server/notify-user";
import { checkRateLimit, rateLimits } from "../../../server/rate-limit";

export async function GET() {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db
    .select({
      id: serverInvitations.id,
      serverId: servers.id,
      serverName: servers.name,
      serverImage: servers.image,
      inviterId: serverInvitations.inviterId,
      recipientId: serverInvitations.recipientId,
      createdAt: serverInvitations.createdAt,
    })
    .from(serverInvitations)
    .innerJoin(servers, eq(servers.id, serverInvitations.serverId))
    .leftJoin(
      serverMembers,
      and(
        eq(serverMembers.serverId, servers.id),
        eq(serverMembers.userId, serverInvitations.recipientId),
      ),
    )
    .where(
      and(
        or(
          eq(serverInvitations.recipientId, session.user.id),
          eq(serverInvitations.inviterId, session.user.id),
        ),
        eq(servers.createdBy, serverInvitations.inviterId),
        isNull(serverMembers.userId),
      ),
    )
    .orderBy(desc(serverInvitations.createdAt));
  const ids = [
    ...new Set(rows.flatMap((row) => [row.inviterId, row.recipientId])),
  ];
  const people = ids.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          image: users.image,
          role: users.role,
          disabledAt: users.disabledAt,
          expiresAt: users.expiresAt,
        })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const active = (id: string) =>
    people.find(
      (person) =>
        person.id === id &&
        person.role !== "demo" &&
        !person.disabledAt &&
        (!person.expiresAt || person.expiresAt.getTime() > Date.now()),
    );
  return Response.json(
    rows
      .filter((row) => active(row.inviterId) && active(row.recipientId))
      .map((row) => ({
        ...row,
        inviterName: active(row.inviterId)!.name ?? "User",
        recipientName: active(row.recipientId)!.name ?? "User",
        image: active(
          row.recipientId === session.user.id ? row.inviterId : row.recipientId,
        )!.image,
        incoming: row.recipientId === session.user.id,
      })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.id !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.id) ||
    !["accept", "decline", "cancel"].includes(body.action)
  )
    return Response.json(
      { error: "Invalid invitation action" },
      { status: 400 },
    );
  if (
    !checkRateLimit(
      `server-invitation-action:${session.user.id}`,
      rateLimits.serverMutation,
    ).allowed
  )
    return Response.json(
      { error: "Too many changes. Try again shortly." },
      { status: 429 },
    );
  const [initial] = await db
    .select()
    .from(serverInvitations)
    .where(eq(serverInvitations.id, body.id));
  if (!initial)
    return Response.json(
      { error: "Invitation no longer exists." },
      { status: 404 },
    );
  if (
    (body.action === "cancel" ? initial.inviterId : initial.recipientId) !==
    session.user.id
  )
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const result = await db.transaction(async (tx) => {
    const people = await tx
      .select()
      .from(users)
      .where(inArray(users.id, [initial.inviterId, initial.recipientId]))
      .orderBy(asc(users.id))
      .for("update");
    const [server] = await tx
      .select()
      .from(servers)
      .where(eq(servers.id, initial.serverId))
      .for("update");
    const [invite] = await tx
      .select()
      .from(serverInvitations)
      .where(eq(serverInvitations.id, body.id))
      .for("update");
    if (!invite || !server)
      return { error: "Invitation no longer exists.", status: 404 };
    // An ownership transfer/reissue cannot turn an old authorization into access.
    if (
      invite.inviterId !== initial.inviterId ||
      invite.recipientId !== initial.recipientId
    )
      return {
        error: "Invitation changed. Refresh and try again.",
        status: 409,
      };
    if (body.action === "accept") {
      if (
        server.createdBy !== invite.inviterId ||
        people.length !== 2 ||
        people.some(
          (person) =>
            person.role === "demo" ||
            person.disabledAt ||
            (person.expiresAt && person.expiresAt.getTime() <= Date.now()),
        )
      )
        return { error: "This invitation is no longer valid.", status: 410 };
      await tx
        .insert(serverMembers)
        .values({ serverId: invite.serverId, userId: session.user.id })
        .onConflictDoNothing();
    }
    await tx
      .delete(serverInvitations)
      .where(eq(serverInvitations.id, invite.id));
    return {
      serverId: invite.serverId,
      inviterId: invite.inviterId,
      recipientId: invite.recipientId,
      recipientName:
        people.find((person) => person.id === invite.recipientId)?.name ??
        "Someone",
      serverName: server.name,
    };
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  const accepted = body.action === "accept";
  const members = accepted
    ? await db
        .select({ userId: serverMembers.userId })
        .from(serverMembers)
        .where(eq(serverMembers.serverId, result.serverId))
    : [];
  await Promise.allSettled(
    [
      ...new Set([
        result.inviterId,
        result.recipientId,
        ...members.map((member) => member.userId),
      ]),
    ].map((userId) =>
      notifyUser(userId, {
        type: "server-invitations-changed",
        ...(accepted
          ? {
              invitationId: body.id,
              serverId: result.serverId,
              userId: result.recipientId,
              ...(userId === result.inviterId
                ? {
                    notice: `${result.recipientName} accepted your invitation to ${result.serverName}.`,
                  }
                : {}),
            }
          : {}),
      }),
    ),
  );
  return Response.json({ id: body.id, serverId: result.serverId, accepted });
}
