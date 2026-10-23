import assert from "node:assert/strict";
import { test } from "node:test";
import { createSignalQueue } from "../app/direct-negotiation.ts";
import { createAudioWindowStats } from "../app/audio-window-stats.ts";

test("SDP finishes before subsequent ICE candidates are applied", async () => {
  let finishDescription;
  const pendingDescription = new Promise((resolve) => {
    finishDescription = resolve;
  });
  const events = [];
  const receive = createSignalQueue(
    async (message) => {
      if (message === "offer") {
        events.push("start SDP");
        await pendingDescription;
        events.push("finish SDP");
      } else events.push(message);
    },
    (error) => {
      throw error;
    },
  );
  const offer = receive("offer");
  const candidate = receive("candidate");
  await Promise.resolve();
  assert.deepEqual(events, ["start SDP"]);
  finishDescription();
  await Promise.all([offer, candidate]);
  assert.deepEqual(events, ["start SDP", "finish SDP", "candidate"]);
});

test("a malformed signal does not permanently block subsequent messages", async () => {
  const errors = [];
  const events = [];
  const receive = createSignalQueue(
    async (message) => {
      if (message === "invalid") throw new Error("bad SDP");
      events.push(message);
    },
    (error) => errors.push(error.message),
  );
  await receive("invalid");
  await receive("offer");
  assert.deepEqual(errors, ["bad SDP"]);
  assert.deepEqual(events, ["offer"]);
});

test("brief audio loss is visible even when whole-call loss would round down", () => {
  const sample = createAudioWindowStats();
  sample({ received: 100000, lost: 0, concealed: 0, samples: 96000000 });
  assert.equal(
    sample({ received: 100045, lost: 5, concealed: 4800, samples: 96048000 }),
    "loss 10.0% / concealed 10.0%",
  );
  assert.equal(
    sample({ received: 100095, lost: 5, concealed: 4800, samples: 96096000 }),
    "loss 0.0% / concealed 0.0%",
  );
  assert.equal(
    sample({ received: 0, lost: 0, concealed: 0, samples: 0 }),
    "measuring…",
  );
});
