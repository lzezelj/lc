export type MessageEdit = {
  id: string;
  text: string;
  editedAt: string;
  mentions?: import("./notification-types").Mention[];
};

export function applyMessageRemoval<
  T extends {
    id: string;
    text: string;
    deleted?: boolean;
    attachments?: unknown[];
    replyTo?: { id: string; text: string } | null;
  },
>(messages: T[], id: string, permanent: boolean): T[] {
  return messages
    .filter((message) => !permanent || message.id !== id)
    .map((message) =>
      message.id === id
        ? {
            ...message,
            text: "Deleted message",
            deleted: true,
            attachments: [],
            mentions: [],
          }
        : message.replyTo?.id === id
          ? {
              ...message,
              replyTo: permanent
                ? null
                : { ...message.replyTo, text: "Deleted message" },
            }
          : message,
    );
}

export function applyMessageEdit<
  T extends {
    id: string;
    text: string;
    deleted?: boolean;
    editedAt?: string | null;
    replyTo?: { id: string; text: string } | null;
  },
>(messages: T[], edit: MessageEdit): T[] {
  if (!Number.isFinite(Date.parse(edit.editedAt))) return messages;
  const current = messages.find((message) => message.id === edit.id);
  if (
    current?.deleted ||
    (current?.editedAt &&
      Date.parse(current.editedAt) > Date.parse(edit.editedAt))
  )
    return messages;
  return messages.map((message) => {
    if (message.id === edit.id) {
      if (
        message.deleted ||
        (message.editedAt &&
          Date.parse(message.editedAt) > Date.parse(edit.editedAt))
      )
        return message;
      return {
        ...message,
        text: edit.text,
        editedAt: edit.editedAt,
        ...(edit.mentions ? { mentions: edit.mentions } : {}),
      };
    }
    return message.replyTo?.id === edit.id
      ? {
          ...message,
          replyTo: { ...message.replyTo, text: edit.text || "Attachment" },
        }
      : message;
  });
}
