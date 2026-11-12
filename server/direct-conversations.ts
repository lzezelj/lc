import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
export { areFriends as canCall } from "./friends";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// Friendship grants calls separately. This predicate grants text conversations only.
export function directPeerAccess(actor: string | SQL, peer: string | SQL) {
  return sql`${actor}::uuid <> ${peer}::uuid
    and exists(select 1 from users dm_actor where dm_actor.id=${actor}::uuid and dm_actor.role<>'demo' and dm_actor.disabled_at is null and (dm_actor.expires_at is null or dm_actor.expires_at>now()))
    and exists(select 1 from users dm_peer where dm_peer.id=${peer}::uuid and dm_peer.role<>'demo' and dm_peer.disabled_at is null and (dm_peer.expires_at is null or dm_peer.expires_at>now()))
    and (
      exists(select 1 from friendships f where f.status='accepted' and ((f.requester_id=${actor}::uuid and f.recipient_id=${peer}::uuid) or (f.requester_id=${peer}::uuid and f.recipient_id=${actor}::uuid)))
      or exists(select 1 from server_members dm_member_a join server_members dm_member_p on dm_member_p.server_id=dm_member_a.server_id where dm_member_a.user_id=${actor}::uuid and dm_member_p.user_id=${peer}::uuid)
      or exists(select 1 from direct_messages m where (m.sender_id=${actor}::uuid and m.recipient_id=${peer}::uuid) or (m.sender_id=${peer}::uuid and m.recipient_id=${actor}::uuid))
    )`;
}

export async function canMessage(actor: string, peer: string) {
  if (!uuid.test(actor) || !uuid.test(peer) || actor === peer) return false;
  const result = await db.execute(
    sql`select (${directPeerAccess(actor, peer)}) as allowed`,
  );
  return result.rows[0]?.allowed === true;
}

export async function conversationPeers(actor: string, peer?: string) {
  const result = await db.execute(sql`
    with peers as (
      select recipient_id as id from friendships where requester_id=${actor}::uuid
      union select requester_id from friendships where recipient_id=${actor}::uuid
      union select recipient_id from direct_messages where sender_id=${actor}::uuid
      union select sender_id from direct_messages where recipient_id=${actor}::uuid
      union select peer.user_id from server_members own join server_members peer on peer.server_id=own.server_id where own.user_id=${actor}::uuid
      ${peer ? sql`union select ${peer}::uuid` : sql``}
    )
    select u.id,u.name,u.handle,u.image,coalesce(f.status::text,'none') as status,
      coalesce(f.recipient_id=${actor}::uuid,false) as incoming,
      greatest(f.last_activity_at,activity.created_at) as "lastActivityAt",
      case when latest.id is null then null else json_build_object('senderId',latest.sender_id,'text',
        case when latest.deleted_at is not null then 'Deleted message' when latest.content='' then 'Attachment' else left(latest.content,160) end) end as "lastMessage",
      (${directPeerAccess(actor, sql`u.id`)}) as "canMessage"
    from peers join users u on u.id=peers.id
    left join friendships f on (f.requester_id=${actor}::uuid and f.recipient_id=u.id) or (f.requester_id=u.id and f.recipient_id=${actor}::uuid)
    left join lateral (
      select created_at from direct_messages m where (m.sender_id=${actor}::uuid and m.recipient_id=u.id) or (m.sender_id=u.id and m.recipient_id=${actor}::uuid)
      order by created_at desc,id desc limit 1
    ) activity on true
    left join lateral (
      select id,sender_id,content,deleted_at from direct_messages m where m.kind='message' and ((m.sender_id=${actor}::uuid and m.recipient_id=u.id) or (m.sender_id=u.id and m.recipient_id=${actor}::uuid))
      order by created_at desc,id desc limit 1
    ) latest on true
    where u.id<>${actor}::uuid and u.role<>'demo' and u.disabled_at is null and (u.expires_at is null or u.expires_at>now())
      ${peer ? sql`and u.id=${peer}::uuid` : sql``}
    order by "lastActivityAt" desc nulls last,u.name,u.id
  `);
  return result.rows;
}

export async function messagingPeerIds(actor: string) {
  const result = await db.execute(
    sql`select u.id from users u where ${directPeerAccess(actor, sql`u.id`)}`,
  );
  return result.rows.map((row) => row.id as string);
}
