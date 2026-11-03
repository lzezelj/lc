import { notifyUser } from "./notify-user";

export async function notifyMessageRemovals(
  userId: string,
  channelMessages: { id: string; channelId: string }[],
  direct: { id: string; recipientId: string }[],
) {
  const url = process.env.SIGNALING_INTERNAL_URL ?? "http://localhost:3001";
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  await Promise.allSettled([
    ...channelMessages.map((message) =>
      secret
        ? fetch(`${url}/internal/message-deleted`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channelId: message.channelId,
              messageId: message.id,
              permanent: true,
            }),
          })
        : Promise.resolve(),
    ),
    ...direct.flatMap((message) => [
      notifyUser(message.recipientId, {
        type: "direct-message-deleted",
        fromUserId: userId,
        messageId: message.id,
        permanent: true,
      }),
      notifyUser(userId, {
        type: "direct-message-deleted",
        fromUserId: message.recipientId,
        messageId: message.id,
        permanent: true,
      }),
    ]),
  ]);
}
