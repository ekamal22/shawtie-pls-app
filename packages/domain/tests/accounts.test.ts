import assert from "node:assert/strict";
import test from "node:test";
import {
  ageOnDate,
  evaluateDateOfBirthCorrection,
  evaluateUsernameChange,
  isAdultOnDate,
  normalizePassword,
  normalizeUsername,
  validatePasswordPolicy,
  validateUsername,
} from "../src/index.ts";

test("age eligibility uses exact calendar birthday boundaries", () => {
  assert.equal(isAdultOnDate("2008-09-21", "2026-09-20"), false);
  assert.equal(isAdultOnDate("2008-09-21", "2026-09-21"), true);
  assert.equal(ageOnDate("2004-02-29", "2022-02-28"), 17);
  assert.equal(ageOnDate("2004-02-29", "2022-03-01"), 18);
});

test("username policy is canonical and reserved names are rejected", () => {
  assert.deepEqual(normalizeUsername("  Alice.Name  "), {
    display: "Alice.Name",
    normalized: "alice.name",
  });
  assert.equal(validateUsername("alice_name").allowed, true);
  assert.equal(validateUsername("a").allowed, false);
  assert.equal(validateUsername("alice..name").allowed, false);
  assert.equal(validateUsername("support").reason, "USERNAME_RESERVED");
});

test("password policy uses NFC, long passwords, and no composition rule", () => {
  assert.equal(normalizePassword("e\u0301"), "é");
  assert.equal(validatePasswordPolicy("this is a long passphrase").allowed, true);
  assert.equal(validatePasswordPolicy("short-password").reason, "PASSWORD_TOO_SHORT");
  assert.equal(validatePasswordPolicy("passwordpassword").reason, "PASSWORD_COMMON");
});

test("username cooldown and partnership occupancy are server decisions", () => {
  const now = new Date("2026-09-21T00:00:00.000Z");
  assert.equal(evaluateUsernameChange(now, null, false).allowed, true);
  assert.equal(evaluateUsernameChange(now, null, true).reason, "USERNAME_CHANGE_NOT_ALLOWED");
  assert.equal(
    evaluateUsernameChange(now, new Date("2026-09-22T00:00:00.000Z"), false).reason,
    "USERNAME_CHANGE_NOT_ALLOWED",
  );
});

test("underage DOB correction does not consume the allowance", () => {
  const rejected = evaluateDateOfBirthCorrection("2026-09-21", "2010-01-01", false);
  assert.equal(rejected.reason, "AGE_INELIGIBLE");
  const accepted = evaluateDateOfBirthCorrection("2026-09-21", "2000-01-01", false);
  assert.equal(accepted.allowed, true);
  assert.equal(
    evaluateDateOfBirthCorrection("2026-09-21", "2000-01-01", true).reason,
    "DOB_CORRECTION_ALREADY_USED",
  );
});
