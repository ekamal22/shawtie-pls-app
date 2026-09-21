const MINIMUM_AGE = 18;

export function ageOnDate(dateOfBirth: string, onDate: string): number {
  const birth = parseDateOnly(dateOfBirth);
  const current = parseDateOnly(onDate);
  let age = current.year - birth.year;
  if (current.month < birth.month || (current.month === birth.month && current.day < birth.day)) {
    age -= 1;
  }
  return age;
}

export function isAdultOnDate(dateOfBirth: string, onDate: string): boolean {
  return ageOnDate(dateOfBirth, onDate) >= MINIMUM_AGE;
}

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Expected ISO calendar date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }
  return { year, month, day };
}
