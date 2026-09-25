/**
 * Presentation of the authoritative partner presence contract
 * (`partner.presence.online`, `partner.presence.lastSeenAt`, `partner.typing`).
 * Presence, last seen, typing, and read receipts are mutual, always on, and cannot be
 * turned off. This module only formats what the server already reports; it never infers
 * presence from other activity and never invents precision.
 */

export interface PresenceInput {
  readonly online: boolean;
  readonly lastSeenAt: string | null;
}

const RECENT_MS = 10 * 60_000;

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatPresence(
  input: PresenceInput,
  now: Date = new Date(),
  locale?: string,
): string {
  if (input.online) return "Online";
  if (!input.lastSeenAt) return "Offline";
  const seen = new Date(input.lastSeenAt);
  if (Number.isNaN(seen.getTime())) return "Offline";
  const elapsed = now.getTime() - seen.getTime();
  if (elapsed >= 0 && elapsed < RECENT_MS) return "Last seen recently";
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(seen);
  if (sameDay(seen, now)) return "Last seen " + time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(seen, yesterday)) return "Last seen yesterday " + time;
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(seen.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(seen);
  return "Last seen " + date + ", " + time;
}
