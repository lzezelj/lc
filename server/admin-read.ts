import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const validAdminId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
export async function readAdmin(query: URLSearchParams) {
  const resource = query.get("resource") ?? "users";
  const userId = query.get("userId"),
    serverId = query.get("serverId"),
    channelId = query.get("channelId"),
    peerId = query.get("peerId");
  const ownerId = query.get("ownerId");
  if (
    [userId, serverId, channelId, peerId, ownerId].some(
      (id) => id !== null && !validAdminId(id),
    )
  )
    return Response.json({ error: "Invalid filter" }, { status: 400 });
  const page = Number(query.get("page") ?? 0);
  const search = (query.get("q") ?? "").trim();
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    page > 100000 ||
    search.length > 200
  )
    return Response.json({ error: "Invalid search or page" }, { status: 400 });
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  let statement: SQL;
  switch (resource) {
    case "users":
      statement = sql`SELECT u.id, u.name, u.handle, u.image, u.role, u.disabled_at AS "disabledAt", u.expires_at AS "expiresAt", u.created_at AS "createdAt"
        FROM users u WHERE (u.name ILIKE ${pattern} OR u.handle ILIKE ${pattern}) ORDER BY lower(u.name), u.id`;
      break;
    case "profile":
      if (!userId)
        return Response.json({ error: "Select a user" }, { status: 400 });
      statement = sql`SELECT id, name, handle, image, role, disabled_at AS "disabledAt", expires_at AS "expiresAt", created_at AS "createdAt" FROM users WHERE id = ${userId}`;
      break;
    case "servers":
      // Include former memberships when messages remain, without pretending they are current members.
      statement = sql`SELECT s.id, s.name, s.created_at AS "createdAt", s.created_by AS "ownerId",
        ${userId ? sql`EXISTS(SELECT 1 FROM server_members sm WHERE sm.server_id=s.id AND sm.user_id=${userId})` : sql`false`} AS "isMember"
        FROM servers s WHERE s.name ILIKE ${pattern}
        ${ownerId ? sql`AND s.created_by=${ownerId}` : sql``}
        ${userId ? sql`AND (EXISTS(SELECT 1 FROM server_members sm WHERE sm.server_id=s.id AND sm.user_id=${userId}) OR EXISTS(SELECT 1 FROM channels c JOIN messages m ON m.channel_id=c.id WHERE c.server_id=s.id AND m.author_id=${userId}))` : sql``}
        ORDER BY lower(s.name), s.id`;
      break;
    case "server":
      if (!serverId)
        return Response.json({ error: "Select a server" }, { status: 400 });
      statement = sql`SELECT s.id,s.name,s.image,s.created_by AS "ownerId",s.afk_channel_id AS "afkChannelId",s.created_at AS "createdAt",
        (SELECT count(*)::int FROM server_members sm WHERE sm.server_id=s.id) AS "memberCount",
        (SELECT count(*)::int FROM channels c WHERE c.server_id=s.id) AS "channelCount",
        (SELECT count(*)::int FROM server_members sm JOIN users u ON u.id=sm.user_id WHERE sm.server_id=s.id AND u.role='demo' AND NOT EXISTS(SELECT 1 FROM server_members other WHERE other.user_id=u.id AND other.server_id<>s.id)) AS "finalDemoCount"
        FROM servers s WHERE s.id=${serverId}`;
      break;
    case "members":
      if (!serverId)
        return Response.json({ error: "Select a server" }, { status: 400 });
      statement = sql`SELECT u.id,u.name,u.handle,u.image,sm.role,u.role AS "accountRole",u.disabled_at AS "disabledAt",u.expires_at AS "expiresAt" FROM server_members sm JOIN users u ON u.id=sm.user_id
        WHERE sm.server_id=${serverId} AND (u.name ILIKE ${pattern} OR u.handle ILIKE ${pattern}) ORDER BY lower(u.name),u.id`;
      break;
    case "channels":
      if (!serverId)
        return Response.json({ error: "Select a server" }, { status: 400 });
      if (
        query.has("type") &&
        !["text", "voice_direct", "voice_group"].includes(
          query.get("type") ?? "",
        )
      )
        return Response.json(
          { error: "Invalid channel type" },
          { status: 400 },
        );
      statement = sql`SELECT c.id,c.name,c.type,c.server_id AS "serverId" FROM channels c WHERE c.server_id=${serverId} AND c.name ILIKE ${pattern}
        ${query.has("type") ? sql`AND c.type=${query.get("type")}::channel_type` : sql``}
        ${userId ? sql`AND EXISTS(SELECT 1 FROM messages m WHERE m.channel_id=c.id AND m.author_id=${userId})` : sql``}
        ORDER BY c.position NULLS LAST,c.created_at,c.id`;
      break;
    case "conversations":
      if (!userId)
        return Response.json({ error: "Select a user" }, { status: 400 });
      statement = sql`SELECT DISTINCT u.id,u.name,u.handle,u.image FROM direct_messages m JOIN users u ON u.id=m.recipient_id
        WHERE m.sender_id=${userId} AND (u.name ILIKE ${pattern} OR u.handle ILIKE ${pattern}) ORDER BY u.name,u.id`;
      break;
    case "messages": {
      const direct = query.get("scope") === "direct";
      if (direct && !userId)
        return Response.json({ error: "Select a user" }, { status: 400 });
      if (!direct && !userId && !serverId && !channelId)
        return Response.json(
          { error: "Select a message scope" },
          { status: 400 },
        );
      statement = direct
        ? sql`SELECT m.id,m.sender_id AS "authorId",u.name AS author,m.recipient_id AS "peerId",p.name AS "peerName",
            CASE WHEN m.deleted_at IS NULL THEN m.content ELSE 'Deleted message' END AS text,
            CASE WHEN m.deleted_at IS NULL THEN m.attachments ELSE '[]'::jsonb END AS attachments,
            m.created_at AS "createdAt",m.edited_at AS "editedAt",m.edited_by_admin AS "editedByAdmin",m.deleted_at AS "deletedAt",m.kind,
            'direct' AS scope FROM direct_messages m JOIN users u ON u.id=m.sender_id JOIN users p ON p.id=m.recipient_id
            WHERE m.sender_id=${userId} ${peerId ? sql`AND m.recipient_id=${peerId}` : sql``}
            AND (m.deleted_at IS NULL AND m.content ILIKE ${pattern} OR ${!search} AND m.deleted_at IS NOT NULL)
            ORDER BY m.created_at DESC,m.id DESC`
        : sql`SELECT m.id,m.author_id AS "authorId",u.name AS author,c.id AS "channelId",c.name AS "channelName",s.id AS "serverId",s.name AS "serverName",
            CASE WHEN m.deleted_at IS NULL THEN m.content ELSE 'Deleted message' END AS text,
            CASE WHEN m.deleted_at IS NULL THEN m.attachments ELSE '[]'::jsonb END AS attachments,
            m.reply_to_id AS "replyToId",CASE WHEN r.deleted_at IS NOT NULL THEN 'Deleted message' ELSE r.content END AS "replyText",
            m.created_at AS "createdAt",m.edited_at AS "editedAt",m.edited_by_admin AS "editedByAdmin",m.deleted_at AS "deletedAt",'message' AS kind,
            'server' AS scope FROM messages m JOIN users u ON u.id=m.author_id JOIN channels c ON c.id=m.channel_id JOIN servers s ON s.id=c.server_id
            LEFT JOIN messages r ON r.id=m.reply_to_id
            WHERE true ${userId ? sql`AND m.author_id=${userId}` : sql``} ${serverId ? sql`AND s.id=${serverId}` : sql``} ${channelId ? sql`AND c.id=${channelId}` : sql``}
            AND (m.deleted_at IS NULL AND m.content ILIKE ${pattern} OR ${!search} AND m.deleted_at IS NOT NULL)
            ORDER BY m.created_at DESC,m.id DESC`;
      break;
    }
    case "audit":
      statement = sql`SELECT a.id,a.actor_id AS "actorId",a.action,a.target_type AS "targetType",a.target_id AS "targetId",a.user_id AS "userId",a.server_id AS "serverId",a.channel_id AS "channelId",a.created_at AS "createdAt"
        FROM admin_audit_log a WHERE (a.action ILIKE ${pattern} OR a.target_id::text ILIKE ${pattern}) ORDER BY a.created_at DESC,a.id DESC`;
      break;
    default:
      return Response.json({ error: "Unknown resource" }, { status: 400 });
  }
  const result = await db.execute(
    sql`${statement} LIMIT 51 OFFSET ${page * 50}`,
  );
  const rows = result.rows.slice(0, 50);
  if (["users", "profile", "members"].includes(resource)) {
    const statuses = await adminStatuses(rows.map((row) => String(row.id)));
    rows.forEach((row) => {
      row.status = statuses?.[String(row.id)] ?? "unavailable";
    });
  }
  return Response.json(
    { rows, nextPage: result.rows.length > 50 ? page + 1 : null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function adminStatuses(
  ids: string[],
): Promise<Record<string, string> | null> {
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || !ids.length) return null;
  try {
    const response = await fetch(
      `${process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001"}/internal/admin-presence`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userIds: ids }),
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      },
    );
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
