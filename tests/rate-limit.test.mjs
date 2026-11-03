import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRateLimit,
  rateLimitMessage,
  resetRateLimitsForTests,
} from "../server/rate-limit.ts";

test("rate limits reject requests after the configured allowance", () => {
  resetRateLimitsForTests();
  const policy = { limit: 2, windowMs: 10_000 };
  assert.equal(checkRateLimit("message:user", policy, 0).allowed, true);
  assert.equal(checkRateLimit("message:user", policy, 1).allowed, true);
  const rejected = checkRateLimit("message:user", policy, 2);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 10);
  assert.equal(
    rateLimitMessage(
      "You are sending messages too quickly.",
      rejected.retryAfterSeconds,
    ),
    "You are sending messages too quickly. Please wait 10 seconds before trying again.",
  );
  const nearReset = checkRateLimit("message:user", policy, 9_001);
  assert.equal(nearReset.allowed, false);
  assert.equal(
    rateLimitMessage("Too many requests.", nearReset.retryAfterSeconds),
    "Too many requests. Please wait 1 second before trying again.",
  );
  assert.equal(checkRateLimit("message:user", policy, 10_000).allowed, true);
});
