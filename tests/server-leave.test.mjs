import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function fixture({
  role = "member",
  membership = "member",
  count = 1,
  authenticated = true,
} = {}) {
  let removed = false;
  let disconnected = false;
  const rows = Array.from({ length: count }, (_, index) => ({
    serverId: `server-${index}`,
    userId: "actor",
    role: membership,
  }));
  const tx = {
    select: () => ({
      from: (table) => ({
        where: () =>
          table === "users" ? { for: async () => [] } : Promise.resolve(rows),
      }),
    }),
    delete: () => ({
      where: async () => {
        removed = true;
      },
    }),
  };
  const source = await readFile(
    new URL("../app/api/servers/route.ts", import.meta.url),
    "utf8",
  );
  const exports = {};
  const dependencies = {
    "node:crypto": { randomUUID: () => "unused" },
    "drizzle-orm": Object.fromEntries(
      ["and", "eq", "gt", "isNull", "or"].map((key) => [key, () => undefined]),
    ),
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "../../../auth": {
      auth: async () =>
        authenticated ? { user: { id: "actor", role } } : null,
    },
    "../../../db": {
      db: {
        transaction: (callback) => callback(tx),
        select: () => ({
          from: () => ({
            where: async () => [{ id: "group", type: "voice_group" }],
          }),
        }),
      },
    },
    "../../../db/schema": {
      users: "users",
      serverMembers: "members",
      servers: {},
      channels: {},
    },
    "../../../server/rate-limit": {},
    "../../../server/notify-server": {},
    "../../../server/disconnect-user": {
      disconnectUserEverywhere: async (userId, channels) => {
        assert.equal(userId, "actor");
        assert.equal(channels[0], "group");
        disconnected = true;
      },
    },
  };
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (key) => {
        assert.ok(key in dependencies);
        return dependencies[key];
      },
    },
  );
  return {
    remove: () =>
      exports.DELETE(
        new Request("http://localhost/api/servers", {
          method: "DELETE",
          body: JSON.stringify({
            serverId: membership ? "server-0" : "missing",
            action: "leave",
            userId: "someone-else",
          }),
        }),
      ),
    state: () => ({ removed, disconnected }),
  };
}

test("leaving requires authentication and rejects owners and nonmembers", async () => {
  for (const options of [
    { authenticated: false },
    { membership: "owner" },
    { membership: null },
  ]) {
    const f = await fixture(options);
    assert.ok([401, 403].includes((await f.remove()).status));
    assert.deepEqual(f.state(), { removed: false, disconnected: false });
  }
});

test("a demo cannot leave its final server but may leave when another remains", async () => {
  const last = await fixture({ role: "demo" });
  assert.equal((await last.remove()).status, 403);
  assert.equal(last.state().removed, false);
  const multiple = await fixture({ role: "demo", count: 2 });
  assert.equal((await multiple.remove()).status, 200);
});

test("ordinary members can leave their final server and revoke their own media access", async () => {
  const f = await fixture();
  assert.equal((await f.remove()).status, 200);
  assert.deepEqual(f.state(), { removed: true, disconnected: true });
});
