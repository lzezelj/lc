import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
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
  await db
    .delete(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, body.userId),
      ),
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
  const { serverId } = await params;
  const body = (await request.json()) as {
    userId?: string;
    userIds?: string[];
    handle?: string;
  };
  if (!session || (!body.userId && !body.userIds?.length && !body.handle))
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const handleUserId = body.handle
    ? (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.handle, body.handle!.trim().toLowerCase()))
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
