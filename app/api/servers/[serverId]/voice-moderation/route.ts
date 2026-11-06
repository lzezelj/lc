import { and, eq } from "drizzle-orm";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { serverMembers } from "../../../../../db/schema";
import { notifyUser } from "../../../../../server/notify-user";
import { checkRateLimit } from "../../../../../server/rate-limit";
import {
  applyGroupModeration,
  readVoicePolicies,
} from "../../../../../server/voice-moderation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await context.params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(serverId))
    return Response.json({ error: "Invalid server" }, { status: 400 });
  const [member] = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (!member) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(await readVoicePolicies(serverId), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await context.params;
  const body = await request.json().catch(() => null);
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (
    !uuid.test(serverId) ||
    !body ||
    typeof body.userId !== "string" ||
    !uuid.test(body.userId) ||
    body.userId === session.user.id ||
    (!Object.hasOwn(body, "voiceMuted") &&
      !Object.hasOwn(body, "voiceDeafened")) ||
    (Object.hasOwn(body, "voiceMuted") &&
      typeof body.voiceMuted !== "boolean") ||
    (Object.hasOwn(body, "voiceDeafened") &&
      typeof body.voiceDeafened !== "boolean")
  )
    return Response.json(
      { error: "Invalid moderation request" },
      { status: 400 },
    );
  const rate = checkRateLimit(`voice-moderation:${session.user.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed)
    return Response.json(
      { error: "Too many moderation changes. Try again shortly." },
      { status: 429 },
    );
  const result = await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, session.user.id),
        ),
      )
      .for("update");
    if (owner?.role !== "owner") return null;
    const [target] = await tx
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, body.userId),
        ),
      )
      .for("update");
    if (!target || target.role === "owner") return null;
    const patch = {
      ...(typeof body.voiceMuted === "boolean"
        ? { voiceMuted: body.voiceMuted }
        : {}),
      ...(typeof body.voiceDeafened === "boolean"
        ? { voiceDeafened: body.voiceDeafened }
        : {}),
    };
    const [policy] = await tx
      .update(serverMembers)
      .set(patch)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, body.userId),
        ),
      )
      .returning({
        voiceMuted: serverMembers.voiceMuted,
        voiceDeafened: serverMembers.voiceDeafened,
      });
    return policy;
  });
  if (!result)
    return Response.json(
      { error: "Only the server owner can moderate another member." },
      { status: 403 },
    );
  let mediaSynced = true;
  try {
    await applyGroupModeration(serverId, body.userId, result);
  } catch {
    mediaSynced = false;
  }
  const members = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(eq(serverMembers.serverId, serverId));
  await Promise.allSettled(
    members.map((member) =>
      notifyUser(member.userId, {
        type: "voice-moderation-changed",
        serverId,
        userId: body.userId,
        ...result,
      }),
    ),
  );
  return Response.json({ ...result, mediaSynced });
}
