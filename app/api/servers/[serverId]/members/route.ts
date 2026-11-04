import { and, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import {
  channels,
  friendships,
  serverMembers,
  users,
} from "../../../../../db/schema";
import { disconnectUserEverywhere } from "../../../../../server/disconnect-user";
import { normalizeUserHandle } from "../../../../../user-handle";

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

  return NextResponse.json(members);
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
        eq(serverMembers.role, "member"),
      ),
    )
    .returning({ userId: serverMembers.userId });
  if (!removed)
    return NextResponse.json(
      { error: "The member's role changed. Refresh and try again." },
      { status: 409 },
    );
  await disconnectUserEverywhere(
    body.userId,
    groupChannels.map((channel) => channel.id),
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
  const { serverId } = await params;
  const body = (await request.json()) as {
    userId?: string;
    userIds?: string[];
    handle?: string;
    mode?: "friends" | "people";
  };
  if (!session || (!body.userId && !body.userIds?.length && !body.handle))
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
        { error: "Only accepted friends can be added" },
        { status: 403 },
      );
  }
  const added = await db
    .insert(serverMembers)
    .values(userIds.map((userId) => ({ serverId, userId })))
    .onConflictDoNothing()
    .returning();
  await Promise.allSettled(
    added.map((member) => disconnectUserEverywhere(member.userId, [])),
  );
  return NextResponse.json(
    { added: added.map((member) => member.userId) },
    { status: added.length ? 201 : 200 },
  );
}
