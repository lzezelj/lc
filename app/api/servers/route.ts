import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { channels, serverMembers, servers, users } from "../../../db/schema";
import {
  checkRateLimit,
  rateLimits,
  rateLimitMessage,
} from "../../../server/rate-limit";
import { notifyServer } from "../../../server/notify-server";
import { disconnectUserEverywhere } from "../../../server/disconnect-user";
import { deleteServer } from "../../../server/delete-server";
import { AdminError } from "../../../server/admin-error";

export async function GET() {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await db
    .select({
      id: servers.id,
      name: servers.name,
      image: servers.image,
      afkChannelId: servers.afkChannelId,
      role: serverMembers.role,
      joinSoundId: serverMembers.joinSoundId,
      voiceMuted: serverMembers.voiceMuted,
      voiceDeafened: serverMembers.voiceDeafened,
    })
    .from(serverMembers)
    .innerJoin(servers, eq(servers.id, serverMembers.serverId))
    .innerJoin(users, eq(users.id, serverMembers.userId))
    .where(
      and(
        eq(serverMembers.userId, session.user.id),
        isNull(users.disabledAt),
        or(isNull(users.expiresAt), gt(users.expiresAt, new Date())),
      ),
    )
    .orderBy(
      asc(serverMembers.position),
      asc(serverMembers.joinedAt),
      asc(servers.id),
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
      {
        error: rateLimitMessage(
          "Too many server changes.",
          rateLimit.retryAfterSeconds,
        ),
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    createAfk?: boolean;
  } | null;
  if (!body || typeof body.name !== "string")
    return NextResponse.json(
      { error: "Server name is required" },
      { status: 400 },
    );
  if (body.createAfk !== undefined && typeof body.createAfk !== "boolean")
    return NextResponse.json({ error: "Invalid AFK option" }, { status: 400 });
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
    let afkChannelId: string | null = null;
    if (body.createAfk) {
      const [afk] = await tx
        .insert(channels)
        .values({ serverId, name: "AFK", type: "voice_group" })
        .returning({ id: channels.id });
      await tx
        .update(servers)
        .set({ afkChannelId: afk.id })
        .where(eq(servers.id, serverId));
      afkChannelId = afk.id;
    }
    return { afkChannelId };
  });
  if (!created)
    return NextResponse.json(
      { error: `You can create up to ${MAX_SERVERS_PER_MEMBER} servers.` },
      { status: 403 },
    );
  return NextResponse.json(
    {
      id: serverId,
      name,
      role: "owner",
      firstChannelId: textChannelId,
      afkChannelId: created.afkChannelId,
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session || session.user.role === "demo")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    serverId?: string;
    name?: string;
    afkChannelId?: string | null;
    createAfk?: boolean;
  } | null;
  if (!body)
    return NextResponse.json(
      { error: "Invalid server settings" },
      { status: 400 },
    );
  if (body.createAfk !== undefined && typeof body.createAfk !== "boolean")
    return NextResponse.json({ error: "Invalid AFK option" }, { status: 400 });
  if (Object.hasOwn(body, "afkChannelId") || body.createAfk === true) {
    const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    if (
      typeof body.serverId !== "string" ||
      !uuid.test(body.serverId) ||
      (body.afkChannelId !== null &&
        body.afkChannelId !== undefined &&
        (typeof body.afkChannelId !== "string" ||
          !uuid.test(body.afkChannelId)))
    )
      return NextResponse.json(
        { error: "Invalid AFK channel" },
        { status: 400 },
      );
    const limit = checkRateLimit(
      `server-mutation:${session.user.id}`,
      rateLimits.serverMutation,
    );
    if (!limit.allowed)
      return NextResponse.json(
        { error: "Too many server changes. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    const result = await db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: servers.id })
        .from(servers)
        .where(
          and(
            eq(servers.id, body.serverId!),
            eq(servers.createdBy, session.user.id),
          ),
        )
        .for("update");
      if (!owner) return null;
      let afkChannelId = body.afkChannelId ?? null;
      if (body.createAfk) {
        const [channel] = await tx
          .insert(channels)
          .values({ serverId: owner.id, name: "AFK", type: "voice_group" })
          .returning({ id: channels.id });
        afkChannelId = channel.id;
      } else if (afkChannelId) {
        const [channel] = await tx
          .select({ type: channels.type })
          .from(channels)
          .where(
            and(eq(channels.id, afkChannelId), eq(channels.serverId, owner.id)),
          )
          .for("update");
        if (!channel || channel.type !== "voice_group") return null;
      }
      await tx
        .update(servers)
        .set({ afkChannelId })
        .where(eq(servers.id, owner.id));
      return { id: owner.id, afkChannelId };
    });
    if (!result)
      return NextResponse.json(
        { error: "Server or AFK group channel not found" },
        { status: 403 },
      );
    await notifyServer(result.id);
    return NextResponse.json(result);
  }
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
  if (
    typeof serverId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(serverId)
  )
    return NextResponse.json({ error: "Invalid server" }, { status: 400 });
  const limit = checkRateLimit(
    `server-delete:${session.user.id}`,
    rateLimits.serverMutation,
  );
  if (!limit.allowed)
    return NextResponse.json(
      {
        error: rateLimitMessage(
          "Too many server changes.",
          limit.retryAfterSeconds,
        ),
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  try {
    return await deleteServer(serverId, session.user.id, true);
  } catch (error) {
    if (error instanceof AdminError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    throw error;
  }
}
