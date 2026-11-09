import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { messageAttachments, users } from "../db/schema";
import { notifyUser } from "./notify-user";
import {
  attachmentVideoMaxBytes,
  attachmentLimit,
  attachmentMaxCount,
  attachmentMaxTotalBytes,
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
const maxRequestBytes = attachmentMaxTotalBytes + 64 * 1024;
export const attachmentQuotaBytes = 100 * 1024 * 1024;
export const attachmentGlobalCapBytes = 2 * 1024 * 1024 * 1024;

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
  // Recognize MP4 brands, excluding other ISO BMFF formats such as AVIF/HEIC.
  if (data.length >= 16 && data.toString("ascii", 4, 8) === "ftyp") {
    const size = data.readUInt32BE(0);
    const brands = new Set([
      "isom",
      "iso2",
      "iso3",
      "iso4",
      "iso5",
      "iso6",
      "mp41",
      "mp42",
      "avc1",
      "M4V ",
      "MSNV",
    ]);
    if (
      size >= 16 &&
      size <= data.length &&
      (size - 16) % 4 === 0 &&
      brands.has(data.toString("ascii", 8, 12))
    )
      return "video/mp4";
  }
  // Read the bounded EBML header and its DocType, rather than trusting an extension.
  if (data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    const vint = (offset: number, keepMarker = false) => {
      const first = data[offset];
      if (!first) return null;
      let mask = 0x80,
        width = 1;
      while (!(first & mask) && width <= 8) {
        mask >>= 1;
        width++;
      }
      if (width > (keepMarker ? 4 : 8) || offset + width > data.length)
        return null;
      let value = keepMarker ? first : first & (mask - 1);
      for (let index = 1; index < width; index++)
        value = value * 256 + data[offset + index];
      return Number.isSafeInteger(value) ? { width, value } : null;
    };
    const header = vint(4);
    if (header && header.value <= 4096) {
      const end = 4 + header.width + header.value;
      if (end <= data.length)
        for (let offset = 4 + header.width; offset < end;) {
          const id = vint(offset, true);
          if (!id) break;
          const size = vint(offset + id.width);
          if (!size) break;
          const start = offset + id.width + size.width;
          if (start + size.value > end) break;
          if (
            id.value === 0x4282 &&
            size.value === 4 &&
            data.toString("ascii", start, start + 4) === "webm"
          )
            return "video/webm";
          offset = start + size.value;
        }
    }
  }
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
        { error: `Attach up to ${attachmentMaxCount} files per message.` },
        { status: 400 },
      );
    const uploads: Upload[] = [];
    for (const file of files) {
      if (
        typeof file === "string" ||
        file.size === 0 ||
        file.size > attachmentVideoMaxBytes
      )
        return Response.json(
          { error: "Images/PDFs must be 1 byte–10 MiB; videos up to 25 MiB." },
          { status: 400 },
        );
      const data = Buffer.from(await file.arrayBuffer());
      const type = attachmentMime(data);
      if (!type)
        return Response.json(
          {
            error:
              "Supported attachments: PNG, JPEG, GIF, WebP, PDF, MP4 and WebM.",
          },
          { status: 400 },
        );
      if (file.size > attachmentLimit(type))
        return Response.json(
          { error: "Images/PDFs are limited to 10 MiB; videos to 25 MiB." },
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
    if (
      uploads.reduce((bytes, file) => bytes + file.data.length, 0) >
      attachmentMaxTotalBytes
    )
      return Response.json(
        { error: "Attach up to 40 MB in total per message." },
        { status: 413 },
      );
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
  let recipients: string[] = [];
  try {
    const result = await db.transaction(async (tx) => {
      if (files.length) {
        const reserved = await tx.execute(
          sql`SELECT lc_attachment_budget(${files.reduce((total, file) => total + file.data.length, 0)}) AS recipients`,
        );
        recipients = (reserved.rows[0]?.recipients ?? []) as string[];
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
      if (files.length) {
        const usage = await tx.execute(
          sql`SELECT coalesce(sum(octet_length(data)), 0)::bigint AS bytes FROM message_attachments`,
        );
        if (Number(usage.rows[0]?.bytes ?? 0) >= attachmentGlobalCapBytes * 0.8)
          return {
            ...message,
            attachmentStorageWarning:
              "Attachment storage is over 80% full. Files older than 30 days may expire when space is needed.",
          };
      }
      return message;
    });
    await Promise.allSettled(
      recipients.map((userId) =>
        notifyUser(userId, { type: "attachments-expired" }),
      ),
    );
    if (!(result instanceof Response) && "attachmentStorageWarning" in result)
      await notifyUser(userId, { type: "attachment-storage-warning" });
    return result;
  } catch (error) {
    let cause: unknown = error;
    for (
      let depth = 0;
      depth < 5 && cause && typeof cause === "object";
      depth++
    ) {
      const details = cause as {
        code?: string;
        message?: string;
        cause?: unknown;
      };
      if (
        details.code === "P0001" &&
        details.message === "LC_ATTACHMENT_STORAGE_FULL"
      )
        return Response.json(
          {
            error:
              "Global attachment storage is full (2 GiB). No files older than 30 days can be removed to make enough room. Try again after space is freed.",
          },
          { status: 413 },
        );
      cause = details.cause;
    }
    throw error;
  }
}
