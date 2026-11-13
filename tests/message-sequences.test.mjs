import assert from "node:assert/strict";
import test from "node:test";
import { messageSequences } from "../app/message-sequences.ts";
import { formatMessageTimestamp } from "../app/message-timestamp.ts";

test("message timestamps use time today, Yesterday at time, or date at time", () => {
  const now = new Date(2026, 10, 13, 12).getTime();
  assert.equal(
    formatMessageTimestamp(
      new Date(2026, 10, 13, 8, 5).getTime(),
      now,
      "en-GB",
    ),
    "08:05",
  );
  assert.equal(
    formatMessageTimestamp(
      new Date(2026, 10, 12, 8, 5).getTime(),
      now,
      "en-GB",
    ),
    "Yesterday at 08:05",
  );
  assert.equal(
    formatMessageTimestamp(
      new Date(2026, 10, 11, 8, 5).getTime(),
      now,
      "en-GB",
    ),
    "11/11/2026 at 08:05",
  );
  assert.equal(formatMessageTimestamp(NaN, now, "en-GB"), "");
  assert.equal(
    formatMessageTimestamp(
      new Date(2026, 10, 13, 18, 5).getTime(),
      now,
      "en-US",
    ),
    "18:05",
  );
  assert.equal(
    formatMessageTimestamp(
      new Date(2026, 10, 13, 0, 5).getTime(),
      now,
      "en-US",
    ),
    "00:05",
  );
});

test("Yesterday uses local calendar days across year, month and daylight-saving boundaries", () => {
  for (const [year, month, day] of [
    [2027, 0, 1],
    [2026, 3, 1],
    [2026, 2, 30],
  ]) {
    assert.equal(
      formatMessageTimestamp(
        new Date(year, month, day - 1, 23, 59).getTime(),
        new Date(year, month, day, 0, 1).getTime(),
        "en-GB",
      ),
      "Yesterday at 23:59",
    );
  }
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
