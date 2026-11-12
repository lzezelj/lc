type SequenceMessage = {
  id: string;
  authorId: string;
  kind?: string;
  deleted?: boolean;
  replyTo?: unknown;
  sentAt?: number;
};

export function messageSequences(
  messages: SequenceMessage[],
  firstUnreadId?: string | null,
) {
  const joins = (
    previous: SequenceMessage | undefined,
    current: SequenceMessage | undefined,
  ) =>
    Boolean(
      previous &&
      current &&
      previous.authorId === current.authorId &&
      !previous.deleted &&
      !current.deleted &&
      previous.kind !== "call" &&
      current.kind !== "call" &&
      !current.replyTo &&
      current.id !== firstUnreadId,
    );
  return new Map(
    messages.map((message, index) => [
      message.id,
      {
        continuation: joins(messages[index - 1], message),
        continues: joins(message, messages[index + 1]),
      },
    ]),
  );
}

export function repeatedMessageTimes(
  messages: SequenceMessage[],
  firstUnreadId?: string | null,
) {
  const groups = messageSequences(messages, firstUnreadId);
  return new Map(
    messages.map((message, index) => {
      const previous = messages[index - 1];
      return [
        message.id,
        Boolean(
          groups.get(message.id)?.continuation &&
          Number.isFinite(message.sentAt) &&
          Number.isFinite(previous?.sentAt) &&
          Math.floor(message.sentAt! / 60000) ===
            Math.floor(previous.sentAt! / 60000),
        ),
      ];
    }),
  );
}
