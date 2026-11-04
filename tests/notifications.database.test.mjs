import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import "dotenv/config";
import pg from "pg";
import * as orm from "drizzle-orm";
import * as core from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import * as attachmentTypes from "../app/attachment-types.ts";
import * as mentions from "../app/mentions.ts";

async function load(path, deps) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    }),
    {
      exports,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      Request,
      Response,
      URL,
      Buffer,
      Uint8Array,
      process: { env: {} },
    },
  );
  return exports;
}
test("PostgreSQL mentions/read state persist across sessions; settings and API access remain account scoped", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const actor = randomUUID(),
    bob = randomUUID(),
    outsider = randomUUID(),
    server = randomUUID(),
    privateServer = randomUUID(),
    channel = randomUUID(),
    privateChannel = randomUUID();
  let currentUser = actor;
  try {
    await client.query("BEGIN");
    const base = drizzle(client, { schema });
    // Route-level transactions reuse this outer transaction so every fixture rolls back.
    const database = new Proxy(base, {
      get(target, key) {
        if (key === "transaction") return async (action) => action(target);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const old = new Date("2020-01-01T00:00:00Z"),
      handle = `bob.${randomUUID()}`;
    await database.insert(schema.users).values([
      { id: actor, name: "Actor" },
      { id: bob, name: "Bob", handle },
      { id: outsider, name: "Outside" },
    ]);
    await database.insert(schema.servers).values([
      { id: server, name: "Mention server", createdBy: actor },
      { id: privateServer, name: "Private", createdBy: outsider },
    ]);
    await database.insert(schema.channels).values([
      {
        id: channel,
        serverId: server,
        name: "general",
        type: "text",
        createdAt: old,
      },
      {
        id: privateChannel,
        serverId: privateServer,
        name: "private",
        type: "text",
        createdAt: old,
      },
    ]);
    await database.insert(schema.serverMembers).values([
      { userId: actor, serverId: server, joinedAt: old },
      { userId: bob, serverId: server, joinedAt: old },
    ]);
    await database.insert(schema.friendships).values({
      requesterId: actor,
      recipientId: bob,
      status: "accepted",
      acceptedAt: old,
    });
    const notices = [];
    const notify = {
      notifyUser: async (userId, event) => {
        if (event.type === "server-mention") {
          const records = await database
            .select()
            .from(schema.messageMentions)
            .where(orm.eq(schema.messageMentions.messageId, event.messageId));
          assert.ok(
            records.some((row) => row.userId === userId),
            "Mention must persist before notification",
          );
        }
        notices.push({ userId, event });
      },
    };
    const auth = {
      auth: async () => ({
        user: {
          id: currentUser,
          name: currentUser === actor ? "Actor" : "Bob",
          role: "member",
        },
      }),
    };
    const friends = {
      areFriends: async (a, b) => {
        const rows = await database
          .select()
          .from(schema.friendships)
          .where(
            orm.and(
              orm.eq(schema.friendships.status, "accepted"),
              orm.or(
                orm.and(
                  orm.eq(schema.friendships.requesterId, a),
                  orm.eq(schema.friendships.recipientId, b),
                ),
                orm.and(
                  orm.eq(schema.friendships.requesterId, b),
                  orm.eq(schema.friendships.recipientId, a),
                ),
              ),
            ),
          );
        return !!rows.length;
      },
    };
    const rates = {
      checkRateLimit: () => ({ allowed: true }),
      rateLimits: { message: {} },
      rateLimitMessage: () => "wait",
    };
    const mentionTools = await load("../server/mentions.ts", {
      "drizzle-orm": orm,
      "../db": { db: database },
      "../db/schema": schema,
      "../app/mentions": mentions,
      "./notify-user": notify,
    });
    const inboxTools = await load("../server/notification-inbox.ts", {
      "drizzle-orm": orm,
      "../db": { db: database },
    });
    const inbox = () => inboxTools.notificationInbox(bob);
    assert.equal(
      (await inbox()).channels.find((row) => row.id === channel).mentions,
      0,
    );
    const reader = await load("../server/message-attachments.ts", {
      "node:crypto": { randomUUID },
      "drizzle-orm": orm,
      "../db": { db: database },
      "../db/schema": schema,
      "../app/attachment-types": attachmentTypes,
    });
    const post = await load(
      "../app/api/channels/[channelId]/messages/route.ts",
      {
        "drizzle-orm": orm,
        "drizzle-orm/pg-core": core,
        "next/server": {
          NextResponse: {
            json: (body, options) => Response.json(body, options),
          },
        },
        "../../../../../auth": auth,
        "../../../../../db": { db: database },
        "../../../../../db/schema": schema,
        "../../../../../server/message-attachments": reader,
        "../../../../../server/rate-limit": rates,
        "../../../../../server/mentions": mentionTools,
      },
    );
    const request = (body, method = "POST") =>
      new Request("http://localhost/api", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const response = await post.POST(
      request({ text: `Hi @Bob and @${handle}, @Actor @Outside` }),
      { params: Promise.resolve({ channelId: channel }) },
    );
    assert.equal(response.status, 201);
    const message = await response.json();
    assert.equal(message.mentions.length, 2);
    assert.ok(message.mentions.every((mention) => mention.userId === bob));
    assert.equal(
      notices.filter((notice) => notice.event.type === "server-mention").length,
      1,
      "Repeated tags notify once per recipient/message",
    );
    assert.equal(
      (await inbox()).channels.find((row) => row.id === channel).mentions,
      1,
    );
    assert.equal(
      (await inbox()).channels.find((row) => row.id === channel).unread,
      true,
    );
    const edit = await load("../server/edit-message.ts", {
      "drizzle-orm": orm,
      "../auth": auth,
      "../db": { db: database },
      "../db/schema": schema,
      "./friends": friends,
      "./notify-user": notify,
      "./rate-limit": rates,
      "./message-attachments": reader,
      "./mentions": mentionTools,
    });
    assert.equal(
      (
        await edit.editChannelMessage(
          request({ text: "Changed @Bob" }, "PATCH"),
          { params: Promise.resolve({ messageId: message.id }) },
        )
      ).status,
      200,
    );
    assert.equal(
      notices.filter((notice) => notice.event.type === "server-mention").length,
      1,
      "Editing an unchanged recipient must not resend a mention",
    );
    const read = await load("../app/api/notifications/read/route.ts", {
      "drizzle-orm": orm,
      "../../../../auth": auth,
      "../../../../db": { db: database },
      "../../../../server/friends": friends,
      "../../../../server/notify-user": notify,
      "../../../../server/rate-limit": rates,
    });
    currentUser = bob;
    assert.equal(
      (
        await read.POST(
          request({
            scope: "channel",
            targetId: channel,
            messageId: message.id,
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await inbox()).channels.find((row) => row.id === channel).mentions,
      0,
    );
    assert.equal(
      (await inbox()).channels.find((row) => row.id === channel).unread,
      false,
    );
    currentUser = actor;
    await edit.editChannelMessage(request({ text: "No tag" }, "PATCH"), {
      params: Promise.resolve({ messageId: message.id }),
    });
    await edit.editChannelMessage(request({ text: "New @Bob" }, "PATCH"), {
      params: Promise.resolve({ messageId: message.id }),
    });
    const added = (await inbox()).channels.find((row) => row.id === channel);
    assert.equal(added.mentions, 1);
    assert.equal(
      added.unread,
      false,
      "A new mention on an old read message needs its own notification",
    );
    assert.equal(
      notices.filter((notice) => notice.event.type === "server-mention").length,
      2,
    );
    currentUser = bob;
    await read.POST(
      request({ scope: "channel", targetId: channel, messageId: message.id }),
    );
    const [newer] = await database
      .insert(schema.messages)
      .values({
        channelId: channel,
        authorId: actor,
        content: "Newer",
        createdAt: orm.sql`clock_timestamp()`,
      })
      .returning();
    assert.equal(
      (await inbox()).channels.find((row) => row.id === channel).firstUnreadId,
      newer.id,
    );
    await read.POST(
      request({ scope: "channel", targetId: channel, messageId: newer.id }),
    );
    await read.POST(
      request({ scope: "channel", targetId: channel, messageId: message.id }),
    );
    const [cursor] = await database
      .select()
      .from(schema.channelReads)
      .where(
        orm.and(
          orm.eq(schema.channelReads.userId, bob),
          orm.eq(schema.channelReads.channelId, channel),
        ),
      );
    assert.equal(
      cursor.messageId,
      newer.id,
      "Older read acknowledgements cannot move the cursor backward",
    );
    const settings = await load("../app/api/notifications/route.ts", {
      "drizzle-orm": orm,
      "../../../auth": auth,
      "../../../db": { db: database },
      "../../../db/schema": schema,
      "../../../server/friends": friends,
      "../../../server/notification-inbox": inboxTools,
      "../../../server/notify-user": notify,
      "../../../server/rate-limit": rates,
    });
    assert.equal(
      (
        await settings.PATCH(
          request(
            { scope: "direct", targetId: actor, kind: "messages", mode: "off" },
            "PATCH",
          ),
        )
      ).status,
      200,
    );
    let preference = (await inbox()).preferences.find(
      (pref) => pref.scope === "direct",
    );
    assert.equal(preference.messages, false);
    assert.equal(preference.calls, true);
    await settings.PATCH(
      request(
        { scope: "direct", targetId: actor, kind: "calls", mode: "off" },
        "PATCH",
      ),
    );
    await settings.PATCH(
      request(
        { scope: "direct", targetId: actor, kind: "messages", mode: "on" },
        "PATCH",
      ),
    );
    preference = (await inbox()).preferences.find(
      (pref) => pref.scope === "direct",
    );
    assert.equal(preference.messages, true);
    assert.equal(preference.calls, false);
    await settings.PATCH(
      request(
        { scope: "server", targetId: server, kind: "messages", mode: "off" },
        "PATCH",
      ),
    );
    preference = (await inbox()).preferences.find(
      (pref) => pref.scope === "server",
    );
    assert.equal(preference.messages, false);
    assert.equal(preference.mentions, true);
    await settings.PATCH(
      request(
        { scope: "server", targetId: server, kind: "mentions", mode: "60" },
        "PATCH",
      ),
    );
    preference = (await inbox()).preferences.find(
      (pref) => pref.scope === "server",
    );
    assert.ok(
      new Date(preference.mentionMuteUntil).getTime() > Date.now() + 3590000,
    );
    const [dm] = await database
      .insert(schema.directMessages)
      .values({
        senderId: actor,
        recipientId: bob,
        content: "Unread DM",
        createdAt: orm.sql`clock_timestamp()`,
      })
      .returning();
    assert.equal(
      (await inbox()).direct.find((row) => row.id === actor).unread,
      1,
    );
    await read.POST(
      request({ scope: "direct", targetId: actor, messageId: dm.id }),
    );
    assert.equal(
      (await inbox()).direct.find((row) => row.id === actor).unread,
      0,
    );
    const [foreign] = await database
      .insert(schema.messages)
      .values({
        channelId: privateChannel,
        authorId: outsider,
        content: "Private",
      })
      .returning();
    assert.equal(
      (
        await read.POST(
          request({
            scope: "channel",
            targetId: privateChannel,
            messageId: foreign.id,
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await read.POST(
          request({ scope: "direct", targetId: outsider, messageId: dm.id }),
        )
      ).status,
      403,
    );
    currentUser = outsider;
    assert.equal(
      (
        await settings.PATCH(
          request(
            {
              scope: "server",
              targetId: server,
              kind: "messages",
              mode: "on",
              userId: bob,
            },
            "PATCH",
          ),
        )
      ).status,
      403,
    );
    const outsiderState = await (await settings.GET()).json();
    assert.equal(outsiderState.channels.length, 0);
    assert.equal(outsiderState.preferences.length, 0);
    currentUser = actor;
    await edit.editChannelMessage(request({ text: "Tag @Bob" }, "PATCH"), {
      params: Promise.resolve({ messageId: message.id }),
    });
    await database
      .update(schema.messages)
      .set({ deletedAt: new Date() })
      .where(orm.eq(schema.messages.id, message.id));
    const [deletedMessage] = await database
      .select()
      .from(schema.messages)
      .where(orm.eq(schema.messages.id, message.id));
    assert.deepEqual(deletedMessage.mentions, []);
    assert.equal(
      (
        await database
          .select()
          .from(schema.messageMentions)
          .where(orm.eq(schema.messageMentions.messageId, message.id))
      ).length,
      0,
      "Soft deletion must erase mention metadata and notification records",
    );
    assert.equal(
      (await inbox()).channels.find((row) => row.id === channel).mentions,
      0,
    );
    await database
      .delete(schema.messages)
      .where(orm.eq(schema.messages.id, message.id));
    assert.equal(
      (
        await database
          .select()
          .from(schema.messageMentions)
          .where(orm.eq(schema.messageMentions.messageId, message.id))
      ).length,
      0,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
