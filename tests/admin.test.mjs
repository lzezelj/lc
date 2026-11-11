import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as accountPolicy from "../auth-account.mjs";
import * as ownerPolicy from "../server/owner-policy.mjs";
import * as orm from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  currentAccountRole,
  matchesOwnerEmail,
} from "../server/owner-policy.mjs";

const owner = "11111111-1111-4111-8111-111111111111",
  author = "22222222-2222-4222-8222-222222222222",
  peer = "33333333-3333-4333-8333-333333333333",
  messageId = "44444444-4444-4444-8444-444444444444";
async function moduleAt(path, dependencies, extra = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency ${name}`);
        return dependencies[name];
      },
      Request,
      Response,
      URL,
      URLSearchParams,
      Buffer,
      AbortSignal,
      process: { env: {} },
      ...extra,
    },
  );
  return exports;
}
const adminErrors = await moduleAt("../server/admin-error.ts", {});
test("current configured email controls ownership, including stale roles and blank configuration", () => {
  assert.equal(
    matchesOwnerEmail(" Owner@Example.test ", "owner@example.test"),
    true,
  );
  for (const configured of [undefined, "", "  ", "someone@example.test"])
    assert.equal(matchesOwnerEmail("owner@example.test", configured), false);
  assert.equal(matchesOwnerEmail(null, "owner@example.test"), false);
  assert.equal(
    currentAccountRole(
      { role: "owner", email: "former@example.test" },
      "owner@example.test",
    ),
    "member",
  );
  assert.equal(
    currentAccountRole(
      { role: "member", email: "owner@example.test" },
      "owner@example.test",
    ),
    "owner",
  );
  assert.equal(
    currentAccountRole(
      { role: "demo", email: "owner@example.test" },
      "owner@example.test",
    ),
    "demo",
  );
});
test("owner guard rejects unauthenticated, demo and nonmatching identities without trusting owner role", async () => {
  for (const user of [
    null,
    { role: "owner", email: "former@example.test" },
    { role: "member", email: "other@example.test" },
    { role: "demo", email: "owner@example.test" },
    { role: "member", email: "OWNER@example.test" },
  ]) {
    const guard = await moduleAt(
      "../server/owner.ts",
      {
        "../auth": { auth: async () => (user ? { user } : null) },
        "./owner-policy.mjs": { matchesOwnerEmail },
      },
      { process: { env: { OWNER_EMAIL: "owner@example.test" } } },
    );
    assert.equal(
      Boolean(await guard.ownerSession()),
      user?.role === "member" && user.email === "OWNER@example.test",
    );
  }
});
test("actual JWT refresh replaces stale token email and role with current database identity", async () => {
  let config;
  const account = {
    id: owner,
    role: "owner",
    email: "former@example.test",
    handle: "owner.0001",
    disabledAt: null,
    expiresAt: null,
  };
  const env = { OWNER_EMAIL: "owner@example.test" };
  await moduleAt(
    "../auth.ts",
    {
      "node:crypto": {},
      "@auth/drizzle-adapter": { DrizzleAdapter: () => ({}) },
      "drizzle-orm": {
        and: () => {},
        eq: () => {},
        gt: () => {},
        isNull: () => {},
      },
      "next-auth": {
        default: (value) => {
          config = value;
          return {};
        },
      },
      "next-auth/providers/credentials": { default: (value) => value },
      "next-auth/providers/google": { default: (value) => value },
      "./auth-account.mjs": accountPolicy,
      "./server/owner-policy.mjs": ownerPolicy,
      "./db": {
        db: {
          select: () => ({ from: () => ({ where: async () => [account] }) }),
        },
      },
      "./db/schema": {
        users: {},
        accounts: {},
        demoInvites: {},
        serverMembers: {},
        sessions: {},
      },
      "./server/user-handles": {},
    },
    { process: { env } },
  );
  const token = {
    userId: owner,
    iat: Math.floor(Date.now() / 1000),
    role: "owner",
    email: "owner@example.test",
  };
  const former = await config.callbacks.jwt({ token });
  assert.equal(former.role, "member");
  assert.equal(former.email, "former@example.test");
  account.email = "OWNER@example.test";
  account.role = "member";
  assert.equal((await config.callbacks.jwt({ token })).role, "owner");
  env.OWNER_EMAIL = "";
  assert.equal((await config.callbacks.jwt({ token })).role, "member");
  account.disabledAt = new Date();
  assert.equal(await config.callbacks.jwt({ token }), null);
});

test("every admin API verb denies access before querying or mutating data", async () => {
  let called = false;
  const routes = await moduleAt("../app/api/admin/route.ts", {
    "../../../server/owner": { ownerSession: async () => null },
    "../../../server/admin-read": {
      readAdmin: () => {
        called = true;
      },
    },
    "../../../server/admin-mutations": {
      mutateAdmin: () => {
        called = true;
      },
    },
    "../../../server/rate-limit": {},
  });
  for (const method of ["GET", "POST", "PATCH", "DELETE"])
    assert.equal(
      (
        await routes[method](
          new Request("http://localhost/api/admin", { method }),
        )
      ).status,
      403,
    );
  assert.equal(called, false);
});
test("admin reads bind filters as SQL parameters and bound pages; no account credentials are selected", async () => {
  const statements = [],
    dialect = new PgDialect();
  const reads = await moduleAt("../server/admin-read.ts", {
    "drizzle-orm": orm,
    "../db": {
      db: {
        execute: async (statement) => {
          statements.push(dialect.sqlToQuery(statement));
          return { rows: [] };
        },
      },
    },
  });
  for (const resource of [
    "users",
    "profile",
    "servers",
    "members",
    "channels",
    "conversations",
    "messages",
    "audit",
  ]) {
    const response = await reads.readAdmin(
      new URLSearchParams({
        resource,
        userId: author,
        serverId: peer,
        q: "%' OR true--",
        page: "2",
      }),
    );
    assert.equal(response.status, 200);
    const query = statements.at(-1);
    assert.ok(!query.sql.includes("OR true--"));
    assert.ok(
      !/\baccounts\b|\bsessions\b|token_hash|access_token|refresh_token/.test(
        query.sql,
      ),
    );
    assert.ok(query.params.includes(100));
  }
  assert.equal(
    (
      await reads.readAdmin(
        new URLSearchParams({ resource: "messages", scope: "direct" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await reads.readAdmin(
        new URLSearchParams({ resource: "channels", serverId: "bad" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await reads.readAdmin(new URLSearchParams({ page: "-1" }))).status,
    400,
  );
});

test("admin file downloads deny unauthenticated/nonowner access before inspecting file data", async () => {
  let read = false;
  const files = await moduleAt("../app/api/admin/files/route.ts", {
    "drizzle-orm": orm,
    "../../../../server/owner": { ownerSession: async () => null },
    "../../../../server/admin-read": {},
    "../../../../server/attachment-range": {},
    "../../../../db": {
      db: {
        select: () => {
          read = true;
        },
      },
    },
    "../../../../db/schema": {},
  });
  assert.equal(
    (
      await files.GET(
        new Request(`http://localhost/api/admin/files?id=${messageId}`),
      )
    ).status,
    403,
  );
  assert.equal(read, false);
});

test("every admin server-picture method rejects nonowners before reading files or body", async () => {
  const routes = await moduleAt("../app/api/admin/server-picture/route.ts", {
    "node:crypto": {},
    "drizzle-orm": orm,
    "../../../../server/owner": { ownerSession: async () => null },
    "../../../../server/admin-read": {},
    "../../../../server/admin-audit": {},
    "../../../../server/profile-pictures": {},
    "../../../../server/rate-limit": {},
    "../../../../server/notify-user": {},
    "../../../../db": {},
    "../../../../db/schema": {},
  });
  for (const method of ["GET", "PUT", "DELETE"])
    assert.equal(
      (
        await routes[method](
          new Request("http://localhost/api/admin/server-picture", { method }),
        )
      ).status,
      403,
    );
});
async function mutationFixture({
  deleted = false,
  kind = "message",
  failAudit = false,
} = {}) {
  const queries = [],
    events = [],
    audits = [];
  let committed = false,
    rolledBack = false;
  const dialect = new PgDialect();
  const tx = {
    execute: async (statement) => {
      const query = dialect.sqlToQuery(statement);
      queries.push(query);
      if (query.sql.startsWith("SELECT m.id"))
        return {
          rows: [
            {
              id: messageId,
              authorId: author,
              peerId: peer,
              kind,
              attachments: [],
              deletedAt: deleted ? new Date() : null,
              channelId: peer,
              serverId: owner,
            },
          ],
        };
      if (query.sql.startsWith("SELECT id,content"))
        return {
          rows: [
            {
              id: messageId,
              text: "replacement",
              editedAt: new Date().toISOString(),
              editedByAdmin: true,
            },
          ],
        };
      return { rows: [] };
    },
  };
  const mutation = await moduleAt("../server/admin-mutations.ts", {
    "./admin-error": adminErrors,
    "./admin-entities": {},
    "drizzle-orm": orm,
    "../db": {
      db: {
        transaction: async (run) => {
          try {
            const result = await run(tx);
            committed = true;
            return result;
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        },
      },
    },
    "./admin-audit": {
      auditAdmin: async (...args) => {
        if (failAudit) throw new Error("Audit unavailable");
        audits.push(args.slice(1));
      },
    },
    "./admin-read": {
      validAdminId: (value) =>
        typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
    },
    "./notify-server": { notifyServer: async () => {} },
    "./remove-channel-media": {},
    "./notify-user": {
      notifyUser: async (userId, event) => {
        assert.ok(committed);
        events.push({ userId, ...event });
      },
    },
    "./mentions": {
      serverMentions: async () => [],
      storeMentions: async () => [],
    },
  });
  const run = (method, body) =>
    mutation.mutateAdmin(
      new Request("http://localhost/api/admin", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "message",
          scope: "direct",
          id: messageId,
          confirmed: true,
          ...body,
        }),
      }),
      owner,
    );
  return { run, queries, events, audits, rolledBack: () => rolledBack };
}
test("admin DM edits preserve author and notify both actual participants only after commit", async () => {
  const fixture = await mutationFixture();
  assert.equal(
    (await fixture.run("PATCH", { text: "replacement" })).status,
    200,
  );
  assert.deepEqual(
    fixture.events.map((event) => [event.userId, event.fromUserId]),
    [
      [author, peer],
      [peer, author],
    ],
  );
  assert.ok(fixture.events.every((event) => event.edit.editedByAdmin));
  assert.equal(fixture.audits[0][0], owner);
  assert.equal(fixture.audits[0][1], "message.edit");
  assert.ok(!JSON.stringify(fixture.audits).includes("replacement"));
  assert.ok(
    !fixture.queries
      .find((query) => query.sql.startsWith("UPDATE"))
      .sql.includes("sender_id="),
  );
});
test("admin deletion distinguishes placeholders and permanent removal and requires confirmation", async () => {
  for (const permanent of [false, true]) {
    const fixture = await mutationFixture();
    assert.equal((await fixture.run("DELETE", { permanent })).status, 200);
    assert.ok(
      fixture.queries.some((query) =>
        permanent
          ? query.sql.startsWith("DELETE")
          : query.sql.includes("deleted_at=COALESCE"),
      ),
    );
    assert.ok(fixture.events.every((event) => event.permanent === permanent));
  }
  const fixture = await mutationFixture();
  assert.equal((await fixture.run("DELETE", { confirmed: false })).status, 400);
  assert.equal(fixture.queries.length, 0);
});
test("deleted/call messages cannot be edited; a failed audit rolls back and emits no events", async () => {
  for (const options of [{ deleted: true }, { kind: "call" }]) {
    const fixture = await mutationFixture(options);
    assert.equal(
      (await fixture.run("PATCH", { text: "replacement" })).status,
      409,
    );
    assert.equal(fixture.events.length, 0);
  }
  const fixture = await mutationFixture({ failAudit: true });
  await assert.rejects(
    fixture.run("PATCH", { text: "replacement" }),
    /Audit unavailable/,
  );
  assert.ok(fixture.rolledBack());
  assert.equal(fixture.events.length, 0);
});

test("admin channel deletion notice applies only to the affected active call", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    'if (message.type === "channel-deleted" && message.channelId)',
  );
  const end = source.indexOf(
    'if (message.type === "voice-sounds-changed"',
    start,
  );
  for (const [active, reason, expected] of [
    ["deleted", "admin", true],
    ["other", "admin", false],
    ["deleted", undefined, false],
  ]) {
    const notices = [];
    let closed = 0;
    vm.runInNewContext(`(function () { ${source.slice(start, end)} })()`, {
      message: { type: "channel-deleted", channelId: "deleted", reason },
      activeVoiceChannelRef: { current: active },
      closeCallViewRef: { current: () => closed++ },
      setNoticeMessage: (value) => notices.push(value),
      setChannels: (run) =>
        assert.equal(run([{ id: "deleted" }, { id: "other" }]).length, 1),
      setSelectedChannelId: (run) => assert.equal(run("deleted"), ""),
      invalidateSignalingToken: () => {},
    });
    assert.equal(closed, active === "deleted" ? 1 : 0);
    assert.equal(notices.length > 0, expected);
    if (expected)
      assert.equal(notices[0], "This channel was deleted by an admin.");
  }
});
