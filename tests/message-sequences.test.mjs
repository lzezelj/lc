import assert from "node:assert/strict";
import test from "node:test";
import {
  messageSequences,
  repeatedMessageTimes,
} from "../app/message-sequences.ts";

test("repeat times collapse only within an author group and the same actual minute", () => {
  const start = Date.parse("2026-11-12T10:00:01Z");
  const rows = [
    message("1", "a", { sentAt: start }),
    message("2", "a", { sentAt: start + 1000 }),
    message("3", "a", { sentAt: start + 60000 }),
    message("4", "b", { sentAt: start + 60000 }),
  ];
  const repeated = repeatedMessageTimes(rows);
  assert.equal(repeated.get("1"), false);
  assert.equal(repeated.get("2"), true);
  assert.equal(repeated.get("3"), false);
  assert.equal(repeated.get("4"), false);
  assert.equal(repeatedMessageTimes(rows, "2").get("2"), false);
  assert.equal(
    repeatedMessageTimes([message("1"), message("2")]).get("2"),
    false,
  );
  assert.equal(
    repeatedMessageTimes([
      rows[0],
      message("2", "a", { sentAt: start + 86400000 }),
    ]).get("2"),
    false,
  );
});

const message = (id, authorId = "a", extra = {}) => ({
  id,
  authorId,
  kind: "message",
  ...extra,
});

test("consecutive authors join while each message retains its own identity", () => {
  const groups = messageSequences([
    message("1"),
    message("2"),
    message("3", "b"),
  ]);
  assert.deepEqual(groups.get("1"), { continuation: false, continues: true });
  assert.deepEqual(groups.get("2"), { continuation: true, continues: false });
  assert.deepEqual(groups.get("3"), { continuation: false, continues: false });
});

test("calls, deletions, replies and unread boundaries interrupt grouping", () => {
  for (const extra of [
    { kind: "call" },
    { deleted: true },
    { replyTo: { id: "earlier" } },
  ]) {
    const groups = messageSequences([message("1"), message("2", "a", extra)]);
    assert.equal(groups.get("2").continuation, false);
  }
  const unread = messageSequences(
    [message("1"), message("2"), message("3")],
    "2",
  );
  assert.equal(unread.get("1").continues, false);
  assert.equal(unread.get("2").continuation, false);
  assert.equal(unread.get("3").continuation, true);
  assert.equal(messageSequences([]).size, 0);
  assert.equal(messageSequences([message("2")]).get("2").continuation, false);
});
