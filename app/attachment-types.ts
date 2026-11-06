export type MessageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
};
export const attachmentMaxBytes = 10 * 1024 * 1024;
export const attachmentMaxCount = 20;
export const attachmentMaxTotalBytes = 40 * 1024 * 1024;
export const attachmentAccept =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf";
