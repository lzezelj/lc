import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { serverMembers, servers, users } from "../../../../../db/schema";
import { notifyServer } from "../../../../../server/notify-server";
import {
  checkRateLimit,
  rateLimitMessage,
  rateLimits,
} from "../../../../../server/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    confirm?: boolean;
  } | null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(serverId) ||
    !uuid.test(body?.userId ?? "") ||
    body?.userId === session.user.id ||
    body?.confirm !== true
  )
    return NextResponse.json(
      { error: "Choose another member and confirm the ownership transfer." },
      { status: 400 },
    );
  const targetId = body.userId!;
  const limit = checkRateLimit(
    `server-mutation:${session.user.id}`,
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
  const result = await db.transaction(async (tx) => {
    // Match the user locks used by account deletion, creation and server leave.
    for (const userId of [session.user.id, targetId].sort())
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
    const [server] = await tx
      .select({ id: servers.id, createdBy: servers.createdBy })
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
        error: "Only the current server owner can transfer ownership.",
        status: 403,
      };
    const [target] = await tx
      .select({
        id: users.id,
        role: users.role,
        disabledAt: users.disabledAt,
        expiresAt: users.expiresAt,
      })
      .from(users)
      .where(eq(users.id, targetId));
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
      !target ||
      !member ||
      member.role !== "member" ||
      target.role === "demo" ||
      target.disabledAt ||
      (target.expiresAt && target.expiresAt.getTime() <= Date.now())
    )
      return {
        error: "Choose an active, non-demo member of this server.",
        status: 400,
      };
    if (target.role !== "owner") {
      const owned = await tx
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.createdBy, targetId));
      if (owned.length >= 3)
        return {
          error: "This member already owns three servers.",
          status: 403,
        };
    }
    await tx
      .update(servers)
      .set({ createdBy: targetId })
      .where(eq(servers.id, serverId));
    await tx
      .update(serverMembers)
      .set({ role: "member" })
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, session.user.id),
        ),
      );
    await tx
      .update(serverMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, targetId),
        ),
      );
    return { ownerId: targetId, status: 200 };
  });
  if ("error" in result)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  await notifyServer(serverId);
  return NextResponse.json({ serverId, ownerId: result.ownerId });
}
