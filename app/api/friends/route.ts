import { and, eq, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { db } from "../../../db";
import { friendships, users } from "../../../db/schema";
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
  // Each direction uses the existing pair/timeline index and returns one row.
  // Do not load conversation pages merely to populate the sidebar.
  const previews = rows.some((row) => row.status === "accepted")
    ? await db.execute(sql`
        select peer.id, latest.sender_id as "senderId",
          case when latest.deleted_at is not null then 'Deleted message'
            when latest.content = '' then 'Attachment'
            else left(latest.content, 160) end as text
        from friendships f
        cross join lateral (select case when f.requester_id = ${session.user.id}::uuid then f.recipient_id else f.requester_id end as id) peer
        left join lateral (
          select * from (
            (select m.id, m.sender_id, m.content, m.deleted_at, m.created_at
             from direct_messages m where m.sender_id = ${session.user.id}::uuid and m.recipient_id = peer.id and m.kind = 'message'
             order by m.created_at desc, m.id desc limit 1)
            union all
            (select m.id, m.sender_id, m.content, m.deleted_at, m.created_at
             from direct_messages m where m.sender_id = peer.id and m.recipient_id = ${session.user.id}::uuid and m.kind = 'message'
             order by m.created_at desc, m.id desc limit 1)
          ) candidates order by created_at desc, id desc limit 1
        ) latest on true
        where f.status = 'accepted' and (f.requester_id = ${session.user.id}::uuid or f.recipient_id = ${session.user.id}::uuid)
      `)
    : { rows: [] };
  const previewById = new Map(
    (
      previews.rows as {
        id: string;
        senderId: string | null;
        text: string | null;
      }[]
    ).map((preview) => [
      preview.id,
      preview.senderId
        ? { senderId: preview.senderId, text: preview.text }
        : null,
    ]),
  );
  return NextResponse.json(
    rows.map((row) => ({
      ...byId.get(
        row.requesterId === session.user.id ? row.recipientId : row.requesterId,
      ),
      status: row.status,
      incoming: row.recipientId === session.user.id,
      lastActivityAt: row.lastActivityAt,
      lastMessage:
        row.status === "accepted"
          ? (previewById.get(
              row.requesterId === session.user.id
                ? row.recipientId
                : row.requesterId,
            ) ?? null)
          : null,
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
  if (body.action === "request" && (body.handle || body.userId)) {
    if (
      body.userId &&
      (typeof body.userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.userId,
        ))
    )
      return NextResponse.json({ error: "Invalid user" }, { status: 400 });
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        body.userId
          ? eq(users.id, body.userId)
          : eq(users.handle, normalizeUserHandle(body.handle!)),
      );
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
    await notifyUser(target.id, {
      type: "friendship-changed",
      notification: "friend-request",
      fromUserId: session.user.id,
    });
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
    await notifyUser(body.userId, {
      type: "friendship-changed",
      notification: "friend-accepted",
      fromUserId: session.user.id,
    });
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
