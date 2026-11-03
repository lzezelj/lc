export type IncomingCall = {
  fromUserId: string;
  fromName: string;
  roomId: string;
};

export function friendCallRoom(userId: string, otherId: string) {
  return `friend:${[userId, otherId].sort().join(":")}`;
}

export function isFriendCall(roomId: string | null | undefined) {
  const parts = roomId?.split(":");
  return (
    parts?.length === 3 &&
    parts[0] === "friend" &&
    Boolean(parts[1] && parts[2])
  );
}

export function conversationHasCall(
  roomId: string | undefined,
  userId: string | undefined,
  otherId: string | undefined,
) {
  return Boolean(
    userId && otherId && roomId === friendCallRoom(userId, otherId),
  );
}

export function incomingCallMatches(
  call: IncomingCall | null,
  event: { fromUserId?: string; roomId?: string },
) {
  return Boolean(
    call &&
    call.fromUserId === event.fromUserId &&
    call.roomId === event.roomId,
  );
}

export function incomingCallLocation(
  status: string,
  call: IncomingCall | null,
  conversationUserId?: string,
) {
  if (!call) return "hidden";
  if (call.fromUserId === conversationUserId) return "conversation";
  return status === "dnd" ? "hidden" : "popup";
}
