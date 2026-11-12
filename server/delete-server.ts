import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditAdmin } from "./admin-audit";
import { AdminError } from "./admin-error";
import { removeChannelMedia } from "./remove-channel-media";
import { disconnectUserEverywhere } from "./disconnect-user";
import { notifyUser } from "./notify-user";

export async function deleteServer(
  id: string,
  actorId: string,
  ownerOnly = true,
) {
  const result = await db.transaction(async (tx) => {
    // Serialize demo final-membership decisions against account/assignment writes.
    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (SELECT user_id FROM server_members WHERE server_id=${id}) ORDER BY id FOR UPDATE`,
    );
    const [server] = (
      await tx.execute(
        sql`SELECT id,name FROM servers WHERE id=${id} ${ownerOnly ? sql`AND created_by=${actorId}` : sql``} FOR UPDATE`,
      )
    ).rows;
    if (!server) throw new AdminError("Server not found", 404);
    const members = (
      await tx.execute(
        sql`SELECT user_id AS id FROM server_members WHERE server_id=${id}`,
      )
    ).rows;
    const rooms = (
      await tx.execute(sql`SELECT id,type FROM channels WHERE server_id=${id}`)
    ).rows;
    const demos = (
      await tx.execute(
        sql`SELECT u.id FROM users u JOIN server_members sm ON sm.user_id=u.id WHERE sm.server_id=${id} AND u.role='demo' AND NOT EXISTS (SELECT 1 FROM server_members other WHERE other.user_id=u.id AND other.server_id<>${id})`,
      )
    ).rows;
    for (const demo of demos) {
      await tx.execute(
        sql`UPDATE users SET disabled_at=COALESCE(disabled_at,now()),updated_at=now() WHERE id=${demo.id}`,
      );
      await tx.execute(
        sql`UPDATE demo_invites SET revoked_at=COALESCE(revoked_at,now()) WHERE demo_user_id=${demo.id}`,
      );
      if (!ownerOnly)
        await auditAdmin(
          tx,
          actorId,
          "demo.revoke-server-deleted",
          "user",
          String(demo.id),
          { userId: String(demo.id), serverId: id },
        );
    }
    const invitees = (
      await tx.execute(
        sql`SELECT recipient_id AS id FROM server_invitations WHERE server_id=${id}`,
      )
    ).rows;
    await tx.execute(sql`DELETE FROM servers WHERE id=${id}`);
    if (!ownerOnly)
      await auditAdmin(tx, actorId, "server.delete", "server", id, {
        serverId: id,
      });
    return { members, rooms, demos, invitees };
  });
  await Promise.allSettled(
    result.rooms.map((room) =>
      removeChannelMedia(
        id,
        String(room.id),
        String(room.type),
        ownerOnly ? undefined : "admin",
      ),
    ),
  );
  await Promise.allSettled([
    ...result.members.map((member) =>
      notifyUser(String(member.id), {
        type: "access-changed",
        reason: "server-deleted",
        serverId: id,
      }),
    ),
    ...result.invitees.map((member) =>
      notifyUser(String(member.id), { type: "server-invitations-changed" }),
    ),
    ...result.demos.map((demo) =>
      disconnectUserEverywhere(String(demo.id), []),
    ),
  ]);
  return Response.json({ id, revokedDemos: result.demos.length });
}
