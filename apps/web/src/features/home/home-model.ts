import type { RelationshipItem, RelationshipSpaceHome } from "../relationship-space/model.ts";

/**
 * Pure Home presentation logic (UX2). Everything here reads data the app already fetches
 * (existing conversation messages and the R1 home aggregate and this-day experience). It never
 * tallies, ranks, or summarizes activity, and it never infers presence.
 */

export interface LatestMessageInput {
  readonly senderAccountId: string;
  readonly body: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly attachments: ReadonlyArray<{ readonly kind: string; readonly role: string }>;
}

export interface LatestPreview {
  readonly fromMe: boolean;
  readonly text: string;
  readonly createdAt: string;
}

const PREVIEW_MAX = 140;

function clamp(text: string): string {
  const chars = Array.from(text);
  return chars.length <= PREVIEW_MAX ? text : chars.slice(0, PREVIEW_MAX - 1).join("") + "\u2026";
}

/** Null when nothing gentle can be said (no message, or the latest one was deleted). */
export function latestPreview(
  message: LatestMessageInput | null,
  selfAccountId: string,
): LatestPreview | null {
  if (!message || message.deletedAt) return null;
  const body = message.body?.replace(/\s+/g, " ").trim() ?? "";
  let text = body;
  if (!text) {
    const first = message.attachments[0];
    if (!first) return null;
    text =
      first.role === "voice_message" || first.kind === "voice"
        ? "Voice message"
        : first.kind === "image"
          ? "Photo"
          : first.kind === "video"
            ? "Video"
            : "Attachment";
  }
  return {
    fromMe: message.senderAccountId === selfAccountId,
    text: clamp(text),
    createdAt: message.createdAt,
  };
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Real timestamp of the message, formatted quietly; never relative precision we do not have. */
export function formatMessageWhen(iso: string, now: Date = new Date(), locale?: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  if (sameDay(when, now)) {
    return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(when);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(when, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(when);
}

/** Calendar dates (YYYY-MM-DD) are compared as UTC days, as the server supplies them. */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(fromDate + "T00:00:00.000Z");
  const to = Date.parse(toDate + "T00:00:00.000Z");
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

export function formatCalendarDate(date: string, locale?: string): string {
  const parsed = new Date(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export type HomeMoment =
  | { readonly type: "reunion"; readonly days: number; readonly date: string }
  | { readonly type: "anniversary"; readonly days: number; readonly date: string }
  | { readonly type: "this_day"; readonly title: string }
  | { readonly type: "recent"; readonly title: string };

/** Kinds that are safe to mention on Home. Surprises, proposals, signals, and curations stay in Ours. */
const MENTIONABLE = new Set([
  "memory",
  "remember_this",
  "first",
  "place",
  "for_you",
  "love",
  "future_us",
  "someday",
]);

const KIND_LABEL: Record<string, string> = {
  memory: "A memory",
  remember_this: "Something kept",
  first: "A first",
  place: "A place",
  for_you: "Something for you",
  love: "Something loved",
  future_us: "Something for later",
  someday: "A someday",
};

function readString(value: Record<string, unknown> | null, key: string): string | null {
  const found = value?.[key];
  return typeof found === "string" && found.trim() ? found.trim() : null;
}

export function itemLabel(item: RelationshipItem): string | null {
  if (!MENTIONABLE.has(item.kind)) return null;
  // A locked item never reveals its content here.
  if (item.release && item.release.state !== "released") return null;
  const text =
    readString(item.preview, "title") ??
    readString(item.content, "title") ??
    readString(item.content, "snapshotText") ??
    readString(item.content, "text") ??
    readString(item.content, "note");
  return clamp(text ?? KIND_LABEL[item.kind] ?? "A memory");
}

const ANNIVERSARY_WINDOW_DAYS = 14;

/**
 * At most one quiet element. Order: the reunion the couple entered themselves, an anniversary
 * that is close, this day, then the most recent shared item.
 */
export function pickMoment(
  space: RelationshipSpaceHome | null,
  thisDay: readonly RelationshipItem[],
): HomeMoment | null {
  if (!space || space.mode === "terminated_or_unavailable") return null;
  const reunion = space.reunion;
  if (reunion?.featureState?.type === "reunion") {
    const days = daysBetween(space.serverDate, reunion.featureState.targetDate);
    if (Number.isFinite(days) && days >= 0) {
      return { type: "reunion", days, date: reunion.featureState.targetDate };
    }
  }
  const anniversaryDays = daysBetween(space.serverDate, space.anniversary.date);
  if (
    Number.isFinite(anniversaryDays) &&
    anniversaryDays >= 0 &&
    anniversaryDays <= ANNIVERSARY_WINDOW_DAYS
  ) {
    return { type: "anniversary", days: anniversaryDays, date: space.anniversary.date };
  }
  for (const item of thisDay) {
    const title = itemLabel(item);
    if (title) return { type: "this_day", title };
  }
  for (const item of space.recentItems) {
    const title = itemLabel(item);
    if (title) return { type: "recent", title };
  }
  return null;
}

export function daysPhrase(days: number): string {
  if (days === 0) return "Today";
  return days === 1 ? "1 day" : days + " days";
}

/** Local calendar date for the this-day experience, as YYYY-MM-DD. */
export function localDateKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}
