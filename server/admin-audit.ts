import { db } from "../db";
import { adminAuditLog } from "../db/schema";

export type AdminTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export async function auditAdmin(
  tx: AdminTransaction,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  context: { userId?: string; serverId?: string; channelId?: string } = {},
) {
  await tx
    .insert(adminAuditLog)
    .values({ actorId, action, targetType, targetId, ...context });
}
