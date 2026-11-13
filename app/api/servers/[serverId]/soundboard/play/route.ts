import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../../auth";
import { db } from "../../../../../../db";
import {
  serverMembers,
  serverSounds,
  servers,
} from "../../../../../../db/schema";
import { checkRateLimit } from "../../../../../../server/rate-limit";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const clip = new URL(request.url).searchParams.get("clip") ?? "";
  if (!uuid.test(serverId) || !uuid.test(clip))
    return NextResponse.json({ error: "Invalid sound" }, { status: 400 });
  const [member] = await db
    .select({ userId: serverMembers.userId })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.userId, session.user.id),
        eq(serverMembers.serverId, serverId),
      ),
    );
  if (!member)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [sound] = await db
    .select({ id: serverSounds.id })
    .from(serverSounds)
    .where(and(eq(serverSounds.id, clip), eq(serverSounds.serverId, serverId)));
  if (!sound)
    return NextResponse.json({ error: "Sound not found" }, { status: 404 });
  const [server] = await db
    .select({ enabled: servers.soundboardCooldownEnabled })
    .from(servers)
    .where(eq(servers.id, serverId));
  if (!server)
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  const limit =
    server.enabled === false
      ? { allowed: true, retryAfterSeconds: 0 }
      : checkRateLimit(`soundboard-play:${session.user.id}`, {
          limit: 1,
          windowMs: 1000,
        });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "Wait one second before playing another sound" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  return NextResponse.json(
    { allowed: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
