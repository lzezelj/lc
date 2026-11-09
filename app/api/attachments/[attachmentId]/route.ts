import { and, eq, sql } from "drizzle-orm";
import { attachmentRange } from "../../../../server/attachment-range";
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
  if (!metadata || metadata.expired)
    return Response.json({ error: "Not found" }, { status: 404 });
  const video = metadata.type.startsWith("video/");
  const rangeHeader = video ? request.headers.get("range") : null;
  const range = rangeHeader
    ? attachmentRange(rangeHeader, metadata.size)
    : null;
  if (rangeHeader && !range)
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${metadata.size}`,
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
      },
    });
  const [file] = await db
    .select({
      data: range
        ? sql<Buffer>`substring(${messageAttachments.data} from ${range.start + 1} for ${range.end - range.start + 1})`
        : messageAttachments.data,
    })
    .from(messageAttachments)
    .where(eq(messageAttachments.id, attachmentId));
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  const inline =
    (metadata.type.startsWith("image/") || video) &&
    !new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(file.data), {
    status: range ? 206 : 200,
    headers: {
      ...(video ? { "Accept-Ranges": "bytes" } : {}),
      ...(range
        ? {
            "Content-Range": `bytes ${range.start}-${range.end}/${metadata.size}`,
          }
        : {}),
      "Content-Type": metadata.type,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(metadata.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
