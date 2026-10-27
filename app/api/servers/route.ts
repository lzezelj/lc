import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { channels, serverMembers, servers, users } from "../../../db/schema";
import { checkRateLimit, rateLimits } from "../../../server/rate-limit";
import { notifyServer } from "../../../server/notify-server";
import { disconnectUserEverywhere } from "../../../server/disconnect-user";

export async function GET() {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await db
    .select({ id: servers.id, name: servers.name, role: serverMembers.role })
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

const MAX_SERVERS_PER_MEMBER = 3;

export async function POST(request: Request) {
  const session = await auth();
  if (!session || session.user.role === "demo")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rateLimit = checkRateLimit(
    `server-mutation:${session.user.id}`,
    rateLimits.serverMutation,
  );
  if (!rateLimit.allowed)
    return NextResponse.json(
      { error: "Too many server changes. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 60)
    return NextResponse.json(
      { error: "Server name must be 1-60 characters" },
      { status: 400 },
    );
  const serverId = randomUUID();
  const textChannelId = randomUUID();
  const created = await db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, session.user.id))
      .for("update");
    if (session.user.role !== "owner") {
      const ownedServers = await tx
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.createdBy, session.user.id));
      if (ownedServers.length >= MAX_SERVERS_PER_MEMBER) return false;
    }
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
    return true;
  });
  if (!created)
    return NextResponse.json(
      { error: `You can create up to ${MAX_SERVERS_PER_MEMBER} servers.` },
      { status: 403 },
    );
  return NextResponse.json(
    { id: serverId, name, role: "owner", firstChannelId: textChannelId },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session || session.user.role === "demo")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json()) as { serverId?: string; name?: string };
  const name = body.name?.trim();
  if (!body.serverId || !name || name.length > 60)
    return NextResponse.json(
      { error: "Server name must be 1-60 characters" },
      { status: 400 },
    );
  const [server] = await db
    .update(servers)
    .set({ name })
    .where(
      and(
        eq(servers.id, body.serverId),
        eq(servers.createdBy, session.user.id),
      ),
    )
    .returning({ id: servers.id, name: servers.name });
  if (!server)
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  void notifyServer(server.id);
  return NextResponse.json(server);
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId, action } = (await request.json()) as {
    serverId?: string;
    action?: string;
  };
  if (!serverId)
    return NextResponse.json({ error: "Server is required" }, { status: 400 });
  if (action === "leave") {
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, session.user.id))
        .for("update");
      const memberships = await tx
        .select()
        .from(serverMembers)
        .where(eq(serverMembers.userId, session.user.id));
      const member = memberships.find((row) => row.serverId === serverId);
      if (!member || member.role === "owner")
        return "Only non-owner members can leave a server.";
      if (session.user.role === "demo" && memberships.length <= 1)
        return "Demo accounts must retain at least one server.";
      await tx
        .delete(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.userId, session.user.id),
          ),
        );
      return null;
    });
    if (result) return NextResponse.json({ error: result }, { status: 403 });
    const leftChannels = await db
      .select({ id: channels.id, type: channels.type })
      .from(channels)
      .where(eq(channels.serverId, serverId));
    await disconnectUserEverywhere(
      session.user.id,
      leftChannels
        .filter((channel) => channel.type === "voice_group")
        .map((channel) => channel.id),
    );
    return NextResponse.json({
      id: serverId,
      channelIds: leftChannels.map((channel) => channel.id),
    });
  }
  const [deleted] = await db
    .delete(servers)
    .where(
      and(eq(servers.id, serverId), eq(servers.createdBy, session.user.id)),
    )
    .returning({ id: servers.id });
  if (!deleted)
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  return NextResponse.json(deleted);
}
