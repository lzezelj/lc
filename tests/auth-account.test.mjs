import assert from "node:assert/strict";
import test from "node:test";
import {
  isAccountActive,
  isSessionWithinLifetime,
  SESSION_MAX_AGE_SECONDS,
} from "../auth-account.mjs";

const now = new Date("2026-10-22T12:00:00.000Z");

test("active accounts without an expiry remain valid", () => {
  assert.equal(
    isAccountActive({ disabledAt: null, expiresAt: null }, now),
    true,
  );
});

test("a future demo-account expiry remains valid", () => {
  assert.equal(
    isAccountActive(
      { disabledAt: null, expiresAt: new Date("2026-10-22T12:01:00.000Z") },
      now,
    ),
    true,
  );
});

test("expired, disabled, and missing accounts are rejected", () => {
  assert.equal(
    isAccountActive(
      { disabledAt: null, expiresAt: new Date("2026-10-22T12:00:00.000Z") },
      now,
    ),
    false,
  );
  assert.equal(
    isAccountActive({ disabledAt: now, expiresAt: null }, now),
    false,
  );
  assert.equal(isAccountActive(undefined, now), false);
});

test("login sessions have a renewable 24-hour lifetime, including legacy cookies", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 86400);
  const current = Math.floor(now.getTime() / 1000);
  assert.equal(isSessionWithinLifetime(current - 86399, now), true);
  assert.equal(isSessionWithinLifetime(current - 86400, now), false);
  assert.equal(
    isSessionWithinLifetime(current - 7 * 86400, now),
    false,
    "a former 30-day cookie must not survive the new policy",
  );
  assert.equal(isSessionWithinLifetime(undefined, now), false);
  assert.equal(isSessionWithinLifetime(NaN, now), false);
  const later = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  assert.equal(
    isSessionWithinLifetime(current, later),
    true,
    "a renewed token gets a fresh window",
  );
});
