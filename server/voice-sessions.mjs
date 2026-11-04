import { RoomServiceClient } from "livekit-server-sdk";

// LiveKit identities retain the account prefix used by moderation APIs.
export async function removeAccountGroupMedia(userId, keepSessionId) {
  const url = process.env.LIVEKIT_INTERNAL_URL ?? process.env.LIVEKIT_URL;
  if (!url) return;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error("Group media server is not configured");
  const client = new RoomServiceClient(
    url.replace(/^ws/, "http"),
    key,
    secret,
    {
      requestTimeout: 2,
      failover: false,
    },
  );
  const rooms = await client.listRooms();
  await finishAll(
    rooms.map(async (room) => {
      const participants = await client.listParticipants(room.name);
      await finishAll(
        participants
          .filter(
            (person) =>
              person.identity.startsWith(`${userId}:`) &&
              person.identity !== `${userId}:${keepSessionId}`,
          )
          .map((person) =>
            client.removeParticipant(room.name, person.identity),
          ),
      );
    }),
  );
}

async function finishAll(operations) {
  const results = await Promise.allSettled(operations);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}

export function createVoiceSessions({ removeGroupMedia, onReplace }) {
  const sessions = new Map();
  const operations = new Map();

  function claim(userId, session, isValid = () => true) {
    const operation = (operations.get(userId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!isValid()) return false;
        const previous = sessions.get(userId);
        if (previous?.id === session.id) {
          if (
            previous.roomId !== session.roomId ||
            previous.kind !== session.kind
          )
            return false;
          if (session.kind === "direct") {
            if (previous.socket?.readyState === 1 && !session.reconnecting)
              return false;
            clearTimeout(previous.timer);
            if (previous.socket !== session.socket)
              onReplace(userId, previous, session);
            sessions.set(userId, session);
          }
          return true;
        }
        // Finish media removal before admitting another transport or room.
        // Also finds orphaned SFU sessions after a signaling restart.
        await removeGroupMedia(
          userId,
          session.kind === "group" ? session.id : undefined,
        );
        if (!isValid()) return false;
        if (previous) {
          clearTimeout(previous.timer);
          onReplace(userId, previous, session);
        }
        sessions.set(userId, session);
        if (session.kind === "group") {
          session.timer = setTimeout(() => release(userId, session.id), 35_000);
          session.timer.unref();
        }
        return true;
      });
    operations.set(userId, operation);
    void operation
      .finally(() => {
        if (operations.get(userId) === operation) operations.delete(userId);
      })
      .catch(() => {});
    return operation;
  }

  function confirm(userId, id) {
    const session = sessions.get(userId);
    if (!session || session.id !== id) return false;
    clearTimeout(session.timer);
    return true;
  }

  function release(userId, id) {
    const session = sessions.get(userId);
    if (!session || session.id !== id) return;
    clearTimeout(session.timer);
    sessions.delete(userId);
  }

  function suspend(userId, id, socket) {
    const session = sessions.get(userId);
    if (!session || session.id !== id) return;
    if (socket && session.socket !== socket) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => release(userId, id), 35_000);
    session.timer.unref();
  }

  return { claim, confirm, release, suspend };
}
