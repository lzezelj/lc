import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as duration from "../server/demo-duration.ts";
import * as handles from "../user-handle.ts";

test("demo extension duration rejects invalid or unbounded input and adds time to the existing deadline", () => {
  for (const invalid of [
    undefined,
    null,
    "4",
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    721,
  ]) {
    assert.equal(duration.parseDemoExtensionHours(invalid), null);
  }
  assert.equal(duration.parseDemoExtensionHours(1), 1);
  assert.equal(duration.parseDemoExtensionHours(720), 720);
  const previous = new Date("2026-10-27T12:00:00Z");
  assert.equal(
    duration.extendDemoDeadline(previous, 4).toISOString(),
    "2026-10-27T16:00:00.000Z",
  );
  assert.equal(previous.toISOString(), "2026-10-27T12:00:00.000Z");
});

const source = await readFile(
  new URL("../app/api/demo-accounts/route.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
});

function createHandler({
  role = "owner",
  owned = true,
  expired = false,
  revoked = false,
  member = true,
} = {}) {
  const writes = [];
  const locks = [];
  const existingExpiry = new Date(Date.now() + (expired ? -1 : 1) * 3600000);
  const schema = Object.fromEntries(
    [
      "users",
      "demoInvites",
      "serverMembers",
      "channels",
      "messages",
      "servers",
    ].map((name) => [
      name,
      {
        name,
        id: `${name}.id`,
        createdBy: `${name}.createdBy`,
        role: `${name}.role`,
        expiresAt: `${name}.expiresAt`,
        disabledAt: `${name}.disabledAt`,
        revokedAt: `${name}.revokedAt`,
        demoUserId: `${name}.demoUserId`,
        userId: `${name}.userId`,
        serverId: `${name}.serverId`,
      },
    ]),
  );
  const query = (inTransaction) => {
    let table;
    const rows = () =>
      !inTransaction
        ? owned
          ? [{ id: "demo" }]
          : []
        : table === schema.users
          ? [{ expiresAt: existingExpiry, disabledAt: null }]
          : table === schema.demoInvites
            ? [{ revokedAt: revoked ? new Date() : null }]
            : member
              ? [{ serverId: "server" }]
              : [];
    return {
      from(value) {
        table = value;
        return this;
      },
      where() {
        return this;
      },
      for(mode) {
        locks.push([table.name, mode]);
        return Promise.resolve(rows());
      },
      limit() {
        return Promise.resolve(rows());
      },
      then(resolve, reject) {
        return Promise.resolve(rows()).then(resolve, reject);
      },
    };
  };
  const tx = {
    select: () => query(true),
    update: (table) => ({
      set: (values) => ({
        where: () => {
          writes.push({ table: table.name, values });
          return Promise.resolve();
        },
      }),
    }),
  };
  const db = {
    select: () => query(false),
    transaction: (callback) => callback(tx),
  };
  const exports = {};
  const require = (name) => {
    if (name === "node:crypto") return crypto;
    if (name === "drizzle-orm")
      return {
        and: (...args) => args,
        eq: (...args) => args,
        inArray: (...args) => args,
        lte: (...args) => args,
      };
    if (name === "next/server")
      return {
        NextResponse: {
          json: (body, init) => new Response(JSON.stringify(body), init),
        },
      };
    if (name.endsWith("/auth"))
      return { auth: async () => ({ user: { id: "owner", role } }) };
    if (name.endsWith("/db")) return { db };
    if (name.endsWith("/db/schema")) return schema;
    if (name.endsWith("/demo-duration")) return duration;
    if (name.endsWith("/user-handle")) return handles;
    if (name.endsWith("/rate-limit"))
      return { checkRateLimit: () => ({ allowed: true }), rateLimits: {} };
    if (name.endsWith("/disconnect-user"))
      return {
        disconnectUserEverywhere: async () => {
          throw new Error("Extension must not disconnect the demo user");
        },
      };
    throw new Error(`Unexpected import: ${name}`);
  };
  vm.runInNewContext(compiled, { require, exports, Request, Response, Date });
  return { patch: exports.PATCH, writes, locks, existingExpiry };
}

function request(extensionHours = 4) {
  return new Request("http://localhost/api/demo-accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      demoUserId: "demo",
      action: "extend",
      extensionHours,
    }),
  });
}

test("demo extension requires owner role, account ownership, and a valid duration", async () => {
  assert.equal(
    (await createHandler({ role: "member" }).patch(request())).status,
    403,
  );
  assert.equal(
    (await createHandler({ owned: false }).patch(request())).status,
    404,
  );
  const invalid = createHandler();
  assert.equal((await invalid.patch(request(0))).status, 400);
  assert.equal(invalid.writes.length, 0);
});

test("expired, revoked or unassigned demos cannot be reactivated by extension", async () => {
  for (const options of [
    { expired: true },
    { revoked: true },
    { member: false },
  ]) {
    const handler = createHandler(options);
    assert.equal((await handler.patch(request())).status, 409);
    assert.equal(handler.writes.length, 0);
  }
});

test("extension preserves login, invite redemption state, token hash and memberships", async () => {
  const handler = createHandler();
  const response = await handler.patch(request(24));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(
    new Date(result.expiresAt).getTime(),
    handler.existingExpiry.getTime() + 86400000,
  );
  assert.deepEqual(handler.locks, [
    ["users", "update"],
    ["demoInvites", "update"],
  ]);
  assert.deepEqual(
    handler.writes.map((write) => write.table),
    ["users", "demoInvites"],
  );
  assert.deepEqual(Object.keys(handler.writes[0].values).sort(), [
    "expiresAt",
    "updatedAt",
  ]);
  assert.deepEqual(Object.keys(handler.writes[1].values), ["expiresAt"]);
});
