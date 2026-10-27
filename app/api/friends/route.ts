import { and, desc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { directMessages, friendships, users } from "../../../db/schema";
import { notifyUser } from "../../../server/notify-user";
import { normalizeUserHandle } from "../../../user-handle";

export async function GET() {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db
    .select()
    .from(friendships)
    .where(
      or(
        eq(friendships.requesterId, session.user.id),
        eq(friendships.recipientId, session.user.id),
      ),
    );
  const ids = rows.map((row) =>
    row.requesterId === session.user.id ? row.recipientId : row.requesterId,
  );
  const people = ids.length
    ? await db
        .select({
          id: users.id,
          name: users.name,
          handle: users.handle,
          image: users.image,
        })
        .from(users)
        .where(or(...ids.map((id) => eq(users.id, id))))
    : [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const messageRows = ids.length
    ? await db
        .select({
          senderId: directMessages.senderId,
          recipientId: directMessages.recipientId,
          text: directMessages.content,
          kind: directMessages.kind,
          deletedAt: directMessages.deletedAt,
          createdAt: directMessages.createdAt,
        })
        .from(directMessages)
        .where(
          or(
            eq(directMessages.senderId, session.user.id),
            eq(directMessages.recipientId, session.user.id),
          ),
        )
        .orderBy(desc(directMessages.createdAt))
    : [];
  const latestByFriend = new Map<
    string,
    { text: string; kind: string; createdAt: Date }
  >();
  for (const message of messageRows) {
    const friendId =
      message.senderId === session.user.id
        ? message.recipientId
        : message.senderId;
    if (!latestByFriend.has(friendId))
      latestByFriend.set(friendId, {
        ...message,
        text: message.deletedAt ? "Deleted message" : message.text,
      });
  }
  return NextResponse.json(
    rows.map((row) => ({
      ...byId.get(
        row.requesterId === session.user.id ? row.recipientId : row.requesterId,
      ),
      status: row.status,
      incoming: row.recipientId === session.user.id,
      lastActivityAt: row.lastActivityAt,
      lastMessage:
        latestByFriend.get(
          row.requesterId === session.user.id
            ? row.recipientId
            : row.requesterId,
        ) ?? null,
    })),
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session || session.user.role === "demo")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json()) as {
    handle?: string;
    userId?: string;
    action?: "request" | "accept" | "decline" | "activity";
  };
  if (body.action === "request" && body.handle) {
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, normalizeUserHandle(body.handle)));
    if (!target || target.id === session.user.id)
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    const [existing] = await db
      .select()
      .from(friendships)
      .where(
        or(
          and(
            eq(friendships.requesterId, session.user.id),
            eq(friendships.recipientId, target.id),
          ),
          and(
            eq(friendships.requesterId, target.id),
            eq(friendships.recipientId, session.user.id),
          ),
        ),
      );
    if (existing)
      return NextResponse.json(
        { error: "Friendship already exists" },
        { status: 409 },
      );
    await db
      .insert(friendships)
      .values({ requesterId: session.user.id, recipientId: target.id });
    await notifyUser(target.id, { type: "friendship-changed" });
    return NextResponse.json({ id: target.id }, { status: 201 });
  }
  if (!body.userId || !body.action)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (body.action === "activity") {
    const [updated] = await db
      .update(friendships)
      .set({ lastActivityAt: new Date() })
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            and(
              eq(friendships.requesterId, session.user.id),
              eq(friendships.recipientId, body.userId),
            ),
            and(
              eq(friendships.requesterId, body.userId),
              eq(friendships.recipientId, session.user.id),
            ),
          ),
        ),
      )
      .returning({ lastActivityAt: friendships.lastActivityAt });
    if (!updated)
      return NextResponse.json({ error: "Friend not found" }, { status: 404 });
    return NextResponse.json(updated);
  }
  if (body.action === "accept") {
    const [accepted] = await db
      .update(friendships)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(
        and(
          eq(friendships.requesterId, body.userId),
          eq(friendships.recipientId, session.user.id),
          eq(friendships.status, "pending"),
        ),
      )
      .returning();
    if (!accepted)
      return NextResponse.json(
        { error: "Friend request not found" },
        { status: 404 },
      );
    await notifyUser(body.userId, { type: "friendship-changed" });
    return NextResponse.json({ id: body.userId, status: "accepted" });
  }
  if (body.action === "decline") {
    await db
      .delete(friendships)
      .where(
        and(
          eq(friendships.requesterId, body.userId),
          eq(friendships.recipientId, session.user.id),
          eq(friendships.status, "pending"),
        ),
      );
    await notifyUser(body.userId, { type: "friendship-changed" });
    return NextResponse.json({ id: body.userId });
  }
  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}
