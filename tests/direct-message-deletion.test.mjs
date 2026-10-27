import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sender = "10000000-0000-0000-0000-000000000001";
const recipient = "10000000-0000-0000-0000-000000000002";
const stranger = "10000000-0000-0000-0000-000000000003";
const messageId = "20000000-0000-0000-0000-000000000001";

async function fixture({ actor = sender, allowed = true } = {}) {
  const rows = [
    {
      id: messageId,
      senderId: sender,
      recipientId: recipient,
      content: "Private message",
      deletedAt: null,
    },
  ];
  const notifications = [];
  const mutate = (values) => ({
    where: (predicate) => ({
      returning: async () => {
        const index = rows.findIndex(predicate);
        if (index < 0) return [];
        if (values) Object.assign(rows[index], values);
        else rows.splice(index, 1);
        return [{ id: messageId }];
      },
    }),
  });
  const dependencies = {
    "drizzle-orm": {
      eq: (column, value) => (row) => row[column] === value,
      and:
        (...predicates) =>
        (row) =>
          predicates.every((predicate) => predicate(row)),
    },
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "../../../../../auth": {
      auth: async () => (actor ? { user: { id: actor, role: "owner" } } : null),
    },
    "../../../../../db": {
      db: { update: () => ({ set: mutate }), delete: () => mutate(null) },
    },
    "../../../../../db/schema": {
      directMessages: {
        id: "id",
        senderId: "senderId",
        recipientId: "recipientId",
      },
    },
    "../../../../../server/notify-user": {
      notifyUser: async (userId, event) =>
        notifications.push({ userId, event }),
    },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed, retryAfterSeconds: 3 }),
      rateLimits: { message: {} },
    },
  };
  const source = await readFile(
    new URL(
      "../app/api/direct-messages/[userId]/[messageId]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      Response,
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    },
  );
  return {
    rows,
    notifications,
    remove: (body = {}, userId = recipient, id = messageId) =>
      exports.DELETE(
        new Request("http://localhost/api/direct-messages/delete", {
          method: "DELETE",
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ userId, messageId: id }) },
      ),
  };
}

test("direct-message soft deletion erases content and notifies both users after persistence", async () => {
  const f = await fixture();
  const response = await f.remove();
  assert.equal(response.status, 200);
  assert.equal(f.rows[0].content, "");
  assert.ok(f.rows[0].deletedAt);
  assert.equal(f.notifications.length, 2);
  assert.equal(f.notifications[0].userId, recipient);
  assert.equal(f.notifications[0].event.fromUserId, sender);
  assert.equal(f.notifications[1].userId, sender);
  assert.equal(f.notifications[1].event.fromUserId, recipient);
  for (const { event } of f.notifications) {
    assert.equal(event.type, "direct-message-deleted");
    assert.equal(event.messageId, messageId);
    assert.equal(event.permanent, false);
    assert.ok(!("content" in event));
  }
});

test("permanent direct-message deletion removes the row", async () => {
  const f = await fixture();
  assert.equal((await f.remove({ permanent: true })).status, 200);
  assert.equal(f.rows.length, 0);
  assert.ok(f.notifications.every(({ event }) => event.permanent));
});

test("recipient and unrelated owner cannot delete another user's direct message", async () => {
  for (const actor of [recipient, stranger]) {
    const f = await fixture({ actor });
    assert.equal((await f.remove({ permanent: true })).status, 404);
    assert.equal(f.rows[0].content, "Private message");
    assert.equal(f.notifications.length, 0);
  }
});

test("deletion is scoped to the conversation and rejects malformed identifiers", async () => {
  const f = await fixture();
  assert.equal((await f.remove({}, stranger)).status, 404);
  assert.equal((await f.remove({}, recipient, "invalid")).status, 400);
  assert.equal(f.rows[0].content, "Private message");
  assert.equal(f.notifications.length, 0);
});

test("deletion requires authentication and respects the rate limit", async () => {
  const anonymous = await fixture({ actor: null });
  assert.equal((await anonymous.remove()).status, 401);
  const limited = await fixture({ allowed: false });
  const response = await limited.remove();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "3");
  assert.equal(limited.rows[0].content, "Private message");
  assert.equal(limited.notifications.length, 0);
});
