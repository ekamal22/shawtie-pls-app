import { addCalendarMonthsUtc, addHours, isAtOrAfter, isBefore } from "../partnership/time.ts";

function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function trustedUtcDate(now: string | Date): string {
  return (typeof now === "string" ? new Date(now) : now).toISOString().slice(0, 10);
}

export function isValidRelationshipStartDate(value: string): boolean {
  return parseDateOnly(value) !== null;
}

export function relationshipStartDateAllowed(value: string, serverDate: string): boolean {
  return isValidRelationshipStartDate(value) && value <= serverDate;
}

export function partnerRequestExpired(expiresAt: string, now: string): boolean {
  return isAtOrAfter(now, expiresAt);
}

export function declineCooldownActive(lastDeclinedAt: string | null, now: string): boolean {
  return Boolean(lastDeclinedAt && isBefore(now, addHours(lastDeclinedAt, 1)));
}

export function rollingMonthCutoffUtc(now: string): string {
  return addCalendarMonthsUtc(now, -1);
}
