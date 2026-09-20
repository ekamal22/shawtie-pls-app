import type { RuleDecision, UsernameValue } from "./types.ts";

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9]|[._](?=[a-z0-9])){1,28}[a-z0-9]$/;

const RESERVED = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "help",
  "moderator",
  "root",
  "security",
  "shawtie",
  "staff",
  "support",
  "system",
]);

export function normalizeUsername(value: string): UsernameValue {
  const display = value.trim().normalize("NFKC");
  return { display, normalized: display.toLowerCase() };
}

export function validateUsername(value: string): RuleDecision {
  const { normalized } = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(normalized)) {
    return { allowed: false, reason: "USERNAME_INVALID" };
  }
  if (RESERVED.has(normalized)) {
    return { allowed: false, reason: "USERNAME_RESERVED" };
  }
  return { allowed: true, reason: null };
}

export function isReservedUsername(value: string): boolean {
  return RESERVED.has(normalizeUsername(value).normalized);
}
