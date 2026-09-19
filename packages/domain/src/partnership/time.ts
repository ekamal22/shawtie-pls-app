const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * HOUR_MS).toISOString();
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export function addCalendarMonthsUtc(iso: string, months: number): string {
  const input = new Date(iso);
  const year = input.getUTCFullYear();
  const month = input.getUTCMonth();
  const day = input.getUTCDate();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);

  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    targetDay,
    input.getUTCHours(),
    input.getUTCMinutes(),
    input.getUTCSeconds(),
    input.getUTCMilliseconds(),
  )).toISOString();
}

export function isBefore(a: string, b: string): boolean {
  return new Date(a).getTime() < new Date(b).getTime();
}

export function isAtOrAfter(a: string, b: string): boolean {
  return new Date(a).getTime() >= new Date(b).getTime();
}
