import { and, asc, eq } from "drizzle-orm";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import { serverMembers, users } from "../../../../db/schema";
import { moveRelative, type DropPlacement } from "../../../../lib/list-order";
import { notifyUser } from "../../../../server/notify-user";
import { checkRateLimit } from "../../../../server/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    serverId?: string;
    targetId?: string;
    placement?: DropPlacement;
  } | null;
  if (
    typeof body?.serverId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.serverId) ||
    typeof body.targetId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.targetId) ||
    !["before", "after"].includes(body.placement ?? "")
  )
    return Response.json({ error: "Invalid server move" }, { status: 400 });
  const limit = checkRateLimit(`server-order:${session.user.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed)
    return Response.json(
      { error: "Too many moves. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const ids = await db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, session.user.id))
      .for("no key update");
    const rows = await tx
      .select({ id: serverMembers.serverId })
      .from(serverMembers)
      .where(eq(serverMembers.userId, session.user.id))
      .orderBy(
        asc(serverMembers.position),
        asc(serverMembers.joinedAt),
        asc(serverMembers.serverId),
      )
      .for("update");
    if (
      !rows.some((row) => row.id === body.serverId) ||
      !rows.some((row) => row.id === body.targetId)
    )
      return null;
    const next = moveRelative(
      rows,
      body.serverId!,
      body.targetId!,
      body.placement!,
    );
    for (const [position, row] of next.entries())
      await tx
        .update(serverMembers)
        .set({ position })
        .where(
          and(
            eq(serverMembers.userId, session.user.id),
            eq(serverMembers.serverId, row.id),
          ),
        );
    return next.map((row) => row.id);
  });
  if (!ids)
    return Response.json({ error: "Server access required" }, { status: 403 });
  await notifyUser(session.user.id, { type: "server-order-updated" });
  return Response.json({ ids });
}
