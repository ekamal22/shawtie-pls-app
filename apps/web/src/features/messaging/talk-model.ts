/*
 * Pure presentation helpers for Talk (UX3). Nothing here changes messaging semantics: it
 * only groups, labels, and formats data the M1/M2 contracts already supply.
 */

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(date: Date): DayPart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayDifference(now: Date, date: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

/**
 * Human time separator: "This morning", "Yesterday evening", "Tuesday evening", or a dated
 * form for older messages. Local time only.
 */
export function timeSeparatorLabel(date: Date, now: Date = new Date(), locale?: string): string {
  const part = dayPart(date);
  const difference = dayDifference(now, date);
  if (difference <= 0) {
    return part === "night" ? "Tonight" : "This " + part;
  }
  if (difference === 1) return "Yesterday " + part;
  if (difference < 7) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date);
    return weekday + " " + part;
  }
  const dated = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
  return dated + ", " + part;
}

export function messageTimeLabel(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(date);
}

export interface TalkMessageLike {
  readonly messageId: string;
  readonly senderAccountId: string;
  readonly createdAt: string;
}

export type GroupPosition = "single" | "first" | "middle" | "last";

export type TalkRow<T extends TalkMessageLike> =
  | { readonly type: "separator"; readonly key: string; readonly label: string }
  | {
      readonly type: "message";
      readonly key: string;
      readonly message: T;
      readonly own: boolean;
      readonly position: GroupPosition;
    };

/** Two messages from the same person within this gap read as one group. */
export const GROUP_GAP_MS = 10 * 60_000;

/**
 * Turns an ordered message list into rows: a time separator whenever the human label
 * changes, and a group position for grouped corners and 2px in-group rhythm.
 */
export function buildRows<T extends TalkMessageLike>(
  messages: readonly T[],
  selfAccountId: string,
  now: Date = new Date(),
  locale?: string,
): Array<TalkRow<T>> {
  const rows: Array<TalkRow<T>> = [];
  let previousLabel: string | null = null;
  let previous: T | null = null;
  const segment: Array<{ index: number; message: T }> = [];

  const flush = () => {
    segment.forEach((entry, position) => {
      const first = position === 0;
      const last = position === segment.length - 1;
      const grouped: GroupPosition =
        first && last ? "single" : first ? "first" : last ? "last" : "middle";
      const row = rows[entry.index];
      if (row && row.type === "message") {
        rows[entry.index] = { ...row, position: grouped };
      }
    });
    segment.length = 0;
  };

  for (const message of messages) {
    const created = new Date(message.createdAt);
    const label = timeSeparatorLabel(created, now, locale);
    let startsSeparator = false;
    if (label !== previousLabel) {
      flush();
      rows.push({ type: "separator", key: "sep:" + message.messageId, label });
      previousLabel = label;
      startsSeparator = true;
    }
    const continues =
      !startsSeparator &&
      previous !== null &&
      previous.senderAccountId === message.senderAccountId &&
      created.getTime() - new Date(previous.createdAt).getTime() < GROUP_GAP_MS;
    if (!continues) flush();
    rows.push({
      type: "message",
      key: message.messageId,
      message,
      own: message.senderAccountId === selfAccountId,
      position: "single",
    });
    segment.push({ index: rows.length - 1, message });
    previous = message;
  }
  flush();
  return rows;
}

export type DeliveryLabel = "Sent" | "Delivered" | "Read";

export interface ReceiptsLike {
  readonly partnerDeliveredThrough: number;
  readonly partnerReadThrough: number;
}

/** Existing contract: read beats delivered beats sent, from the partner's high-water marks. */
export function deliveryLabel(receipts: ReceiptsLike, serverSequence: number): DeliveryLabel {
  if (receipts.partnerReadThrough >= serverSequence) return "Read";
  if (receipts.partnerDeliveredThrough >= serverSequence) return "Delivered";
  return "Sent";
}

/** Long messages collapse behind "Read more" past either bound. */
export const COLLAPSE_CHARACTERS = 600;
export const COLLAPSE_LINES = 10;

export function isLongMessage(body: string | null): boolean {
  if (!body) return false;
  if (body.length > COLLAPSE_CHARACTERS) return true;
  return body.split("\n").length > COLLAPSE_LINES;
}

/**
 * Remember This create payload for the EXISTING R1 contract. The snapshot is an independent
 * client-supplied copy; the loose `message` reference records provenance only. Never sent
 * unless the person chose to keep the message.
 */
/**
 * The title a kept message gets in Ours and Home: the start of the words themselves, so a list
 * of kept things reads as words worth keeping. The author's name stays only as the fallback
 * for a message without text.
 */
export function keptTitle(body: string | null, authorName: string): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return authorName.slice(0, 512);
  return text.length > 60 ? text.slice(0, 59).trimEnd() + "…" : text;
}

export function buildRememberThisPayload(input: {
  readonly messageId: string;
  readonly body: string;
  readonly authorName: string;
  readonly createdAt: string;
}) {
  const created = new Date(input.createdAt);
  return {
    kind: "remember_this" as const,
    contentSchemaVersion: 1 as const,
    occurrence: {
      precision: "day" as const,
      year: created.getUTCFullYear(),
      month: created.getUTCMonth() + 1,
      day: created.getUTCDate(),
    },
    storyIncluded: false,
    references: [
      {
        referenceType: "message" as const,
        referenceId: input.messageId,
        role: "source" as const,
        position: 0,
      },
    ],
    links: [],
    preview: null,
    content: {
      title: keptTitle(input.body, input.authorName),
      snapshotText: input.body,
      note: null,
    },
    release: null,
    featureState: null,
  };
}
