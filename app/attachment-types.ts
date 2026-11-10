export type MessageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  expired?: boolean;
};
export function messageDeletionPreview(message: {
  text: string;
  attachments?: MessageAttachment[];
}) {
  return (
    [
      message.text.trim(),
      ...(message.attachments?.map((file) => file.name) ?? []),
    ]
      .filter(Boolean)
      .join("\n") || "Message"
  );
}
export const attachmentMaxBytes = 10 * 1024 * 1024;
export const attachmentVideoMaxBytes = 25 * 1024 * 1024;
export function attachmentLimit(type: string) {
  return type.startsWith("video/")
    ? attachmentVideoMaxBytes
    : attachmentMaxBytes;
}
export const attachmentMaxCount = 20;
export const attachmentMaxTotalBytes = 40 * 1024 * 1024;
export const attachmentAccept =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf,video/mp4,video/webm";
