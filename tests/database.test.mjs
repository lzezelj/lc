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
import { attachmentRange } from "../server/attachment-range.ts";
import { moveRelative } from "../lib/list-order.ts";

const { Client } = pg;

test("channel moves are owner-only within Text/Voice; server order is private to the signed-in account and new items append", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    const [owner, member, mod, first, second, third] = Array.from(
      { length: 6 },
      () => randomUUID(),
    );
    await database.insert(schema.users).values([
      { id: owner, name: "Owner" },
      { id: member, name: "Member" },
      { id: mod, name: "Moderator" },
    ]);
    await database.insert(schema.servers).values([
      { id: first, name: "First", createdBy: owner },
      { id: second, name: "Second", createdBy: owner },
      { id: third, name: "Private", createdBy: owner },
    ]);
    await database.insert(schema.serverMembers).values([
      { userId: owner, serverId: first, role: "owner", position: 0 },
      { userId: owner, serverId: second, role: "owner", position: 1 },
      { userId: member, serverId: first, position: 0 },
      { userId: member, serverId: second, position: 1 },
      { userId: mod, serverId: first, role: "mod" },
    ]);
    const [a, b, c, voiceA, voiceB, foreign] = await database
      .insert(schema.channels)
      .values([
        { serverId: first, name: "Text A", type: "text", position: 0 },
        { serverId: first, name: "Text B", type: "text", position: 1 },
        { serverId: first, name: "Text C", type: "text", position: 2 },
        { serverId: first, name: "Voice A", type: "voice_direct", position: 0 },
        { serverId: first, name: "Voice B", type: "voice_group", position: 1 },
        { serverId: third, name: "Foreign", type: "text" },
      ])
      .returning();
    let actor = owner,
      allowed = true;
    const events = [];
    const databaseProxy = new Proxy(database, {
      get(target, key) {
        if (key === "transaction") return (run) => run(database);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const load = async (path, prefix) => {
      const exports = {};
      const dependencies = {
        "drizzle-orm": orm,
        "next/server": { NextResponse: { json: Response.json } },
        "node:crypto": { randomUUID },
        [`${prefix}auth`]: {
          auth: async () =>
            actor ? { user: { id: actor, role: "member" } } : null,
        },
        [`${prefix}db`]: { db: databaseProxy },
        [`${prefix}db/schema`]: schema,
        [`${prefix}server/notify-user`]: {
          notifyUser: async (userId, event) => events.push({ userId, event }),
        },
        [`${prefix}server/rate-limit`]: {
          rateLimits: { serverMutation: {} },
          checkRateLimit: () => ({ allowed, retryAfterSeconds: 2 }),
        },
        [`${prefix}server/notify-server`]: {},
        [`${prefix}server/remove-channel-media`]: {},
        [`${prefix}server/disconnect-user`]: {},
        "../../../../../../lib/list-order": { moveRelative },
        "../../../../lib/list-order": { moveRelative },
      };
      vm.runInNewContext(
        ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        }),
        {
          exports,
          Response,
          require: (name) => {
            assert.ok(name in dependencies, name);
            return dependencies[name];
          },
        },
      );
      return exports;
    };
    const channelOrder = await load(
      "../app/api/servers/[serverId]/channels/order/route.ts",
      "../../../../../../",
    );
    const serverOrder = await load(
      "../app/api/servers/order/route.ts",
      "../../../../",
    );
    const serverList = await load("../app/api/servers/route.ts", "../../../");
    const channelList = await load(
      "../app/api/servers/[serverId]/channels/route.ts",
      "../../../../../",
    );
    const request = (body) =>
      new Request("http://local/order", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const context = { params: Promise.resolve({ serverId: first }) };
    const moveChannel = (channelId, targetId = a.id, placement = "before") =>
      channelOrder.POST(request({ channelId, targetId, placement }), context);
    const channels = async () =>
      await (
        await channelList.GET(new Request("http://local/channels"), context)
      ).json();
    const servers = async () =>
      (await (await serverList.GET()).json()).map((row) => row.id);
    actor = null;
    assert.equal((await moveChannel(a.id)).status, 401);
    actor = member;
    assert.equal((await moveChannel(a.id)).status, 403);
    actor = mod;
    assert.equal((await moveChannel(a.id)).status, 403);
    actor = owner;
    assert.equal((await moveChannel(foreign.id)).status, 404);
    assert.equal((await moveChannel(a.id, b.id, "sideways")).status, 400);
    assert.equal((await moveChannel(a.id, voiceA.id)).status, 400);
    assert.equal((await moveChannel(a.id, foreign.id)).status, 404);
    assert.equal(events.length, 0);
    assert.equal((await moveChannel(c.id, a.id)).status, 200);
    let rows = await channels();
    assert.deepEqual(
      rows.filter((row) => row.type === "text").map((row) => row.id),
      [c.id, a.id, b.id],
    );
    assert.deepEqual(
      rows.filter((row) => row.type !== "text").map((row) => row.id),
      [voiceA.id, voiceB.id],
    );
    assert.equal(
      (await moveChannel(voiceA.id, voiceB.id, "after")).status,
      200,
    );
    rows = await channels();
    assert.deepEqual(
      rows.filter((row) => row.type !== "text").map((row) => row.id),
      [voiceB.id, voiceA.id],
    );
    assert.equal((await moveChannel(a.id)).status, 200); // First in Text stays first.
    assert.deepEqual(
      [...new Set(events.map((event) => event.userId))].sort(),
      [owner, member, mod].sort(),
    );
    assert.ok(
      events.every(
        ({ event }) =>
          event.type === "channel-order-updated" && event.serverId === first,
      ),
    );
    const [added] = await database
      .insert(schema.channels)
      .values({ serverId: first, name: "New text", type: "text" })
      .returning();
    assert.equal(
      (await channels()).filter((row) => row.type === "text").at(-1).id,
      added.id,
    );
    actor = member;
    events.length = 0;
    assert.equal(
      (
        await serverOrder.POST(
          request({
            serverId: second,
            targetId: first,
            placement: "before",
            userId: owner,
          }),
        )
      ).status,
      200,
    );
    assert.deepEqual(await servers(), [second, first]);
    assert.ok(
      events.every(
        ({ userId, event }) =>
          userId === member && event.type === "server-order-updated",
      ),
    );
    actor = owner;
    assert.deepEqual(await servers(), [first, second]);
    actor = member;
    assert.equal(
      (
        await serverOrder.POST(
          request({ serverId: third, targetId: first, placement: "before" }),
        )
      ).status,
      403,
    );
    await database
      .insert(schema.serverMembers)
      .values({ userId: member, serverId: third });
    assert.deepEqual(await servers(), [second, first, third]);
    allowed = false;
    assert.equal(
      (
        await serverOrder.POST(
          request({ serverId: first, targetId: second, placement: "before" }),
        )
      ).status,
      429,
    );
    actor = owner;
    assert.equal((await moveChannel(a.id)).status, 429);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("AFK channel references clear on channel deletion and do not prevent server cascades", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const owner = randomUUID(),
      server = randomUUID(),
      channel = randomUUID(),
      replacement = randomUUID();
    await client.query("INSERT INTO users(id,name) VALUES($1,'AFK owner')", [
      owner,
    ]);
    await client.query(
      "INSERT INTO servers(id,name,created_by) VALUES($1,'AFK test',$2)",
      [server, owner],
    );
    await client.query(
      "INSERT INTO channels(id,server_id,name,type) VALUES($1,$2,'AFK','voice_group')",
      [channel, server],
    );
    await client.query("UPDATE servers SET afk_channel_id=$1 WHERE id=$2", [
      channel,
      server,
    ]);
    await client.query("DELETE FROM channels WHERE id=$1", [channel]);
    assert.equal(
      (
        await client.query("SELECT afk_channel_id FROM servers WHERE id=$1", [
          server,
        ])
      ).rows[0].afk_channel_id,
      null,
    );
    await client.query(
      "INSERT INTO channels(id,server_id,name,type) VALUES($1,$2,'AFK','voice_group')",
      [replacement, server],
    );
    await client.query("UPDATE servers SET afk_channel_id=$1 WHERE id=$2", [
      replacement,
      server,
    ]);
    await client.query("DELETE FROM servers WHERE id=$1", [server]);
    assert.equal(
      (
        await client.query("SELECT id FROM channels WHERE server_id=$1", [
          server,
        ])
      ).rowCount,
      0,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("AFK creation returns the destination immediately; settings require the owner and a same-server group channel", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    const owner = randomUUID(),
      outsider = randomUUID(),
      serverId = randomUUID(),
      otherServer = randomUUID();
    await database.insert(schema.users).values([
      { id: owner, name: "Owner" },
      { id: outsider, name: "Outsider" },
    ]);
    await database.insert(schema.servers).values([
      { id: serverId, name: "AFK server", createdBy: owner },
      { id: otherServer, name: "Other", createdBy: owner },
    ]);
    const [group, text, foreign] = await database
      .insert(schema.channels)
      .values([
        { serverId, name: "Group", type: "voice_group" },
        { serverId, name: "Text", type: "text" },
        { serverId: otherServer, name: "Foreign", type: "voice_group" },
      ])
      .returning();
    let actor = owner;
    const events = [],
      route = {};
    const db = new Proxy(database, {
      get(target, key) {
        if (key === "transaction") return (run) => run(database);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const dependencies = {
      "node:crypto": { randomUUID },
      "drizzle-orm": orm,
      "next/server": { NextResponse: { json: Response.json } },
      "../../../auth": {
        auth: async () => ({ user: { id: actor, role: "member" } }),
      },
      "../../../db": { db },
      "../../../db/schema": schema,
      "../../../server/notify-server": {
        notifyServer: async (id) => events.push(id),
      },
      "../../../server/disconnect-user": {},
      "../../../server/rate-limit": {
        rateLimits: { serverMutation: {} },
        checkRateLimit: () => ({ allowed: true }),
      },
    };
    vm.runInNewContext(
      ts.transpile(
        await readFile(
          new URL("../app/api/servers/route.ts", import.meta.url),
          "utf8",
        ),
        { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      ),
      { exports: route, Response, require: (name) => dependencies[name] },
    );
    const save = (options) =>
      route.PATCH(
        new Request("http://local/servers", {
          method: "PATCH",
          body: JSON.stringify({ serverId, ...options }),
        }),
      );
    actor = outsider;
    assert.equal((await save({ createAfk: true })).status, 403);
    actor = owner;
    for (const afkChannelId of [text.id, foreign.id, "invalid"])
      assert.ok([400, 403].includes((await save({ afkChannelId })).status));
    assert.equal(events.length, 0);
    assert.equal((await save({ afkChannelId: group.id })).status, 200);
    assert.equal(
      (
        await database
          .select()
          .from(schema.servers)
          .where(orm.eq(schema.servers.id, serverId))
      )[0].afkChannelId,
      group.id,
    );
    const created = await (await save({ createAfk: true })).json();
    const [destination] = await database
      .select()
      .from(schema.channels)
      .where(orm.eq(schema.channels.id, created.afkChannelId));
    assert.equal(destination.serverId, serverId);
    assert.equal(destination.type, "voice_group");
    assert.equal((await save({ afkChannelId: null })).status, 200);
    assert.equal(events.length, 3);
    const creation = await route.POST(
      new Request("http://local/servers", {
        method: "POST",
        body: JSON.stringify({ name: "New AFK server", createAfk: true }),
      }),
    );
    assert.equal(creation.status, 201);
    const server = await creation.json();
    assert.ok(server.afkChannelId);
    const [newAfk] = await database
      .select()
      .from(schema.channels)
      .where(orm.eq(schema.channels.id, server.afkChannelId));
    assert.equal(newAfk.serverId, server.id);
    assert.equal(newAfk.type, "voice_group");
    assert.equal(
      (
        await database
          .select()
          .from(schema.servers)
          .where(orm.eq(schema.servers.id, serverId))
      )[0].afkChannelId,
      null,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("moderator migration extends only server roles and preserves ordinary account roles", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const temporarySchema = `lc_mod_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${temporarySchema}"`);
    await client.query(`SET LOCAL search_path TO "${temporarySchema}"`);
    await client.query("CREATE TYPE server_role AS ENUM ('owner', 'member')");
    await client.query(
      "CREATE TYPE user_role AS ENUM ('owner', 'member', 'demo')",
    );
    await client.query(
      await readFile(
        new URL("../db/migrations/0029_server_moderators.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const [type, expected] of [
      ["server_role", ["owner", "member", "mod"]],
      ["user_role", ["owner", "member", "demo"]],
    ]) {
      const { rows } = await client.query(
        "SELECT enumlabel FROM pg_enum WHERE enumtypid = $1::regtype ORDER BY enumsortorder",
        [type],
      );
      assert.deepEqual(
        rows.map((row) => row.enumlabel),
        expected,
      );
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("video attachment migration permits 25 MiB, serves authorized PostgreSQL byte ranges and cleans up deletions", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    const owner = randomUUID(),
      outsider = randomUUID(),
      serverId = randomUUID(),
      channelId = randomUUID(),
      messageId = randomUUID(),
      fileId = randomUUID();
    await database.insert(schema.users).values([
      { id: owner, name: "Video owner" },
      { id: outsider, name: "Video outsider" },
    ]);
    await database
      .insert(schema.servers)
      .values({ id: serverId, name: "Video range test", createdBy: owner });
    await database
      .insert(schema.serverMembers)
      .values({ serverId, userId: owner, role: "owner" });
    await database
      .insert(schema.channels)
      .values({ id: channelId, serverId, name: "clips", type: "text" });
    const data = Buffer.alloc(25 * 1024 * 1024);
    Buffer.from("000000186674797069736f6d0000020069736f6d6d703432", "hex").copy(
      data,
    );
    const metadata = [
      { id: fileId, name: "clip.mp4", type: "video/mp4", size: data.length },
    ];
    await database.insert(schema.messages).values({
      id: messageId,
      channelId,
      authorId: owner,
      content: "",
      attachments: metadata,
    });
    await database
      .insert(schema.messageAttachments)
      .values({ id: fileId, uploaderId: owner, messageId, data });
    await client.query("SAVEPOINT oversized_video");
    await assert.rejects(
      client.query(
        "INSERT INTO message_attachments(uploader_id,message_id,data) VALUES($1,$2,$3)",
        [owner, messageId, Buffer.alloc(data.length + 1)],
      ),
      /attachment_size/,
    );
    await client.query("ROLLBACK TO SAVEPOINT oversized_video");
    let actor = owner;
    const route = {};
    const dependencies = {
      "drizzle-orm": orm,
      "../../../../auth": { auth: async () => ({ user: { id: actor } }) },
      "../../../../db": { db: database },
      "../../../../db/schema": schema,
      "../../../../server/friends": { areFriends: async () => false },
      "../../../../server/attachment-range": { attachmentRange },
    };
    vm.runInNewContext(
      ts.transpile(
        await readFile(
          new URL(
            "../app/api/attachments/[attachmentId]/route.ts",
            import.meta.url,
          ),
          "utf8",
        ),
        { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      ),
      {
        exports: route,
        Response,
        Uint8Array,
        URL,
        require: (name) => {
          assert.ok(name in dependencies, name);
          return dependencies[name];
        },
      },
    );
    const read = () =>
      route.GET(
        new Request(`http://local/api/attachments/${fileId}`, {
          headers: { Range: "bytes=4-15" },
        }),
        { params: Promise.resolve({ attachmentId: fileId }) },
      );
    const response = await read();
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Length"), "12");
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      data.subarray(4, 16),
    );
    actor = outsider;
    assert.equal((await read()).status, 404);
    actor = owner;
    await database
      .update(schema.messages)
      .set({ deletedAt: new Date() })
      .where(orm.eq(schema.messages.id, messageId));
    assert.equal((await read()).status, 404);
    assert.equal(
      (
        await database
          .select()
          .from(schema.messageAttachments)
          .where(orm.eq(schema.messageAttachments.id, fileId))
      ).length,
      0,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("server pictures persist privately for members and pending invitees, revoke access and cascade on server deletion", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    const owner = randomUUID(),
      member = randomUUID(),
      invitee = randomUUID(),
      outsider = randomUUID(),
      serverId = randomUUID();
    await database.insert(schema.users).values(
      [owner, member, invitee, outsider].map((id) => ({
        id,
        name: "Picture test",
      })),
    );
    await database
      .insert(schema.servers)
      .values({ id: serverId, name: "Private picture", createdBy: owner });
    await database.insert(schema.serverMembers).values([
      { serverId, userId: owner, role: "owner" },
      { serverId, userId: member },
    ]);
    await database
      .insert(schema.serverInvitations)
      .values({ serverId, inviterId: owner, recipientId: invitee });
    const transactional = new Proxy(database, {
      get(target, key) {
        if (key === "transaction") return async (run) => run(database);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const helpers = {},
      route = {},
      events = [];
    let actor = owner;
    const load = async (path, exports, deps) =>
      vm.runInNewContext(
        ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        }),
        {
          exports,
          Response,
          Buffer,
          Uint8Array,
          require: (name) => {
            assert.ok(name in deps, name);
            return deps[name];
          },
        },
      );
    await load("../server/profile-pictures.ts", helpers, {
      "node:crypto": { randomUUID },
      "drizzle-orm": orm,
      "../db": { db: transactional },
      "../db/schema": schema,
      "./notify-user": {},
    });
    await load("../app/api/servers/[serverId]/picture/route.ts", route, {
      "node:crypto": { randomUUID },
      "drizzle-orm": orm,
      "../../../../../auth": {
        auth: async () => (actor ? { user: { id: actor } } : null),
      },
      "../../../../../db": { db: transactional },
      "../../../../../db/schema": schema,
      "../../../../../server/profile-pictures": helpers,
      "../../../../../server/rate-limit": {
        checkRateLimit: () => ({ allowed: true }),
      },
      "../../../../../server/notify-user": {
        notifyUser: async (id, event) => events.push({ id, event }),
      },
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=",
      "base64",
    );
    const run = (method) =>
      route[method](
        new Request("http://local/picture", {
          method,
          ...(method === "PUT"
            ? { headers: { "Content-Type": "image/png" }, body: png }
            : {}),
        }),
        { params: Promise.resolve({ serverId }) },
      );
    assert.equal((await run("PUT")).status, 200);
    assert.deepEqual(
      events.map((event) => event.id).sort(),
      [owner, member, invitee].sort(),
    );
    for (const viewer of [owner, member, invitee]) {
      actor = viewer;
      const response = await run("GET");
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    }
    assert.equal(
      (
        await database
          .select()
          .from(schema.serverMembers)
          .where(orm.eq(schema.serverMembers.userId, invitee))
      ).length,
      0,
      "Seeing an invitation picture grants no membership",
    );
    actor = outsider;
    for (const method of ["GET", "PUT", "DELETE"])
      assert.equal((await run(method)).status, method === "GET" ? 404 : 403);
    await database
      .delete(schema.serverInvitations)
      .where(orm.eq(schema.serverInvitations.serverId, serverId));
    actor = invitee;
    assert.equal(
      (await run("GET")).status,
      404,
      "Cancelling an invite revokes picture access",
    );
    await database
      .delete(schema.serverMembers)
      .where(orm.eq(schema.serverMembers.userId, member));
    actor = member;
    assert.equal(
      (await run("GET")).status,
      404,
      "Leaving revokes picture access",
    );
    actor = owner;
    assert.equal((await run("DELETE")).status, 200);
    assert.equal(
      (
        await database
          .select()
          .from(schema.serverPictures)
          .where(orm.eq(schema.serverPictures.serverId, serverId))
      ).length,
      0,
    );
    assert.equal(
      (
        await database
          .select()
          .from(schema.servers)
          .where(orm.eq(schema.servers.id, serverId))
      )[0].image,
      null,
    );
    assert.equal((await run("PUT")).status, 200);
    await database
      .delete(schema.servers)
      .where(orm.eq(schema.servers.id, serverId));
    assert.equal(
      (
        await database
          .select()
          .from(schema.serverPictures)
          .where(orm.eq(schema.serverPictures.serverId, serverId))
      ).length,
      0,
      "Server deletion removes picture bytes",
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("pending server invitations grant access only on recipient acceptance and isolate senders, accounts and server lifetimes", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    const owner = randomUUID(),
      recipient = randomUUID(),
      outsider = randomUUID(),
      demo = randomUUID(),
      serverId = randomUUID();
    await database.insert(schema.users).values([
      { id: owner, name: "Inviter" },
      { id: recipient, name: "Recipient" },
      { id: outsider, name: "Outsider" },
      { id: demo, name: "Demo", role: "demo" },
    ]);
    await database
      .insert(schema.servers)
      .values({ id: serverId, name: "Invitation test", createdBy: owner });
    await database
      .insert(schema.serverMembers)
      .values({ serverId, userId: owner, role: "owner" });
    await database
      .insert(schema.channels)
      .values({ serverId, name: "private", type: "text" });
    const transactional = new Proxy(database, {
      get(target, key) {
        if (key === "transaction")
          return async (run) => {
            await client.query("SAVEPOINT invitations_test");
            try {
              const result = await run(database);
              await client.query("RELEASE SAVEPOINT invitations_test");
              return result;
            } catch (error) {
              await client.query("ROLLBACK TO SAVEPOINT invitations_test");
              await client.query("RELEASE SAVEPOINT invitations_test");
              throw error;
            }
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let actor = owner;
    const events = [];
    async function load(path, extra) {
      const exports = {};
      vm.runInNewContext(
        ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        }),
        {
          exports,
          Response,
          require: (name) => {
            const deps = { "drizzle-orm": orm, ...extra };
            assert.ok(name in deps, name);
            return deps[name];
          },
        },
      );
      return exports;
    }
    const service = await load("../server/server-invitations.ts", {
      "../db": { db: transactional },
      "../db/schema": schema,
    });
    const route = await load("../app/api/server-invitations/route.ts", {
      "../../../auth": {
        auth: async () => (actor ? { user: { id: actor } } : null),
      },
      "../../../db": { db: transactional },
      "../../../db/schema": schema,
      "../../../server/rate-limit": {
        checkRateLimit: () => ({ allowed: true }),
        rateLimits: { serverMutation: {} },
      },
      "../../../server/notify-user": {
        notifyUser: async (id, event) => events.push({ id, event }),
      },
    });
    const channelRoute = await load(
      "../app/api/servers/[serverId]/channels/route.ts",
      {
        "../../../../../auth": { auth: async () => ({ user: { id: actor } }) },
        "../../../../../db": { db: transactional },
        "../../../../../db/schema": schema,
        "next/server": { NextResponse: { json: Response.json } },
        "../../../../../server/rate-limit": {},
        "../../../../../server/notify-server": {},
        "../../../../../server/remove-channel-media": {},
      },
    );
    const channels = () =>
      channelRoute.GET(null, { params: Promise.resolve({ serverId }) });
    const list = async () => (await route.GET()).json();
    const act = (id, action) =>
      route.PATCH(
        new Request("http://local/server-invitations", {
          method: "PATCH",
          body: JSON.stringify({ id, action }),
        }),
      );
    const issue = () =>
      service.createServerInvitations(serverId, owner, [recipient]);
    assert.equal(
      (await service.createServerInvitations(serverId, outsider, [recipient]))
        .status,
      403,
    );
    assert.equal(
      (await service.createServerInvitations(serverId, owner, [demo])).status,
      400,
    );
    assert.deepEqual(Array.from((await issue()).invited), [recipient]);
    await issue();
    assert.equal(
      (await database.select().from(schema.serverInvitations)).length,
      1,
      "Repeated sends preserve one pending invitation",
    );
    actor = recipient;
    assert.equal(
      (await channels()).status,
      403,
      "Invitation is not server membership",
    );
    const [invitation] = await list();
    assert.equal(invitation.serverName, "Invitation test");
    assert.equal(invitation.incoming, true);
    assert.equal((await act(invitation.id, "cancel")).status, 403);
    actor = outsider;
    assert.deepEqual(await list(), []);
    assert.equal((await act(invitation.id, "accept")).status, 403);
    actor = owner;
    assert.equal((await list())[0].incoming, false);
    assert.equal((await act(invitation.id, "accept")).status, 403);
    actor = recipient;
    assert.equal((await act(invitation.id, "decline")).status, 200);
    assert.equal((await channels()).status, 403);
    await issue();
    const [declinedReplacement] = await list();
    actor = owner;
    assert.equal((await act(declinedReplacement.id, "cancel")).status, 200);
    actor = recipient;
    assert.equal((await act(declinedReplacement.id, "accept")).status, 404);
    await issue();
    const [accepted] = await list();
    assert.equal((await act(accepted.id, "accept")).status, 200);
    const confirmation = events.filter(({ event }) => event.notice);
    assert.equal(confirmation.length, 1);
    assert.equal(confirmation[0].id, owner);
    assert.match(
      confirmation[0].event.notice,
      /accepted your invitation to Invitation test/,
    );
    assert.equal((await channels()).status, 200);
    assert.deepEqual(await list(), []);
    assert.equal((await act(accepted.id, "accept")).status, 404);
    assert.equal(
      (
        await database
          .select()
          .from(schema.serverMembers)
          .where(orm.eq(schema.serverMembers.userId, recipient))
      ).length,
      1,
    );
    assert.deepEqual(
      Array.from((await issue()).invited),
      [],
      "Members are not invited again",
    );
    assert.ok(
      events.every(({ event }) => event.type === "server-invitations-changed"),
      "Invitation delivery never requests global access reset or call disconnect",
    );
    await database
      .delete(schema.serverMembers)
      .where(orm.eq(schema.serverMembers.userId, recipient));
    await issue();
    const [stale] = await list();
    await database
      .update(schema.servers)
      .set({ createdBy: outsider })
      .where(orm.eq(schema.servers.id, serverId));
    assert.equal((await act(stale.id, "accept")).status, 410);
    assert.deepEqual(await list(), []);
    await database
      .update(schema.servers)
      .set({ createdBy: owner })
      .where(orm.eq(schema.servers.id, serverId));
    await database
      .update(schema.users)
      .set({ disabledAt: new Date() })
      .where(orm.eq(schema.users.id, recipient));
    assert.equal((await act(stale.id, "accept")).status, 410);
    await database
      .delete(schema.servers)
      .where(orm.eq(schema.servers.id, serverId));
    assert.equal(
      (await database.select().from(schema.serverInvitations)).length,
      0,
    );
    actor = null;
    assert.equal((await route.GET()).status, 401);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("server voice moderation flags default off and stay isolated by member and server", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const owner = randomUUID(),
      person = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    await client.query(
      "INSERT INTO users (id, role, name) VALUES ($1, 'owner', 'Owner'), ($2, 'member', 'Person')",
      [owner, person],
    );
    await client.query(
      "INSERT INTO servers (id, name, created_by) VALUES ($1, 'First', $3), ($2, 'Second', $3)",
      [first, second, owner],
    );
    await client.query(
      "INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $3, 'owner'), ($1, $4, 'member'), ($2, $4, 'member')",
      [first, second, owner, person],
    );
    let result = await client.query(
      "SELECT voice_muted, voice_deafened FROM server_members WHERE server_id IN ($1, $2)",
      [first, second],
    );
    assert.ok(
      result.rows.every(
        (row) => row.voice_muted === false && row.voice_deafened === false,
      ),
    );
    await client.query(
      "UPDATE server_members SET voice_deafened = true WHERE server_id = $1 AND user_id = $2",
      [first, person],
    );
    result = await client.query(
      "SELECT server_id, user_id, voice_muted, voice_deafened FROM server_members WHERE server_id IN ($1, $2)",
      [first, second],
    );
    assert.equal(result.rows.filter((row) => row.voice_deafened).length, 1);
    assert.ok(result.rows.every((row) => !row.voice_muted));
    assert.equal(
      result.rows.find((row) => row.voice_deafened).server_id,
      first,
    );
    await client.query(
      "DELETE FROM server_members WHERE server_id = $1 AND user_id = $2",
      [first, person],
    );
    await client.query(
      "INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $2, 'member')",
      [first, person],
    );
    result = await client.query(
      "SELECT voice_muted, voice_deafened FROM server_members WHERE server_id = $1 AND user_id = $2",
      [first, person],
    );
    assert.deepEqual(result.rows, [
      { voice_muted: false, voice_deafened: false },
    ]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("profile picture storage replaces one bounded row and cleans up when removed", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const userId = randomUUID();
    const memberId = randomUUID(),
      friendId = randomUUID(),
      outsiderId = randomUUID(),
      serverId = randomUUID();
    const database = drizzle(client, { schema });
    await client.query(
      "INSERT INTO users(id,name,image) VALUES($1,'Avatar fixture','/api/avatar?v=first')",
      [userId],
    );
    await database.insert(schema.users).values([
      { id: memberId, name: "Avatar member" },
      { id: friendId, name: "Avatar friend" },
      { id: outsiderId, name: "Avatar outsider" },
    ]);
    await database
      .insert(schema.servers)
      .values({ id: serverId, createdBy: userId, name: "Avatar access" });
    await database.insert(schema.serverMembers).values([
      { serverId, userId },
      { serverId, userId: memberId },
    ]);
    await database.insert(schema.friendships).values([
      { requesterId: userId, recipientId: friendId, status: "accepted" },
      { requesterId: userId, recipientId: outsiderId, status: "pending" },
    ]);
    const helpers = {};
    vm.runInNewContext(
      ts.transpile(
        await readFile(
          new URL("../server/profile-pictures.ts", import.meta.url),
          "utf8",
        ),
        { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      ),
      {
        exports: helpers,
        Buffer,
        Response,
        require: (name) =>
          ({
            "node:crypto": { randomUUID },
            "drizzle-orm": orm,
            "../db": { db: database },
            "../db/schema": schema,
            "./notify-user": { notifyUser: async () => {} },
          })[name],
      },
    );
    assert.deepEqual(
      [...(await helpers.profileAudience(userId))].sort(),
      [userId, memberId, friendId].sort(),
      "Only self, current members and accepted friends can read pictures",
    );
    await database
      .delete(schema.serverMembers)
      .where(orm.eq(schema.serverMembers.userId, memberId));
    await database
      .delete(schema.friendships)
      .where(orm.eq(schema.friendships.recipientId, friendId));
    assert.deepEqual(
      [...(await helpers.profileAudience(userId))],
      [userId],
      "Revoked relationships immediately remove picture access",
    );
    const data = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=",
      "base64",
    );
    await client.query(
      "INSERT INTO user_avatars(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      [userId, data],
    );
    await client.query(
      "INSERT INTO user_avatars(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
      [userId, data],
    );
    assert.equal(
      (
        await client.query("SELECT 1 FROM user_avatars WHERE user_id=$1", [
          userId,
        ])
      ).rowCount,
      1,
    );
    await client.query("UPDATE users SET image=NULL WHERE id=$1", [userId]);
    assert.equal(
      (
        await client.query("SELECT 1 FROM user_avatars WHERE user_id=$1", [
          userId,
        ])
      ).rowCount,
      0,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

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
  const user = randomUUID(),
    otherUser = randomUUID(),
    server = randomUUID(),
    otherServer = randomUUID(),
    sound = randomUUID();
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
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
    // The route's transaction must stay inside this test's outer rollback.
    const scopedDatabase = new Proxy(database, {
      get(target, key) {
        if (key === "transaction") return (run) => run(database);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const dependencies = {
      "drizzle-orm": orm,
      "next/server": { NextResponse: { json: Response.json } },
      "../../../../../auth": {
        auth: async () => ({ user: { id: actor, role: "member" } }),
      },
      "../../../../../db": { db: scopedDatabase },
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
    try {
      const leftovers = await client.query(
        "SELECT (SELECT count(*) FROM users WHERE id = ANY($1::uuid[])) + (SELECT count(*) FROM servers WHERE id = ANY($2::uuid[])) AS count",
        [
          [user, otherUser],
          [server, otherServer],
        ],
      );
      assert.equal(
        Number(leftovers.rows[0].count),
        0,
        "Join-sound fixtures must not survive rollback",
      );
    } finally {
      await client.end();
    }
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
      "./notify-user": { notifyUser: async () => {} },
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

test("global attachment retention expires old files transactionally and preserves messages", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await observer.connect();
  const schema = `lc_retention_${randomUUID().replaceAll("-", "")}`;
  const [
    channel,
    server,
    message,
    direct,
    recentMessage,
    oldFile,
    directFile,
    recentFile,
    sender,
    recipient,
    member,
  ] = Array.from({ length: 11 }, () => randomUUID());
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE channels (id uuid PRIMARY KEY, server_id uuid);
      CREATE TABLE server_members (server_id uuid, user_id uuid);
      CREATE TABLE messages (id uuid PRIMARY KEY, channel_id uuid, text text, attachments jsonb, created_at timestamptz);
      CREATE TABLE direct_messages (id uuid PRIMARY KEY, sender_id uuid, recipient_id uuid, text text, attachments jsonb, created_at timestamptz);
      CREATE TABLE message_attachments (id uuid PRIMARY KEY, message_id uuid, direct_message_id uuid, data bytea);
    `);
    await client.query("INSERT INTO channels VALUES ($1,$2)", [
      channel,
      server,
    ]);
    await client.query("INSERT INTO server_members VALUES ($1,$2)", [
      server,
      member,
    ]);
    await client.query(
      "INSERT INTO messages VALUES ($1,$2,'keep channel text',$3,now()-interval '50 days'),($4,$2,'keep recent text',$5,now())",
      [
        message,
        channel,
        JSON.stringify([{ id: oldFile, name: "old.png" }]),
        recentMessage,
        JSON.stringify([{ id: recentFile, name: "recent.png" }]),
      ],
    );
    await client.query(
      "INSERT INTO direct_messages VALUES ($1,$2,$3,'keep direct text',$4,now()-interval '40 days')",
      [
        direct,
        sender,
        recipient,
        JSON.stringify([{ id: directFile, name: "old.mp4" }]),
      ],
    );
    await client.query(
      "INSERT INTO message_attachments VALUES ($1,$2,null,$3),($4,null,$5,$6),($7,$8,null,$9)",
      [
        oldFile,
        message,
        Buffer.alloc(20),
        directFile,
        direct,
        Buffer.alloc(30),
        recentFile,
        recentMessage,
        Buffer.alloc(40),
      ],
    );
    await client.query(
      await readFile(
        new URL(
          "../db/migrations/0027_attachment_retention.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      (await client.query("SELECT lc_attachment_budget(10,100,50) AS audience"))
        .rows[0].audience,
      [],
    );
    assert.equal(
      (
        await observer.query(
          "SELECT pg_try_advisory_xact_lock(73492017) AS acquired",
        )
      ).rows[0].acquired,
      false,
      "Budget checks hold the shared lock until transaction completion",
    );
    const firstExpired = await client.query(
      "SELECT lc_attachment_budget(30,100,70) AS audience",
    );
    assert.deepEqual(firstExpired.rows[0].audience, [member]);
    assert.deepEqual(
      new Set(
        (await client.query("SELECT id FROM message_attachments")).rows.map(
          (row) => row.id,
        ),
      ),
      new Set([directFile, recentFile]),
      "The oldest file expires before a newer eligible file",
    );
    const expired = await client.query(
      "SELECT lc_attachment_budget(40,100,50) AS audience",
    );
    assert.deepEqual(
      new Set(expired.rows[0].audience),
      new Set([sender, recipient]),
    );
    assert.deepEqual(
      (await client.query("SELECT id FROM message_attachments")).rows.map(
        (row) => row.id,
      ),
      [recentFile],
    );
    const channelRow = (
      await client.query("SELECT text, attachments FROM messages WHERE id=$1", [
        message,
      ])
    ).rows[0];
    assert.equal(channelRow.text, "keep channel text");
    assert.equal(channelRow.attachments[0].expired, true);
    const directRow = (
      await client.query(
        "SELECT text, attachments FROM direct_messages WHERE id=$1",
        [direct],
      )
    ).rows[0];
    assert.equal(directRow.text, "keep direct text");
    assert.equal(directRow.attachments[0].expired, true);
    assert.equal(
      (
        await client.query("SELECT attachments FROM messages WHERE id=$1", [
          recentMessage,
        ])
      ).rows[0].attachments[0].expired,
      undefined,
    );

    // A failed cleanup must restore even the eligible file it tried deleting.
    await client.query(
      "INSERT INTO message_attachments (id,message_id,data,created_at) VALUES ($1,$2,$3,now()-interval '50 days')",
      [oldFile, message, Buffer.alloc(10)],
    );
    await client.query("UPDATE messages SET attachments=$2 WHERE id=$1", [
      message,
      JSON.stringify([{ id: oldFile, name: "restored.png" }]),
    ]);
    await client.query("SAVEPOINT cannot_free_enough");
    await assert.rejects(
      client.query("SELECT lc_attachment_budget(70,100,50)"),
      (error) =>
        error.code === "P0001" &&
        error.message === "LC_ATTACHMENT_STORAGE_FULL",
    );
    await client.query("ROLLBACK TO SAVEPOINT cannot_free_enough");
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM message_attachments",
        )
      ).rows[0].count,
      2,
    );
    assert.equal(
      (
        await client.query("SELECT attachments FROM messages WHERE id=$1", [
          message,
        ])
      ).rows[0].attachments[0].expired,
      undefined,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
    await observer.end();
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
    await client.query(
      await readFile(
        new URL(
          "../db/migrations/0028_sound_duration_margin.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await client.query(
      "INSERT INTO server_sounds (server_id, name, audio, duration_ms) VALUES ($1, 'Duration margin', $2, 10010)",
      [server, Buffer.alloc(1921964)],
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
      ["Clip", audio, 10011],
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
