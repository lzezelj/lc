import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { messageAttachments, users } from "../db/schema";
import {
  attachmentMaxBytes,
  attachmentMaxCount,
  type MessageAttachment,
} from "../app/attachment-types";

type Upload = { metadata: MessageAttachment; data: Buffer };
type MessageBody = {
  text?: string;
  replyToId?: string;
  event?: "call-ended" | "call-declined" | "user-unavailable";
  durationSeconds?: number;
  files: Upload[];
};
const maxRequestBytes = attachmentMaxBytes * attachmentMaxCount + 64 * 1024;
export const attachmentQuotaBytes = 100 * 1024 * 1024;

export function attachmentMime(data: Buffer) {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6)))
    return "image/gif";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (data.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export async function readMessageRequest(
  request: Request,
): Promise<MessageBody | Response> {
  try {
    const multipart = request.headers
      .get("content-type")
      ?.startsWith("multipart/form-data");
    const limit = multipart ? maxRequestBytes : 64 * 1024;
    if (Number(request.headers.get("content-length")) > limit)
      return Response.json(
        { error: "Message upload is too large." },
        { status: 413 },
      );
    // Enforce the bound even for chunked requests before parsing multipart data.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return Response.json(
            { error: "Message upload is too large." },
            { status: 413 },
          );
        }
        chunks.push(next.value);
      }
    }
    const bytes = Buffer.concat(chunks);
    if (!multipart) {
      const body = JSON.parse(bytes.toString("utf8"));
      if (
        !body ||
        typeof body !== "object" ||
        (body.text !== undefined && typeof body.text !== "string") ||
        (body.replyToId !== undefined && typeof body.replyToId !== "string")
      )
        throw new Error("Invalid message");
      return { ...body, files: [] };
    }
    const form = await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
    const files = form.getAll("files");
    if (files.length > attachmentMaxCount)
      return Response.json(
        { error: "Attach up to four files per message." },
        { status: 400 },
      );
    const uploads: Upload[] = [];
    for (const file of files) {
      if (
        typeof file === "string" ||
        file.size === 0 ||
        file.size > attachmentMaxBytes
      )
        return Response.json(
          { error: "Each file must be between 1 byte and 10 MB." },
          { status: 400 },
        );
      const data = Buffer.from(await file.arrayBuffer());
      const type = attachmentMime(data);
      if (!type)
        return Response.json(
          { error: "Supported attachments: PNG, JPEG, GIF, WebP and PDF." },
          { status: 400 },
        );
      const name =
        file.name
          .replaceAll("\\", "/")
          .split("/")
          .at(-1)!
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .slice(0, 180) || "Attachment";
      uploads.push({
        data,
        metadata: { id: randomUUID(), name, type, size: data.length },
      });
    }
    const text = form.get("text");
    const replyToId = form.get("replyToId");
    if (
      (text !== null && typeof text !== "string") ||
      (replyToId !== null && typeof replyToId !== "string")
    )
      throw new Error("Invalid message");
    return {
      text: text ?? "",
      replyToId: replyToId || undefined,
      files: uploads,
    };
  } catch {
    return Response.json({ error: "Invalid message upload." }, { status: 400 });
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function saveAttachedMessage(
  userId: string,
  files: Upload[],
  direct: boolean,
  create: (
    connection: typeof db | Transaction,
    attachments: MessageAttachment[],
  ) => Promise<{ id: string; createdAt: Date }>,
  afterSave?: (
    connection: Transaction,
    message: { id: string; createdAt: Date },
  ) => Promise<void>,
) {
  if (!files.length && !afterSave) return create(db, []);
  return db.transaction(async (tx) => {
    if (files.length) {
      // Serialize account uploads across both message types so quota checks cannot race.
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        // Allow foreign-key key-share locks from incoming DMs while serializing uploads.
        .for("no key update");
      const [usage] = await tx
        .select({
          bytes: sql<number>`coalesce(sum(octet_length(${messageAttachments.data})), 0)::bigint`,
        })
        .from(messageAttachments)
        .where(eq(messageAttachments.uploaderId, userId));
      if (
        Number(usage.bytes) +
          files.reduce((total, file) => total + file.data.length, 0) >
        attachmentQuotaBytes
      )
        return Response.json(
          {
            error:
              "Your 100 MB attachment quota is full. Delete messages with attachments to free space.",
          },
          { status: 413 },
        );
    }
    const message = await create(
      tx,
      files.map((file) => file.metadata),
    );
    if (files.length)
      await tx.insert(messageAttachments).values(
        files.map((file) => ({
          id: file.metadata.id,
          uploaderId: userId,
          messageId: direct ? null : message.id,
          directMessageId: direct ? message.id : null,
          data: file.data,
        })),
      );
    await afterSave?.(tx, message);
    return message;
  });
}
