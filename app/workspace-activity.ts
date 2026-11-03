export type ActivityChannel = {
  id: string;
  serverId: string;
  type: string;
  latestMessageId: string | null;
  latestMessageAt: string | null;
};
export type ActivityMessage = {
  channelId: string;
  messageId: string;
  createdAt: string;
  authorId: string;
};
const cursor = (id: string | null, at: string | null) =>
  id && at ? `${new Date(at).toISOString()}/${id}` : "";

export class WorkspaceActivity {
  channels = new Map<string, ActivityChannel>();
  reads: Record<string, string>;
  private pending = new Map<string, ActivityMessage>();
  private revisions = new Map<string, number>();
  version = 0;
  constructor(reads: Record<string, string> = {}) {
    this.reads = { ...reads };
  }
  snapshot(rows: ActivityChannel[], startedAt: number) {
    const next = new Map<string, ActivityChannel>();
    for (const row of rows) {
      const pending = this.pending.get(row.id);
      const current = this.channels.get(row.id);
      const hasLiveUpdate = (this.revisions.get(row.id) ?? 0) > startedAt;
      const latest =
        hasLiveUpdate && pending
          ? {
              ...row,
              latestMessageId: pending.messageId,
              latestMessageAt: pending.createdAt,
            }
          : hasLiveUpdate && current
            ? current
            : row;
      next.set(row.id, latest);
      // First visit establishes a baseline; live events received during startup
      // remain unread rather than disappearing into the initial snapshot.
      if (!(row.id in this.reads))
        this.reads[row.id] = pending
          ? ""
          : cursor(row.latestMessageId, row.latestMessageAt);
    }
    this.channels = next;
    for (const id of Object.keys(this.reads))
      if (!next.has(id)) delete this.reads[id];
    this.pending.clear();
  }
  message(event: ActivityMessage, ownUserId: string) {
    if (
      event.authorId === ownUserId ||
      !Number.isFinite(Date.parse(event.createdAt))
    )
      return;
    const current = this.channels.get(event.channelId);
    const previous = current
      ? cursor(current.latestMessageId, current.latestMessageAt)
      : this.pending.has(event.channelId)
        ? cursor(
            this.pending.get(event.channelId)!.messageId,
            this.pending.get(event.channelId)!.createdAt,
          )
        : "";
    if (cursor(event.messageId, event.createdAt) <= previous) return;
    this.revisions.set(event.channelId, ++this.version);
    this.pending.set(event.channelId, event);
    if (current)
      this.channels.set(current.id, {
        ...current,
        latestMessageId: event.messageId,
        latestMessageAt: event.createdAt,
      });
  }
  read(channelId: string) {
    const channel = this.channels.get(channelId);
    if (channel)
      this.reads[channelId] = [
        this.reads[channelId] ?? "",
        cursor(channel.latestMessageId, channel.latestMessageAt),
      ]
        .sort()
        .at(-1)!;
  }
  mergeReads(reads: unknown) {
    if (!reads || typeof reads !== "object" || Array.isArray(reads)) return;
    for (const [id, value] of Object.entries(reads)) {
      if (
        this.channels.has(id) &&
        typeof value === "string" &&
        value > (this.reads[id] ?? "")
      )
        this.reads[id] = value;
    }
  }
  unread() {
    return Object.fromEntries(
      [...this.channels.values()]
        .filter(
          (channel) =>
            channel.type === "text" &&
            cursor(channel.latestMessageId, channel.latestMessageAt) >
              (this.reads[channel.id] ?? ""),
        )
        .map((channel) => [channel.id, true]),
    );
  }
}

export function serverVoiceUsers<T extends { userId?: string; name: string }>(
  serverId: string,
  channels: ActivityChannel[],
  presence: Record<string, T[]>,
) {
  const users = new Map<string, T>();
  for (const channel of channels) {
    if (channel.serverId !== serverId || channel.type === "text") continue;
    for (const person of presence[channel.id] ?? [])
      users.set(person.userId || person.name, person);
  }
  return [...users.values()];
}
