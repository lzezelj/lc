import { sql } from "drizzle-orm";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import { areFriends } from "../../../../server/friends";
import { notifyUser } from "../../../../server/notify-user";
import { checkRateLimit } from "../../../../server/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null),
    uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (
    !body ||
    !["channel", "direct"].includes(body.scope) ||
    typeof body.targetId !== "string" ||
    !uuid.test(body.targetId) ||
    typeof body.messageId !== "string" ||
    !uuid.test(body.messageId)
  )
    return Response.json({ error: "Invalid read marker" }, { status: 400 });
  const limit = checkRateLimit(`notification-reads:${session.user.id}`, {
    limit: 180,
    windowMs: 60000,
  });
  if (!limit.allowed)
    return Response.json(
      { error: "Too many read updates" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  if (
    body.scope === "direct" &&
    !(await areFriends(session.user.id, body.targetId))
  )
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const result =
    body.scope === "channel"
      ? await db.execute(sql`insert into channel_reads(user_id,channel_id,read_at,message_at,message_id)
    select ${session.user.id}::uuid,m.channel_id,clock_timestamp(),m.created_at,m.id from messages m join channels c on c.id=m.channel_id join server_members sm on sm.server_id=c.server_id and sm.user_id=${session.user.id}::uuid where m.id=${body.messageId}::uuid and m.channel_id=${body.targetId}::uuid
    on conflict(user_id,channel_id) do update set read_at=greatest(channel_reads.read_at,excluded.read_at),message_at=case when (excluded.message_at,excluded.message_id)>(channel_reads.message_at,channel_reads.message_id) then excluded.message_at else channel_reads.message_at end,message_id=case when (excluded.message_at,excluded.message_id)>(channel_reads.message_at,channel_reads.message_id) then excluded.message_id else channel_reads.message_id end returning channel_id`)
      : await db.execute(sql`insert into direct_reads(user_id,friend_id,read_at,message_at,message_id)
    select ${session.user.id}::uuid,${body.targetId}::uuid,clock_timestamp(),m.created_at,m.id from direct_messages m where m.id=${body.messageId}::uuid and ((m.sender_id=${session.user.id}::uuid and m.recipient_id=${body.targetId}::uuid) or (m.sender_id=${body.targetId}::uuid and m.recipient_id=${session.user.id}::uuid))
    on conflict(user_id,friend_id) do update set read_at=greatest(direct_reads.read_at,excluded.read_at),message_at=case when (excluded.message_at,excluded.message_id)>(direct_reads.message_at,direct_reads.message_id) then excluded.message_at else direct_reads.message_at end,message_id=case when (excluded.message_at,excluded.message_id)>(direct_reads.message_at,direct_reads.message_id) then excluded.message_id else direct_reads.message_id end returning friend_id`);
  if (!result.rows.length)
    return Response.json({ error: "Message not accessible" }, { status: 403 });
  await notifyUser(session.user.id, { type: "notifications-changed" });
  return Response.json({ ok: true });
}
