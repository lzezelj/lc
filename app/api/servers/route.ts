import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { channels, serverMembers, servers, users } from "../../../db/schema";

export async function GET() {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await db
    .select({ id: servers.id, name: servers.name })
    .from(serverMembers)
    .innerJoin(servers, eq(servers.id, serverMembers.serverId))
    .innerJoin(users, eq(users.id, serverMembers.userId))
    .where(
      and(
        eq(serverMembers.userId, session.user.id),
        isNull(users.disabledAt),
        or(isNull(users.expiresAt), gt(users.expiresAt, new Date())),
      ),
    );
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session || session.user.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 60)
    return NextResponse.json(
      { error: "Server name must be 1-60 characters" },
      { status: 400 },
    );
  const serverId = randomUUID();
  const textChannelId = randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .insert(servers)
      .values({ id: serverId, name, createdBy: session.user.id });
    await tx
      .insert(serverMembers)
      .values({ serverId, userId: session.user.id, role: "owner" });
    await tx.insert(channels).values([
      { id: textChannelId, serverId, name: "general", type: "text" },
      { serverId, name: "Lounge", type: "voice_direct" },
    ]);
  });
  return NextResponse.json(
    { id: serverId, name, firstChannelId: textChannelId },
    { status: 201 },
  );
}
