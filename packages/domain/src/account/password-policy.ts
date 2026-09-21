import type { RuleDecision } from "./types.ts";

const COMMON_PASSWORDS = new Set([
  "123456789012345",
  "1234567890123456",
  "12345678901234567890",
  "abcdefghijklmnop",
  "correcthorsebatterystaple",
  "iloveyouiloveyou",
  "letmeinletmeinletmein",
  "passwordpassword",
  "qwertyqwertyqwerty",
  "welcome123456789",
]);

export function normalizePassword(value: string): string {
  return value.normalize("NFC");
}

export function validatePasswordPolicy(value: string): RuleDecision {
  const normalized = normalizePassword(value);
  const codePoints = [...normalized].length;
  if (codePoints < 15) return { allowed: false, reason: "PASSWORD_TOO_SHORT" };
  if (codePoints > 128) return { allowed: false, reason: "PASSWORD_TOO_LONG" };
  let encodedBytes = 0;
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    encodedBytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  if (encodedBytes > 1024) {
    return { allowed: false, reason: "PASSWORD_TOO_LARGE" };
  }
  if (COMMON_PASSWORDS.has(normalized.toLowerCase())) {
    return { allowed: false, reason: "PASSWORD_COMMON" };
  }
  return { allowed: true, reason: null };
}
