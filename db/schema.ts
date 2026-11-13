import {
  type AnyPgColumn,
  customType,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { MessageAttachment } from "../app/attachment-types";
import type { Mention } from "../app/notification-types";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["owner", "member", "demo"]);

// No target foreign keys: moderation history survives removal of its targets.
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    userId: uuid("user_id"),
    serverId: uuid("server_id"),
    channelId: uuid("channel_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("admin_audit_created_idx").on(table.createdAt, table.id)],
);
export const friendshipStatus = pgEnum("friendship_status", [
  "pending",
  "accepted",
]);
export const serverRole = pgEnum("server_role", ["owner", "member", "mod"]);
export const channelType = pgEnum("channel_type", [
  "text",
  "voice_direct",
  "voice_group",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    role: userRole("role").default("member").notNull(),
    name: text("name").notNull(),
    handle: text("handle").unique(),
    email: text("email"),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

// OAuth provider accounts linked to an owner. These columns follow the
// Auth.js adapter model, so Google authentication can be added later.
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const demoInvites = pgTable(
  "demo_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    demoUserId: uuid("demo_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("demo_invites_token_hash_unique").on(table.tokenHash),
    index("demo_invites_demo_user_id_idx").on(table.demoUserId),
  ],
);

export const servers = pgTable(
  "servers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    image: text("image"),
    afkChannelId: uuid("afk_channel_id").references(
      (): AnyPgColumn => channels.id,
      { onDelete: "set null" },
    ),
    soundboardCooldownEnabled: boolean("soundboard_cooldown_enabled")
      .default(true)
      .notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("servers_created_by_idx").on(table.createdBy)],
);

export const serverMembers = pgTable(
  "server_members",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: serverRole("role").default("member").notNull(),
    position: integer("position"),
    voiceMuted: boolean("voice_muted").default(false).notNull(),
    voiceDeafened: boolean("voice_deafened").default(false).notNull(),
    joinSoundId: uuid("join_sound_id").references(
      (): AnyPgColumn => serverSounds.id,
      { onDelete: "set null" },
    ),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.userId] }),
    index("server_members_user_id_idx").on(table.userId),
  ],
);

export const serverInvitations = pgTable(
  "server_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("server_invitations_server_recipient_unique").on(
      table.serverId,
      table.recipientId,
    ),
    index("server_invitations_recipient_idx").on(table.recipientId),
    index("server_invitations_inviter_idx").on(table.inviterId),
    check(
      "server_invitations_distinct_people",
      sql`${table.inviterId} <> ${table.recipientId}`,
    ),
  ],
);

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: channelType("type").notNull(),
    position: integer("position"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("channels_server_id_idx").on(table.serverId)],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const serverPictures = pgTable("server_pictures", {
  serverId: uuid("server_id")
    .primaryKey()
    .references(() => servers.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});
export const userAvatars = pgTable("user_avatars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});

export const serverSounds = pgTable(
  "server_sounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    audio: bytea("audio").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("server_sounds_server_id_idx").on(table.serverId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    mentions: jsonb("mentions").$type<Mention[]>().default([]).notNull(),
    attachments: jsonb("attachments")
      .$type<MessageAttachment[]>()
      .default([])
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    editedByAdmin: boolean("edited_by_admin").default(false).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("messages_channel_timeline_idx").on(
      table.channelId,
      table.createdAt,
      table.id,
    ),
    index("messages_reply_to_id_idx").on(table.replyToId),
    index("messages_author_timeline_idx").on(
      table.authorId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: friendshipStatus("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.requesterId, table.recipientId] }),
    index("friendships_recipient_idx").on(table.recipientId),
  ],
);

export const directMessages = pgTable(
  "direct_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    kind: text("kind").default("message").notNull(),
    attachments: jsonb("attachments")
      .$type<MessageAttachment[]>()
      .default([])
      .notNull(),
    callDurationSeconds: integer("call_duration_seconds"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    editedByAdmin: boolean("edited_by_admin").default(false).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("direct_messages_timeline_idx").on(
      table.senderId,
      table.recipientId,
      table.createdAt,
    ),
  ],
);

export const channelMessageReactions = pgTable(
  "channel_message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] })],
);
export const directMessageReactions = pgTable(
  "direct_message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => directMessages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] })],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    directMessageId: uuid("direct_message_id").references(
      () => directMessages.id,
      { onDelete: "cascade" },
    ),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("message_attachments_uploader_idx").on(table.uploaderId),
    index("message_attachments_message_idx").on(table.messageId),
    index("message_attachments_direct_idx").on(table.directMessageId),
    index("message_attachments_created_idx").on(table.createdAt, table.id),
  ],
);

export const messageMentions = pgTable(
  "message_mentions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notifiedAt: timestamp("notified_at", { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index("message_mentions_user_idx").on(table.userId, table.notifiedAt),
  ],
);

export const channelReads = pgTable(
  "channel_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
    messageAt: timestamp("message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    messageId: uuid("message_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.channelId] })],
);
export const directReads = pgTable(
  "direct_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: uuid("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
    messageAt: timestamp("message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    messageId: uuid("message_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.friendId] })],
);
export const serverNotifications = pgTable(
  "server_notifications",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    messages: boolean("messages").default(true).notNull(),
    mentions: boolean("mentions").default(true).notNull(),
    messageMuteUntil: timestamp("message_mute_until", { withTimezone: true }),
    mentionMuteUntil: timestamp("mention_mute_until", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.serverId] })],
);
export const directNotifications = pgTable(
  "direct_notifications",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: uuid("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messages: boolean("messages").default(true).notNull(),
    calls: boolean("calls").default(true).notNull(),
    messageMuteUntil: timestamp("message_mute_until", { withTimezone: true }),
    callMuteUntil: timestamp("call_mute_until", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.friendId] })],
);
