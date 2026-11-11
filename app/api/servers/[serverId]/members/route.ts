import { and, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import {
  channels,
  friendships,
  serverMembers,
  servers,
  users,
} from "../../../../../db/schema";
import { disconnectUserEverywhere } from "../../../../../server/disconnect-user";
import { normalizeUserHandle } from "../../../../../user-handle";
import { createServerInvitations } from "../../../../../server/server-invitations";
import { notifyUser } from "../../../../../server/notify-user";
import { checkRateLimit, rateLimits } from "../../../../../server/rate-limit";
import { notifyServer } from "../../../../../server/notify-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    role?: string;
  } | null;
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (
    !uuid.test(serverId) ||
    typeof body?.userId !== "string" ||
    !uuid.test(body.userId) ||
    body.userId === session.user.id ||
    (body.role !== "member" && body.role !== "mod")
  )
    return NextResponse.json(
      { error: "Choose another member and a member or moderator role." },
      { status: 400 },
    );
  if (
    !checkRateLimit(
      `server-mutation:${session.user.id}`,
      rateLimits.serverMutation,
    ).allowed
  )
    return NextResponse.json(
      { error: "Too many server changes. Try again shortly." },
      { status: 429 },
    );
  const targetId = body.userId;
  const nextRole = body.role;
  const result = await db.transaction(async (tx) => {
    // Coordinate with account deletion, server leave and ownership transfer.
    let target:
      | Pick<
          typeof users.$inferSelect,
          "id" | "role" | "disabledAt" | "expiresAt"
        >
      | undefined;
    for (const userId of [session.user.id, targetId].sort()) {
      const [user] = await tx
        .select({
          id: users.id,
          role: users.role,
          disabledAt: users.disabledAt,
          expiresAt: users.expiresAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (userId === targetId) target = user;
    }
    const [server] = await tx
      .select({ createdBy: servers.createdBy })
      .from(servers)
      .where(eq(servers.id, serverId))
      .for("update");
    const [owner] = await tx
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, session.user.id),
        ),
      )
      .for("update");
    if (
      !server ||
      server.createdBy !== session.user.id ||
      owner?.role !== "owner"
    )
      return {
        error: "Only the current server owner can change moderator roles.",
        status: 403,
      };
    const [member] = await tx
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, targetId),
        ),
      )
      .for("update");
    if (
      !member ||
      member.role === "owner" ||
      !target ||
      target.role === "demo" ||
      target.disabledAt ||
      (target.expiresAt && target.expiresAt.getTime() <= Date.now())
    )
      return {
        error: "Choose an active, non-demo member of this server.",
        status: 400,
      };
    const [updated] = await tx
      .update(serverMembers)
      .set({ role: nextRole })
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, targetId),
          eq(serverMembers.role, member.role),
        ),
      )
      .returning({ userId: serverMembers.userId, role: serverMembers.role });
    return updated
      ? { ...updated, status: 200 }
      : { error: "The member changed. Refresh and try again.", status: 409 };
  });
  if ("error" in result)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  await notifyServer(serverId);
  return NextResponse.json({ id: result.userId, role: result.role });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  const { serverId } = await params;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [membership] = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const expiredMembers = await db
    .select({ userId: users.id })
    .from(serverMembers)
    .innerJoin(users, eq(users.id, serverMembers.userId))
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(users.role, "demo"),
        lte(users.expiresAt, new Date()),
      ),
    );
  if (expiredMembers.length > 0) {
    await db.delete(serverMembers).where(
      and(
        eq(serverMembers.serverId, serverId),
        inArray(
          serverMembers.userId,
          expiredMembers.map((member) => member.userId),
        ),
      ),
    );
  }

  const members = await db
    .select({
      id: users.id,
      name: users.name,
      handle: users.handle,
      image: users.image,
      role: serverMembers.role,
      accountRole: users.role,
      voiceMuted: serverMembers.voiceMuted,
      voiceDeafened: serverMembers.voiceDeafened,
    })
    .from(serverMembers)
    .innerJoin(users, eq(users.id, serverMembers.userId))
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        isNull(users.disabledAt),
        or(isNull(users.expiresAt), gt(users.expiresAt, new Date())),
      ),
    );

  return NextResponse.json(
    members.map(({ accountRole, ...member }) => ({
      ...member,
      canBeModerator: accountRole !== "demo",
    })),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  const { serverId } = await params;
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { userId?: string };
  if (!body.userId || body.userId === session.user.id)
    return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  const [owner] = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (owner?.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [target] = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, body.userId),
      ),
    );
  if (!target || target.role === "owner")
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  const groupChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(eq(channels.serverId, serverId), eq(channels.type, "voice_group")),
    );
  const [removed] = await db
    .delete(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, body.userId),
        eq(serverMembers.role, target.role),
      ),
    )
    .returning({ userId: serverMembers.userId });
  if (!removed)
    return NextResponse.json(
      { error: "The member's role changed. Refresh and try again." },
      { status: 409 },
    );
  const [removedFrom] = await db
    .select({ name: servers.name })
    .from(servers)
    .where(eq(servers.id, serverId));
  await disconnectUserEverywhere(
    body.userId,
    groupChannels.map((channel) => channel.id),
    {
      reason: "server-kicked",
      serverId,
      serverName: removedFrom?.name ?? "the server",
    },
  );
  return NextResponse.json({ id: body.userId });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    !checkRateLimit(
      `server-invitations:${session.user.id}`,
      rateLimits.serverMutation,
    ).allowed
  )
    return NextResponse.json(
      { error: "Too many invitations. Try again shortly." },
      { status: 429 },
    );
  const { serverId } = await params;
  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    userIds?: string[];
    handle?: string;
    mode?: "friends" | "people";
  } | null;
  if (
    !body ||
    (!body.userId && !body.userIds?.length && !body.handle) ||
    (body.handle !== undefined && typeof body.handle !== "string")
  )
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (
    body.mode !== undefined &&
    body.mode !== "friends" &&
    body.mode !== "people"
  )
    return NextResponse.json(
      { error: "Invalid invitation mode" },
      { status: 400 },
    );
  if (
    body.userIds &&
    (!Array.isArray(body.userIds) || body.userIds.length > 50)
  )
    return NextResponse.json(
      { error: "Choose up to 50 people" },
      { status: 400 },
    );
  const handleUserId = body.handle
    ? (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.handle, normalizeUserHandle(body.handle!)))
      )[0]?.id
    : undefined;
  const userIds = [
    ...new Set([
      ...(body.userIds ?? []),
      ...(body.userId ? [body.userId] : []),
      ...(handleUserId ? [handleUserId] : []),
    ]),
  ];
  if (userIds.length === 0)
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  const [owner] = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (owner?.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (
    userIds.some(
      (id) =>
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  const activeUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, userIds),
        ne(users.role, "demo"),
        isNull(users.disabledAt),
        or(isNull(users.expiresAt), gt(users.expiresAt, new Date())),
      ),
    );
  if (activeUsers.length !== userIds.length)
    return NextResponse.json(
      {
        error:
          "Only active accounts can be invited. Manage demo access through demo account settings.",
      },
      { status: 400 },
    );
  if (body.mode !== "people") {
    const friendRows = await db
      .select({
        requesterId: friendships.requesterId,
        recipientId: friendships.recipientId,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            and(
              eq(friendships.requesterId, session.user.id),
              inArray(friendships.recipientId, userIds),
            ),
            and(
              inArray(friendships.requesterId, userIds),
              eq(friendships.recipientId, session.user.id),
            ),
          ),
        ),
      );
    const friendIds = new Set(
      friendRows.map((row) =>
        row.requesterId === session.user.id ? row.recipientId : row.requesterId,
      ),
    );
    if (userIds.some((userId) => !friendIds.has(userId)))
      return NextResponse.json(
        { error: "Only accepted friends can be invited" },
        { status: 403 },
      );
  }
  const result = await createServerInvitations(
    serverId,
    session.user.id,
    userIds,
  );
  if ("error" in result)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  await Promise.allSettled(
    [session.user.id, ...result.invited].map((userId) =>
      notifyUser(userId, {
        type: "server-invitations-changed",
        ...(userId !== session.user.id
          ? { notification: "server-invite", serverId }
          : {}),
      }),
    ),
  );
  return NextResponse.json(
    { invited: result.invited },
    { status: result.invited.length ? 201 : 200 },
  );
}
