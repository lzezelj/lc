import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as handles from "../user-handle.ts";
import * as accountPolicy from "../auth-account.mjs";

test("handles display bracketed numbers and accept old and new search formats", () => {
  assert.equal(handles.buildUserHandle("Lovro Žeželj", 7), "lovrozezelj.0007");
  assert.equal(handles.buildUserHandle("", 0), "user.0000");
  assert.equal(
    handles.formatUserHandle("lovrozezelj.0007"),
    "lovrozezelj (0007)",
  );
  assert.equal(handles.formatUserHandle(null), "");
  assert.equal(handles.normalizeUserHandle(" Lovro (0007) "), "lovro.0007");
  assert.equal(handles.normalizeUserHandle("Lovro.0007"), "lovro.0007");
  assert.equal(handles.normalizeUserHandle("Lovro (00"), "lovro.00");
  assert.equal(handles.normalizeUserHandle("Lovro ("), "lovro.");
});

async function compile(path, dependencies) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (name) => {
        if (!(name in dependencies))
          throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
      },
      process: {
        env: {
          OWNER_EMAIL: "owner@example.test",
          ALLOWED_EMAILS: "new@example.test",
        },
      },
    },
  );
  return exports;
}

async function allocator(initial, reserved = []) {
  const user = initial ? { ...initial } : null;
  let nextNumber = 0;
  let writes = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: async () => (user ? [{ handle: user.handle }] : []),
      }),
    }),
    update: () => ({
      set: (values) => ({
        where: () => ({
          returning: async () => {
            writes++;
            if (reserved.includes(values.handle))
              throw { cause: { code: "23505" } };
            if (!user || user.handle !== null) return [];
            user.handle = values.handle;
            return [{ handle: user.handle }];
          },
        }),
      }),
    }),
  };
  const schema = { users: { id: "id", handle: "handle" } };
  const compiled = await compile("../server/user-handles.ts", {
    "node:crypto": { randomInt: () => nextNumber++ },
    "drizzle-orm": {
      and: (...values) => values,
      eq: (...values) => values,
      isNull: (value) => value,
    },
    "../db": { db },
    "../db/schema": schema,
    "../user-handle": handles,
  });
  return { ensure: compiled.ensureUserHandle, user, writes: () => writes };
}

test("missing handles are allocated with collision retries without replacing existing handles", async () => {
  const missing = await allocator({ handle: null }, ["lovro.0000"]);
  assert.equal(await missing.ensure("user", "Lovro"), "lovro.0001");
  assert.equal(await missing.ensure("user", "Renamed"), "lovro.0001");
  assert.equal(missing.writes(), 2);
  const deleted = await allocator(null);
  await assert.rejects(deleted.ensure("missing", "Lovro"), /missing user/);
});

test("concurrent handle repairs preserve the first successful assignment", async () => {
  const shared = await allocator({ handle: null });
  const result = await Promise.all([
    shared.ensure("user", "Lovro"),
    shared.ensure("user", "Lovro"),
  ]);
  assert.equal(result[0], result[1]);
  assert.equal(shared.user.handle, result[0]);
});

test("OAuth handle allocation runs after persistence and session refresh repairs older accounts", async () => {
  let config;
  let persisted = false;
  const assigned = [];
  const roleWrites = [];
  const db = {
    update: () => ({
      set: (values) => ({
        where: async () => {
          roleWrites.push(values);
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => [
          {
            id: "saved-user",
            name: "New User",
            role: "member",
            handle: null,
            disabledAt: null,
            expiresAt: null,
          },
        ],
      }),
    }),
  };
  await compile("../auth.ts", {
    "node:crypto": {},
    "@auth/drizzle-adapter": { DrizzleAdapter: () => ({}) },
    "drizzle-orm": {
      and: (...values) => values,
      eq: (...values) => values,
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
    "./db": { db },
    "./db/schema": {
      users: { id: "id" },
      accounts: {},
      demoInvites: {},
      serverMembers: {},
      sessions: {},
    },
    "./server/user-handles": {
      ensureUserHandle: async (id) => {
        assert.equal(persisted, true);
        assigned.push(id);
        return "newuser.0001";
      },
    },
  });
  const user = {
    id: "temporary-profile-id",
    name: "New User",
    email: "new@example.test",
  };
  assert.equal(
    await config.callbacks.signIn({
      user,
      account: { provider: "google" },
      profile: { email: user.email, email_verified: true },
    }),
    true,
  );
  assert.equal(
    assigned.length,
    0,
    "signIn runs before a new database user exists",
  );
  persisted = true;
  user.id = "saved-user";
  const token = await config.callbacks.jwt({
    token: {},
    user,
    account: { provider: "google" },
  });
  assert.equal(token.handle, "newuser.0001");
  assert.deepEqual(assigned, ["saved-user"]);
  assert.equal(roleWrites[0].role, "member");
  const refreshed = await config.callbacks.jwt({
    token: { userId: "saved-user", iat: Math.floor(Date.now() / 1000) },
  });
  assert.equal(refreshed.handle, "newuser.0001");
  const session = await config.callbacks.session({
    session: { user: {} },
    token: refreshed,
  });
  assert.equal(session.user.handle, "newuser.0001");
});
