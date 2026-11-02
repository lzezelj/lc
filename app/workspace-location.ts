export type WorkspaceLocation = {
  view: "friends" | "server";
  serverId: string;
  channelId: string;
  friendId: string;
  friendTab: "online" | "offline" | "pending";
};

type LocationStorage = Pick<Storage, "getItem" | "setItem">;
export function readWorkspaceLocation(
  storage: LocationStorage,
  userId: string,
  reload: boolean,
): WorkspaceLocation | null {
  if (!reload) return null;
  try {
    const saved = JSON.parse(
      storage.getItem(`lc.workspace:${userId}`) ?? "null",
    );
    if (
      !saved ||
      !["friends", "server"].includes(saved.view) ||
      !["online", "offline", "pending"].includes(saved.friendTab) ||
      ![saved.serverId, saved.channelId, saved.friendId].every(
        (id) => typeof id === "string",
      )
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveWorkspaceLocation(
  storage: LocationStorage,
  userId: string,
  location: WorkspaceLocation,
) {
  try {
    storage.setItem(`lc.workspace:${userId}`, JSON.stringify(location));
  } catch {
    /* Navigation works when browser storage is unavailable. */
  }
}

export function restoredTextChannel(
  channels: { id: string; type: string }[],
  requestedId = "",
) {
  return (
    channels.find(
      (channel) => channel.id === requestedId && channel.type === "text",
    )?.id ??
    channels.find((channel) => channel.type === "text")?.id ??
    ""
  );
}
