import type { NotificationKind, NotificationScope } from "./notification-types";

export type NotificationSoundEvent = {
  type: string;
  notification?: string;
  fromUserId?: string;
  userId?: string;
  serverId?: string;
  channelId?: string;
  authorId?: string;
  messageId?: string;
  message?: { id: string };
  notice?: string;
  reason?: string;
};
export class NotificationSoundGate {
  private seen = new Set<string>();
  take(
    event: NotificationSoundEvent,
    settings: {
      userId: string;
      enabled: boolean;
      ready: boolean;
      deafened: boolean;
      channels: { id: string; serverId: string }[];
      allowed: (
        scope: NotificationScope,
        target: string,
        kind: NotificationKind,
      ) => boolean;
    },
  ) {
    if (!settings.enabled || !settings.ready || settings.deafened) return null;
    let key = "",
      sound: "message" | "request" | "notification" = "notification";
    if (event.type === "direct-message" && event.fromUserId && event.message) {
      if (
        event.fromUserId === settings.userId ||
        !settings.allowed("direct", event.fromUserId, "messages")
      )
        return null;
      key = `direct:${event.message.id}`;
      sound = "message";
    } else if (
      ["channel-activity", "server-mention"].includes(event.type) &&
      event.channelId &&
      event.messageId
    ) {
      const serverId =
        event.serverId ??
        settings.channels.find((channel) => channel.id === event.channelId)
          ?.serverId;
      if (
        !serverId ||
        event.authorId === settings.userId ||
        !settings.allowed(
          "server",
          serverId,
          event.type === "server-mention" ? "mentions" : "messages",
        )
      )
        return null;
      key = `channel:${event.messageId}`;
      sound = "message";
    } else if (
      event.notification === "friend-request" ||
      event.notification === "friend-accepted"
    ) {
      if (
        !event.fromUserId ||
        !settings.allowed("direct", event.fromUserId, "messages")
      )
        return null;
      sound = "request";
    } else if (event.notification === "server-invite") {
      if (
        !event.serverId ||
        !settings.allowed("server", event.serverId, "messages")
      )
        return null;
      sound = "request";
    } else if (!event.notice && event.reason !== "server-kicked") return null;
    else if (
      event.serverId &&
      !settings.allowed("server", event.serverId, "messages")
    )
      return null;
    if (key) {
      if (this.seen.has(key)) return null;
      this.seen.add(key);
      if (this.seen.size > 500)
        this.seen.delete(this.seen.values().next().value!);
    }
    return sound;
  }
}
