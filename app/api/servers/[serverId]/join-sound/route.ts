import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { serverMembers, serverSounds } from "../../../../../db/schema";
import { checkRateLimit, rateLimits } from "../../../../../server/rate-limit";
import { notifyUser } from "../../../../../server/notify-user";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Other members can resolve the authenticated participant's entrance/exit clips.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const userId =
    new URL(request.url).searchParams.get("userId") ?? session.user.id;
  if (!uuid.test(serverId) || !uuid.test(userId))
    return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  const [member] = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (!member)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [sounds] = await db
    .select({
      joinSoundId: serverMembers.joinSoundId,
    })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, userId),
      ),
    );
  if (!sounds)
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  return NextResponse.json(sounds, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const body = await request.json().catch(() => null);
  const changes: { joinSoundId?: string | null } = {};
  if (body && typeof body === "object")
    for (const key of ["joinSoundId"] as const) {
      if (Object.hasOwn(body, key)) changes[key] = body[key];
    }
  if (
    !uuid.test(serverId) ||
    Object.keys(changes).length === 0 ||
    Object.values(changes).some(
      (value) =>
        value !== null && (typeof value !== "string" || !uuid.test(value)),
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
    for (const soundId of new Set(Object.values(changes))) {
      if (soundId === null) continue;
      const [sound] = await tx
        .select({ id: serverSounds.id })
        .from(serverSounds)
        .where(
          and(
            eq(serverSounds.id, soundId!),
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
      .update(serverMembers)
      .set(changes)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.userId, session.user.id),
        ),
      )
      .returning({
        joinSoundId: serverMembers.joinSoundId,
      });
    return NextResponse.json(updated);
  });
  if (response.ok) {
    const { joinSoundId } = await response.clone().json();
    void notifyUser(session.user.id, {
      type: "voice-sounds-changed",
      serverId,
      joinSoundId,
    });
  }
  return response;
}
