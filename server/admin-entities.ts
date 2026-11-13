import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditAdmin } from "./admin-audit";
import { AdminError } from "./admin-error";
import { validAdminId } from "./admin-read";
import { matchesOwnerEmail } from "./owner-policy.mjs";
import { notifyServer } from "./notify-server";
import { notifyUser } from "./notify-user";
import { notifyMessageRemovals } from "./message-removals";
import { disconnectUserEverywhere } from "./disconnect-user";
import { deleteServer } from "./delete-server";
import { applyGroupModeration } from "./voice-moderation";

export async function mutateAdminServer(
  body: Record<string, unknown>,
  method: string,
  actorId: string,
) {
  if (method !== "POST" && !validAdminId(body.id))
    throw new AdminError("Invalid server");
  const id = String(body.id ?? ""),
    action = body.action ?? "rename";
  if (method === "DELETE") {
    if (body.confirm !== "DELETE")
      throw new AdminError("Type DELETE to confirm server deletion");
    return deleteServer(id, actorId, false);
  }
  if (method === "PATCH" && action === "ownership")
    return transferServer(id, body.ownerId, actorId);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if ((method === "POST" || action === "rename") && (!name || name.length > 60))
    throw new AdminError("Server name must be 1–60 characters");
  if (body.createAfk !== undefined && typeof body.createAfk !== "boolean")
    throw new AdminError("Invalid AFK option");
  if (
    action === "soundboard" &&
    typeof body.soundboardCooldownEnabled !== "boolean"
  )
    throw new AdminError("Invalid soundboard cooldown option");
  if (
    method === "PATCH" &&
    action !== "rename" &&
    action !== "afk" &&
    action !== "soundboard"
  )
    throw new AdminError("Unknown server action");
  if (
    action === "afk" &&
    body.createAfk !== true &&
    body.afkChannelId !== null &&
    !validAdminId(body.afkChannelId)
  )
    throw new AdminError("Choose an AFK group channel or disable AFK");
  const row = await db.transaction(async (tx) => {
    if (method === "POST") {
      const account = await tx.execute(
        sql`SELECT id FROM users WHERE id=${actorId} AND disabled_at IS NULL FOR UPDATE`,
      );
      if (!account.rows.length)
        throw new AdminError("Account unavailable", 403);
      const [server] = (
        await tx.execute(
          sql`INSERT INTO servers(name,created_by) VALUES (${name},${actorId}) RETURNING id,name`,
        )
      ).rows;
      await tx.execute(
        sql`INSERT INTO server_members(server_id,user_id,role) VALUES (${server.id},${actorId},'owner')`,
      );
      await tx.execute(
        sql`INSERT INTO channels(server_id,name,type) VALUES (${server.id},'general','text'),(${server.id},'Lounge','voice_direct')`,
      );
      if (body.createAfk === true) {
        const [afk] = (
          await tx.execute(
            sql`INSERT INTO channels(server_id,name,type) VALUES (${server.id},'AFK','voice_group') RETURNING id`,
          )
        ).rows;
        await tx.execute(
          sql`UPDATE servers SET afk_channel_id=${afk.id} WHERE id=${server.id}`,
        );
      }
      await auditAdmin(
        tx,
        actorId,
        "server.create",
        "server",
        String(server.id),
        { serverId: String(server.id) },
      );
      return server;
    }
    const [server] = (
      await tx.execute(
        sql`SELECT id,name FROM servers WHERE id=${id} FOR UPDATE`,
      )
    ).rows;
    if (!server) throw new AdminError("Server not found", 404);
    if (action === "rename") {
      await tx.execute(sql`UPDATE servers SET name=${name} WHERE id=${id}`);
    } else if (action === "soundboard") {
      await tx.execute(
        sql`UPDATE servers SET soundboard_cooldown_enabled=${body.soundboardCooldownEnabled} WHERE id=${id}`,
      );
    } else {
      let afkChannelId = body.afkChannelId;
      if (body.createAfk === true) {
        const [afk] = (
          await tx.execute(
            sql`INSERT INTO channels(server_id,name,type) VALUES (${id},'AFK','voice_group') RETURNING id`,
          )
        ).rows;
        afkChannelId = afk.id;
        await auditAdmin(
          tx,
          actorId,
          "channel.create",
          "channel",
          String(afk.id),
          { serverId: id, channelId: String(afk.id) },
        );
      } else if (afkChannelId !== null) {
        const [channel] = (
          await tx.execute(
            sql`SELECT id FROM channels WHERE id=${afkChannelId} AND server_id=${id} AND type='voice_group' FOR UPDATE`,
          )
        ).rows;
        if (!channel)
          throw new AdminError(
            "Choose a group voice channel belonging to this server",
          );
      }
      await tx.execute(
        sql`UPDATE servers SET afk_channel_id=${afkChannelId} WHERE id=${id}`,
      );
    }
    await auditAdmin(
      tx,
      actorId,
      action === "rename"
        ? "server.rename"
        : action === "soundboard"
          ? "server.soundboard"
          : "server.afk",
      "server",
      id,
      { serverId: id },
    );
    return { ...server, ...(action === "rename" ? { name } : {}) };
  });
  if (method === "POST") await notifyUser(actorId, { type: "access-changed" });
  else if (action === "soundboard") {
    const members = await db.execute(
      sql`SELECT user_id AS id FROM server_members WHERE server_id=${id}`,
    );
    await Promise.allSettled(
      members.rows.map((member) =>
        notifyUser(String(member.id), {
          type: "soundboard-updated",
          serverId: id,
        }),
      ),
    );
  } else await notifyServer(id);
  return Response.json(row, { status: method === "POST" ? 201 : 200 });
}

async function transferServer(id: string, ownerId: unknown, actorId: string) {
  if (!validAdminId(ownerId))
    throw new AdminError("Choose an existing active, non-demo member");
  // Read the old owner only to establish the shared user-before-server lock order.
  const [initial] = (
    await db.execute(
      sql`SELECT created_by AS "ownerId" FROM servers WHERE id=${id}`,
    )
  ).rows;
  if (!initial) throw new AdminError("Server not found", 404);
  const previous = String(initial.ownerId);
  if (ownerId === previous)
    throw new AdminError("That account already owns this server");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (${previous},${ownerId}) ORDER BY id FOR UPDATE`,
    );
    const [server] = (
      await tx.execute(
        sql`SELECT created_by AS "ownerId" FROM servers WHERE id=${id} FOR UPDATE`,
      )
    ).rows;
    if (!server || server.ownerId !== previous)
      throw new AdminError(
        "Server ownership changed. Refresh and try again.",
        409,
      );
    const [target] = (
      await tx.execute(
        sql`SELECT id,role,email FROM users WHERE id=${ownerId} AND role<>'demo' AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at>now())`,
      )
    ).rows;
    const [member] = (
      await tx.execute(
        sql`SELECT role FROM server_members WHERE server_id=${id} AND user_id=${ownerId} FOR UPDATE`,
      )
    ).rows;
    if (!target || !member || !["member", "mod"].includes(String(member.role)))
      throw new AdminError(
        "Choose an existing active, non-demo member of this server",
      );
    if (!matchesOwnerEmail(target.email, process.env.OWNER_EMAIL)) {
      const count = await tx.execute(
        sql`SELECT id FROM servers WHERE created_by=${ownerId} LIMIT 3`,
      );
      if (count.rows.length >= 3)
        throw new AdminError("This account already owns three servers", 409);
    }
    await tx.execute(
      sql`UPDATE servers SET created_by=${ownerId} WHERE id=${id}`,
    );
    await tx.execute(
      sql`UPDATE server_members SET role='member' WHERE server_id=${id} AND user_id=${previous}`,
    );
    await tx.execute(
      sql`UPDATE server_members SET role='owner',voice_muted=false,voice_deafened=false WHERE server_id=${id} AND user_id=${ownerId}`,
    );
    await auditAdmin(tx, actorId, "server.ownership", "server", id, {
      serverId: id,
      userId: ownerId,
    });
  });
  await notifyServer(id);
  const policy = { voiceMuted: false, voiceDeafened: false };
  await applyGroupModeration(id, ownerId, policy).catch(() => {});
  const members = await db.execute(
    sql`SELECT user_id AS id FROM server_members WHERE server_id=${id}`,
  );
  await Promise.allSettled(
    members.rows.map((member) =>
      notifyUser(String(member.id), {
        type: "voice-moderation-changed",
        serverId: id,
        userId: ownerId,
        ...policy,
      }),
    ),
  );
  return Response.json({ id, ownerId });
}

export async function deleteAdminUser(
  body: Record<string, unknown>,
  actorId: string,
) {
  if (
    !validAdminId(body.id) ||
    body.confirm !== "DELETE" ||
    typeof body.deleteMessages !== "boolean"
  )
    throw new AdminError(
      "Type DELETE and choose whether to erase sent messages",
    );
  const id = body.id;
  if (id === actorId)
    throw new AdminError(
      "The current application owner cannot be deleted here",
      403,
    );
  const result = await db.transaction(async (tx) => {
    const [user] = (
      await tx.execute(
        sql`SELECT id,email FROM users WHERE id=${id} FOR UPDATE`,
      )
    ).rows;
    if (!user) throw new AdminError("User not found", 404);
    if (matchesOwnerEmail(user.email, process.env.OWNER_EMAIL))
      throw new AdminError(
        "The configured application owner cannot be deleted",
        403,
      );
    const owned = await tx.execute(
      sql`SELECT id FROM servers WHERE created_by=${id} LIMIT 1`,
    );
    if (owned.rows.length)
      throw new AdminError(
        "Transfer or delete this user’s owned servers before deleting the account",
        409,
      );
    const members = (
      await tx.execute(
        sql`SELECT server_id AS id FROM server_members WHERE user_id=${id}`,
      )
    ).rows;
    const audience = (
      await tx.execute(
        sql`SELECT DISTINCT user_id AS id FROM server_members WHERE server_id IN (SELECT server_id FROM server_members WHERE user_id=${id}) UNION SELECT requester_id AS id FROM friendships WHERE recipient_id=${id} UNION SELECT recipient_id AS id FROM friendships WHERE requester_id=${id}`,
      )
    ).rows;
    const rooms = (
      await tx.execute(
        sql`SELECT c.id FROM channels c JOIN server_members sm ON sm.server_id=c.server_id WHERE sm.user_id=${id} AND c.type='voice_group'`,
      )
    ).rows;
    const friends = (
      await tx.execute(
        sql`DELETE FROM friendships WHERE requester_id=${id} OR recipient_id=${id} RETURNING requester_id AS "requesterId",recipient_id AS "recipientId"`,
      )
    ).rows;
    const channelRows = body.deleteMessages
      ? (
          await tx.execute(
            sql`DELETE FROM messages WHERE author_id=${id} RETURNING id,channel_id AS "channelId"`,
          )
        ).rows
      : [];
    const directRows = body.deleteMessages
      ? (
          await tx.execute(
            sql`DELETE FROM direct_messages WHERE sender_id=${id} RETURNING id,recipient_id AS "recipientId"`,
          )
        ).rows
      : [];
    await tx.execute(sql`DELETE FROM accounts WHERE user_id=${id}`);
    await tx.execute(sql`DELETE FROM sessions WHERE user_id=${id}`);
    await tx.execute(sql`DELETE FROM demo_invites WHERE demo_user_id=${id}`);
    await tx.execute(
      sql`DELETE FROM server_invitations WHERE recipient_id=${id} OR inviter_id=${id}`,
    );
    await tx.execute(sql`DELETE FROM server_members WHERE user_id=${id}`);
    await tx.execute(sql`DELETE FROM user_avatars WHERE user_id=${id}`);
    await tx.execute(
      sql`UPDATE users SET name='Deleted user',handle=NULL,email=NULL,email_verified=NULL,image=NULL,created_by=NULL,disabled_at=now(),updated_at=now() WHERE id=${id}`,
    );
    await auditAdmin(
      tx,
      actorId,
      body.deleteMessages ? "user.delete-with-messages" : "user.delete",
      "user",
      id,
      { userId: id },
    );
    return { members, rooms, friends, channelRows, directRows, audience };
  });
  await Promise.allSettled([
    disconnectUserEverywhere(
      id,
      result.rooms.map((room) => String(room.id)),
    ),
    notifyMessageRemovals(
      id,
      result.channelRows.map((row) => ({
        id: String(row.id),
        channelId: String(row.channelId),
      })),
      result.directRows.map((row) => ({
        id: String(row.id),
        recipientId: String(row.recipientId),
      })),
    ),
    ...result.friends.map((friend) =>
      notifyUser(
        String(
          friend.requesterId === id ? friend.recipientId : friend.requesterId,
        ),
        { type: "friendship-changed" },
      ),
    ),
    ...result.members.map((member) => notifyServer(String(member.id))),
    ...result.audience.map((member) =>
      notifyUser(String(member.id), {
        type: "profile-updated",
        userId: id,
        name: "Deleted user",
        image: null,
      }),
    ),
  ]);
  return Response.json({ id, deleted: true });
}
