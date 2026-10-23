import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";
import { checkRateLimit, rateLimits } from "../../../../../server/rate-limit";

async function membership(userId: string, serverId: string) {
  const [result] = await db
    .select()
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.userId, userId),
        eq(serverMembers.serverId, serverId),
      ),
    );
  return result;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  const { serverId } = await params;
  if (!session || !(await membership(session.user.id, serverId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(
    await db.select().from(channels).where(eq(channels.serverId, serverId)),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  const { serverId } = await params;
  const member = session && (await membership(session.user.id, serverId));
  if (!session || member?.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rateLimit = checkRateLimit(
    `server-mutation:${session.user.id}`,
    rateLimits.serverMutation,
  );
  if (!rateLimit.allowed)
    return NextResponse.json(
      { error: "Too many server changes. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  const body = (await request.json()) as {
    name?: string;
    type?: "text" | "voice_direct" | "voice_group";
  };
  const name = body.name?.trim();
  if (
    !name ||
    name.length > 60 ||
    !["text", "voice_direct", "voice_group"].includes(body.type ?? "")
  )
    return NextResponse.json(
      { error: "Valid name and channel type are required" },
      { status: 400 },
    );
  const [channel] = await db
    .insert(channels)
    .values({ serverId, name, type: body.type! })
    .returning();
  return NextResponse.json(channel, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  const { serverId } = await params;
  const member = session && (await membership(session.user.id, serverId));
  if (!session || member?.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json()) as { channelId?: string; name?: string };
  const name = body.name?.trim();
  if (!body.channelId || !name || name.length > 60)
    return NextResponse.json(
      { error: "Channel name must be 1-60 characters" },
      { status: 400 },
    );
  const [channel] = await db
    .update(channels)
    .set({ name })
    .where(
      and(eq(channels.id, body.channelId), eq(channels.serverId, serverId)),
    )
    .returning();
  if (!channel)
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  return NextResponse.json(channel);
}
