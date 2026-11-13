import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditAdmin } from "./admin-audit";
import { validAdminId } from "./admin-read";
import { notifyServer } from "./notify-server";
import { removeChannelMedia } from "./remove-channel-media";
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
    if (body.target === "message")
      return Response.json(
        { error: "Admin message access is disabled" },
        { status: 403 },
      );
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
