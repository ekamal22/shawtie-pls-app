import type { RuleDecision } from "./types.ts";

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
  return { allowed: true, reason: null };
}
