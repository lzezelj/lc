import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { channels, messages, serverMembers } from "../../../db/schema";

export async function GET() {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const activity = await db
    .selectDistinctOn([channels.id], {
      id: channels.id,
      serverId: channels.serverId,
      type: channels.type,
      latestMessageId: messages.id,
      latestMessageAt: messages.createdAt,
    })
    .from(channels)
    .innerJoin(
      serverMembers,
      and(
        eq(serverMembers.serverId, channels.serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    )
    .leftJoin(
      messages,
      and(
        eq(messages.channelId, channels.id),
        ne(messages.authorId, session.user.id),
        isNull(messages.deletedAt),
      ),
    )
    .orderBy(channels.id, desc(messages.createdAt), desc(messages.id));
  return NextResponse.json(activity, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
