import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { friendships, serverMembers } from "../db/schema";
import { notifyUser } from "./notify-user";

export const avatarMaxBytes = 512 * 1024;
export function validAvatar(data: Buffer) {
  return (
    data.length >= 33 &&
    data.length <= avatarMaxBytes &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.readUInt32BE(8) === 13 &&
    data.toString("ascii", 12, 16) === "IHDR" &&
    data.readUInt32BE(16) > 0 &&
    data.readUInt32BE(16) <= 512 &&
    data.readUInt32BE(20) > 0 &&
    data.readUInt32BE(20) <= 512
  );
}
export function avatarUrl(userId: string) {
  return `/api/users/${userId}/avatar?v=${randomUUID()}`;
}
export async function readAvatar(request: Request): Promise<Buffer | Response> {
  if (request.headers.get("content-type")?.split(";")[0] !== "image/png")
    return Response.json(
      { error: "Choose an image using the profile picture picker." },
      { status: 415 },
    );
  if (Number(request.headers.get("content-length")) > avatarMaxBytes)
    return Response.json(
      { error: "Profile picture is too large." },
      { status: 413 },
    );
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json(
      { error: "Choose a profile picture." },
      { status: 400 },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > avatarMaxBytes) {
      await reader.cancel();
      return Response.json(
        { error: "Profile picture is too large." },
        { status: 413 },
      );
    }
    chunks.push(chunk.value);
  }
  const data = Buffer.concat(chunks);
  return validAvatar(data)
    ? data
    : Response.json(
        { error: "Choose a PNG picture up to 512 × 512 pixels." },
        { status: 400 },
      );
}
export async function profileAudience(userId: string) {
  const [memberships, friends] = await Promise.all([
    db
      .select({ serverId: serverMembers.serverId })
      .from(serverMembers)
      .where(eq(serverMembers.userId, userId)),
    db
      .select({
        requesterId: friendships.requesterId,
        recipientId: friendships.recipientId,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            eq(friendships.requesterId, userId),
            eq(friendships.recipientId, userId),
          ),
        ),
      ),
  ]);
  const peers = memberships.length
    ? await db
        .select({ userId: serverMembers.userId })
        .from(serverMembers)
        .where(
          inArray(
            serverMembers.serverId,
            memberships.map((member) => member.serverId),
          ),
        )
    : [];
  return new Set([
    userId,
    ...peers.map((peer) => peer.userId),
    ...friends.map((friend) =>
      friend.requesterId === userId ? friend.recipientId : friend.requesterId,
    ),
  ]);
}
export async function notifyProfilePicture(
  userId: string,
  image: string | null,
) {
  await Promise.allSettled(
    [...(await profileAudience(userId))].map((recipient) =>
      notifyUser(recipient, { type: "profile-updated", userId, image }),
    ),
  );
}
