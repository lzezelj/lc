import {
  AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "member", "demo"]);
export const friendshipStatus = pgEnum("friendship_status", [
  "pending",
  "accepted",
]);
export const serverRole = pgEnum("server_role", ["owner", "member"]);
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
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.userId] }),
    index("server_members_user_id_idx").on(table.userId),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("channels_server_id_idx").on(table.serverId)],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("messages_channel_timeline_idx").on(
      table.channelId,
      table.createdAt,
      table.id,
    ),
    index("messages_reply_to_id_idx").on(table.replyToId),
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
    callDurationSeconds: integer("call_duration_seconds"),
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
