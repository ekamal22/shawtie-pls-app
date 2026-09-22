import type {
  RelationshipItemKind,
  RelationshipItemMutationDenial,
  RelationshipItemPolicy,
  RelationshipOccurrence,
  RelationshipReleaseMode,
  RelationshipScheduledReleaseDecision,
} from "./types.ts";

const CREATOR_DEFAULT: RelationshipItemPolicy = {
  contentEditor: "creator",
  deleter: "creator",
  sharedStateEditor: "none",
  releaseModes: [],
  manualReleaseActor: "none",
  immutableAfterRelease: false,
};

const SHARED_CURATED: RelationshipItemPolicy = {
  contentEditor: "either_partner",
  deleter: "either_partner",
  sharedStateEditor: "either_partner",
  releaseModes: [],
  manualReleaseActor: "none",
  immutableAfterRelease: false,
};

const DELIVERY_RECIPIENT_OPEN: RelationshipItemPolicy = {
  contentEditor: "creator",
  deleter: "creator",
  sharedStateEditor: "none",
  releaseModes: ["immediate", "scheduled", "recipient_open"],
  manualReleaseActor: "recipient",
  immutableAfterRelease: true,
};

const DELIVERY_CREATOR_REVEAL: RelationshipItemPolicy = {
  contentEditor: "creator",
  deleter: "creator",
  sharedStateEditor: "none",
  releaseModes: ["immediate", "creator_reveal"],
  manualReleaseActor: "creator",
  immutableAfterRelease: true,
};

export function relationshipItemPolicy(kind: RelationshipItemKind): RelationshipItemPolicy {
  switch (kind) {
    case "someday":
      return { ...CREATOR_DEFAULT, sharedStateEditor: "either_partner" };
    case "our_year":
    case "anniversary":
    case "reunion":
      return SHARED_CURATED;
    case "for_you":
    case "future_us":
      return DELIVERY_RECIPIENT_OPEN;
    case "surprise":
    case "proposal":
      return DELIVERY_CREATOR_REVEAL;
    case "relationship_signal":
      return { ...CREATOR_DEFAULT, immutableAfterRelease: true };
    default:
      return CREATOR_DEFAULT;
  }
}

export function canEditRelationshipContent(input: {
  readonly kind: RelationshipItemKind;
  readonly creatorAccountId: string;
  readonly actorAccountId: string;
  readonly releasedAt: string | null;
}):
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: RelationshipItemMutationDenial } {
  const policy = relationshipItemPolicy(input.kind);
  if (input.kind === "relationship_signal") {
    return { allowed: false, reason: "RELATIONSHIP_ITEM_IMMUTABLE" };
  }
  if (policy.immutableAfterRelease && input.releasedAt) {
    return { allowed: false, reason: "RELATIONSHIP_ITEM_IMMUTABLE" };
  }
  if (policy.contentEditor === "creator" && input.creatorAccountId !== input.actorAccountId) {
    return { allowed: false, reason: "RELATIONSHIP_ITEM_NOT_OWNED" };
  }
  return { allowed: true };
}

export function canDeleteRelationshipItem(input: {
  readonly kind: RelationshipItemKind;
  readonly creatorAccountId: string;
  readonly actorAccountId: string;
}):
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: RelationshipItemMutationDenial } {
  const policy = relationshipItemPolicy(input.kind);
  if (policy.deleter === "creator" && input.creatorAccountId !== input.actorAccountId) {
    return { allowed: false, reason: "RELATIONSHIP_ITEM_NOT_OWNED" };
  }
  return { allowed: true };
}

export function canMutateRelationshipSharedState(kind: RelationshipItemKind): boolean {
  return relationshipItemPolicy(kind).sharedStateEditor === "either_partner";
}

export function canManuallyReleaseRelationshipItem(input: {
  readonly kind: RelationshipItemKind;
  readonly releaseMode: RelationshipReleaseMode | null;
  readonly creatorAccountId: string;
  readonly actorAccountId: string;
}): boolean {
  const policy = relationshipItemPolicy(input.kind);
  if (!input.releaseMode || !policy.releaseModes.includes(input.releaseMode)) return false;
  if (input.releaseMode === "recipient_open") {
    return (
      policy.manualReleaseActor === "recipient" && input.creatorAccountId !== input.actorAccountId
    );
  }
  if (input.releaseMode === "creator_reveal") {
    return (
      policy.manualReleaseActor === "creator" && input.creatorAccountId === input.actorAccountId
    );
  }
  return false;
}

function validCalendarDay(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function compareDateParts(year: number, month: number, day: number, isoDate: string): number {
  const [targetYearRaw, targetMonthRaw, targetDayRaw] = isoDate.split("-");
  const targetYear = Number(targetYearRaw);
  const targetMonth = Number(targetMonthRaw);
  const targetDay = Number(targetDayRaw);
  if (year !== targetYear) return year - targetYear;
  if (month !== targetMonth) return month - targetMonth;
  return day - targetDay;
}

export function occurrenceIsValid(
  occurrence: RelationshipOccurrence | null,
  trustedServerDate: string,
  rejectFuture: boolean,
): boolean {
  if (!occurrence) return true;
  if (occurrence.precision === "unknown") {
    return occurrence.year === null && occurrence.month === null && occurrence.day === null;
  }
  if (!occurrence.year || occurrence.year < 1900 || occurrence.year > 9999) return false;
  if (occurrence.precision === "year") {
    if (occurrence.month !== null || occurrence.day !== null) return false;
    return !rejectFuture || occurrence.year <= Number(trustedServerDate.slice(0, 4));
  }
  if (!occurrence.month || occurrence.month < 1 || occurrence.month > 12) return false;
  if (occurrence.precision === "month") {
    if (occurrence.day !== null) return false;
    if (!rejectFuture) return true;
    const firstDay = compareDateParts(occurrence.year, occurrence.month, 1, trustedServerDate);
    return firstDay <= 0;
  }
  if (!occurrence.day || !validCalendarDay(occurrence.year, occurrence.month, occurrence.day)) {
    return false;
  }
  return (
    !rejectFuture ||
    compareDateParts(occurrence.year, occurrence.month, occurrence.day, trustedServerDate) <= 0
  );
}

export function historicalOccurrenceRequiredNotFuture(kind: RelationshipItemKind): boolean {
  return ["memory", "remember_this", "first", "place", "love"].includes(kind);
}

export function anniversaryDateForYear(relationshipStartDate: string, year: number): string {
  const [, monthRaw, dayRaw] = relationshipStartDate.split("-");
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const resolvedDay = Math.min(day, lastDay);
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(resolvedDay).padStart(2, "0"),
  ].join("-");
}

export function relationshipOccurrenceSortTuple(
  occurrence: RelationshipOccurrence | null,
  itemId: string,
): readonly [number, number, number, string] {
  if (!occurrence || occurrence.precision === "unknown" || occurrence.year === null) {
    return [10000, 13, 32, itemId];
  }
  const month = occurrence.month ?? 0;
  const day = occurrence.day ?? 0;
  return [occurrence.year, month, day, itemId];
}

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function evaluateScheduledRelationshipRelease(input: {
  readonly now: string;
  readonly releaseMode: RelationshipReleaseMode | null;
  readonly unlockAt: string | null;
  readonly releasedAt: string | null;
  readonly lifecycle: "active" | "breakup_pending" | "terminated";
  readonly breakupFinalDeadline: string | null;
  readonly accountDeletionRecoverUntil: string | null;
}): RelationshipScheduledReleaseDecision {
  if (input.releasedAt) return { action: "stale", reason: "released" };
  if (input.releaseMode !== "scheduled" || !input.unlockAt) {
    return { action: "stale", reason: "invalid_mode" };
  }
  if (input.lifecycle === "terminated") return { action: "stale", reason: "terminated" };

  const now = timestamp(input.now);
  const unlock = timestamp(input.unlockAt);
  if (!Number.isFinite(now) || !Number.isFinite(unlock)) {
    return { action: "stale", reason: "invalid_mode" };
  }

  const deadlines = [input.breakupFinalDeadline, input.accountDeletionRecoverUntil]
    .filter((value): value is string => Boolean(value))
    .map(timestamp)
    .filter(Number.isFinite);
  const destructiveDeadline = deadlines.length > 0 ? Math.min(...deadlines) : null;

  if (destructiveDeadline !== null && now >= destructiveDeadline) {
    return { action: "stale", reason: "destructive_deadline" };
  }
  if (now < unlock) return { action: "too_early" };

  if (input.accountDeletionRecoverUntil) {
    return { action: "pause", until: input.accountDeletionRecoverUntil };
  }

  return { action: "release" };
}
