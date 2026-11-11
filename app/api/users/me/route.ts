import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import {
  accounts,
  channels,
  directMessages,
  friendships,
  messages,
  serverMembers,
  servers,
  sessions,
  users,
} from "../../../../db/schema";
import { disconnectUserEverywhere } from "../../../../server/disconnect-user";
import { notifyMessageRemovals } from "../../../../server/message-removals";
import { notifyServer } from "../../../../server/notify-server";
import { notifyUser } from "../../../../server/notify-user";
import { profileAudience } from "../../../../server/profile-pictures";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 60)
    return NextResponse.json(
      { error: "Username must be 1-60 characters" },
      { status: 400 },
    );
  const [user] = await db
    .update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id, name: users.name });
  await Promise.allSettled(
    [...(await profileAudience(session.user.id))].map((recipient) =>
      notifyUser(recipient, {
        type: "profile-updated",
        userId: user.id,
        name: user.name,
      }),
    ),
  );
  return NextResponse.json(user);
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    confirm?: string;
    deleteMessages?: boolean;
  } | null;
  if (body?.confirm !== "DELETE" || typeof body.deleteMessages !== "boolean")
    return NextResponse.json(
      {
        error:
          "Confirm account deletion and choose whether to delete messages.",
      },
      { status: 400 },
    );
  const userId = session.user.id;
  try {
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      const owned = await tx
        .select({ id: servers.id })
        .from(servers)
        .where(eq(servers.createdBy, userId))
        .limit(1);
      if (owned.length) throw new Error("owned-servers");
      const memberships = await tx
        .select({ serverId: serverMembers.serverId })
        .from(serverMembers)
        .where(eq(serverMembers.userId, userId));
      const rooms = await tx
        .select({ id: channels.id })
        .from(channels)
        .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
        .where(
          and(
            eq(serverMembers.userId, userId),
            eq(channels.type, "voice_group"),
          ),
        );
      const channelRows = body.deleteMessages
        ? await tx
            .delete(messages)
            .where(eq(messages.authorId, userId))
            .returning({ id: messages.id, channelId: messages.channelId })
        : [];
      const directRows = body.deleteMessages
        ? await tx
            .delete(directMessages)
            .where(eq(directMessages.senderId, userId))
            .returning({
              id: directMessages.id,
              recipientId: directMessages.recipientId,
            })
        : [];
      await tx.delete(accounts).where(eq(accounts.userId, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      const removedFriends = await tx
        .delete(friendships)
        .where(
          or(
            eq(friendships.requesterId, userId),
            eq(friendships.recipientId, userId),
          ),
        )
        .returning({
          requesterId: friendships.requesterId,
          recipientId: friendships.recipientId,
        });
      await tx.delete(serverMembers).where(eq(serverMembers.userId, userId));
      await tx
        .update(users)
        .set({
          name: "Deleted user",
          handle: null,
          email: null,
          emailVerified: null,
          image: null,
          createdBy: null,
          disabledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      return { memberships, rooms, channelRows, directRows, removedFriends };
    });
    await Promise.allSettled([
      disconnectUserEverywhere(
        userId,
        result.rooms.map((room) => room.id),
      ),
      notifyMessageRemovals(userId, result.channelRows, result.directRows),
      ...result.removedFriends.map((friend) =>
        notifyUser(
          friend.requesterId === userId
            ? friend.recipientId
            : friend.requesterId,
          { type: "friendship-changed" },
        ),
      ),
      ...result.memberships.map((member) => notifyServer(member.serverId)),
    ]);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof Error && error.message === "owned-servers")
      return NextResponse.json(
        {
          error:
            "Transfer or delete the servers you own before deleting your account.",
        },
        { status: 409 },
      );
    throw error;
  }
}
