export function groupMessagesByServer<
  T extends { serverId: string; serverName: string },
>(messages: T[], currentServerId: string) {
  const groups = new Map<string, { id: string; name: string; messages: T[] }>();
  for (const message of messages) {
    if (!groups.has(message.serverId))
      groups.set(message.serverId, {
        id: message.serverId,
        name: message.serverName,
        messages: [],
      });
    groups.get(message.serverId)!.messages.push(message);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.id === currentServerId) - Number(a.id === currentServerId) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
