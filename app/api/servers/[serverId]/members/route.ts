import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers, users } from "../../../../../db/schema";
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
