import type { RelationshipItem, RelationshipItemKind } from "../relationship-space/model.ts";

/*
 * Ours presentation model (UX4). Pure functions that map existing R1 item kinds onto the
 * Then, Now, Next chapters and the Firsts, Places, Kept lenses. This is a presentation
 * mapping only (PRESENTATION_ONLY): no kind, API, or authority is added or changed, and
 * lifecycle mode and capabilities always come from the server projection.
 */

export type Chapter = "then" | "now" | "next";
export type Lens = "all" | "firsts" | "places" | "kept";

export const CHAPTERS: readonly Chapter[] = ["then", "now", "next"];

export const CHAPTER_KINDS: Readonly<Record<Chapter, readonly RelationshipItemKind[]>> = {
  then: ["memory", "first", "place", "remember_this"],
  now: ["for_you", "love", "relationship_signal", "surprise", "proposal"],
  next: ["someday", "future_us", "reunion", "anniversary", "our_year"],
};

export const LENS_KINDS: Readonly<Record<Exclude<Lens, "all">, RelationshipItemKind>> = {
  firsts: "first",
  places: "place",
  kept: "remember_this",
};

export const LENS_LABELS: Readonly<Record<Lens, string>> = {
  all: "All",
  firsts: "Firsts",
  places: "Places",
  kept: "Kept",
};

export const CHAPTER_COPY: Readonly<
  Record<Chapter, { title: string; kicker: string; empty: string; emptyHint: string }>
> = {
  then: {
    title: "Then",
    kicker: "What made us us",
    empty: "The story starts wherever you like.",
    emptyHint: "A memory, a first, or a place can go here whenever you want to keep one.",
  },
  now: {
    title: "Now",
    kicker: "Today, between us",
    empty: "Nothing new right now.",
    emptyHint: "Letters, reasons, and small signals will gather here.",
  },
  next: {
    title: "Next",
    kicker: "Where we are heading",
    empty: "Room for whatever comes next.",
    emptyHint: "Someday plans, future letters, and reunions can live here.",
  },
};

const KIND_LABELS: Readonly<Record<RelationshipItemKind, string>> = {
  memory: "Memory",
  remember_this: "Kept",
  first: "A first",
  place: "A place",
  for_you: "A letter for you",
  future_us: "Future Us",
  love: "Love",
  someday: "Someday",
  our_year: "Our Year",
  anniversary: "Anniversary",
  surprise: "Surprise",
  reunion: "Until we're together again",
  proposal: "Proposal",
  relationship_signal: "Signal",
};

export function kindLabel(kind: RelationshipItemKind): string {
  return KIND_LABELS[kind] ?? kind;
}

export function chapterOf(kind: RelationshipItemKind): Chapter {
  for (const chapter of CHAPTERS) {
    if (CHAPTER_KINDS[chapter].includes(kind)) return chapter;
  }
  return "then";
}

export function lensKinds(chapter: Chapter, lens: Lens): readonly RelationshipItemKind[] {
  if (chapter === "then" && lens !== "all") return [LENS_KINDS[lens]];
  return CHAPTER_KINDS[chapter];
}

export function readString(value: Record<string, unknown> | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === "string" && item.trim() ? item : null;
}

export function itemTitle(item: RelationshipItem): string {
  return (
    readString(item.preview, "title") ??
    readString(item.content, "title") ??
    readString(item.content, "text") ??
    readString(item.content, "snapshotText") ??
    readString(item.content, "body") ??
    kindLabel(item.kind)
  );
}

/** The main readable text of an item, preferring the fuller fields over the title. */
export function itemBody(item: RelationshipItem): string | null {
  return (
    readString(item.content, "body") ??
    readString(item.content, "note") ??
    readString(item.content, "snapshotText") ??
    readString(item.content, "text") ??
    readString(item.content, "sharedFeelingText") ??
    readString(item.content, "intro")
  );
}

export function isLocked(item: RelationshipItem): boolean {
  return item.release?.state === "locked";
}

/**
 * The scheduled release time the authoritative R1 projection already exposes for a locked
 * item. Knowing when something will arrive is intentional anticipation (accepted product
 * rule); it is never computed, inferred, counted down, or read from anything but the
 * projection's own `release.unlockAt`.
 */
export function scheduledArrival(item: RelationshipItem): string | null {
  const release = item.release;
  if (!release || release.state !== "locked" || release.mode !== "scheduled") return null;
  return typeof release.unlockAt === "string" && release.unlockAt.length > 0
    ? release.unlockAt
    : null;
}

export function arrivalText(iso: string): string | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return (
    "Arrives " +
    new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(value)
  );
}

export function hasVoiceLetter(item: RelationshipItem): boolean {
  return item.references.some(
    (reference) => reference.referenceType === "media" && reference.role === "voice_letter",
  );
}

function occurrenceParts(
  item: RelationshipItem,
): { year: number; month: number | null; day: number | null } | null {
  const value = item.occurrence;
  if (!value || value.precision === "unknown") return null;
  if (value.precision === "year") return { year: Number(value.year), month: null, day: null };
  if (value.precision === "month") {
    return { year: Number(value.year), month: Number(value.month), day: null };
  }
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Human date wording that never invents precision the item does not have. */
export function occurrenceText(item: RelationshipItem): string | null {
  const parts = occurrenceParts(item);
  if (!parts) return null;
  if (parts.month === null) return String(parts.year);
  const month = MONTHS[parts.month - 1];
  if (!month) return String(parts.year);
  if (parts.day === null) return month + " " + parts.year;
  return parts.day + " " + month + " " + parts.year;
}

/** Sort key for "when did this happen", falling back to when it was created. */
function orderKey(item: RelationshipItem): number {
  const parts = occurrenceParts(item);
  if (parts) return Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day ?? 1);
  return new Date(item.createdAt).getTime();
}

export function newestFirst(items: readonly RelationshipItem[]): RelationshipItem[] {
  return [...items].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
      left.itemId.localeCompare(right.itemId),
  );
}

export function byOccurrence(items: readonly RelationshipItem[]): RelationshipItem[] {
  return [...items].sort(
    (left, right) => orderKey(right) - orderKey(left) || left.itemId.localeCompare(right.itemId),
  );
}

/**
 * Whether an item belongs in a chapter's calm view. Release-gated items that are not yet
 * released never appear as chapter content. The only pre-release surface is the server's own
 * upcoming-releases list, shown with its authorized preview and nothing added.
 */
export function isChapterContent(item: RelationshipItem): boolean {
  if (item.kind === "relationship_signal") return true;
  return !isLocked(item);
}

export const CURATED_LIMIT = 3;

/** A few curated items for a chapter, never the whole list. */
export function curate(
  chapter: Chapter,
  items: readonly RelationshipItem[],
  limit = CURATED_LIMIT,
): RelationshipItem[] {
  const ordered = chapter === "then" ? byOccurrence(items) : newestFirst(items);
  return ordered.slice(0, limit);
}

export interface ChapterBuckets {
  readonly then: RelationshipItem[];
  readonly now: RelationshipItem[];
  readonly next: RelationshipItem[];
}

/** Groups already fetched items into chapters and drops sealed content and duplicates. */
export function bucketItems(items: readonly RelationshipItem[]): ChapterBuckets {
  const buckets: Record<Chapter, RelationshipItem[]> = { then: [], now: [], next: [] };
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    if (!isChapterContent(item)) continue;
    buckets[chapterOf(item.kind)].push(item);
  }
  return buckets;
}

/**
 * Creator-only authority for edit and delete, mirroring the rules the existing Relationship
 * Space card uses. Remember This is shared to read and creator-only to change; curation kinds
 * (Our Year, Anniversary, Reunion) can be changed by either partner. The server re-checks
 * every mutation; this only decides which controls to show.
 */
export function itemAuthority(
  item: RelationshipItem,
  accountId: string,
  viewOnly: boolean,
): { canEdit: boolean; canDelete: boolean; isCreator: boolean } {
  const isCreator = item.creatorAccountId === accountId;
  const sharedCuration =
    item.kind === "our_year" || item.kind === "anniversary" || item.kind === "reunion";
  const mayChange = isCreator || sharedCuration;
  return {
    isCreator,
    canDelete: !viewOnly && mayChange,
    canEdit:
      !viewOnly &&
      mayChange &&
      item.kind !== "relationship_signal" &&
      item.release?.state !== "released" &&
      Boolean(item.content),
  };
}

export function daysUntil(serverDate: string, targetDate: string): number {
  const start = new Date(serverDate + "T00:00:00.000Z").getTime();
  const target = new Date(targetDate + "T00:00:00.000Z").getTime();
  return Math.max(0, Math.ceil((target - start) / (24 * 60 * 60_000)));
}

/** A calendar date such as "2026-06-01" as "1 June 2026", without any time zone shift. */
export function calendarDateText(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const name = month ? MONTHS[month - 1] : undefined;
  if (!year || !name || !day) return value;
  return day + " " + name + " " + year;
}

export function durationText(duration: { years: number; months: number; days: number }): string {
  const parts = [
    duration.years ? duration.years + (duration.years === 1 ? " year" : " years") : "",
    duration.months ? duration.months + (duration.months === 1 ? " month" : " months") : "",
    duration.days ? duration.days + (duration.days === 1 ? " day" : " days") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Today";
}
