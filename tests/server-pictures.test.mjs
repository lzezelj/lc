import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const serverId = "11111111-1111-4111-8111-111111111111";
const actor = "viewer";
async function fixture({
  authenticated = true,
  owner = true,
  member = true,
  invited = false,
  staleInvite = false,
  lockedOwner = true,
  allowed = true,
} = {}) {
  const table = (name, columns) =>
    Object.fromEntries(columns.map((column) => [column, `${name}.${column}`]));
  const servers = table("servers", ["id", "createdBy"]),
    serverMembers = table("members", ["serverId", "userId"]),
    serverInvitations = table("invites", [
      "serverId",
      "recipientId",
      "inviterId",
    ]),
    serverPictures = table("pictures", ["serverId", "data"]);
  const record = {
    "servers.id": serverId,
    "servers.createdBy": owner ? actor : "owner",
    "members.serverId": member ? serverId : null,
    "members.userId": member ? actor : null,
    "invites.serverId": invited ? serverId : null,
    "invites.recipientId": invited ? actor : null,
    "invites.inviterId": staleInvite ? "old-owner" : owner ? actor : "owner",
    "pictures.data": Buffer.from("private PNG"),
    "pictures.serverId": serverId,
  };
  let reads = 0;
  const mutations = [],
    events = [];
  function select(fields) {
    let rows = [record];
    const chain = {
      from() {
        return chain;
      },
      innerJoin(_table, predicate) {
        rows = rows.filter(predicate);
        return chain;
      },
      leftJoin(_table, predicate) {
        if (!predicate(record))
          rows = rows.map((row) => ({
            ...row,
            ...Object.fromEntries(
              Object.values(_table).map((column) => [column, null]),
            ),
          }));
        return chain;
      },
      where(predicate) {
        rows = rows.filter(predicate);
        return chain;
      },
      limit() {
        return chain;
      },
      for() {
        if (!lockedOwner) rows = [];
        return chain;
      },
      then(resolve, reject) {
        return Promise.resolve(
          rows.map((row) =>
            Object.fromEntries(
              Object.entries(fields).map(([key, column]) => [key, row[column]]),
            ),
          ),
        ).then(resolve, reject);
      },
    };
    return chain;
  }
  const db = {
    select,
    transaction: async (callback) => callback(db),
    insert: () => ({
      values: (value) => ({
        onConflictDoUpdate: async () => mutations.push(["insert", value]),
      }),
    }),
    delete: () => ({ where: async () => mutations.push(["delete"]) }),
    update: () => ({
      set: (value) => ({
        where: async () => mutations.push(["update", value]),
      }),
    }),
  };
  const deps = {
    "node:crypto": { randomUUID: () => "version" },
    "drizzle-orm": {
      eq: (column, value) => (row) =>
        row[column] === (Object.hasOwn(row, value) ? row[value] : value),
      and:
        (...predicates) =>
        (row) =>
          predicates.every((predicate) => predicate(row)),
      or:
        (...predicates) =>
        (row) =>
          predicates.some((predicate) => predicate(row)),
    },
    "../../../../../auth": {
      auth: async () => (authenticated ? { user: { id: actor } } : null),
    },
    "../../../../../db": { db },
    "../../../../../db/schema": {
      servers,
      serverMembers,
      serverInvitations,
      serverPictures,
    },
    "../../../../../server/profile-pictures": {
      readAvatar: async (request) => {
        reads++;
        return request.headers.get("content-type") === "image/png"
          ? Buffer.from("validated PNG")
          : Response.json({ error: "Invalid image" }, { status: 415 });
      },
    },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed, retryAfterSeconds: 60 }),
    },
    "../../../../../server/notify-user": {
      notifyUser: async (...args) => events.push(args),
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(
      await readFile(
        new URL(
          "../app/api/servers/[serverId]/picture/route.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    ),
    {
      exports,
      Response,
      Uint8Array,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
    },
  );
  return {
    mutations,
    events,
    reads: () => reads,
    run: (method, id = serverId, type = "image/png") =>
      exports[method](
        new Request("http://local/picture", {
          method,
          ...(method === "PUT"
            ? { headers: { "Content-Type": type }, body: "picture" }
            : {}),
        }),
        { params: Promise.resolve({ serverId: id }) },
      ),
  };
}

test("server pictures require authentication, valid IDs and ownership before reading uploads", async () => {
  for (const [options, id, status] of [
    [{ authenticated: false }, serverId, 401],
    [{}, "invalid", 400],
    [{ owner: false }, serverId, 403],
    [{ allowed: false }, serverId, 429],
  ]) {
    const f = await fixture(options);
    assert.equal((await f.run("PUT", id)).status, status);
    assert.equal(f.reads(), 0);
    assert.equal(f.mutations.length, 0);
  }
});
test("picture reads permit members and current invitees but deny outsiders and stale invites", async () => {
  for (const [options, status] of [
    [{ member: true }, 200],
    [{ member: false, invited: true }, 200],
    [{ member: false }, 404],
    [{ member: false, invited: true, staleInvite: true }, 404],
  ]) {
    const response = await (await fixture(options)).run("GET");
    assert.equal(response.status, status);
    if (status === 200) {
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal(response.headers.get("Content-Type"), "image/png");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    }
  }
});
test("picture changes validate uploads, recheck ownership, replace/remove bytes and notify the audience", async () => {
  const invalid = await fixture();
  assert.equal((await invalid.run("PUT", serverId, "text/html")).status, 415);
  assert.equal(invalid.mutations.length, 0);
  const transferred = await fixture({ lockedOwner: false });
  assert.equal((await transferred.run("PUT")).status, 403);
  assert.equal(transferred.mutations.length, 0);
  for (const method of ["PUT", "DELETE"]) {
    const f = await fixture({ invited: true });
    const response = await f.run(method);
    assert.equal(response.status, 200);
    const { image } = await response.json();
    assert.equal(
      image,
      method === "PUT" ? `/api/servers/${serverId}/picture?v=version` : null,
    );
    assert.equal(f.mutations[0][0], method === "PUT" ? "insert" : "delete");
    assert.equal(f.mutations[1][1].image, image);
    assert.equal(f.events.length, 1, "Member/invite audience is deduplicated");
    assert.equal(f.events[0][1].type, "server-picture-updated");
    assert.equal(f.events[0][1].image, image);
  }
});
