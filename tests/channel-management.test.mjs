import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { groupMessagesByServer } from "../app/message-groups.ts";

const id = "11111111-1111-4111-8111-111111111111";
const source = await readFile(
  new URL("../app/api/servers/[serverId]/channels/route.ts", import.meta.url),
  "utf8",
);
function fixture({
  authenticated = true,
  role = "owner",
  found = true,
  allowed = true,
} = {}) {
  const events = [],
    predicates = [];
  const dependencies = {
    "drizzle-orm": { eq: (...args) => args, and: (...args) => args },
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "../../../../../auth": {
      auth: async () => (authenticated ? { user: { id: "owner" } } : null),
    },
    "../../../../../db/schema": {
      channels: { id: "channel.id", serverId: "channel.serverId" },
      serverMembers: {},
      servers: { id: "server.id" },
    },
    "../../../../../db": {
      db: {
        transaction: async (run) => run(dependencies["../../../../../db"].db),
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve, reject) =>
                Promise.resolve([{ role }]).then(resolve, reject),
              for: async () => [{ role }],
            }),
          }),
        }),
        delete: () => ({
          where: (predicate) => {
            predicates.push(predicate);
            return {
              returning: async () => {
                events.push("delete");
                return found ? [{ id, type: "voice_group" }] : [];
              },
            };
          },
        }),
      },
    },
    "../../../../../server/rate-limit": {
      rateLimitMessage,
      rateLimits: { serverMutation: {} },
      checkRateLimit: () => ({ allowed, retryAfterSeconds: 5 }),
    },
    "../../../../../server/notify-server": {
      notifyServer: async (serverId) => events.push(["notify", serverId]),
    },
    "../../../../../server/remove-channel-media": {
      removeChannelMedia: async (...args) => events.push(["media", ...args]),
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (key) => {
        assert.ok(key in dependencies, key);
        return dependencies[key];
      },
    },
  );
  return {
    events,
    predicates,
    remove: (body = { channelId: id }) =>
      exports.DELETE(
        new Request("http://localhost/api/servers/server/channels", {
          method: "DELETE",
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ serverId: "server" }) },
      ),
  };
}

test("channel deletion requires authenticated server ownership", async () => {
  for (const options of [
    { authenticated: false },
    { role: "member" },
    { role: null },
  ]) {
    const f = fixture(options);
    assert.equal((await f.remove()).status, 403);
    assert.deepEqual(f.events, []);
  }
});
test("channel deletion is scoped to the server and cleans up only after persistence", async () => {
  const f = fixture();
  assert.equal((await f.remove()).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(f.predicates)), [
    [
      ["channel.id", id],
      ["channel.serverId", "server"],
    ],
  ]);
  assert.deepEqual(f.events, [
    "delete",
    ["media", "server", id, "voice_group"],
    ["notify", "server"],
  ]);
  const missing = fixture({ found: false });
  assert.equal((await missing.remove()).status, 404);
  assert.deepEqual(missing.events, ["delete"]);
});
test("invalid and rate-limited channel deletions cannot mutate storage", async () => {
  const invalid = fixture();
  assert.equal((await invalid.remove({ channelId: "invalid" })).status, 400);
  assert.deepEqual(invalid.events, []);
  const limited = fixture({ allowed: false });
  const response = await limited.remove();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "5");
  assert.equal(
    (await response.json()).error,
    "Too many server changes. Please wait 5 seconds before trying again.",
  );
  assert.deepEqual(limited.events, []);
});
test("message groups prioritize the current server without merging duplicate names or changing message order", () => {
  const messages = [
    { serverId: "a", serverName: "Same", id: "1" },
    { serverId: "b", serverName: "Same", id: "2" },
    { serverId: "a", serverName: "Same", id: "3" },
  ];
  const groups = groupMessagesByServer(messages, "b");
  assert.deepEqual(
    groups.map((group) => group.id),
    ["b", "a"],
  );
  assert.deepEqual(
    groups[1].messages.map((message) => message.id),
    ["1", "3"],
  );
  assert.equal(messages[0].id, "1");
  assert.deepEqual(groupMessagesByServer([], "missing"), []);
  assert.deepEqual(
    groupMessagesByServer(messages, "missing").map((group) => group.id),
    ["a", "b"],
  );
});
import { rateLimitMessage } from "../server/rate-limit.ts";
