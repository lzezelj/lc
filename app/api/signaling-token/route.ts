import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { channels, serverMembers } from "../../../db/schema";
import { createSignalingToken } from "../../../server/signaling-auth.mjs";

export async function POST() {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Signaling authentication is not configured" },
      { status: 503 },
    );
  }
  const permittedChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
    .where(eq(serverMembers.userId, session.user.id));
  const memberships = await db
    .select({ id: serverMembers.serverId })
    .from(serverMembers)
    .where(eq(serverMembers.userId, session.user.id));
  return NextResponse.json({
    token: createSignalingToken(
      {
        id: session.user.id,
        name: session.user.name ?? "User",
        channelIds: permittedChannels.map((channel) => channel.id),
        serverIds: memberships.map((membership) => membership.id),
      },
      secret,
    ),
  });
}
