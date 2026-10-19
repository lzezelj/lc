import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import {
  channels,
  messages,
  serverMembers,
  users,
} from "../../../../../db/schema";

async function canAccess(userId: string, channelId: string) {
  const [result] = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
    .where(and(eq(channels.id, channelId), eq(serverMembers.userId, userId)));
  return Boolean(result);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  const { channelId } = await params;
  if (!session || !(await canAccess(session.user.id, channelId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await db
    .select({
      id: messages.id,
      text: messages.content,
      createdAt: messages.createdAt,
      author: users.name,
      authorId: users.id,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.channelId, channelId))
    .orderBy(desc(messages.createdAt))
    .limit(100);
  return NextResponse.json(result.reverse());
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  const { channelId } = await params;
  if (!session || !(await canAccess(session.user.id, channelId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text || text.length > 4000)
    return NextResponse.json(
      { error: "Message must be 1-4000 characters" },
      { status: 400 },
    );
  const [message] = await db
    .insert(messages)
    .values({ channelId, authorId: session.user.id, content: text })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  return NextResponse.json(
    {
      ...message,
      text,
      author: session.user.name ?? "User",
      authorId: session.user.id,
    },
    { status: 201 },
  );
}
