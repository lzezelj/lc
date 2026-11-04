import { and, eq } from "drizzle-orm";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import {
  channels,
  directMessages,
  messageAttachments,
  messages,
  serverMembers,
} from "../../../../db/schema";
import { areFriends } from "../../../../server/friends";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { attachmentId } = await params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(attachmentId))
    return Response.json({ error: "Not found" }, { status: 404 });
  const [row] = await db
    .select({
      messageId: messageAttachments.messageId,
      directMessageId: messageAttachments.directMessageId,
    })
    .from(messageAttachments)
    .where(eq(messageAttachments.id, attachmentId));
  let metadata;
  if (row?.messageId) {
    const [message] = await db
      .select({
        attachments: messages.attachments,
        deletedAt: messages.deletedAt,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(serverMembers, eq(serverMembers.serverId, channels.serverId))
      .where(
        and(
          eq(messages.id, row.messageId),
          eq(serverMembers.userId, session.user.id),
        ),
      );
    if (message && !message.deletedAt)
      metadata = message.attachments.find((file) => file.id === attachmentId);
  } else if (row?.directMessageId) {
    const [message] = await db
      .select()
      .from(directMessages)
      .where(eq(directMessages.id, row.directMessageId));
    if (
      message &&
      !message.deletedAt &&
      (message.senderId === session.user.id ||
        message.recipientId === session.user.id)
    ) {
      const otherId =
        message.senderId === session.user.id
          ? message.recipientId
          : message.senderId;
      if (await areFriends(session.user.id, otherId))
        metadata = message.attachments.find((file) => file.id === attachmentId);
    }
  }
  if (!metadata) return Response.json({ error: "Not found" }, { status: 404 });
  const [file] = await db
    .select({ data: messageAttachments.data })
    .from(messageAttachments)
    .where(eq(messageAttachments.id, attachmentId));
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  const inline =
    metadata.type.startsWith("image/") &&
    !new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": metadata.type,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(metadata.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
