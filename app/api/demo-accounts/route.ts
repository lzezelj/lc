import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import {
  channels,
  demoInvites,
  messages,
  serverMembers,
  servers,
  users,
} from "../../../db/schema";
import { disconnectUserEverywhere } from "../../../server/disconnect-user";
import { checkRateLimit, rateLimits } from "../../../server/rate-limit";
import {
  extendDemoDeadline,
  parseDemoExtensionHours,
} from "../../../server/demo-duration";

function adminRateLimit(userId: string) {
  return checkRateLimit(`admin-mutation:${userId}`, rateLimits.adminMutation);
}

function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many account changes. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const expiredAccounts = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.createdBy, session.user.id),
        eq(users.role, "demo"),
        lte(users.expiresAt, new Date()),
      ),
    );
  if (expiredAccounts.length > 0) {
    await db.delete(serverMembers).where(
      inArray(
        serverMembers.userId,
        expiredAccounts.map((account) => account.id),
      ),
    );
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      expiresAt: users.expiresAt,
      disabledAt: users.disabledAt,
      redeemedAt: demoInvites.redeemedAt,
      revokedAt: demoInvites.revokedAt,
      serverId: servers.id,
      serverName: servers.name,
    })
    .from(users)
    .innerJoin(demoInvites, eq(demoInvites.demoUserId, users.id))
    .leftJoin(serverMembers, eq(serverMembers.userId, users.id))
    .leftJoin(servers, eq(servers.id, serverMembers.serverId))
    .where(and(eq(users.createdBy, session.user.id), eq(users.role, "demo")));

  const accounts = new Map<
    string,
    {
      id: string;
      name: string;
      expiresAt: Date | null;
      status: "pending" | "active" | "expired" | "revoked";
      servers: { id: string; name: string }[];
    }
  >();
  for (const row of rows) {
    const status =
      row.disabledAt || row.revokedAt
        ? "revoked"
        : row.expiresAt && row.expiresAt <= new Date()
          ? "expired"
          : row.redeemedAt
            ? "active"
            : "pending";
    const account = accounts.get(row.id) ?? {
      id: row.id,
      name: row.name,
      expiresAt: row.expiresAt,
      status,
      servers: [],
    };
    if (row.serverId && row.serverName) {
      account.servers.push({ id: row.serverId, name: row.serverName });
    }
    accounts.set(row.id, account);
  }

  return NextResponse.json([...accounts.values()]);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session || session.user.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rateLimit = adminRateLimit(session.user.id);
  if (!rateLimit.allowed)
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  const body = (await request.json()) as { name?: string; serverId?: string };
  const name = body.name?.trim();
  const serverId = body.serverId;
  if (!name || name.length > 60 || !serverId) {
    return NextResponse.json(
      { error: "Name and server are required" },
      { status: 400 },
    );
  }
  const [membership] = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const demoUserId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: demoUserId,
      role: "demo",
      name,
      createdBy: session.user.id,
      expiresAt,
    });
    await tx.insert(serverMembers).values({ serverId, userId: demoUserId });
    await tx.insert(demoInvites).values({
      demoUserId,
      createdBy: session.user.id,
      tokenHash,
      expiresAt,
    });
  });
  const publicOrigin = process.env.AUTH_URL ?? new URL(request.url).origin;
  return NextResponse.json(
    {
      inviteUrl: new URL(`/invite/${token}`, publicOrigin).toString(),
      expiresAt,
      member: { id: demoUserId, name, image: null, role: "member" },
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session || session.user.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rateLimit = adminRateLimit(session.user.id);
  if (!rateLimit.allowed)
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  const body = (await request.json()) as {
    demoUserId?: string;
    action?: string;
    serverIds?: string[];
    name?: string;
    extensionHours?: number;
  };
  if (!body.demoUserId || !body.action) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const [demoUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, body.demoUserId),
        eq(users.createdBy, session.user.id),
        eq(users.role, "demo"),
      ),
    );
  if (!demoUser) {
    return NextResponse.json(
      { error: "Demo account not found" },
      { status: 404 },
    );
  }

  if (body.action === "extend") {
    const hours = parseDemoExtensionHours(body.extensionHours);
    if (hours === null)
      return NextResponse.json(
        { error: "Choose a whole number of hours between 1 and 720." },
        { status: 400 },
      );
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ expiresAt: users.expiresAt, disabledAt: users.disabledAt })
        .from(users)
        .where(
          and(
            eq(users.id, demoUser.id),
            eq(users.createdBy, session.user.id),
            eq(users.role, "demo"),
          ),
        )
        .for("update");
      const now = new Date();
      if (!current?.expiresAt || current.disabledAt || current.expiresAt <= now)
        return null;
      const [invite] = await tx
        .select({ revokedAt: demoInvites.revokedAt })
        .from(demoInvites)
        .where(eq(demoInvites.demoUserId, demoUser.id))
        .for("update");
      if (!invite || invite.revokedAt) return null;
      const [membership] = await tx
        .select({ serverId: serverMembers.serverId })
        .from(serverMembers)
        .where(eq(serverMembers.userId, demoUser.id))
        .limit(1);
      if (!membership) return null;
      const expiresAt = extendDemoDeadline(current.expiresAt, hours);
      await tx
        .update(users)
        .set({ expiresAt, updatedAt: now })
        .where(eq(users.id, demoUser.id));
      // Keep redemption/revocation state and the token hash intact. A used
      // invitation must not become usable again when access is extended.
      await tx
        .update(demoInvites)
        .set({ expiresAt })
        .where(eq(demoInvites.demoUserId, demoUser.id));
      return { id: demoUser.id, expiresAt };
    });
    if (!result)
      return NextResponse.json(
        {
          error:
            "Only active or pending demo accounts with server access can be extended. Reactivate expired or revoked accounts using a new invitation and server assignment.",
        },
        { status: 409 },
      );
    return NextResponse.json(result);
  }

  if (body.action === "rename") {
    const name = body.name?.trim();
    if (!name || name.length > 60)
      return NextResponse.json(
        { error: "Username must be 1-60 characters" },
        { status: 400 },
      );
    await db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, demoUser.id));
    return NextResponse.json({ id: demoUser.id, name });
  }

  if (body.action === "servers") {
    const serverIds = [...new Set(body.serverIds ?? [])];
    if (serverIds.length === 0)
      return NextResponse.json(
        { error: "Demo accounts must keep at least one server." },
        { status: 400 },
      );
    const owned = await db
      .select({ id: servers.id })
      .from(servers)
      .where(
        and(
          inArray(servers.id, serverIds),
          eq(servers.createdBy, session.user.id),
        ),
      );
    if (owned.length !== serverIds.length)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const previous = await db
      .select({ serverId: serverMembers.serverId })
      .from(serverMembers)
      .where(eq(serverMembers.userId, demoUser.id));
    const affectedServerIds = [
      ...new Set([...previous.map((row) => row.serverId), ...serverIds]),
    ];
    const groupChannels = await db
      .select({ id: channels.id })
      .from(channels)
      .where(
        and(
          inArray(channels.serverId, affectedServerIds),
          eq(channels.type, "voice_group"),
        ),
      );
    await db.transaction(async (tx) => {
      await tx
        .delete(serverMembers)
        .where(eq(serverMembers.userId, demoUser.id));
      await tx
        .insert(serverMembers)
        .values(
          serverIds.map((serverId) => ({ serverId, userId: demoUser.id })),
        );
    });
    await disconnectUserEverywhere(
      demoUser.id,
      groupChannels.map((channel) => channel.id),
    );
    return NextResponse.json({ id: demoUser.id, serverIds });
  }

  if (body.action === "regenerate") {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
    await db
      .update(demoInvites)
      .set({ tokenHash, expiresAt, revokedAt: null, redeemedAt: null })
      .where(eq(demoInvites.demoUserId, demoUser.id));
    await db
      .update(users)
      .set({ expiresAt, disabledAt: null, updatedAt: new Date() })
      .where(eq(users.id, demoUser.id));
    const publicOrigin = process.env.AUTH_URL ?? new URL(request.url).origin;
    return NextResponse.json({
      id: demoUser.id,
      inviteUrl: new URL(`/invite/${token}`, publicOrigin).toString(),
      expiresAt,
      status: "pending",
    });
  }

  if (body.action !== "revoke")
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const groupChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
    .where(
      and(
        eq(serverMembers.userId, demoUser.id),
        eq(channels.type, "voice_group"),
      ),
    );
  const revokedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ disabledAt: revokedAt, updatedAt: revokedAt })
      .where(eq(users.id, demoUser.id));
    await tx
      .update(demoInvites)
      .set({ revokedAt })
      .where(eq(demoInvites.demoUserId, demoUser.id));
    await tx.delete(serverMembers).where(eq(serverMembers.userId, demoUser.id));
  });
  await disconnectUserEverywhere(
    demoUser.id,
    groupChannels.map((channel) => channel.id),
  );
  return NextResponse.json({ id: demoUser.id, status: "revoked" });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session || session.user.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rateLimit = adminRateLimit(session.user.id);
  if (!rateLimit.allowed)
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  const body = (await request.json()) as {
    demoUserId?: string;
    deleteMessages?: boolean;
  };
  if (!body.demoUserId)
    return NextResponse.json(
      { error: "Demo account is required" },
      { status: 400 },
    );
  const [demoUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, body.demoUserId),
        eq(users.createdBy, session.user.id),
        eq(users.role, "demo"),
      ),
    );
  if (!demoUser)
    return NextResponse.json(
      { error: "Demo account not found" },
      { status: 404 },
    );
  const groupChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
    .where(
      and(
        eq(serverMembers.userId, demoUser.id),
        eq(channels.type, "voice_group"),
      ),
    );
  await disconnectUserEverywhere(
    demoUser.id,
    groupChannels.map((channel) => channel.id),
  );
  await db.transaction(async (tx) => {
    await tx.delete(serverMembers).where(eq(serverMembers.userId, demoUser.id));
    await tx.delete(demoInvites).where(eq(demoInvites.demoUserId, demoUser.id));
    if (body.deleteMessages) {
      await tx.delete(messages).where(eq(messages.authorId, demoUser.id));
      await tx.delete(users).where(eq(users.id, demoUser.id));
    } else {
      await tx
        .update(users)
        .set({
          name: "Deleted user",
          email: null,
          image: null,
          createdBy: null,
          disabledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, demoUser.id));
    }
  });
  return NextResponse.json({ id: demoUser.id });
}
