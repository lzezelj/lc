import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditAdmin } from "./admin-audit";
import { validAdminId } from "./admin-read";
import { notifyServer } from "./notify-server";
import { notifyUser } from "./notify-user";
import { removeChannelMedia } from "./remove-channel-media";
import { serverMentions, storeMentions } from "./mentions";
import type { Mention } from "../app/notification-types";
import { AdminError } from "./admin-error";
import { mutateAdminServer, deleteAdminUser } from "./admin-entities";

export async function mutateAdmin(request: Request, actorId: string) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "JSON required" }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json({ error: "Missing action" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 20000) {
      await reader.cancel();
      return Response.json({ error: "Request too large" }, { status: 413 });
    }
    chunks.push(chunk.value);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || body.confirmed !== true)
    return Response.json({ error: "Confirmation required" }, { status: 400 });
  try {
    if (body.target === "server")
      return await mutateAdminServer(body, request.method, actorId);
    if (body.target === "user" && request.method === "DELETE")
      return await deleteAdminUser(body, actorId);
    if (body.target === "channel")
      return await mutateChannel(body, request.method, actorId);
    if (body.target === "message" && request.method !== "POST")
      return await mutateMessage(body, request.method, actorId);
    throw new AdminError("Unknown action");
  } catch (error) {
    if (error instanceof AdminError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

async function mutateChannel(
  body: Record<string, unknown>,
  method: string,
  actorId: string,
) {
  if (
    !validAdminId(body.serverId) ||
    (method !== "POST" && !validAdminId(body.id))
  )
    throw new AdminError("Invalid channel");
  const serverId = body.serverId;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (method !== "DELETE" && (!name || name.length > 60))
    throw new AdminError("Channel name must be 1–60 characters");
  if (
    method === "POST" &&
    !["text", "voice_direct", "voice_group"].includes(String(body.type))
  )
    throw new AdminError("Invalid channel type");
  const row = await db.transaction(async (tx) => {
    const parent = await tx.execute(
      sql`SELECT id FROM servers WHERE id=${serverId} FOR UPDATE`,
    );
    if (!parent.rows.length) throw new AdminError("Server not found", 404);
    const result =
      method === "POST"
        ? await tx.execute(
            sql`INSERT INTO channels(server_id,name,type) VALUES (${serverId},${name},${body.type}::channel_type) RETURNING id,name,type`,
          )
        : method === "PATCH"
          ? await tx.execute(
              sql`UPDATE channels SET name=${name} WHERE id=${body.id} AND server_id=${serverId} RETURNING id,name,type`,
            )
          : await tx.execute(
              sql`DELETE FROM channels WHERE id=${body.id} AND server_id=${serverId} RETURNING id,name,type`,
            );
    const row = result.rows[0];
    if (!row) throw new AdminError("Channel not found", 404);
    await auditAdmin(
      tx,
      actorId,
      method === "POST"
        ? "channel.create"
        : method === "PATCH"
          ? "channel.rename"
          : "channel.delete",
      "channel",
      String(row.id),
      { serverId, channelId: String(row.id) },
    );
    return row;
  });
  if (method === "DELETE")
    await removeChannelMedia(
      serverId,
      String(row.id),
      String(row.type),
      "admin",
    );
  await notifyServer(serverId);
  return Response.json(row, { status: method === "POST" ? 201 : 200 });
}

async function mutateMessage(
  body: Record<string, unknown>,
  method: string,
  actorId: string,
) {
  if (
    !validAdminId(body.id) ||
    !["server", "direct"].includes(String(body.scope))
  )
    throw new AdminError("Invalid message");
  const direct = body.scope === "direct";
  const table = direct ? sql`direct_messages` : sql`messages`;
  const result = await db.transaction(async (tx) => {
    const found = await tx.execute(
      direct
        ? sql`SELECT m.id,m.sender_id AS "authorId",m.recipient_id AS "peerId",m.kind,m.attachments,m.deleted_at AS "deletedAt" FROM direct_messages m WHERE m.id=${body.id} FOR UPDATE`
        : sql`SELECT m.id,m.author_id AS "authorId",m.channel_id AS "channelId",c.server_id AS "serverId",m.attachments,m.deleted_at AS "deletedAt" FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=${body.id} FOR UPDATE OF m`,
    );
    const row = found.rows[0];
    if (!row) throw new AdminError("Message not found", 404);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    let mentions: Mention[] = [];
    if (method === "PATCH") {
      if (row.deletedAt || (direct && row.kind !== "message"))
        throw new AdminError(
          "Deleted messages and call records cannot be edited",
          409,
        );
      if (
        text.length > 4000 ||
        (!text && !(row.attachments as unknown[]).length)
      )
        throw new AdminError(
          "Add text or keep an attachment; maximum 4000 characters",
        );
      if (!direct)
        mentions = await serverMentions(
          String(row.channelId),
          text,
          String(row.authorId),
        );
      await tx.execute(
        sql`UPDATE ${table} SET content=${text},edited_at=now(),edited_by_admin=true ${!direct ? sql`,mentions=${JSON.stringify(mentions)}::jsonb` : sql``} WHERE id=${body.id}`,
      );
      // Update mention state without sending a notification attributed to the author.
      if (!direct) await storeMentions(tx, String(row.id), mentions, true);
    } else if (body.permanent === true) {
      await tx.execute(sql`DELETE FROM ${table} WHERE id=${body.id}`);
    } else {
      await tx.execute(
        sql`UPDATE ${table} SET content='',deleted_at=COALESCE(deleted_at,now()),edited_at=now() WHERE id=${body.id}`,
      );
    }
    const saved =
      method === "PATCH"
        ? (
            await tx.execute(
              sql`SELECT id,content AS text,edited_at AS "editedAt",edited_by_admin AS "editedByAdmin" FROM ${table} WHERE id=${body.id}`,
            )
          ).rows[0]
        : null;
    await auditAdmin(
      tx,
      actorId,
      method === "PATCH"
        ? "message.edit"
        : body.permanent === true
          ? "message.delete-permanently"
          : "message.delete",
      direct ? "direct-message" : "channel-message",
      String(row.id),
      {
        userId: String(row.authorId),
        ...(!direct
          ? { serverId: String(row.serverId), channelId: String(row.channelId) }
          : {}),
      },
    );
    return { row, saved: saved ? { ...saved, mentions } : null };
  });
  const { row, saved } = result;
  if (direct) {
    await Promise.all(
      [
        [row.authorId, row.peerId],
        [row.peerId, row.authorId],
      ].map(([recipient, peer]) =>
        notifyUser(
          String(recipient),
          saved
            ? { type: "direct-message-edited", fromUserId: peer, edit: saved }
            : {
                type: "direct-message-deleted",
                fromUserId: peer,
                messageId: row.id,
                permanent: body.permanent === true,
              },
        ),
      ),
    );
  } else {
    const secret =
      process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
    if (secret)
      await fetch(
        `${process.env.SIGNALING_INTERNAL_URL ?? "http://127.0.0.1:3001"}/internal/message-${saved ? "edited" : "deleted"}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            saved
              ? { channelId: row.channelId, edit: saved }
              : {
                  channelId: row.channelId,
                  messageId: row.id,
                  permanent: body.permanent === true,
                },
          ),
          signal: AbortSignal.timeout(5000),
        },
      ).catch(() => undefined);
  }
  return Response.json({ id: row.id });
}
