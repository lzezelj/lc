export type Mention = {
  userId: string;
  name: string;
  start: number;
  end: number;
};
export type NotificationKind = "messages" | "mentions" | "calls";
export type NotificationScope = "server" | "direct";
export type NotificationPreference = {
  scope: NotificationScope;
  targetId: string;
  messages: boolean;
  mentions?: boolean;
  calls?: boolean;
  messageMuteUntil: string | null;
  mentionMuteUntil?: string | null;
  callMuteUntil?: string | null;
};
export type ChannelNotification = {
  id: string;
  serverId: string;
  unread: boolean;
  mentions: number;
  firstUnreadId: string | null;
  latestMessageId: string | null;
};
export type DirectNotification = {
  id: string;
  unread: number;
  firstUnreadId: string | null;
  latestMessageId: string | null;
};
export type NotificationInbox = {
  channels: ChannelNotification[];
  direct: DirectNotification[];
  preferences: NotificationPreference[];
};
export function notificationAllowed(
  preferences: NotificationPreference[],
  scope: NotificationScope,
  targetId: string,
  kind: NotificationKind,
  now = Date.now(),
) {
  const preference = preferences.find(
    (item) => item.scope === scope && item.targetId === targetId,
  );
  if (!preference) return true;
  const until =
    kind === "messages"
      ? preference.messageMuteUntil
      : kind === "calls"
        ? preference.callMuteUntil
        : preference.mentionMuteUntil;
  return preference[kind] !== false && (!until || Date.parse(until) <= now);
}
