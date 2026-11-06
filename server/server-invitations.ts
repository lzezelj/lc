import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { serverInvitations, serverMembers, servers, users } from "../db/schema";

export async function createServerInvitations(
  serverId: string,
  inviterId: string,
  recipientIds: string[],
) {
  return db.transaction(async (tx) => {
    // Use the account/server lock order shared with ownership and account removal.
    const accounts = await tx
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set([inviterId, ...recipientIds])]))
      .orderBy(asc(users.id))
      .for("update");
    const [server] = await tx
      .select({ createdBy: servers.createdBy })
      .from(servers)
      .where(eq(servers.id, serverId))
      .for("update");
    if (server?.createdBy !== inviterId)
      return {
        error: "Only the server owner can invite people.",
        status: 403,
      } as const;
    if (
      !accounts.some(
        (person) =>
          person.id === inviterId &&
          !person.disabledAt &&
          (!person.expiresAt || person.expiresAt.getTime() > Date.now()),
      )
    )
      return { error: "Inviter is no longer active.", status: 403 } as const;
    if (
      recipientIds.some(
        (id) =>
          id === inviterId ||
          !accounts.some(
            (person) =>
              person.id === id &&
              person.role !== "demo" &&
              !person.disabledAt &&
              (!person.expiresAt || person.expiresAt.getTime() > Date.now()),
          ),
      )
    )
      return {
        error: "Only active non-demo accounts can be invited.",
        status: 400,
      } as const;
    const members = await tx
      .select({ userId: serverMembers.userId })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          inArray(serverMembers.userId, recipientIds),
        ),
      );
    const remaining = recipientIds.filter(
      (id) => !members.some((member) => member.userId === id),
    );
    if (!remaining.length) return { invited: [] };
    const invited = await tx
      .insert(serverInvitations)
      .values(
        remaining.map((recipientId) => ({ serverId, inviterId, recipientId })),
      )
      .onConflictDoUpdate({
        target: [serverInvitations.serverId, serverInvitations.recipientId],
        set: { inviterId, createdAt: new Date() },
      })
      .returning({ recipientId: serverInvitations.recipientId });
    return { invited: invited.map((invite) => invite.recipientId) };
  });
}
