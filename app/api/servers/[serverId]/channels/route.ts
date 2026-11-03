import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";
import {
  checkRateLimit,
  rateLimits,
  rateLimitMessage,
} from "../../../../../server/rate-limit";
import { notifyServer } from "../../../../../server/notify-server";
import { removeChannelMedia } from "../../../../../server/remove-channel-media";

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
      {
        error: rateLimitMessage(
          "Too many server changes.",
          rateLimit.retryAfterSeconds,
        ),
      },
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
  await notifyServer(serverId);
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
  void notifyServer(serverId);
  return NextResponse.json(channel);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  const { serverId } = await params;
  const member = session && (await membership(session.user.id, serverId));
  if (!session || member?.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limit = checkRateLimit(
    `server-mutation:${session.user.id}`,
    rateLimits.serverMutation,
  );
  if (!limit.allowed)
    return NextResponse.json(
      {
        error: rateLimitMessage(
          "Too many server changes.",
          limit.retryAfterSeconds,
        ),
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  const body = (await request.json().catch(() => null)) as {
    channelId?: string;
  } | null;
  if (
    typeof body?.channelId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.channelId,
    )
  )
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  const [channel] = await db
    .delete(channels)
    .where(
      and(eq(channels.id, body.channelId), eq(channels.serverId, serverId)),
    )
    .returning();
  if (!channel)
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  await removeChannelMedia(serverId, channel.id, channel.type);
  await notifyServer(serverId);
  return NextResponse.json({ id: channel.id });
}
