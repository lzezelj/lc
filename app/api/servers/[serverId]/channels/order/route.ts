import { and, asc, eq } from "drizzle-orm";
import { auth } from "../../../../../../auth";
import { db } from "../../../../../../db";
import { channels, serverMembers, servers } from "../../../../../../db/schema";
import {
  moveRelative,
  type DropPlacement,
} from "../../../../../../lib/list-order";
import { notifyUser } from "../../../../../../server/notify-user";
import { checkRateLimit } from "../../../../../../server/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  try {
    return await reorder(request, context);
  } catch {
    return Response.json(
      { error: "Channel could not be moved. Please try again." },
      { status: 500 },
    );
  }
}

async function reorder(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const body = (await request.json().catch(() => null)) as {
    channelId?: string;
    targetId?: string;
    placement?: DropPlacement;
  } | null;
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (
    !uuid.test(serverId) ||
    typeof body?.channelId !== "string" ||
    !uuid.test(body.channelId) ||
    typeof body.targetId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.targetId) ||
    !["before", "after"].includes(body.placement ?? "")
  )
    return Response.json({ error: "Invalid channel move" }, { status: 400 });
  const limit = checkRateLimit(`channel-order:${session.user.id}`, {
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
  const result = await db.transaction(async (tx) => {
    const [server] = await tx
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, serverId))
      .for("update");
    if (!server) return { error: "Server not found", status: 404 };
    const [member] = await tx
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, session.user.id),
        ),
      )
      .for("update");
    if (member?.role !== "owner")
      return { error: "Only the server owner can move channels", status: 403 };
    const rows = await tx
      .select({ id: channels.id, type: channels.type })
      .from(channels)
      .where(eq(channels.serverId, serverId))
      .orderBy(
        asc(channels.position),
        asc(channels.createdAt),
        asc(channels.id),
      )
      .for("update");
    const target = rows.find((row) => row.id === body.channelId);
    const destination = rows.find((row) => row.id === body.targetId);
    if (!target || !destination)
      return { error: "Channel not found", status: 404 };
    if ((target.type === "text") !== (destination.type === "text"))
      return {
        error: "Channels must stay in their Text or Voice section",
        status: 400,
      };
    const group = rows.filter(
      (row) => (row.type === "text") === (target.type === "text"),
    );
    const next = moveRelative(
      group,
      target.id,
      destination.id,
      body.placement!,
    );
    for (const [position, row] of next.entries())
      await tx
        .update(channels)
        .set({ position })
        .where(and(eq(channels.serverId, serverId), eq(channels.id, row.id)));
    return { ids: next.map((row) => row.id) };
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  const members = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(eq(serverMembers.serverId, serverId));
  await Promise.allSettled(
    members.map(({ userId }) =>
      notifyUser(userId, { type: "channel-order-updated", serverId }),
    ),
  );
  return Response.json(result);
}
