import assert from "node:assert/strict";
import test from "node:test";
import { isAccountActive } from "../auth-account.mjs";

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
