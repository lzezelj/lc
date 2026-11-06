import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "dotenv/config";
import pg from "pg";
import vm from "node:vm";
import ts from "typescript";
import * as orm from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import * as attachmentTypes from "../app/attachment-types.ts";
import * as emojiCatalog from "../app/emoji-catalog.ts";

const { Client } = pg;

test("message reactions enforce conversation access, isolate actors, aggregate live counts and clean up deleted messages", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    const a = randomUUID(),
      b = randomUUID(),
      outsider = randomUUID(),
      server = randomUUID(),
      channel = randomUUID(),
      message = randomUUID(),
      direct = randomUUID(),
      call = randomUUID();
    await database.insert(schema.users).values([
      { id: a, name: "Reactor A" },
      { id: b, name: "Reactor B" },
      { id: outsider, name: "Outsider" },
    ]);
    await database
      .insert(schema.servers)
      .values({ id: server, name: "Reaction test", createdBy: a });
    await database.insert(schema.serverMembers).values([
      { serverId: server, userId: a },
      { serverId: server, userId: b },
    ]);
    await database
      .insert(schema.channels)
      .values({ id: channel, serverId: server, name: "general", type: "text" });
    await database.insert(schema.messages).values({
      id: message,
      channelId: channel,
      authorId: a,
      content: "React here",
    });
    await database
      .insert(schema.friendships)
      .values({ requesterId: a, recipientId: b, status: "accepted" });
    await database.insert(schema.directMessages).values([
      { id: direct, senderId: a, recipientId: b, content: "Private reaction" },
      {
        id: call,
        senderId: a,
        recipientId: b,
        content: "Call ended",
        kind: "call",
      },
    ]);
    let actor = a,
      authenticated = true;
    const events = [];
    const route = {};
    const deps = {
      "drizzle-orm": orm,
      "../../../auth": {
        auth: async () => (authenticated ? { user: { id: actor } } : null),
      },
      "../../../db": {
        db: new Proxy(database, {
          get(target, property) {
            if (property === "transaction")
              return async (callback) => {
                await client.query("SAVEPOINT reaction_test");
                try {
                  const result = await callback(database);
                  await client.query("RELEASE SAVEPOINT reaction_test");
                  return result;
                } catch (error) {
                  await client.query("ROLLBACK TO SAVEPOINT reaction_test");
                  await client.query("RELEASE SAVEPOINT reaction_test");
                  throw error;
                }
              };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      },
      "../../../db/schema": schema,
      "../../emoji-catalog": emojiCatalog,
      "../../../server/rate-limit": {
        checkRateLimit: () => ({ allowed: true }),
      },
      "../../../server/notify-user": {
        notifyUser: async (userId, event) => events.push({ userId, event }),
      },
      "../../../server/friends": {
        areFriends: async (left, right) => {
          const result = await client.query(
            "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1))",
            [left, right],
          );
          return result.rowCount > 0;
        },
      },
    };
    vm.runInNewContext(
      ts.transpile(
        await readFile(
          new URL("../app/api/message-reactions/route.ts", import.meta.url),
          "utf8",
        ),
        { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      ),
      {
        exports: route,
        Response,
        URL,
        process: { env: {} },
        require: (name) => {
          assert.ok(name in deps, name);
          return deps[name];
        },
      },
    );
    const mutate = (id, scope, remove = false, emoji = "👍") =>
      route[remove ? "DELETE" : "POST"](
        new Request("https://lc.test/api/message-reactions", {
          method: remove ? "DELETE" : "POST",
          body: JSON.stringify({
            messageId: id,
            emoji,
            ...scope,
            actorId: outsider,
          }),
        }),
      );
    const read = (ids, scope) =>
      route.GET(
        new Request(
          `https://lc.test/api/message-reactions?${new URLSearchParams({ messageIds: ids.join(","), ...scope })}`,
        ),
      );
    assert.equal((await mutate(message, { channelId: channel })).status, 200);
    await mutate(message, { channelId: channel });
    let counts = await (await read([message], { channelId: channel })).json();
    assert.deepEqual(
      counts[message],
      [{ emoji: "👍", count: 1, me: true }],
      "duplicate adds are idempotent",
    );
    await mutate(message, { channelId: channel }, false, "❤️");
    counts = await (await read([message], { channelId: channel })).json();
    assert.deepEqual(
      counts[message],
      [{ emoji: "❤️", count: 1, me: true }],
      "another emoji replaces the previous reaction",
    );
    await mutate(message, { channelId: channel });
    actor = b;
    await mutate(message, { channelId: channel });
    counts = await (await read([message], { channelId: channel })).json();
    assert.equal(counts[message][0].count, 2);
    const details = await (
      await read([message], { channelId: channel, details: "1" })
    ).json();
    assert.deepEqual(
      details.people.map(({ name, me }) => ({ name, me })),
      [
        { name: "Reactor A", me: false },
        { name: "Reactor B", me: true },
      ],
    );
    assert.equal(
      (await read([direct], { channelId: channel, details: "1" })).status,
      404,
    );
    await mutate(message, { channelId: channel }, true);
    counts = await (await read([message], { channelId: channel })).json();
    assert.deepEqual(
      counts[message],
      [{ emoji: "👍", count: 1, me: false }],
      "removing affects only the current user",
    );
    actor = outsider;
    assert.equal((await mutate(message, { channelId: channel })).status, 403);
    assert.equal((await read([message], { channelId: channel })).status, 403);
    assert.equal(
      (await read([message], { channelId: channel, details: "1" })).status,
      403,
    );
    assert.equal((await mutate(direct, { userId: a })).status, 403);
    actor = a;
    assert.equal(
      (await mutate(message, { channelId: channel }, false, "plain text"))
        .status,
      400,
    );
    assert.equal((await mutate(direct, { channelId: channel })).status, 404);
    assert.equal((await mutate(call, { userId: b })).status, 404);
    assert.equal((await mutate(direct, { userId: b })).status, 200);
    assert.deepEqual(events.map((event) => event.userId).sort(), [a, b].sort());
    assert.ok(
      events.every((event) => event.event.type === "message-reactions-changed"),
    );
    counts = await (await read([direct], { userId: b })).json();
    assert.equal(counts[direct][0].me, true);
    await mutate(direct, { userId: b }, false, "❤️");
    counts = await (await read([direct], { userId: b })).json();
    assert.deepEqual(counts[direct], [{ emoji: "❤️", count: 1, me: true }]);
    const directDetails = await (
      await read([direct], { userId: b, details: "1" })
    ).json();
    assert.deepEqual(directDetails.people, [
      { userId: a, name: "Reactor A", emoji: "❤️", me: true },
    ]);
    await database
      .update(schema.messages)
      .set({ deletedAt: new Date() })
      .where(orm.eq(schema.messages.id, message));
    await database
      .update(schema.directMessages)
      .set({ deletedAt: new Date() })
      .where(orm.eq(schema.directMessages.id, direct));
    assert.equal(
      (
        await database
          .select()
          .from(schema.channelMessageReactions)
          .where(orm.eq(schema.channelMessageReactions.messageId, message))
      ).length,
      0,
    );
    assert.equal(
      (
        await database
          .select()
          .from(schema.directMessageReactions)
          .where(orm.eq(schema.directMessageReactions.messageId, direct))
      ).length,
      0,
    );
    assert.equal((await mutate(message, { channelId: channel })).status, 404);
    authenticated = false;
    assert.equal((await read([message], { channelId: channel })).status, 401);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("member join sounds are isolated by person and server and reset on sound deletion", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    const user = randomUUID(),
      otherUser = randomUUID(),
      server = randomUUID(),
      otherServer = randomUUID(),
      sound = randomUUID();
    await database.insert(schema.users).values([
      { id: user, name: "Join sound owner" },
      { id: otherUser, name: "Other member" },
    ]);
    await database.insert(schema.servers).values([
      { id: server, name: "Join sound test", createdBy: user },
      { id: otherServer, name: "Other server", createdBy: user },
    ]);
    const [created] = await database
      .insert(schema.serverMembers)
      .values([
        { serverId: server, userId: user },
        { serverId: server, userId: otherUser },
        { serverId: otherServer, userId: user },
      ])
      .returning();
    assert.equal(created.joinSoundId, null);
    await database.insert(schema.serverSounds).values({
      id: sound,
      serverId: server,
      name: "Welcome",
      audio: Buffer.alloc(44),
      durationMs: 100,
    });
    let actor = user;
    const route = {};
    const dependencies = {
      "drizzle-orm": orm,
      "next/server": { NextResponse: { json: Response.json } },
      "../../../../../auth": {
        auth: async () => ({ user: { id: actor, role: "member" } }),
      },
      "../../../../../db": { db: database },
      "../../../../../db/schema": schema,
      "../../../../../server/rate-limit": {
        checkRateLimit: () => ({ allowed: true }),
        rateLimits: { serverMutation: {} },
      },
      "../../../../../server/notify-user": { notifyUser: async () => {} },
    };
    vm.runInNewContext(
      ts.transpile(
        await readFile(
          new URL(
            "../app/api/servers/[serverId]/join-sound/route.ts",
            import.meta.url,
          ),
          "utf8",
        ),
        { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      ),
      {
        exports: route,
        URL,
        require: (name) => {
          assert.ok(name in dependencies, name);
          return dependencies[name];
        },
      },
    );
    const scope = { params: Promise.resolve({ serverId: server }) };
    const saved = await route.PATCH(
      new Request("https://lc.test/join-sound", {
        method: "PATCH",
        body: JSON.stringify({
          joinSoundId: sound,
          userId: otherUser,
        }),
      }),
      scope,
    );
    assert.equal(saved.status, 200);
    actor = otherUser;
    const target = await route.GET(
      new Request(`https://lc.test/join-sound?userId=${user}`),
      scope,
    );
    assert.deepEqual(
      await target.json(),
      { joinSoundId: sound },
      "listeners resolve the joining/leaving member, not their own defaults",
    );
    const denied = await route.GET(
      new Request(`https://lc.test/join-sound?userId=${user}`),
      { params: Promise.resolve({ serverId: otherServer }) },
    );
    assert.equal(
      denied.status,
      403,
      "outsiders cannot read another server's sound choices",
    );
    const others = await database
      .select()
      .from(schema.serverMembers)
      .where(
        orm.or(
          orm.eq(schema.serverMembers.userId, otherUser),
          orm.eq(schema.serverMembers.serverId, otherServer),
        ),
      );
    assert.ok(
      others.every((member) => member.joinSoundId === null),
      "other people and servers retain independent defaults",
    );
    await database
      .delete(schema.serverSounds)
      .where(orm.eq(schema.serverSounds.id, sound));
    const [reset] = await database
      .select()
      .from(schema.serverMembers)
      .where(
        orm.and(
          orm.eq(schema.serverMembers.serverId, server),
          orm.eq(schema.serverMembers.userId, user),
        ),
      );
    assert.equal(reset.joinSoundId, null);
    await database.insert(schema.serverSounds).values({
      id: sound,
      serverId: server,
      name: "Welcome",
      audio: Buffer.alloc(44),
      durationMs: 100,
    });
    await database
      .update(schema.serverMembers)
      .set({ joinSoundId: sound })
      .where(
        orm.and(
          orm.eq(schema.serverMembers.serverId, server),
          orm.eq(schema.serverMembers.userId, user),
        ),
      );
    await database
      .delete(schema.servers)
      .where(orm.eq(schema.servers.id, server));
    assert.equal(
      (
        await database
          .select()
          .from(schema.serverSounds)
          .where(orm.eq(schema.serverSounds.id, sound))
      ).length,
      0,
      "server deletion still cascades with a selected sound",
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("real PostgreSQL edit/search queries preserve files, enforce conversation scope and page stored history", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const actor = randomUUID(),
    friend = randomUUID(),
    stranger = randomUUID(),
    server = randomUUID(),
    privateServer = randomUUID(),
    channel = randomUUID(),
    privateChannel = randomUUID();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    await database.insert(schema.users).values([
      { id: actor, name: "Editor" },
      { id: friend, name: "Friend" },
      { id: stranger, name: "Other" },
    ]);
    await database.insert(schema.servers).values([
      { id: server, name: "Search test", createdBy: actor },
      { id: privateServer, name: "Private", createdBy: stranger },
    ]);
    await database.insert(schema.channels).values([
      { id: channel, serverId: server, name: "general", type: "text" },
      {
        id: privateChannel,
        serverId: privateServer,
        name: "private",
        type: "text",
      },
    ]);
    await database
      .insert(schema.serverMembers)
      .values({ serverId: server, userId: actor });
    const createdAt = new Date("2026-11-04T12:00:00Z");
    const searchIds = Array.from({ length: 125 }, () => randomUUID());
    await database.insert(schema.messages).values(
      searchIds.map((id) => ({
        id,
        channelId: channel,
        authorId: actor,
        content: "needle",
        createdAt,
      })),
    );
    const foreignId = randomUUID(),
      deletedId = randomUUID(),
      editableId = randomUUID(),
      fileId = randomUUID(),
      directId = randomUUID();
    await database.insert(schema.messages).values([
      {
        id: foreignId,
        channelId: privateChannel,
        authorId: stranger,
        content: "needle",
        createdAt,
      },
      {
        id: deletedId,
        channelId: channel,
        authorId: actor,
        content: "needle",
        deletedAt: new Date(),
        createdAt,
      },
      {
        id: editableId,
        channelId: channel,
        authorId: actor,
        content: "Editable",
        attachments: [
          {
            id: fileId,
            name: "Report%_2026.pdf",
            type: "application/pdf",
            size: 8,
          },
        ],
        createdAt,
      },
    ]);
    await database.insert(schema.messageAttachments).values({
      id: fileId,
      messageId: editableId,
      uploaderId: actor,
      data: Buffer.from("%PDF-1.7"),
    });
    await database.insert(schema.directMessages).values({
      id: directId,
      senderId: actor,
      recipientId: friend,
      content: "Direct editable",
    });
    await database.insert(schema.directMessages).values({
      senderId: stranger,
      recipientId: friend,
      content: "Direct private",
    });
    async function load(path, deps) {
      const exports = {};
      vm.runInNewContext(
        ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
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
    const reader = await load("../server/message-attachments.ts", {
      "node:crypto": { randomUUID },
      "drizzle-orm": orm,
      "../db": { db: database },
      "../db/schema": schema,
      "../app/attachment-types": attachmentTypes,
    });
    const auth = {
        auth: async () => ({ user: { id: actor, role: "member" } }),
      },
      friends = {
        areFriends: async (a, b) =>
          [actor, friend].includes(a) && [actor, friend].includes(b),
      },
      rates = {
        checkRateLimit: () => ({ allowed: true }),
        rateLimits: { message: {} },
        rateLimitMessage: () => "wait",
      };
    const notices = [];
    await database.insert(schema.friendships).values([
      { requesterId: actor, recipientId: friend, status: "accepted" },
      { requesterId: actor, recipientId: stranger, status: "pending" },
    ]);
    const friendList = await load("../app/api/friends/route.ts", {
      "drizzle-orm": orm,
      "next/server": { NextResponse: { json: Response.json } },
      "../../../auth": auth,
      "../../../db": { db: database },
      "../../../db/schema": schema,
      "../../../server/notify-user": {},
      "../../../user-handle": {},
    });
    let previews = await (await friendList.GET()).json();
    assert.equal(
      previews.find((row) => row.id === friend).lastMessage.text,
      "Direct editable",
    );
    assert.equal(previews.find((row) => row.id === stranger).lastMessage, null);
    const previewId = randomUUID();
    await database.insert(schema.directMessages).values({
      id: previewId,
      senderId: friend,
      recipientId: actor,
      content: "x".repeat(200),
      createdAt: new Date(Date.now() + 1000),
    });
    previews = await (await friendList.GET()).json();
    assert.equal(
      previews.find((row) => row.id === friend).lastMessage.text.length,
      160,
    );
    assert.equal(
      previews.find((row) => row.id === friend).lastMessage.senderId,
      friend,
    );
    await database
      .update(schema.directMessages)
      .set({ deletedAt: new Date() })
      .where(orm.eq(schema.directMessages.id, previewId));
    previews = await (await friendList.GET()).json();
    assert.equal(
      previews.find((row) => row.id === friend).lastMessage.text,
      "Deleted message",
    );
    await database
      .update(schema.directMessages)
      .set({
        deletedAt: null,
        content: "",
        attachments: [
          { id: randomUUID(), name: "photo.png", type: "image/png", size: 1 },
        ],
      })
      .where(orm.eq(schema.directMessages.id, previewId));
    previews = await (await friendList.GET()).json();
    assert.equal(
      previews.find((row) => row.id === friend).lastMessage.text,
      "Attachment",
    );
    await database
      .delete(schema.directMessages)
      .where(orm.eq(schema.directMessages.id, previewId));
    const edits = await load("../server/edit-message.ts", {
      "drizzle-orm": orm,
      "../auth": auth,
      "../db": { db: database },
      "../db/schema": schema,
      "./friends": friends,
      "./rate-limit": rates,
      "./message-attachments": reader,
      "./notify-user": {
        notifyUser: async (userId, event) => notices.push({ userId, event }),
      },
    });
    const request = (text) =>
      new Request("http://localhost/message", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    assert.equal(
      (
        await edits.editChannelMessage(request("Corrected"), {
          params: Promise.resolve({ messageId: editableId }),
        })
      ).status,
      200,
    );
    const [saved] = await database
      .select()
      .from(schema.messages)
      .where(orm.eq(schema.messages.id, editableId));
    assert.equal(saved.content, "Corrected");
    assert.ok(saved.editedAt);
    assert.equal(saved.attachments[0].id, fileId);
    assert.equal(
      (
        await edits.editChannelMessage(request("Forbidden"), {
          params: Promise.resolve({ messageId: foreignId }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await edits.editDirectMessage(request("Direct corrected"), {
          params: Promise.resolve({ messageId: directId, userId: friend }),
        })
      ).status,
      200,
    );
    assert.equal(notices.length, 2);
    const search = await load("../app/api/message-search/route.ts", {
      "drizzle-orm": orm,
      "../../../auth": auth,
      "../../../db": { db: database },
      "../../../db/schema": schema,
      "../../../server/friends": friends,
      "../../../server/rate-limit": rates,
    });
    const find = (parameters) =>
      search.GET(
        new Request(
          `http://localhost/search?${new URLSearchParams(parameters)}`,
        ),
      );
    // PostgreSQL stores microseconds; JavaScript Date truncates to milliseconds.
    // Reproduce with both a fractional target and ties at that exact timestamp.
    await client.query(
      "UPDATE messages SET created_at = '2026-11-04T12:00:00.123456Z'::timestamptz WHERE channel_id = $1",
      [channel],
    );
    await client.query(
      "UPDATE direct_messages SET created_at = '2026-11-04T12:00:00.123456Z'::timestamptz WHERE id = $1",
      [directId],
    );
    for (const scope of [
      { channelId: channel, contextId: searchIds[60] },
      { userId: friend, contextId: directId },
    ]) {
      const page = await (await find(scope)).json();
      assert.equal(
        page.messages.filter((row) => row.id === scope.contextId).length,
        1,
        "Selected message must occur exactly once despite sub-millisecond timestamps",
      );
      assert.equal(
        new Set(page.messages.map((row) => row.id)).size,
        page.messages.length,
        "Context must contain unique message IDs",
      );
    }
    let cursor = {},
      ids = [];
    for (const size of [50, 50, 25]) {
      const page = await (
        await find({ channelId: channel, q: "needle", ...cursor })
      ).json();
      assert.equal(page.messages.length, size);
      ids.push(...page.messages.map((row) => row.id));
      cursor = page.nextCursor;
      if (cursor)
        assert.match(
          cursor.beforeCreatedAt,
          /\.123456Z$/,
          "Search cursors must retain all six fractional digits",
        );
    }
    assert.equal(cursor, null);
    assert.deepEqual(ids, [...searchIds].sort().reverse());
    const filenames = await (
      await find({ channelId: channel, q: "%_" })
    ).json();
    assert.equal(filenames.messages.length, 1);
    assert.equal(filenames.messages[0].id, editableId);
    const context = await (
      await find({ channelId: channel, contextId: searchIds[60] })
    ).json();
    assert.ok(context.messages.some((row) => row.id === searchIds[60]));
    assert.ok(context.messages.length <= 51);
    assert.ok(!context.messages.some((row) => row.id === foreignId));
    assert.equal(
      (await find({ channelId: channel, contextId: foreignId })).status,
      404,
    );
    assert.equal(
      (await find({ channelId: privateChannel, q: "needle" })).status,
      403,
    );
    const direct = await (await find({ userId: friend, q: "Direct" })).json();
    assert.equal(direct.messages.length, 1);
    assert.equal(direct.messages[0].id, directId);
    assert.ok(direct.messages[0].editedAt);
    for (const isDirect of [false, true]) {
      const neighborIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const [index, fraction] of [
        "123455",
        "123456",
        "123457",
      ].entries()) {
        if (isDirect)
          await client.query(
            "INSERT INTO direct_messages (id,sender_id,recipient_id,content,created_at) VALUES ($1,$2,$3,'microsecond neighbor',$4::timestamptz)",
            [
              neighborIds[index],
              actor,
              friend,
              `2027-01-01T12:00:00.${fraction}Z`,
            ],
          );
        else
          await client.query(
            "INSERT INTO messages (id,channel_id,author_id,content,created_at) VALUES ($1,$2,$3,'microsecond neighbor',$4::timestamptz)",
            [
              neighborIds[index],
              channel,
              actor,
              `2027-01-01T12:00:00.${fraction}Z`,
            ],
          );
      }
      const page = await (
        await find({
          ...(isDirect ? { userId: friend } : { channelId: channel }),
          contextId: neighborIds[1],
        })
      ).json();
      const positions = neighborIds.map((id) =>
        page.messages.findIndex((row) => row.id === id),
      );
      assert.ok(
        positions[0] >= 0 &&
          positions[0] < positions[1] &&
          positions[1] < positions[2],
        "Sub-millisecond neighbors must appear once, in chronological order",
      );
      assert.equal(
        new Set(page.messages.map((row) => row.id)).size,
        page.messages.length,
      );
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("attachment migration releases soft-deleted bytes and cascades permanent message removal", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = `lc_attachment_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      "CREATE TABLE users (id uuid PRIMARY KEY); CREATE TABLE messages (id uuid PRIMARY KEY, deleted_at timestamptz); CREATE TABLE direct_messages (id uuid PRIMARY KEY, deleted_at timestamptz)",
    );
    await client.query(
      await readFile(
        new URL(
          "../db/migrations/0013_message_attachments.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const userId = randomUUID();
    await client.query("INSERT INTO users VALUES ($1)", [userId]);
    for (const [table, column] of [
      ["messages", "message_id"],
      ["direct_messages", "direct_message_id"],
    ]) {
      for (const soft of [false, true]) {
        const id = randomUUID();
        await client.query(
          `INSERT INTO ${table} (id, attachments) VALUES ($1, '[{"name":"test.pdf"}]')`,
          [id],
        );
        await client.query(
          `INSERT INTO message_attachments (uploader_id, ${column}, data) VALUES ($1,$2,$3)`,
          [userId, id, Buffer.from("%PDF-1.7")],
        );
        if (soft) {
          await client.query(
            `UPDATE ${table} SET deleted_at=now() WHERE id=$1`,
            [id],
          );
          assert.deepEqual(
            (
              await client.query(
                `SELECT attachments FROM ${table} WHERE id=$1`,
                [id],
              )
            ).rows[0].attachments,
            [],
          );
        } else await client.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM message_attachments",
            )
          ).rows[0].count,
          0,
        );
      }
    }
    const id = randomUUID();
    await client.query("INSERT INTO messages (id) VALUES ($1)", [id]);
    for (const [messageId, directId, data] of [
      [null, null, Buffer.from("x")],
      [id, null, Buffer.alloc(0)],
      [id, null, Buffer.alloc(10485761)],
    ]) {
      await client.query("SAVEPOINT invalid_attachment");
      await assert.rejects(
        client.query(
          "INSERT INTO message_attachments (uploader_id,message_id,direct_message_id,data) VALUES ($1,$2,$3,$4)",
          [userId, messageId, directId, data],
        ),
        (error) => error.code === "23514",
      );
      await client.query("ROLLBACK TO SAVEPOINT invalid_attachment");
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("custom sound migration enforces storage bounds and cascades without touching application data", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = `lc_sound_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query("CREATE TABLE servers (id uuid PRIMARY KEY)");
    const migration = await readFile(
      new URL("../db/migrations/0011_server_sounds.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
    const server = randomUUID();
    await client.query("INSERT INTO servers (id) VALUES ($1)", [server]);
    const audio = Buffer.alloc(44);
    const insert = await client.query(
      "INSERT INTO server_sounds (server_id, name, audio, duration_ms) VALUES ($1, 'Clip', $2, 600) RETURNING id, audio",
      [server, audio],
    );
    assert.deepEqual(insert.rows[0].audio, audio);
    await client.query(
      await readFile(
        new URL("../db/migrations/0012_sound_limits.sql", import.meta.url),
        "utf8",
      ),
    );
    await client.query(
      "INSERT INTO server_sounds (server_id, name, audio, duration_ms) VALUES ($1, 'Ten seconds', $2, 10000)",
      [server, Buffer.alloc(1920044)],
    );
    assert.equal(
      (
        await client.query(
          "SELECT duration_ms FROM server_sounds WHERE id = $1",
          [insert.rows[0].id],
        )
      ).rows[0].duration_ms,
      600,
      "The limit migration must preserve existing clips",
    );
    for (const [name, bytes, duration] of [
      [" ", audio, 600],
      ["Clip", Buffer.alloc(2097153), 600],
      ["Clip", audio, 10001],
    ]) {
      await client.query("SAVEPOINT invalid_sound");
      await assert.rejects(
        client.query(
          "INSERT INTO server_sounds (server_id, name, audio, duration_ms) VALUES ($1, $2, $3, $4)",
          [server, name, bytes, duration],
        ),
        (error) => error.code === "23514",
      );
      await client.query("ROLLBACK TO SAVEPOINT invalid_sound");
    }
    await client.query("DELETE FROM servers WHERE id = $1", [server]);
    assert.equal(
      (await client.query("SELECT count(*)::int AS count FROM server_sounds"))
        .rows[0].count,
      0,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("deleting a server cascades to its channels, memberships, and messages", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const ownerId = randomUUID();
    const demoId = randomUUID();
    const serverId = randomUUID();
    const channelId = randomUUID();

    await client.query(
      `INSERT INTO users (id, role, name, email)
       VALUES ($1, 'owner', 'Owner', $2), ($3, 'demo', 'Guest', NULL)`,
      [ownerId, `owner-${ownerId}@example.test`, demoId],
    );
    await client.query(
      "INSERT INTO servers (id, name, created_by) VALUES ($1, 'Interview', $2)",
      [serverId, ownerId],
    );
    await client.query(
      `INSERT INTO server_members (server_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
      [serverId, ownerId, demoId],
    );
    await client.query(
      `INSERT INTO channels (id, server_id, name, type)
       VALUES ($1, $2, 'general', 'text')`,
      [channelId, serverId],
    );
    await client.query(
      "INSERT INTO messages (channel_id, author_id, content) VALUES ($1, $2, 'Hello')",
      [channelId, demoId],
    );

    await client.query("DELETE FROM servers WHERE id = $1", [serverId]);
    const memberships = await client.query(
      "SELECT count(*)::int AS count FROM server_members WHERE server_id = $1",
      [serverId],
    );
    const messages = await client.query(
      "SELECT count(*)::int AS count FROM messages WHERE channel_id = $1",
      [channelId],
    );
    const channels = await client.query(
      "SELECT count(*)::int AS count FROM channels WHERE server_id = $1",
      [serverId],
    );

    assert.equal(memberships.rows[0].count, 0);
    assert.equal(messages.rows[0].count, 0);
    assert.equal(channels.rows[0].count, 0);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("messages cannot reference users or channels that do not exist", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const userId = randomUUID();
    const serverId = randomUUID();
    const channelId = randomUUID();
    await client.query(
      "INSERT INTO users (id, role, name, email) VALUES ($1, 'owner', 'Owner', $2)",
      [userId, `owner-${userId}@example.test`],
    );
    await client.query(
      "INSERT INTO servers (id, name, created_by) VALUES ($1, 'Constraints', $2)",
      [serverId, userId],
    );
    await client.query(
      "INSERT INTO channels (id, server_id, name, type) VALUES ($1, $2, 'general', 'text')",
      [channelId, serverId],
    );
    for (const [channel, author] of [
      [randomUUID(), userId],
      [channelId, randomUUID()],
    ]) {
      await client.query("SAVEPOINT invalid_message");
      await assert.rejects(
        client.query(
          "INSERT INTO messages (channel_id, author_id, content) VALUES ($1, $2, 'Invalid')",
          [channel, author],
        ),
        (error) => error.code === "23503",
      );
      await client.query("ROLLBACK TO SAVEPOINT invalid_message");
      await client.query("RELEASE SAVEPOINT invalid_message");
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("channels distinguish direct and SFU-backed group calls", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const ownerId = randomUUID();
    const serverId = randomUUID();
    await client.query(
      "INSERT INTO users (id, role, name, email) VALUES ($1, 'owner', 'Owner', $2)",
      [ownerId, `owner-${ownerId}@example.test`],
    );
    await client.query(
      "INSERT INTO servers (id, name, created_by) VALUES ($1, 'Calls', $2)",
      [serverId, ownerId],
    );
    await client.query(
      `INSERT INTO channels (server_id, name, type)
       VALUES ($1, 'Pair', 'voice_direct'), ($1, 'Team', 'voice_group')`,
      [serverId],
    );
    const result = await client.query(
      "SELECT type FROM channels WHERE server_id = $1 ORDER BY type",
      [serverId],
    );

    assert.deepEqual(
      result.rows.map((row) => row.type),
      ["voice_direct", "voice_group"],
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
