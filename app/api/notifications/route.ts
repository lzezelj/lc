import { and, eq } from "drizzle-orm";
import { auth } from "../../../auth";
import { db } from "../../../db";
import {
  serverMembers,
  serverNotifications,
  directNotifications,
} from "../../../db/schema";
import { canMessage } from "../../../server/direct-conversations";
import { notificationInbox } from "../../../server/notification-inbox";
import { notifyUser } from "../../../server/notify-user";
import { checkRateLimit } from "../../../server/rate-limit";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(await notificationInbox(session.user.id), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !["server", "direct"].includes(body.scope) ||
    typeof body.targetId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.targetId) ||
    !["messages", body.scope === "server" ? "mentions" : "calls"].includes(
      body.kind,
    ) ||
    !["on", "off", "60", "480", "1440"].includes(body.mode)
  )
    return Response.json(
      { error: "Invalid notification preference" },
      { status: 400 },
    );
  const limit = checkRateLimit(`notification-settings:${session.user.id}`, {
    limit: 60,
    windowMs: 60000,
  });
  if (!limit.allowed)
    return Response.json(
      { error: "Too many changes" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  if (body.scope === "server") {
    const [member] = await db
      .select()
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.userId, session.user.id),
          eq(serverMembers.serverId, body.targetId),
        ),
      );
    if (!member) return Response.json({ error: "Forbidden" }, { status: 403 });
  } else if (!(await canMessage(session.user.id, body.targetId)))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const enabled = body.mode !== "off",
    until = ["on", "off"].includes(body.mode)
      ? null
      : new Date(Date.now() + Number(body.mode) * 60000);
  if (body.scope === "server") {
    const change =
      body.kind === "messages"
        ? { messages: enabled, messageMuteUntil: until }
        : { mentions: enabled, mentionMuteUntil: until };
    await db
      .insert(serverNotifications)
      .values({ userId: session.user.id, serverId: body.targetId, ...change })
      .onConflictDoUpdate({
        target: [serverNotifications.userId, serverNotifications.serverId],
        set: change,
      });
  } else {
    const change =
      body.kind === "messages"
        ? { messages: enabled, messageMuteUntil: until }
        : { calls: enabled, callMuteUntil: until };
    await db
      .insert(directNotifications)
      .values({ userId: session.user.id, friendId: body.targetId, ...change })
      .onConflictDoUpdate({
        target: [directNotifications.userId, directNotifications.friendId],
        set: change,
      });
  }
  await notifyUser(session.user.id, { type: "notifications-changed" });
  return Response.json({ ok: true });
}
