import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { channels, serverMembers } from "../../../../../db/schema";

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
