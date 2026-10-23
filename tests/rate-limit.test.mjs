import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRateLimit,
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
  assert.equal(checkRateLimit("message:user", policy, 10_000).allowed, true);
});
