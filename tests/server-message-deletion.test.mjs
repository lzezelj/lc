import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const serverA = "11111111-1111-4111-8111-111111111111";
const serverB = "22222222-2222-4222-8222-222222222222";
const source = await readFile(
  new URL("../app/api/users/[userId]/messages/route.ts", import.meta.url),
  "utf8",
);
function fixture({
  authenticated = true,
  role = "member",
  userId = "actor",
  ownedDemo = false,
} = {}) {
  const rows = [
    { id: "a1", channel: "a1", author: userId, deleted: null, text: "A1" },
    { id: "a2", channel: "a2", author: userId, deleted: null, text: "A2" },
    { id: "b1", channel: "b1", author: userId, deleted: null, text: "B1" },
    {
      id: "other",
      channel: "a1",
      author: "someone-else",
      deleted: null,
      text: "Other",
    },
    { id: "old", channel: "a1", author: userId, deleted: "earlier", text: "" },
  ];
  const channelRows = [
    { channel: "a1", server: serverA },
    { channel: "a2", server: serverA },
    { channel: "b1", server: serverB },
  ];
  const notified = [];
  let updates = 0;
  const operation =
    (op) =>
    (...args) => ({ op, args });
  function matches(predicate, row) {
    if (!predicate) return true;
    const { op, args } = predicate;
    if (op === "and") return args.every((arg) => matches(arg, row));
    if (op === "eq") return row[args[0]] === args[1];
    if (op === "isNull") return row[args[0]] === null;
    if (op === "inArray")
      return channelRows
        .filter((channel) => matches(args[1].predicate, channel))
        .some((channel) => channel.channel === row[args[0]]);
    throw new Error(`Unexpected predicate ${op}`);
  }
  const dependencies = {
    "../../../../../server/admin-audit": { auditAdmin: async () => {} },
    "drizzle-orm": Object.fromEntries(
      ["and", "asc", "eq", "inArray", "isNull"].map((op) => [
        op,
        operation(op),
      ]),
    ),
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "../../../../../auth": {
      auth: async () =>
        authenticated ? { user: { id: "actor", role } } : null,
    },
    "../../../../../db/schema": {
      messages: {
        id: "id",
        channelId: "channel",
        authorId: "author",
        deletedAt: "deleted",
      },
      channels: { id: "channel", serverId: "server" },
      servers: {},
      users: "users",
    },
    "../../../../../db": {
      db: {
        transaction: (run) => run(dependencies["../../../../../db"].db),
        select: () => ({
          from: (table) => ({
            where: (predicate) =>
              table === "users"
                ? Promise.resolve(ownedDemo ? [{ id: userId }] : [])
                : { predicate },
          }),
        }),
        update: () => ({
          set: (values) => ({
            where: (predicate) => ({
              returning: async () => {
                updates++;
                const selected = rows.filter((row) => matches(predicate, row));
                selected.forEach((row) => {
                  row.text = values.content;
                  row.deleted = values.deletedAt;
                });
                return selected.map((row) => ({
                  id: row.id,
                  channelId: row.channel,
                }));
              },
            }),
          }),
        }),
      },
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
      URL,
      process: { env: { SIGNALING_INTERNAL_SECRET: "test-secret" } },
      fetch: async (_url, request) => {
        notified.push(JSON.parse(request.body));
      },
      require: (key) => {
        assert.ok(key in dependencies, key);
        return dependencies[key];
      },
    },
  );
  return {
    rows,
    notified,
    updates: () => updates,
    remove: (query = "") =>
      exports.DELETE(
        new Request(`http://localhost/api/users/${userId}/messages${query}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ userId }) },
      ),
  };
}
test("server bulk deletion erases only this author's live messages in the selected server and broadcasts those IDs", async () => {
  const f = fixture();
  const response = await f.remove(`?serverId=${serverA}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deletedCount, 2);
  assert.deepEqual(
    f.rows.map((row) => row.text),
    ["", "", "B1", "Other", ""],
  );
  assert.ok(f.rows[0].deleted);
  assert.equal(f.rows[4].deleted, "earlier");
  assert.deepEqual(
    f.notified.map((event) => event.messageId),
    ["a1", "a2"],
  );
});
test("empty and invalid server filters never fall back to deleting all messages", async () => {
  for (const query of ["?serverId=", "?serverId=invalid"]) {
    const f = fixture();
    assert.equal((await f.remove(query)).status, 400);
    assert.equal(f.updates(), 0);
    assert.deepEqual(f.notified, []);
  }
});
test("server bulk deletion retains account authorization and managed-demo access", async () => {
  for (const options of [
    { authenticated: false },
    { userId: "other" },
    { userId: "other", role: "owner" },
  ]) {
    const f = fixture(options);
    assert.equal((await f.remove(`?serverId=${serverA}`)).status, 403);
    assert.equal(f.updates(), 0);
  }
  const owned = fixture({ userId: "demo", role: "owner", ownedDemo: true });
  assert.equal((await owned.remove(`?serverId=${serverA}`)).status, 200);
});
test("unfiltered bulk deletion still deletes across servers but leaves other authors alone", async () => {
  const f = fixture();
  assert.equal((await (await f.remove()).json()).deletedCount, 3);
  assert.equal(f.rows[3].text, "Other");
});
