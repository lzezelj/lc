import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as crypto from "node:crypto";
import * as handles from "../user-handle.ts";
import * as duration from "../server/demo-duration.ts";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import "dotenv/config";
import pg from "pg";
import * as orm from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";

async function moduleAt(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      Request,
      Response,
      URLSearchParams,
      URL,
      Buffer,
      AbortSignal,
      process: { env: {} },
    },
  );
  return exports;
}
test("ordinary server deletion enforces ownership and cleans media, access and orphaned demos after database deletion", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const base = drizzle(client, { schema });
    const db = new Proxy(base, {
      get(target, key) {
        if (key === "transaction") return async (action) => action(target);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const [owner, member, demo, serverId, room] = Array.from(
      { length: 5 },
      () => randomUUID(),
    );
    await base.insert(schema.users).values([
      { id: owner, name: "Owner" },
      { id: member, name: "Member" },
      { id: demo, name: "Demo", role: "demo" },
    ]);
    await base
      .insert(schema.servers)
      .values({ id: serverId, name: "Deletion test", createdBy: owner });
    await base.insert(schema.serverMembers).values([
      { userId: owner, serverId, role: "owner" },
      { userId: member, serverId },
      { userId: demo, serverId },
    ]);
    await base
      .insert(schema.channels)
      .values({ id: room, serverId, name: "Voice", type: "voice_group" });
    const events = [];
    const errors = await moduleAt("../server/admin-error.ts", {});
    const service = await moduleAt("../server/delete-server.ts", {
      "drizzle-orm": orm,
      "../db": { db },
      "./admin-error": errors,
      "./admin-audit": {
        auditAdmin: () =>
          assert.fail("Ordinary deletion is not an admin action"),
      },
      "./remove-channel-media": {
        removeChannelMedia: async (...args) => {
          assert.equal(
            (
              await base
                .select()
                .from(schema.servers)
                .where(orm.eq(schema.servers.id, serverId))
            ).length,
            0,
          );
          events.push(["media", ...args]);
        },
      },
      "./notify-user": {
        notifyUser: async (...args) => events.push(["notify", ...args]),
      },
      "./disconnect-user": {
        disconnectUserEverywhere: async (...args) =>
          events.push(["disconnect", ...args]),
      },
    });
    await assert.rejects(
      () => service.deleteServer(serverId, member, true),
      (error) => error.status === 404,
    );
    assert.equal(events.length, 0);
    const response = await service.deleteServer(serverId, owner, true);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revokedDemos, 1);
    assert.ok(
      events.some(
        ([type, id, channel]) =>
          type === "media" && id === serverId && channel === room,
      ),
    );
    assert.ok(
      events.some(
        ([type, id, event]) =>
          type === "notify" &&
          id === member &&
          event.reason === "server-deleted",
      ),
    );
    assert.ok(
      events.some(([type, id]) => type === "disconnect" && id === demo),
    );
    const [revoked] = await base
      .select()
      .from(schema.users)
      .where(orm.eq(schema.users.id, demo));
    assert.ok(revoked.disabledAt);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("admin SQL, audit atomicity, global reads, edits and deletion cleanup against PostgreSQL", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const database = drizzle(client, { schema });
  const [
    actor,
    author,
    peer,
    serverId,
    channelId,
    messageId,
    replyId,
    directId,
    attachmentId,
  ] = Array.from({ length: 9 }, () => randomUUID());
  try {
    await client.query("BEGIN");
    const installed = await client.query(
      "SELECT to_regclass('admin_audit_log') AS name",
    );
    if (!installed.rows[0].name)
      await client.query(
        await readFile(
          new URL("../db/migrations/0032_admin_dashboard.sql", import.meta.url),
          "utf8",
        ),
      );
    // The migration and all fixtures are rolled back; no persistent database changes.
    await database.insert(schema.users).values([
      { id: actor, name: "Admin fixture" },
      { id: author, name: "Author fixture" },
      { id: peer, name: "Peer fixture" },
    ]);
    await database
      .insert(schema.servers)
      .values({ id: serverId, name: "Admin SQL fixture", createdBy: peer });
    await database
      .insert(schema.channels)
      .values({ id: channelId, serverId, name: "fixture", type: "text" });
    await database.insert(schema.messages).values([
      { id: messageId, channelId, authorId: author, content: "original" },
      {
        id: replyId,
        channelId,
        authorId: peer,
        content: "reply",
        replyToId: messageId,
      },
    ]);
    await database.insert(schema.directMessages).values({
      id: directId,
      senderId: author,
      recipientId: peer,
      content: "private fixture",
    });
    const file = {
      id: attachmentId,
      name: "fixture.pdf",
      size: 4,
      type: "application/pdf",
    };
    await database
      .update(schema.messages)
      .set({ attachments: [file] })
      .where(orm.eq(schema.messages.id, messageId));
    await database.insert(schema.messageAttachments).values({
      id: attachmentId,
      uploaderId: author,
      messageId,
      data: Buffer.from("test"),
    });
    const db = new Proxy(database, {
      get(target, key) {
        if (key === "transaction")
          return async (run) => {
            await client.query("SAVEPOINT admin_action");
            try {
              const result = await run(database);
              await client.query("RELEASE SAVEPOINT admin_action");
              return result;
            } catch (error) {
              await client.query("ROLLBACK TO SAVEPOINT admin_action");
              throw error;
            }
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const audit = await moduleAt("../server/admin-audit.ts", {
      "../db": { db },
      "../db/schema": schema,
    });
    const reads = await moduleAt("../server/admin-read.ts", {
      "drizzle-orm": orm,
      "../db": { db },
    });
    const events = [];
    const dependencies = {
      "./admin-error": await moduleAt("../server/admin-error.ts", {}),
      "drizzle-orm": orm,
      "../db": { db },
      "./admin-audit": audit,
      "./admin-read": reads,
      "./notify-server": { notifyServer: async () => {} },
      "./remove-channel-media": {
        removeChannelMedia: async (...args) => events.push(args),
      },
      "./notify-user": { notifyUser: async (...args) => events.push(args) },
      "./mentions": {
        serverMentions: async () => [],
        storeMentions: async () => [],
      },
    };
    dependencies["./delete-server"] = await moduleAt(
      "../server/delete-server.ts",
      {
        ...dependencies,
        "./disconnect-user": {
          disconnectUserEverywhere: async (...args) => events.push(args),
        },
      },
    );
    dependencies["./admin-entities"] = await moduleAt(
      "../server/admin-entities.ts",
      {
        ...dependencies,
        "./owner-policy.mjs": {
          matchesOwnerEmail: (email, configured) =>
            !!configured &&
            typeof email === "string" &&
            email.trim().toLowerCase() === configured.trim().toLowerCase(),
        },
        "./message-removals": {
          notifyMessageRemovals: async (...args) => events.push(args),
        },
        "./disconnect-user": {
          disconnectUserEverywhere: async (...args) => events.push(args),
        },
        "./voice-moderation": {
          applyGroupModeration: async (...args) => events.push(args),
        },
      },
    );
    const service = await moduleAt(
      "../server/admin-mutations.ts",
      dependencies,
    );
    const run = (method, body, target = service) =>
      target.mutateAdmin(
        new Request("http://localhost/api/admin", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true, ...body }),
        }),
        actor,
      );
    for (const resource of [
      "profile",
      "servers",
      "channels",
      "messages",
      "conversations",
    ]) {
      const response = await reads.readAdmin(
        new URLSearchParams({
          resource,
          userId: author,
          serverId,
          scope: "server",
        }),
      );
      assert.equal(response.status, 200);
      assert.ok((await response.json()).rows.length > 0, resource);
    }
    const direct = await reads.readAdmin(
      new URLSearchParams({
        resource: "messages",
        userId: author,
        scope: "direct",
      }),
    );
    assert.equal((await direct.json()).rows[0].id, directId);
    assert.equal(
      (
        await run("PATCH", {
          target: "message",
          id: messageId,
          scope: "server",
          text: "admin replacement",
        })
      ).status,
      200,
    );
    let [saved] = await database
      .select()
      .from(schema.messages)
      .where(orm.eq(schema.messages.id, messageId));
    assert.equal(saved.authorId, author);
    assert.equal(saved.editedByAdmin, true);
    const broken = await moduleAt("../server/admin-mutations.ts", {
      ...dependencies,
      "./admin-audit": {
        auditAdmin: async () => {
          throw new Error("Audit failed");
        },
      },
    });
    await assert.rejects(
      run(
        "PATCH",
        {
          target: "message",
          id: messageId,
          scope: "server",
          text: "must roll back",
        },
        broken,
      ),
      /Audit failed/,
    );
    [saved] = await database
      .select()
      .from(schema.messages)
      .where(orm.eq(schema.messages.id, messageId));
    assert.equal(saved.content, "admin replacement");
    assert.equal(
      (
        await run("DELETE", {
          target: "message",
          id: messageId,
          scope: "server",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await database
          .select()
          .from(schema.messageAttachments)
          .where(orm.eq(schema.messageAttachments.id, attachmentId))
      ).length,
      0,
    );
    [saved] = await database
      .select()
      .from(schema.messages)
      .where(orm.eq(schema.messages.id, messageId));
    assert.equal(saved.content, "");
    assert.ok(saved.deletedAt);
    assert.equal(
      (
        await run("DELETE", {
          target: "message",
          id: messageId,
          scope: "server",
          permanent: true,
        })
      ).status,
      200,
    );
    const [reply] = await database
      .select()
      .from(schema.messages)
      .where(orm.eq(schema.messages.id, replyId));
    assert.equal(reply.replyToId, null);
    assert.equal(
      (
        await run("PATCH", {
          target: "message",
          id: directId,
          scope: "direct",
          text: "admin DM",
        })
      ).status,
      200,
    );
    assert.equal(
      events.filter((event) => event[1]?.type === "direct-message-edited")
        .length,
      2,
    );
    const created = await run("POST", {
      target: "channel",
      serverId,
      name: "Admin voice",
      type: "voice_group",
    });
    assert.equal(created.status, 201);
    const voice = await created.json();
    assert.equal(
      (
        await run("PATCH", {
          target: "channel",
          serverId,
          id: voice.id,
          name: "Renamed",
        })
      ).status,
      200,
    );
    assert.equal(
      (await run("DELETE", { target: "channel", serverId, id: voice.id }))
        .status,
      200,
    );
    assert.ok(
      events.some((event) => event[1] === voice.id && event[3] === "admin"),
    );
    const logs = await database
      .select()
      .from(schema.adminAuditLog)
      .where(orm.eq(schema.adminAuditLog.actorId, actor));
    assert.equal(logs.length, 7);
    assert.ok(!JSON.stringify(logs).includes("admin replacement"));
    const ownedServer = randomUUID();
    await database
      .insert(schema.servers)
      .values({ id: ownedServer, name: "Demo fixture", createdBy: actor });
    await database
      .insert(schema.serverMembers)
      .values({ serverId: ownedServer, userId: actor, role: "owner" });
    const demoApi = await moduleAt("../app/api/demo-accounts/route.ts", {
      "node:crypto": crypto,
      "drizzle-orm": orm,
      "next/server": {
        NextResponse: { json: (body, options) => Response.json(body, options) },
      },
      "../../../server/owner": {
        ownerSession: async () => ({ user: { id: actor, role: "owner" } }),
      },
      "../../../server/admin-audit": audit,
      "../../../db": { db },
      "../../../db/schema": schema,
      "../../../user-handle": handles,
      "../../../server/demo-duration": duration,
      "../../../server/disconnect-user": {
        disconnectUserEverywhere: async () => {},
      },
      "../../../server/rate-limit": {
        checkRateLimit: () => ({ allowed: true }),
        rateLimits: {},
      },
    });
    const demoRequest = (method, body) =>
      new Request("http://localhost/api/demo-accounts", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const createdDemo = await demoApi.POST(
      demoRequest("POST", { name: "Fixture demo", serverId: ownedServer }),
    );
    assert.equal(createdDemo.status, 201);
    const demoUserId = (await createdDemo.json()).member.id;
    assert.equal(
      (
        await demoApi.PATCH(
          demoRequest("PATCH", { demoUserId, action: "revoke" }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await demoApi.PATCH(
          demoRequest("PATCH", { demoUserId, action: "regenerate" }),
        )
      ).status,
      409,
      "A demo cannot reactivate without membership",
    );
    assert.equal(
      (
        await demoApi.PATCH(
          demoRequest("PATCH", {
            demoUserId,
            action: "regenerate",
            serverIds: [ownedServer],
          }),
        )
      ).status,
      200,
    );
    const [reactivated] = await database
      .select()
      .from(schema.users)
      .where(orm.eq(schema.users.id, demoUserId));
    assert.equal(reactivated.disabledAt, null);
    assert.equal(
      (
        await database
          .select()
          .from(schema.serverMembers)
          .where(orm.eq(schema.serverMembers.userId, demoUserId))
      ).length,
      1,
    );
    const demoLogs = await database
      .select()
      .from(schema.adminAuditLog)
      .where(orm.eq(schema.adminAuditLog.targetId, demoUserId));
    assert.equal(demoLogs.length, 3);
    assert.ok(
      demoLogs.every((entry) => !JSON.stringify(entry).includes("invite/")),
    );
    await database
      .delete(schema.servers)
      .where(orm.eq(schema.servers.id, ownedServer));
    await database
      .delete(schema.users)
      .where(orm.eq(schema.users.id, demoUserId));
    const createdServerResponse = await run("POST", {
      target: "server",
      name: "Managed server fixture",
      createAfk: true,
    });
    assert.equal(createdServerResponse.status, 201);
    const managed = await createdServerResponse.json();
    const brokenEntities = await moduleAt("../server/admin-entities.ts", {
      ...dependencies,
      "./admin-audit": {
        auditAdmin: async () => {
          throw new Error("Entity audit failed");
        },
      },
      "./owner-policy.mjs": { matchesOwnerEmail: () => false },
      "./message-removals": {},
      "./disconnect-user": {},
      "./voice-moderation": {},
    });
    const brokenEntityService = await moduleAt("../server/admin-mutations.ts", {
      ...dependencies,
      "./admin-entities": brokenEntities,
    });
    await assert.rejects(
      run(
        "PATCH",
        { target: "server", id: managed.id, name: "Must roll back" },
        brokenEntityService,
      ),
      /Entity audit failed/,
    );
    const details = async () =>
      (
        await (
          await reads.readAdmin(
            new URLSearchParams({ resource: "server", serverId: managed.id }),
          )
        ).json()
      ).rows[0];
    assert.equal((await details()).ownerId, actor);
    assert.equal((await details()).name, "Managed server fixture");
    assert.equal((await details()).channelCount, 3);
    assert.ok((await details()).afkChannelId);
    assert.equal(
      (
        await run("PATCH", {
          target: "server",
          id: managed.id,
          name: "Renamed fixture",
        })
      ).status,
      200,
    );
    assert.equal((await details()).name, "Renamed fixture");
    assert.equal(
      (
        await run("PATCH", {
          target: "server",
          id: managed.id,
          action: "afk",
          afkChannelId: channelId,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await run("PATCH", {
          target: "server",
          id: managed.id,
          action: "afk",
          afkChannelId: null,
        })
      ).status,
      200,
    );
    assert.equal((await details()).afkChannelId, null);
    assert.equal(
      (
        await run("PATCH", {
          target: "server",
          id: managed.id,
          action: "afk",
          createAfk: true,
        })
      ).status,
      200,
    );
    assert.equal((await details()).channelCount, 4);

    // The picture endpoint shares validation/cropping contracts, but independently guards and audits admin writes.
    const profileTools = await moduleAt("../server/profile-pictures.ts", {
      "node:crypto": crypto,
      "drizzle-orm": orm,
      "../db": { db },
      "../db/schema": schema,
      "./notify-user": dependencies["./notify-user"],
    });
    const pictureApi = await moduleAt(
      "../app/api/admin/server-picture/route.ts",
      {
        "node:crypto": crypto,
        "drizzle-orm": orm,
        "../../../../server/owner": {
          ownerSession: async () => ({ user: { id: actor } }),
        },
        "../../../../server/admin-read": reads,
        "../../../../server/admin-audit": audit,
        "../../../../server/profile-pictures": profileTools,
        "../../../../server/rate-limit": {
          checkRateLimit: () => ({ allowed: true }),
          rateLimits: {},
        },
        "../../../../server/notify-user": dependencies["./notify-user"],
        "../../../../db": { db },
        "../../../../db/schema": schema,
      },
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=",
      "base64",
    );
    const pictureRequest = (method, confirmed = true, data = png) =>
      new Request(
        `http://localhost/api/admin/server-picture?serverId=${managed.id}`,
        {
          method,
          headers: {
            "Content-Type": "image/png",
            "X-Admin-Confirmed": String(confirmed),
          },
          ...(method === "PUT" ? { body: data } : {}),
        },
      );
    assert.equal(
      (await pictureApi.PUT(pictureRequest("PUT", false))).status,
      400,
    );
    assert.equal(
      (
        await pictureApi.PUT(
          pictureRequest("PUT", true, Buffer.from("not an image")),
        )
      ).status,
      400,
    );
    assert.equal((await pictureApi.PUT(pictureRequest("PUT"))).status, 200);
    const picture = await pictureApi.GET(
      new Request(
        `http://localhost/api/admin/server-picture?serverId=${managed.id}`,
      ),
    );
    assert.equal(picture.status, 200);
    assert.deepEqual(Buffer.from(await picture.arrayBuffer()), png);
    assert.equal(
      (await pictureApi.DELETE(pictureRequest("DELETE"))).status,
      200,
    );
    assert.equal((await details()).image, null);

    await database.insert(schema.serverMembers).values({
      serverId: managed.id,
      userId: peer,
      voiceMuted: true,
      voiceDeafened: true,
    });
    assert.equal(
      (
        await run("PATCH", {
          target: "server",
          id: managed.id,
          action: "ownership",
          ownerId: peer,
        })
      ).status,
      200,
    );
    assert.equal((await details()).ownerId, peer);
    const [promoted] = await database
      .select()
      .from(schema.serverMembers)
      .where(
        orm.and(
          orm.eq(schema.serverMembers.serverId, managed.id),
          orm.eq(schema.serverMembers.userId, peer),
        ),
      );
    assert.equal(promoted.role, "owner");
    assert.equal(promoted.voiceMuted, false);
    assert.equal(promoted.voiceDeafened, false);
    assert.equal(
      (
        await run("DELETE", {
          target: "user",
          id: peer,
          confirm: "DELETE",
          deleteMessages: false,
        })
      ).status,
      409,
      "Owned servers block account deletion",
    );
    assert.equal(
      (
        await run("DELETE", {
          target: "user",
          id: actor,
          confirm: "DELETE",
          deleteMessages: false,
        })
      ).status,
      403,
      "Admin self-deletion is blocked",
    );
    const [finalDemo, continuingDemo] = [randomUUID(), randomUUID()];
    await database.insert(schema.users).values([
      { id: finalDemo, name: "Final server demo", role: "demo" },
      { id: continuingDemo, name: "Continuing demo", role: "demo" },
    ]);
    await database.insert(schema.demoInvites).values(
      [finalDemo, continuingDemo].map((id) => ({
        demoUserId: id,
        createdBy: peer,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
      })),
    );
    await database.insert(schema.serverMembers).values([
      { serverId: managed.id, userId: finalDemo },
      { serverId: managed.id, userId: continuingDemo },
      { serverId, userId: continuingDemo },
    ]);
    assert.equal(
      (await run("DELETE", { target: "server", id: managed.id })).status,
      400,
      "Server deletion requires typed confirmation",
    );
    assert.equal((await details()).finalDemoCount, 1);
    const deletedServer = await run("DELETE", {
      target: "server",
      id: managed.id,
      confirm: "DELETE",
    });
    assert.equal(deletedServer.status, 200);
    assert.equal((await deletedServer.json()).revokedDemos, 1);
    assert.equal(
      (
        await database
          .select()
          .from(schema.channels)
          .where(orm.eq(schema.channels.serverId, managed.id))
      ).length,
      0,
    );
    const finalDemoRow = (
      await database
        .select()
        .from(schema.users)
        .where(orm.eq(schema.users.id, finalDemo))
    )[0];
    const continuingRow = (
      await database
        .select()
        .from(schema.users)
        .where(orm.eq(schema.users.id, continuingDemo))
    )[0];
    assert.ok(finalDemoRow.disabledAt);
    assert.equal(continuingRow.disabledAt, null);
    assert.ok(
      events.some(
        (event) =>
          event[1]?.type === "access-changed" &&
          event[1]?.reason === "server-deleted",
      ),
    );

    const retainedMessage = randomUUID(),
      incomingMessage = randomUUID();
    await database.insert(schema.messages).values({
      id: retainedMessage,
      channelId,
      authorId: author,
      content: "Retain this authored message",
    });
    await database.insert(schema.directMessages).values({
      id: incomingMessage,
      senderId: peer,
      recipientId: author,
      content: "Other sender incoming",
    });
    await database
      .insert(schema.userAvatars)
      .values({ userId: author, data: png });
    await database.insert(schema.accounts).values({
      userId: author,
      type: "oauth",
      provider: "google",
      providerAccountId: randomUUID(),
    });
    await database.insert(schema.sessions).values({
      sessionToken: randomUUID(),
      userId: author,
      expires: new Date(Date.now() + 3600000),
    });
    await database
      .insert(schema.serverMembers)
      .values({ serverId, userId: author });
    await database
      .insert(schema.friendships)
      .values({ requesterId: author, recipientId: peer, status: "accepted" });
    assert.equal(
      (
        await run("DELETE", {
          target: "user",
          id: author,
          confirm: "DELETE",
          deleteMessages: false,
        })
      ).status,
      200,
    );
    const [anonymous] = await database
      .select()
      .from(schema.users)
      .where(orm.eq(schema.users.id, author));
    assert.equal(anonymous.name, "Deleted user");
    assert.equal(anonymous.email, null);
    assert.ok(anonymous.disabledAt);
    assert.equal(
      (
        await database
          .select()
          .from(schema.messages)
          .where(orm.eq(schema.messages.id, retainedMessage))
      ).length,
      1,
    );
    assert.equal(
      (
        await database
          .select()
          .from(schema.directMessages)
          .where(orm.eq(schema.directMessages.id, incomingMessage))
      ).length,
      1,
    );
    for (const [table, column] of [
      [schema.userAvatars, schema.userAvatars.userId],
      [schema.accounts, schema.accounts.userId],
      [schema.sessions, schema.sessions.userId],
      [schema.serverMembers, schema.serverMembers.userId],
    ])
      assert.equal(
        (await database.select().from(table).where(orm.eq(column, author)))
          .length,
        0,
      );
    const erasingUser = randomUUID(),
      erasedChannelMessage = randomUUID(),
      erasedDm = randomUUID(),
      preservedDm = randomUUID();
    await database
      .insert(schema.users)
      .values({ id: erasingUser, name: "Erasing account" });
    await database.insert(schema.messages).values({
      id: erasedChannelMessage,
      channelId,
      authorId: erasingUser,
      content: "Erase mine",
    });
    await database.insert(schema.directMessages).values([
      {
        id: erasedDm,
        senderId: erasingUser,
        recipientId: peer,
        content: "Erase sent",
      },
      {
        id: preservedDm,
        senderId: peer,
        recipientId: erasingUser,
        content: "Preserve incoming",
      },
    ]);
    assert.equal(
      (
        await run("DELETE", {
          target: "user",
          id: erasingUser,
          confirm: "DELETE",
          deleteMessages: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await database
          .select()
          .from(schema.messages)
          .where(orm.eq(schema.messages.id, erasedChannelMessage))
      ).length,
      0,
    );
    assert.equal(
      (
        await database
          .select()
          .from(schema.directMessages)
          .where(orm.eq(schema.directMessages.id, erasedDm))
      ).length,
      0,
    );
    assert.equal(
      (
        await database
          .select()
          .from(schema.directMessages)
          .where(orm.eq(schema.directMessages.id, preservedDm))
      ).length,
      1,
    );
    const entityLogs = await database
      .select()
      .from(schema.adminAuditLog)
      .where(orm.eq(schema.adminAuditLog.actorId, actor));
    for (const action of [
      "server.create",
      "server.rename",
      "server.afk",
      "server.ownership",
      "server.delete",
      "server.picture.change",
      "server.picture.remove",
      "demo.revoke-server-deleted",
      "user.delete",
      "user.delete-with-messages",
    ])
      assert.ok(
        entityLogs.some((entry) => entry.action === action),
        action,
      );
    await database.delete(schema.users).where(orm.eq(schema.users.id, actor));
    assert.equal(
      (
        await database
          .select()
          .from(schema.adminAuditLog)
          .where(orm.eq(schema.adminAuditLog.actorId, actor))
      ).length,
      entityLogs.length,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
