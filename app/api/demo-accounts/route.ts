import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { demoInvites, serverMembers, servers, users } from "../../../db/schema";

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  return NextResponse.json(
    {
      inviteUrl: `${new URL(request.url).origin}/invite/${token}`,
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
  const body = (await request.json()) as {
    demoUserId?: string;
    action?: string;
  };
  if (!body.demoUserId || body.action !== "revoke") {
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

  return NextResponse.json({ id: demoUser.id, status: "revoked" });
}
