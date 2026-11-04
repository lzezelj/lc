import { sql } from "drizzle-orm";
import { db } from "../db";
import type { NotificationInbox } from "../app/notification-types";

export async function notificationInbox(
  userId: string,
): Promise<NotificationInbox> {
  await db.execute(sql`insert into channel_reads(user_id,channel_id,read_at,message_at,message_id)
    select ${userId}::uuid,c.id,greatest(sm.joined_at,c.created_at),greatest(sm.joined_at,c.created_at),'00000000-0000-0000-0000-000000000000'::uuid
    from server_members sm join channels c on c.server_id=sm.server_id where sm.user_id=${userId}::uuid and c.type='text'
    on conflict do nothing`);
  await db.execute(sql`insert into direct_reads(user_id,friend_id,read_at,message_at,message_id)
    select ${userId}::uuid,case when f.requester_id=${userId}::uuid then f.recipient_id else f.requester_id end,coalesce(f.accepted_at,f.created_at),coalesce(f.accepted_at,f.created_at),'00000000-0000-0000-0000-000000000000'::uuid
    from friendships f where f.status='accepted' and (f.requester_id=${userId}::uuid or f.recipient_id=${userId}::uuid) on conflict do nothing`);
  const [channels, direct, serverPrefs, directPrefs] = await Promise.all([
    db.execute(sql`select c.id,c.server_id as "serverId",
      exists(select 1 from messages m where m.channel_id=c.id and m.author_id<>${userId}::uuid and m.deleted_at is null and (m.created_at,m.id)>(r.message_at,r.message_id)) as unread,
      (select count(*)::int from message_mentions mm join messages m on m.id=mm.message_id where mm.user_id=${userId}::uuid and m.channel_id=c.id and m.deleted_at is null and mm.notified_at>r.read_at) as mentions,
      (select m.id from messages m where m.channel_id=c.id and m.author_id<>${userId}::uuid and m.deleted_at is null and (m.created_at,m.id)>(r.message_at,r.message_id) order by m.created_at,m.id limit 1) as "firstUnreadId",
      (select m.id from messages m where m.channel_id=c.id order by m.created_at desc,m.id desc limit 1) as "latestMessageId"
      from channels c join server_members sm on sm.server_id=c.server_id and sm.user_id=${userId}::uuid join channel_reads r on r.channel_id=c.id and r.user_id=${userId}::uuid where c.type='text'`),
    db.execute(sql`select r.friend_id as id,
      (select count(*)::int from direct_messages m where m.sender_id=r.friend_id and m.recipient_id=${userId}::uuid and m.kind='message' and m.deleted_at is null and (m.created_at,m.id)>(r.message_at,r.message_id)) as unread,
      (select m.id from direct_messages m where m.sender_id=r.friend_id and m.recipient_id=${userId}::uuid and m.kind='message' and m.deleted_at is null and (m.created_at,m.id)>(r.message_at,r.message_id) order by m.created_at,m.id limit 1) as "firstUnreadId",
      (select m.id from direct_messages m where (m.sender_id=${userId}::uuid and m.recipient_id=r.friend_id) or (m.sender_id=r.friend_id and m.recipient_id=${userId}::uuid) order by m.created_at desc,m.id desc limit 1) as "latestMessageId"
      from direct_reads r join friendships f on f.status='accepted' and ((f.requester_id=r.user_id and f.recipient_id=r.friend_id) or (f.recipient_id=r.user_id and f.requester_id=r.friend_id)) where r.user_id=${userId}::uuid`),
    db.execute(
      sql`select 'server' as scope,p.server_id as "targetId",p.messages,p.mentions,p.message_mute_until as "messageMuteUntil",p.mention_mute_until as "mentionMuteUntil" from server_notifications p join server_members sm on sm.server_id=p.server_id and sm.user_id=p.user_id where p.user_id=${userId}::uuid`,
    ),
    db.execute(
      sql`select 'direct' as scope,p.friend_id as "targetId",p.messages,p.calls,p.message_mute_until as "messageMuteUntil",p.call_mute_until as "callMuteUntil" from direct_notifications p join friendships f on f.status='accepted' and ((f.requester_id=p.user_id and f.recipient_id=p.friend_id) or (f.recipient_id=p.user_id and f.requester_id=p.friend_id)) where p.user_id=${userId}::uuid`,
    ),
  ]);
  return {
    channels: channels.rows,
    direct: direct.rows,
    preferences: [...serverPrefs.rows, ...directPrefs.rows],
  } as NotificationInbox;
}
