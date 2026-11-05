import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { serverMembers, servers, serverSounds } from "../../../../../db/schema";
import { checkRateLimit, rateLimits } from "../../../../../server/rate-limit";
import { notifyServer } from "../../../../../server/notify-server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const body = await request.json().catch(() => null);
  if (
    !uuid.test(serverId) ||
    !body ||
    !(
      body.joinSoundId === null ||
      (typeof body.joinSoundId === "string" && uuid.test(body.joinSoundId))
    )
  )
    return NextResponse.json(
      { error: "Choose Default or a sound from this server." },
      { status: 400 },
    );
  const limit = checkRateLimit(
    `server-mutation:${session.user.id}`,
    rateLimits.serverMutation,
  );
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Too many server changes. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const response = await db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, session.user.id),
        ),
      )
      .for("update");
    if (!member || !["owner", "member"].includes(member.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (body.joinSoundId !== null) {
      const [sound] = await tx
        .select({ id: serverSounds.id })
        .from(serverSounds)
        .where(
          and(
            eq(serverSounds.id, body.joinSoundId),
            eq(serverSounds.serverId, serverId),
          ),
        )
        .for("key share");
      if (!sound)
        return NextResponse.json(
          { error: "Sound not found in this server." },
          { status: 404 },
        );
    }
    const [updated] = await tx
      .update(servers)
      .set({ joinSoundId: body.joinSoundId })
      .where(eq(servers.id, serverId))
      .returning({ joinSoundId: servers.joinSoundId });
    return NextResponse.json(updated);
  });
  if (response.ok) void notifyServer(serverId);
  return response;
}
