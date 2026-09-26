import type {
  RelationshipItem,
  RelationshipItemKind,
  RelationshipOccurrence,
} from "../../relationship-space/model.ts";

/*
 * Pure presentation helpers for Ours content views (UX6). Nothing here changes product
 * semantics: it only reads the existing R1 projection and derives words and groupings.
 * No IO and no browser APIs so it can be unit tested with node.
 */

export type { RelationshipItem, RelationshipItemKind, RelationshipOccurrence };

export const KIND_LABELS: Record<RelationshipItemKind, string> = {
  memory: "Memory",
  remember_this: "Kept",
  first: "First",
  place: "Place",
  for_you: "For you",
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

export const SIGNAL_OPTIONS = [
  ["i_need_you", "I need you"],
  ["call_me_when_you_can", "Call me when you can"],
  ["i_need_reassurance", "I need reassurance"],
  ["shared_feeling", "Share a feeling"],
  ["thinking_of_you", "Thinking of you"],
  ["kiss", "Kiss"],
  ["hug", "Hug"],
] as const;

export type SignalKind = (typeof SIGNAL_OPTIONS)[number][0];

export function signalLabel(kind: string): string {
  return SIGNAL_OPTIONS.find(([value]) => value === kind)?.[1] ?? kind.replaceAll("_", " ");
}

export const SOMEDAY_STATES = [
  { value: "someday", label: "Someday" },
  { value: "soon", label: "Soon" },
  { value: "completed", label: "We did it" },
] as const;

export type SomedayStateValue = (typeof SOMEDAY_STATES)[number]["value"];

export const LOVE_CATEGORY_LABELS: Record<string, string> = {
  reason: "A reason",
  noticed: "Something I noticed",
  remembered: "Something I remembered",
};

export function kindLabel(kind: RelationshipItemKind): string {
  return KIND_LABELS[kind] ?? kind;
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

/** The heading the person wrote, if any. Never falls back to body text. */
export function itemHeading(item: RelationshipItem): string | null {
  return readString(item.content, "title") ?? readString(item.preview, "title");
}

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

export function readSequenceSteps(value: Record<string, unknown> | null): string[] {
  const steps = value?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const text = (entry as Record<string, unknown>).text;
    return typeof text === "string" && text.trim() ? [text] : [];
  });
}

export function readCoordinate(
  value: Record<string, unknown> | null,
  key: "latitude" | "longitude",
): number | null {
  const coordinate = value?.[key];
  return typeof coordinate === "number" && Number.isFinite(coordinate) ? coordinate : null;
}

/* Occurrence and precision */

export type OccurrencePrecision = "day" | "month" | "year" | "unknown" | "none";

export function occurrencePrecision(item: RelationshipItem): OccurrencePrecision {
  const value = item.occurrence;
  return value ? value.precision : "none";
}

export const PRECISION_LABELS: Record<OccurrencePrecision, string> = {
  day: "Exact day",
  month: "Month",
  year: "Year",
  unknown: "Date unknown",
  none: "",
};

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

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}

export interface OccurrenceDisplay {
  precision: OccurrencePrecision;
  /** The large editorial line: a day number, a month name, a year, or a quiet fallback. */
  lead: string;
  /** The quiet line under the lead. */
  rest: string;
  /** A complete plain form for accessible names and captions. */
  full: string;
  precisionLabel: string;
  /** Machine-readable value, only as precise as the stored occurrence. */
  dateTime: string | null;
}

export function describeOccurrence(occurrence: RelationshipOccurrence | null): OccurrenceDisplay {
  if (!occurrence) {
    return {
      precision: "none",
      lead: "Undated",
      rest: "",
      full: "No date",
      precisionLabel: "",
      dateTime: null,
    };
  }
  if (occurrence.precision === "unknown") {
    return {
      precision: "unknown",
      lead: "Date unknown",
      rest: "",
      full: "Date unknown",
      precisionLabel: PRECISION_LABELS.unknown,
      dateTime: null,
    };
  }
  if (occurrence.precision === "year") {
    return {
      precision: "year",
      lead: String(occurrence.year),
      rest: "",
      full: String(occurrence.year),
      precisionLabel: PRECISION_LABELS.year,
      dateTime: String(occurrence.year),
    };
  }
  const month = String(occurrence.month).padStart(2, "0");
  if (occurrence.precision === "month") {
    return {
      precision: "month",
      lead: monthName(occurrence.month),
      rest: String(occurrence.year),
      full: monthName(occurrence.month) + " " + occurrence.year,
      precisionLabel: PRECISION_LABELS.month,
      dateTime: occurrence.year + "-" + month,
    };
  }
  return {
    precision: "day",
    lead: String(occurrence.day),
    rest: monthName(occurrence.month) + " " + occurrence.year,
    full: occurrence.day + " " + monthName(occurrence.month) + " " + occurrence.year,
    precisionLabel: PRECISION_LABELS.day,
    dateTime: occurrence.year + "-" + month + "-" + String(occurrence.day).padStart(2, "0"),
  };
}

export function occurrenceYear(item: RelationshipItem): number | null {
  const value = item.occurrence;
  if (!value || value.precision === "unknown") return null;
  return value.year;
}

/** A calendar date from the server, formatted without any timezone shift. */
export function formatCalendarDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return Number(match[3]) + " " + monthName(Number(match[2])) + " " + match[1];
}

/* Our Story grouping */

export interface StoryGroup {
  key: string;
  year: number | null;
  label: string;
  items: RelationshipItem[];
}

/**
 * Groups story items by occurrence year in the order the server supplied (occurred_asc).
 * Items without a usable year gather in one final group. The year rail is derived only from
 * groups that actually exist.
 */
export function groupStoryByYear(items: readonly RelationshipItem[]): StoryGroup[] {
  const groups = new Map<string, StoryGroup>();
  const undated: RelationshipItem[] = [];
  for (const item of items) {
    const year = occurrenceYear(item);
    if (year === null) {
      undated.push(item);
      continue;
    }
    const key = "y" + year;
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, year, label: String(year), items: [item] });
  }
  const dated = [...groups.values()].sort((a, b) => (a.year as number) - (b.year as number));
  if (undated.length) {
    dated.push({ key: "undated", year: null, label: "Whenever it was", items: undated });
  }
  return dated;
}

export function sortByOccurrence(items: readonly RelationshipItem[]): RelationshipItem[] {
  const rank = (item: RelationshipItem): number => {
    const value = item.occurrence;
    if (!value || value.precision === "unknown") return Number.MAX_SAFE_INTEGER;
    return value.year * 10_000 + (value.month ?? 0) * 100 + (value.day ?? 0);
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/* References */

export function messageReferenceId(item: RelationshipItem): string | null {
  const reference = item.references.find(
    (entry) => entry.referenceType === "message" && entry.role === "source",
  );
  return reference ? reference.referenceId : null;
}

type MediaReference = Extract<RelationshipItem["references"][number], { referenceType: "media" }>;

export function mediaReferences(item: RelationshipItem): MediaReference[] {
  return item.references
    .filter((entry): entry is MediaReference => entry.referenceType === "media")
    .sort((a, b) => a.position - b.position);
}

export function voiceLetterReferences(item: RelationshipItem): MediaReference[] {
  return mediaReferences(item).filter((entry) => entry.role === "voice_letter");
}

export function attachmentReferences(item: RelationshipItem): MediaReference[] {
  return mediaReferences(item).filter((entry) => entry.role !== "voice_letter");
}

/* Authority: mirrors the R1 feature mutation table. The server re-authorizes everything. */

const SHARED_CURATED_KINDS: readonly RelationshipItemKind[] = [
  "our_year",
  "anniversary",
  "reunion",
];

export function isCreator(item: RelationshipItem, accountId: string): boolean {
  return item.creatorAccountId === accountId;
}

export function canDeleteItem(
  item: RelationshipItem,
  accountId: string,
  disabled: boolean,
): boolean {
  return !disabled && (isCreator(item, accountId) || SHARED_CURATED_KINDS.includes(item.kind));
}

export function canEditItem(item: RelationshipItem, accountId: string, disabled: boolean): boolean {
  return (
    !disabled &&
    item.kind !== "relationship_signal" &&
    item.release?.state !== "released" &&
    Boolean(item.content) &&
    (isCreator(item, accountId) || SHARED_CURATED_KINDS.includes(item.kind))
  );
}

/* Sealed and opening state */

export interface SealInfo {
  sealed: boolean;
  /** Short band text, always calm and never urgent. */
  band: string;
  detail: string | null;
  /** True when this account may run the existing manual release action. */
  canRelease: boolean;
  releaseLabel: string | null;
  audience: "creator" | "recipient";
}

export function sealInfo(
  item: RelationshipItem,
  accountId: string,
  disabled: boolean,
  formatWhen: (iso: string) => string,
): SealInfo | null {
  const release = item.release;
  if (!release || release.state !== "locked") return null;
  const creator = isCreator(item, accountId);
  const condition = readString(item.preview, "conditionLabel");
  const audience = creator ? "creator" : "recipient";

  if (release.mode === "scheduled") {
    return {
      sealed: true,
      band: creator ? "Sealed until it arrives" : "Sealed",
      detail: release.unlockAt ? formatWhen(release.unlockAt) : null,
      canRelease: false,
      releaseLabel: null,
      audience,
    };
  }
  if (release.mode === "recipient_open") {
    return {
      sealed: true,
      band: creator ? "Waiting to be opened" : "Sealed",
      detail: condition,
      canRelease: !disabled && !creator,
      releaseLabel: !creator ? "Open the letter" : null,
      audience,
    };
  }
  if (release.mode === "creator_reveal") {
    return {
      sealed: true,
      band: creator ? "Yours until you reveal it" : "Sealed",
      detail: null,
      canRelease: !disabled && creator,
      releaseLabel: creator ? "Reveal" : null,
      audience,
    };
  }
  return null;
}

/* Time phrasing: calm, coarse, never a ticking count. */

export function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T00:00:00.000Z").getTime();
  const to = new Date(toDate + "T00:00:00.000Z").getTime();
  return Math.max(0, Math.ceil((to - from) / (24 * 60 * 60_000)));
}

export function reunionPhrase(serverDate: string, targetDate: string): string {
  const days = daysBetween(serverDate, targetDate);
  if (days === 0) return "Together today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return "In " + days + " days";
  if (days < 60) return "In about " + Math.round(days / 7) + " weeks";
  return "In about " + Math.round(days / 30) + " months";
}

export function togetherPhrase(duration: { years: number; months: number; days: number }): string {
  const plural = (count: number, unit: string) => count + " " + unit + (count === 1 ? "" : "s");
  const parts: string[] = [];
  if (duration.years) parts.push(plural(duration.years, "year"));
  if (duration.months) parts.push(plural(duration.months, "month"));
  if (!duration.years && duration.days) parts.push(plural(duration.days, "day"));
  return parts.length ? parts.join(", ") : "Just beginning";
}

export function yearsAgoPhrase(onDate: string, item: RelationshipItem): string | null {
  const year = occurrenceYear(item);
  if (year === null) return null;
  const diff = Number(onDate.slice(0, 4)) - year;
  if (diff <= 0) return null;
  return diff === 1 ? "A year ago today" : diff + " years ago today";
}

/* Payload builders shared by composer and signals (contract shape unchanged). */

export function buildSignalPayload(signalKind: SignalKind, text: string): unknown {
  return {
    kind: "relationship_signal",
    contentSchemaVersion: 1,
    preview: null,
    content: { sharedFeelingText: text.trim() || null },
    occurrence: null,
    storyIncluded: false,
    release: null,
    featureState: { type: "relationship_signal", signalKind },
    references: [],
    links: [],
  };
}

/* Sequence pages for Surprise and Proposal players. */

export interface SequencePage {
  kind: "intro" | "step" | "media";
  text: string | null;
  mediaId: string | null;
  mediaRole: "attachment" | "voice_letter" | null;
}

export function buildSequencePages(item: RelationshipItem): SequencePage[] {
  const pages: SequencePage[] = [];
  const intro = readString(item.content, "intro");
  if (intro) pages.push({ kind: "intro", text: intro, mediaId: null, mediaRole: null });
  for (const step of readSequenceSteps(item.content)) {
    pages.push({ kind: "step", text: step, mediaId: null, mediaRole: null });
  }
  for (const reference of mediaReferences(item)) {
    pages.push({
      kind: "media",
      text: null,
      mediaId: reference.referenceId,
      mediaRole: reference.role,
    });
  }
  return pages;
}

/** Saved curation links in their saved order, limited to items still present. */
export function orderByCurationLinks(
  items: readonly RelationshipItem[],
  saved: RelationshipItem | null,
): RelationshipItem[] {
  if (!saved) return [...items];
  const byId = new Map(items.map((item) => [item.itemId, item]));
  return saved.links
    .filter((link) => link.linkType === "curation")
    .sort((a, b) => a.position - b.position)
    .flatMap((link) => {
      const target = byId.get(link.targetItemId);
      return target ? [target] : [];
    });
}
