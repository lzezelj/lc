import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import {
  WorkspaceActivity,
  serverVoiceUsers,
} from "../app/workspace-activity.ts";

const channel = (
  id = "text-a",
  serverId = "server-a",
  type = "text",
  messageId = "one",
  at = "2026-11-03T12:00:00.000Z",
) => ({ id, serverId, type, latestMessageId: messageId, latestMessageAt: at });
const event = (
  messageId,
  createdAt = "2026-11-03T12:01:00.000Z",
  channelId = "text-a",
  authorId = "other",
) => ({ channelId, messageId, createdAt, authorId });

test("first visit establishes read baselines; new messages flag only the relevant channel/server", () => {
  const activity = new WorkspaceActivity();
  activity.snapshot([channel(), channel("text-b", "server-b")], 0);
  assert.deepEqual(activity.unread(), {});
  activity.message(event("two"), "me");
  assert.deepEqual(activity.unread(), { "text-a": true });
  activity.read("text-a");
  assert.deepEqual(activity.unread(), {});
  const restored = new WorkspaceActivity(activity.reads);
  restored.snapshot(
    [
      channel(
        "text-a",
        "server-a",
        "text",
        "three",
        "2026-11-03T12:02:00.000Z",
      ),
    ],
    0,
  );
  assert.deepEqual(
    restored.unread(),
    { "text-a": true },
    "a reload or reconnect must detect missed messages",
  );
});

test("own, duplicate, malformed and older events do not create or regress unread state", () => {
  const activity = new WorkspaceActivity();
  activity.snapshot([channel()], 0);
  activity.message(event("own", undefined, undefined, "me"), "me");
  activity.message(event("bad", "not-a-date"), "me");
  assert.deepEqual(activity.unread(), {});
  activity.message(event("two"), "me");
  activity.read("text-a");
  activity.message(event("two"), "me");
  activity.message(event("old", "2026-11-03T11:59:00Z"), "me");
  assert.deepEqual(activity.unread(), {});
});

test("live activity during a snapshot is retained, including before initial metadata arrives", () => {
  const activity = new WorkspaceActivity();
  const started = activity.version;
  activity.message(event("two"), "me");
  activity.snapshot([channel()], started);
  assert.equal(activity.channels.get("text-a").latestMessageId, "two");
  assert.deepEqual(activity.unread(), { "text-a": true });
  const next = activity.version;
  activity.message(event("three", "2026-11-03T12:02:00Z"), "me");
  activity.snapshot(
    [channel("text-a", "server-a", "text", "two", "2026-11-03T12:01:00Z")],
    next,
  );
  assert.equal(activity.channels.get("text-a").latestMessageId, "three");
});

test("authoritative deletion/revocation snapshots clear obsolete activity and read markers", () => {
  const activity = new WorkspaceActivity();
  activity.snapshot([channel()], 0);
  activity.message(event("two"), "me");
  activity.snapshot([channel()], activity.version);
  assert.deepEqual(
    activity.unread(),
    {},
    "deleting the only unread message must restore the read baseline",
  );
  activity.snapshot([], activity.version);
  assert.equal(activity.channels.size, 0);
  assert.deepEqual(activity.reads, {});
});

test("read markers merge monotonically across tabs and remain isolated between account trackers", () => {
  const first = new WorkspaceActivity();
  first.snapshot([channel()], 0);
  const second = new WorkspaceActivity({ ...first.reads });
  second.snapshot([channel()], 0);
  first.message(event("two"), "me");
  first.read("text-a");
  second.message(event("two"), "me");
  assert.deepEqual(second.unread(), { "text-a": true });
  second.mergeReads(first.reads);
  assert.deepEqual(second.unread(), {});
  second.snapshot([channel()], second.version);
  second.read("text-a");
  assert.equal(
    second.reads["text-a"],
    first.reads["text-a"],
    "a deleted or stale message cannot move the read cursor backward",
  );
  const otherAccount = new WorkspaceActivity();
  assert.deepEqual(otherAccount.reads, {});
});

test("voice summaries include all server voice channels, deduplicate user identities and exclude other servers", () => {
  const channels = [
    channel("voice-a", "server-a", "voice_direct"),
    channel("voice-b", "server-a", "voice_group"),
    channel("voice-c", "server-b", "voice_group"),
    channel(),
  ];
  const people = serverVoiceUsers("server-a", channels, {
    "voice-a": [{ userId: "one", name: "Alex" }],
    "voice-b": [
      { userId: "one", name: "Alex" },
      { userId: "two", name: "Alex" },
    ],
    "voice-c": [{ userId: "three", name: "Other server" }],
    "text-a": [{ userId: "four", name: "Not voice" }],
  });
  assert.deepEqual(
    people.map((person) => person.userId),
    ["one", "two"],
  );
});

test("activity API derives membership from the session and excludes own/deleted messages without returning content", async () => {
  for (const authenticated of [false, true]) {
    const joins = [],
      selections = [];
    const table = (name) =>
      new Proxy({}, { get: (_, key) => `${name}.${String(key)}` });
    const schema = {
      channels: table("channel"),
      messages: table("message"),
      serverMembers: table("member"),
    };
    const chain = {
      from() {
        return chain;
      },
      innerJoin(_table, condition) {
        joins.push(condition);
        return chain;
      },
      leftJoin(_table, condition) {
        joins.push(condition);
        return chain;
      },
      orderBy: async () => [channel()],
    };
    const exports = {};
    vm.runInNewContext(
      ts.transpile(
        await readFile(
          new URL("../app/api/workspace-activity/route.ts", import.meta.url),
          "utf8",
        ),
        { module: ts.ModuleKind.CommonJS },
      ),
      {
        exports,
        require: (name) =>
          ({
            "drizzle-orm": Object.fromEntries(
              ["and", "desc", "eq", "isNull", "ne"].map((key) => [
                key,
                (...args) => ({ key, args }),
              ]),
            ),
            "next/server": { NextResponse: { json: Response.json } },
            "../../../auth": {
              auth: async () =>
                authenticated ? { user: { id: "actor" } } : null,
            },
            "../../../db": {
              db: {
                selectDistinctOn: (_keys, fields) => {
                  selections.push(fields);
                  return chain;
                },
              },
            },
            "../../../db/schema": schema,
          })[name],
      },
    );
    const response = await exports.GET();
    assert.equal(response.status, authenticated ? 200 : 401);
    if (!authenticated) {
      assert.equal(joins.length, 0);
      continue;
    }
    assert.match(JSON.stringify(joins[0]), /member.userId.*actor/);
    assert.match(JSON.stringify(joins[1]), /message.authorId.*actor/);
    assert.match(JSON.stringify(joins[1]), /isNull.*message.deletedAt/);
    assert.ok(!JSON.stringify(selections).includes("content"));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
