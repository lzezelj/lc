import { eq } from "drizzle-orm";
import { ownerSession } from "../../../../server/owner";
import { validAdminId } from "../../../../server/admin-read";
import { attachmentRange } from "../../../../server/attachment-range";
import { db } from "../../../../db";
import {
  userAvatars,
  messageAttachments,
  messages,
  directMessages,
} from "../../../../db/schema";

export async function GET(request: Request) {
  if (!(await ownerSession())) return new Response(null, { status: 403 });
  const query = new URL(request.url).searchParams,
    id = query.get("id");
  if (!validAdminId(id)) return new Response(null, { status: 400 });
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (query.get("kind") === "avatar") {
    const [avatar] = await db
      .select({ data: userAvatars.data })
      .from(userAvatars)
      .where(eq(userAvatars.userId, id));
    return avatar
      ? new Response(new Uint8Array(avatar.data), {
          headers: { ...headers, "Content-Type": "image/png" },
        })
      : new Response(null, { status: 404 });
  }
  const [attachment] = await db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.id, id));
  if (!attachment) return new Response(null, { status: 404 });
  const [message] = attachment.messageId
    ? await db
        .select({
          attachments: messages.attachments,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .where(eq(messages.id, attachment.messageId))
    : attachment.directMessageId
      ? await db
          .select({
            attachments: directMessages.attachments,
            deletedAt: directMessages.deletedAt,
          })
          .from(directMessages)
          .where(eq(directMessages.id, attachment.directMessageId))
      : [];
  const file =
    !message?.deletedAt && message?.attachments.find((item) => item.id === id);
  if (!file || file.expired) return new Response(null, { status: 404 });
  const rangeHeader = request.headers.get("range"),
    range = rangeHeader
      ? attachmentRange(rangeHeader, attachment.data.length)
      : null;
  if (rangeHeader && !range)
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${attachment.data.length}`,
      },
    });
  const bytes = range
    ? attachment.data.subarray(range.start, range.end + 1)
    : attachment.data;
  return new Response(new Uint8Array(bytes), {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Type": file.type,
      "Content-Length": String(bytes.length),
      "Accept-Ranges": "bytes",
      ...(range
        ? {
            "Content-Range": `bytes ${range.start}-${range.end}/${attachment.data.length}`,
          }
        : {}),
      "Content-Disposition": `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
    },
  });
}
