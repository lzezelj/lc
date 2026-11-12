import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as orm from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { resolveMentions, mentionQuery } from "../app/mentions.ts";
import { notificationAllowed } from "../app/notification-types.ts";

const actor = "10000000-0000-4000-8000-000000000001",
  friend = "10000000-0000-4000-8000-000000000002",
  server = "20000000-0000-4000-8000-000000000001",
  message = "30000000-0000-4000-8000-000000000001";
const members = [
  { id: actor, name: "Me", handle: "me.1111" },
  { id: friend, name: "Bob Smith", handle: "bob.2222" },
  { id: "alice", name: "Alice", handle: "alice.3333" },
];

test("typed server mentions resolve full names and handles, excluding self, email addresses and partial names", () => {
  const text =
    "Hi @Bob Smith, @bob.2222! @Alice. @Me @bob.2222suffix contact@example.com";
  const mentions = resolveMentions(text, members, actor);
  assert.deepEqual(
    mentions.map((item) => item.userId),
    [friend, friend, "alice"],
  );
  assert.deepEqual(
    mentions.map((item) => text.slice(item.start, item.end)),
    ["@Bob Smith", "@bob.2222", "@Alice"],
  );
  assert.equal(resolveMentions("@Unknown @Bob", members, actor).length, 0);
  assert.equal(resolveMentions("@ALICE", members, actor)[0].userId, "alice");
});
test("duplicate display names require a unique handle and punctuation is matched literally", () => {
  const people = [
    ...members,
    { id: "another", name: "Alice", handle: "alice.4444" },
    { id: "special", name: "A (B)+", handle: "special.5555" },
  ];
  assert.equal(resolveMentions("@Alice", people, actor).length, 0);
  assert.equal(
    resolveMentions("@alice.4444", people, actor)[0].userId,
    "another",
  );
  assert.equal(resolveMentions("@A (B)+!", people, actor)[0].userId, "special");
  assert.equal(resolveMentions("@alice.3333.net", people, actor).length, 0);
});
test("mention completion reads the token at the caret and ignores email/newline contexts", () => {
  assert.deepEqual(mentionQuery("Hello @Bo", 9), {
    start: 6,
    end: 9,
    query: "Bo",
  });
  assert.equal(mentionQuery("mail@example", 12), null);
  assert.equal(mentionQuery("@Alice\nhello", 12), null);
  assert.equal(mentionQuery("hello", 5), null);
});
test("server message and mention preferences and direct message/call preferences remain independent", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const prefs = [
    {
      scope: "server",
      targetId: server,
      messages: false,
      mentions: true,
      messageMuteUntil: null,
    },
    {
      scope: "direct",
      targetId: friend,
      messages: false,
      calls: true,
      messageMuteUntil: null,
      callMuteUntil: "2026-11-04T13:00:00Z",
    },
  ];
  assert.equal(
    notificationAllowed(prefs, "server", server, "messages", now),
    false,
  );
  assert.equal(
    notificationAllowed(prefs, "server", server, "mentions", now),
    true,
  );
  assert.equal(
    notificationAllowed(prefs, "direct", friend, "messages", now),
    false,
  );
  assert.equal(
    notificationAllowed(prefs, "direct", friend, "calls", now),
    false,
  );
  assert.equal(
    notificationAllowed(prefs, "direct", friend, "calls", now + 3600001),
    true,
  );
  assert.equal(
    notificationAllowed(prefs, "direct", "unconfigured", "messages", now),
    true,
  );
});
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
    },
  );
  return exports;
}
async function fixture({
  authenticated = true,
  allowed = true,
  limited = false,
  readAllowed = true,
} = {}) {
  const writes = [],
    notices = [],
    queries = [];
  const tables = {
    serverMembers: { userId: "member.user", serverId: "member.server" },
    serverNotifications: { userId: "server.user", serverId: "server.id" },
    directNotifications: { userId: "dm.user", friendId: "dm.friend" },
  };
  const db = {
    select() {
      return {
        from() {
          return { where: async () => (allowed ? [{ userId: actor }] : []) };
        },
      };
    },
    insert(table) {
      return {
        values(value) {
          return {
            async onConflictDoUpdate(change) {
              writes.push({ table, value, change });
            },
          };
        },
      };
    },
    async execute(query) {
      queries.push(new PgDialect().sqlToQuery(query));
      return { rows: readAllowed ? [{}] : [] };
    },
  };
  const auth = {
      auth: async () => (authenticated ? { user: { id: actor } } : null),
    },
    friends = { canMessage: async () => allowed },
    rate = {
      checkRateLimit: () => ({ allowed: !limited, retryAfterSeconds: 3 }),
    },
    notify = {
      notifyUser: async (userId, event) => notices.push({ userId, event }),
    };
  const settings = await load("../app/api/notifications/route.ts", {
    "drizzle-orm": orm,
    "../../../auth": auth,
    "../../../db": { db },
    "../../../db/schema": tables,
    "../../../server/direct-conversations": friends,
    "../../../server/notification-inbox": {
      notificationInbox: async (userId) => {
        assert.equal(userId, actor);
        return { channels: [], direct: [], preferences: [] };
      },
    },
    "../../../server/notify-user": notify,
    "../../../server/rate-limit": rate,
  });
  const reads = await load("../app/api/notifications/read/route.ts", {
    "drizzle-orm": orm,
    "../../../../auth": auth,
    "../../../../db": { db },
    "../../../../server/direct-conversations": friends,
    "../../../../server/notify-user": notify,
    "../../../../server/rate-limit": rate,
  });
  const request = (body, method) =>
    new Request("http://localhost/notifications", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    writes,
    notices,
    queries,
    get: settings.GET,
    patch: (body) => settings.PATCH(request(body, "PATCH")),
    read: (body) => reads.POST(request(body, "POST")),
  };
}
test("notification settings enforce authentication/access and restrict supported targets and kinds", async () => {
  for (const options of [{ authenticated: false }, { allowed: false }]) {
    const f = await fixture(options);
    for (const scope of ["server", "direct"])
      assert.equal(
        (
          await f.patch({
            scope,
            targetId: server,
            kind: "messages",
            mode: "off",
          })
        ).status,
        403,
      );
    assert.equal(f.writes.length, 0);
  }
  const f = await fixture();
  for (const body of [
    { scope: "all", targetId: server, kind: "messages", mode: "off" },
    { scope: "server", targetId: server, kind: "calls", mode: "off" },
    { scope: "direct", targetId: friend, kind: "mentions", mode: "off" },
    { scope: "direct", targetId: "bad", kind: "calls", mode: "on" },
    { scope: "server", targetId: server, kind: "messages", mode: "forever" },
  ])
    assert.equal((await f.patch(body)).status, 400);
  assert.equal(f.writes.length, 0);
});
test("preference writes scope the actor server-side, persist temporary/indefinite muting and notify their other sessions", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.patch({
        scope: "direct",
        targetId: friend,
        kind: "messages",
        mode: "off",
        userId: "forged",
      })
    ).status,
    200,
  );
  assert.equal(f.writes[0].value.userId, actor);
  assert.equal(f.writes[0].value.messages, false);
  assert.ok(!("calls" in f.writes[0].change.set));
  assert.equal(
    (
      await f.patch({
        scope: "direct",
        targetId: friend,
        kind: "calls",
        mode: "60",
      })
    ).status,
    200,
  );
  assert.equal(f.writes[1].value.calls, true);
  assert.ok(f.writes[1].value.callMuteUntil.getTime() > Date.now() + 3590000);
  assert.ok(!("messages" in f.writes[1].change.set));
  assert.equal(f.notices.length, 2);
  assert.equal(f.notices[0].userId, actor);
  assert.equal(f.notices[0].event.type, "notifications-changed");
  assert.equal(
    (await f.get()).headers.get("Cache-Control"),
    "private, no-store",
  );
  const limited = await fixture({ limited: true });
  assert.equal(
    (
      await limited.patch({
        scope: "server",
        targetId: server,
        kind: "mentions",
        mode: "off",
      })
    ).status,
    429,
  );
  assert.equal(limited.writes.length, 0);
});
test("read markers enforce pair/membership scope and cannot replace a newer cursor with an older one", async () => {
  const invalid = await fixture();
  assert.equal(
    (
      await invalid.read({
        scope: "channel",
        targetId: server,
        messageId: "bad",
      })
    ).status,
    400,
  );
  assert.equal(invalid.queries.length, 0);
  const denied = await fixture({ readAllowed: false });
  assert.equal(
    (
      await denied.read({
        scope: "channel",
        targetId: server,
        messageId: message,
      })
    ).status,
    403,
  );
  assert.equal(denied.notices.length, 0);
  const stranger = await fixture({ allowed: false });
  assert.equal(
    (
      await stranger.read({
        scope: "direct",
        targetId: friend,
        messageId: message,
      })
    ).status,
    403,
  );
  assert.equal(stranger.queries.length, 0);
  for (const scope of ["channel", "direct"]) {
    const f = await fixture();
    assert.equal(
      (
        await f.read({
          scope,
          targetId: scope === "channel" ? server : friend,
          messageId: message,
          userId: "forged",
        })
      ).status,
      200,
    );
    const query = f.queries[0];
    assert.ok(query.params.includes(actor));
    assert.ok(!query.params.includes("forged"));
    assert.match(
      query.sql,
      /case when \(excluded\.message_at,excluded\.message_id\)>/,
    );
    if (scope === "channel") assert.match(query.sql, /join server_members/);
    else assert.match(query.sql, /m\.sender_id/);
    assert.equal(f.notices[0].userId, actor);
  }
  const limited = await fixture({ limited: true });
  assert.equal(
    (
      await limited.read({
        scope: "channel",
        targetId: server,
        messageId: message,
      })
    ).status,
    429,
  );
  assert.equal(limited.queries.length, 0);
});
