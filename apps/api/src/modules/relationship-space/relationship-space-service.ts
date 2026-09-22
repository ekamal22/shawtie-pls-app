import { randomUUID } from "node:crypto";
import {
  appendRelationshipEvent,
  cancelPendingScheduledActionsByDeduplicationKey,
  completeLifecycleIdempotency,
  deleteIncomingRelationshipLinks,
  deleteRelationshipItem,
  getTransactionTimestamp,
  incrementRelationshipItemVersion,
  insertRelationshipItem,
  insertScheduledAction,
  listRelationshipItems,
  listRelationshipItemsForThisDay,
  listRelationshipItemsForYear,
  listUpcomingRelationshipReleases,
  loadIncomingRelationshipLinkOwnerIds,
  loadPartnershipReadModelForAccount,
  loadRelationshipFeatureState,
  loadRelationshipItem,
  loadRelationshipLinks,
  loadRelationshipReferences,
  lockPartnershipLifecycle,
  lockRelationshipItemsByIds,
  replaceRelationshipFeatureState,
  replaceRelationshipLinks,
  replaceRelationshipReferences,
  reserveLifecycleIdempotency,
  setRelationshipStoryIncluded,
  updateRelationshipItemRoot,
  withTransaction,
  type DatabasePool,
  type LockedPartnershipLifecycle,
  type QueryExecutor,
  type RelationshipFeatureState,
  type RelationshipItemRecord,
  type RelationshipLinkRecord,
  type RelationshipReferenceRecord,
} from "@shawtie/db";
import {
  anniversaryDateForYear,
  canDeleteRelationshipItem,
  canEditRelationshipContent,
  canManuallyReleaseRelationshipItem,
  canMutateRelationshipSharedState,
  evaluateCapability,
  historicalOccurrenceRequiredNotFuture,
  occurrenceIsValid,
  trustedUtcDate,
  type CapabilityContext,
  type PartnershipState,
  type RelationshipItemKind,
} from "@shawtie/domain";
import {
  parseAtBoundary,
  relationshipItemCreateSchema,
  relationshipItemCursorSchema,
  type AnniversaryQuery,
  type OurYearParams,
  type RelationshipFeatureStateInput,
  type RelationshipItemCreateInput,
  type RelationshipItemListQuery,
  type RelationshipItemPatchInput,
  type RelationshipItemProjection,
  type RelationshipItemReleaseInput,
  type RelationshipLinkInput,
  type RelationshipOccurrenceInput,
  type RelationshipReferenceInput,
  type ThisDayQuery,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";

const DAY = 24 * 60 * 60_000;
const IDEMPOTENCY_RETENTION = DAY;
const MAX_PROTECTED_JSON_BYTES = 64 * 1024;

export interface RelationshipReferenceResolver {
  authorize(
    executor: QueryExecutor,
    input: {
      readonly partnershipId: string;
      readonly actorAccountId: string;
      readonly referenceId: string;
    },
  ): Promise<boolean>;
}

export interface RelationshipSpaceServiceOptions {
  readonly messageReferenceResolver?: RelationshipReferenceResolver;
  readonly mediaReferenceResolver?: RelationshipReferenceResolver;
}

interface MutationReservation {
  readonly replayed: boolean;
  readonly id: string;
  readonly fingerprint: Buffer;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
}

function safeVersion(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Relationship item version exceeds safe integer range");
  }
  return Number(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fingerprintVersion(fingerprint: Buffer): number {
  if (fingerprint.length !== 36) {
    throw new Error("R1 idempotency fingerprint has invalid length");
  }
  return fingerprint.readUInt32BE(0);
}

function encodeFingerprint(version: number, digest: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(version, 0);
  return Buffer.concat([prefix, digest]);
}

function privatePayloadBytes(preview: unknown | null, content: unknown | null): number {
  return Buffer.byteLength(JSON.stringify({ preview, content }), "utf8");
}

function occurrenceFromItem(item: RelationshipItemRecord): RelationshipOccurrenceInput {
  if (!item.occurredPrecision) return null;
  if (item.occurredPrecision === "unknown") {
    return { precision: "unknown", year: null, month: null, day: null };
  }
  if (item.occurredPrecision === "year") {
    return {
      precision: "year",
      year: item.occurredYear as number,
      month: null,
      day: null,
    };
  }
  if (item.occurredPrecision === "month") {
    return {
      precision: "month",
      year: item.occurredYear as number,
      month: item.occurredMonth as number,
      day: null,
    };
  }
  return {
    precision: "day",
    year: item.occurredYear as number,
    month: item.occurredMonth as number,
    day: item.occurredDay as number,
  };
}

function releaseFromItem(item: RelationshipItemRecord): RelationshipItemCreateInput["release"] {
  if (!item.releaseMode) return null;
  if (item.releaseMode === "scheduled") {
    if (!item.unlockAt) throw new Error("Scheduled relationship item is missing unlock time");
    return { mode: "scheduled", unlockAt: item.unlockAt.toISOString() };
  }
  if (item.releaseMode === "recipient_open") {
    return { mode: "recipient_open", unlockAt: null };
  }
  if (item.releaseMode === "creator_reveal") {
    return { mode: "creator_reveal", unlockAt: null };
  }
  return { mode: "immediate", unlockAt: null };
}

function featureStateForContract(
  state: RelationshipFeatureState | null,
): RelationshipFeatureStateInput | null {
  if (!state) return null;
  if (state.type === "someday") return { type: "someday", state: state.state };
  if (state.type === "relationship_signal") {
    return {
      type: "relationship_signal",
      signalKind: state.signalKind as
        | "i_need_you"
        | "call_me_when_you_can"
        | "i_need_reassurance"
        | "shared_feeling"
        | "thinking_of_you"
        | "kiss"
        | "hug",
    };
  }
  if (state.type === "reunion") return { type: "reunion", targetDate: state.targetDate };
  return {
    type: "curation",
    curationType: state.curationType,
    anchorYear: state.anchorYear,
  };
}

function featureStateForDatabase(
  state: RelationshipFeatureStateInput | null,
  previous: RelationshipFeatureState | null,
  now: Date,
): RelationshipFeatureState | null {
  if (!state) return null;
  if (state.type === "someday") {
    const completedAt =
      state.state === "completed"
        ? previous?.type === "someday" && previous.state === "completed"
          ? previous.completedAt
          : now
        : null;
    return { type: "someday", state: state.state, completedAt };
  }
  if (state.type === "relationship_signal") {
    return { type: "relationship_signal", signalKind: state.signalKind };
  }
  if (state.type === "reunion") {
    return { type: "reunion", targetDate: state.targetDate };
  }
  return {
    type: "curation",
    curationType: state.curationType,
    anchorYear: state.anchorYear,
  };
}

function releaseChanged(
  item: RelationshipItemRecord,
  release: RelationshipItemCreateInput["release"],
): boolean {
  const current = releaseFromItem(item);
  return canonicalJson(current) !== canonicalJson(release);
}

function isFullItemVisible(item: RelationshipItemRecord, actorAccountId: string): boolean {
  return (
    item.releaseMode === null ||
    item.releasedAt !== null ||
    item.creatorAccountId === actorAccountId
  );
}

function hasPreview(item: RelationshipItemRecord): boolean {
  return item.developmentPreviewPayload !== null;
}

function isItemVisible(item: RelationshipItemRecord, actorAccountId: string): boolean {
  return isFullItemVisible(item, actorAccountId) || hasPreview(item);
}

function canTargetBeLinked(item: RelationshipItemRecord): boolean {
  return item.releaseMode === null || item.releasedAt !== null;
}

function capabilityContext(
  actorAccountId: string,
  lifecycle: LockedPartnershipLifecycle,
  now: Date,
): CapabilityContext {
  const first = lifecycle.memberIds[0];
  const second = lifecycle.memberIds[1];
  if (!first || !second) throw new Error("R1 partnership must have exactly two members");
  const members: readonly [string, string] = [first, second];
  const partnership: PartnershipState = {
    id: lifecycle.partnershipId,
    members,
    lifecycle: lifecycle.lifecycleState,
    generation: safeVersion(lifecycle.generation),
    breakup: lifecycle.breakup
      ? {
          initiatedBy: lifecycle.breakup.initiatedByAccountId,
          initiatedAt: lifecycle.breakup.initiatedAt.toISOString(),
          initiatorCancelUntil: lifecycle.breakup.initiatorCancelUntil.toISOString(),
          baseDeadline: lifecycle.breakup.baseDeadline.toISOString(),
          finalDeadline: lifecycle.breakup.finalDeadline.toISOString(),
          restoreIntentAt: Object.fromEntries(
            Object.entries(lifecycle.breakup.restoreIntentAt).map(([accountId, at]) => [
              accountId,
              at.toISOString(),
            ]),
          ),
          generation: safeVersion(lifecycle.breakup.generation),
        }
      : null,
    accountDeletion: lifecycle.accountDeletion
      ? {
          accountId: lifecycle.accountDeletion.accountId,
          requestedAt: lifecycle.accountDeletion.requestedAt.toISOString(),
          recoverUntil: lifecycle.accountDeletion.recoverUntil.toISOString(),
          generation: safeVersion(lifecycle.accountDeletion.generation),
        }
      : null,
    terminatedAt: lifecycle.terminatedAt?.toISOString() ?? null,
    terminationReason: lifecycle.terminationReason,
    partnerEligibleAt: Object.fromEntries(members.map((memberId) => [memberId, null])),
  };
  return {
    actor: {
      id: actorAccountId,
      status: lifecycle.accountStatuses[actorAccountId] ?? "deleted",
      nextUsernameChangeEligibleAt: null,
    },
    partnership,
    now: now.toISOString(),
  };
}

function queryShape(input: RelationshipItemListQuery): string {
  return [
    "r1",
    input.sort,
    input.kind ?? "*",
    input.storyOnly ? "story" : "all",
    input.year ?? "*",
  ].join(":");
}

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(raw: string) {
  try {
    return parseAtBoundary(
      relationshipItemCursorSchema,
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
  } catch {
    throw new ApiError(400, "INVALID_CURSOR");
  }
}

function dateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new ApiError(400, "INVALID_OCCURRENCE");
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new ApiError(400, "INVALID_OCCURRENCE");
  }
  return { year, month, day };
}

function compareCalendarDates(left: string, right: string): number {
  return left.localeCompare(right);
}

function addCalendarMonths(date: string, months: number): string {
  const { year, month, day } = dateParts(date);
  const targetIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonthIndex = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonthIndex + 1).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
}

function relationshipDuration(
  relationshipStartDate: string,
  serverDate: string,
): { years: number; months: number; days: number } {
  if (compareCalendarDates(relationshipStartDate, serverDate) > 0) {
    return { years: 0, months: 0, days: 0 };
  }
  let months = 0;
  while (
    months < 12 * 200 &&
    compareCalendarDates(addCalendarMonths(relationshipStartDate, months + 1), serverDate) <= 0
  ) {
    months += 1;
  }
  const cursor = addCalendarMonths(relationshipStartDate, months);
  const days = Math.floor(
    (new Date(serverDate + "T00:00:00.000Z").getTime() -
      new Date(cursor + "T00:00:00.000Z").getTime()) /
      DAY,
  );
  return { years: Math.floor(months / 12), months: months % 12, days };
}

function occurrenceFields(occurrence: RelationshipOccurrenceInput): {
  precision: RelationshipItemRecord["occurredPrecision"];
  year: number | null;
  month: number | null;
  day: number | null;
} {
  if (!occurrence) return { precision: null, year: null, month: null, day: null };
  return {
    precision: occurrence.precision,
    year: occurrence.year,
    month: occurrence.month,
    day: occurrence.day,
  };
}

function releaseFields(
  release: RelationshipItemCreateInput["release"],
  now: Date,
): {
  mode: RelationshipItemRecord["releaseMode"];
  unlockAt: Date | null;
  releasedAt: Date | null;
} {
  if (!release) return { mode: null, unlockAt: null, releasedAt: null };
  if (release.mode === "scheduled") {
    return { mode: "scheduled", unlockAt: new Date(release.unlockAt), releasedAt: null };
  }
  if (release.mode === "immediate") {
    return { mode: "immediate", unlockAt: null, releasedAt: now };
  }
  return { mode: release.mode, unlockAt: null, releasedAt: null };
}

function linkTypeAllowed(kind: RelationshipItemKind, link: RelationshipLinkInput): boolean {
  if (kind === "our_year" || kind === "anniversary") return link.linkType === "curation";
  if (kind === "reunion") return link.linkType === "prepared_content";
  return false;
}

export class RelationshipSpaceService {
  readonly database: DatabasePool;
  readonly keys: AuthKeyRing;
  readonly options: RelationshipSpaceServiceOptions;

  constructor(
    database: DatabasePool,
    keys: AuthKeyRing,
    options: RelationshipSpaceServiceOptions = {},
  ) {
    this.database = database;
    this.keys = keys;
    this.options = options;
  }

  #fingerprintPayload(input: {
    readonly accountId: string;
    readonly partnershipId: string;
    readonly operation: string;
    readonly targetItemId?: string;
    readonly body: unknown;
  }): string {
    return canonicalJson({
      v: 1,
      accountId: input.accountId,
      partnershipId: input.partnershipId,
      operation: input.operation,
      targetItemId: input.targetItemId ?? null,
      body: input.body,
    });
  }

  #activeFingerprint(payload: string): Buffer {
    const verifier = this.keys.activeVerifier("r1-idempotency-fingerprint", payload);
    return encodeFingerprint(verifier.version, verifier.value);
  }

  #fingerprintForStoredVersion(payload: string, stored: Buffer): Buffer {
    const version = fingerprintVersion(stored);
    return encodeFingerprint(
      version,
      this.keys.verifier("r1-idempotency-fingerprint", payload, version),
    );
  }

  async #findCompletedMutation(
    transaction: QueryExecutor,
    input: {
      readonly accountId: string;
      readonly partnershipId: string;
      readonly operation: string;
      readonly targetItemId?: string;
      readonly idempotencyKey: string;
      readonly body: unknown;
      readonly now: Date;
    },
  ): Promise<MutationReservation | null> {
    const payload = this.#fingerprintPayload(input);
    const scope = [
      "r1",
      input.partnershipId,
      input.operation,
      input.targetItemId ?? "create",
    ].join(":");
    const result = await transaction.query<{
      id: string;
      request_fingerprint: Buffer | null;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT id, request_fingerprint, response_status, response_body
       FROM idempotency_records
       WHERE account_id = $1
         AND scope = $2
         AND idempotency_key = $3
         AND (expires_at IS NULL OR expires_at > $4)
       LIMIT 1`,
      [input.accountId, scope, input.idempotencyKey, input.now],
    );
    const row = result.rows[0];
    if (!row || row.response_status === null) return null;
    if (!row.request_fingerprint) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    const expected = this.#fingerprintForStoredVersion(payload, row.request_fingerprint);
    if (!this.keys.safeEqual(row.request_fingerprint, expected)) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    }
    return {
      replayed: true,
      id: row.id,
      fingerprint: row.request_fingerprint,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  async #reserveMutation(
    transaction: QueryExecutor,
    input: {
      readonly accountId: string;
      readonly partnershipId: string;
      readonly operation: string;
      readonly targetItemId?: string;
      readonly idempotencyKey: string;
      readonly body: unknown;
      readonly now: Date;
    },
  ): Promise<MutationReservation> {
    const payload = this.#fingerprintPayload(input);
    const activeFingerprint = this.#activeFingerprint(payload);
    const scope = [
      "r1",
      input.partnershipId,
      input.operation,
      input.targetItemId ?? "create",
    ].join(":");

    await transaction.query(
      "DELETE FROM idempotency_records WHERE account_id = $1 AND scope = $2 AND idempotency_key = $3 AND expires_at IS NOT NULL AND expires_at <= $4",
      [input.accountId, scope, input.idempotencyKey, input.now],
    );

    const record = await reserveLifecycleIdempotency(transaction, {
      id: randomUUID(),
      accountId: input.accountId,
      scope,
      idempotencyKey: input.idempotencyKey,
      fingerprint: activeFingerprint,
      createdAt: input.now,
    });

    const expected = record.fingerprint
      ? this.#fingerprintForStoredVersion(payload, record.fingerprint)
      : activeFingerprint;

    if (
      !record.fingerprint ||
      !this.keys.safeEqual(record.fingerprint, expected)
    ) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    }

    return {
      replayed: record.responseStatus !== null,
      id: record.id,
      fingerprint: record.fingerprint,
      responseStatus: record.responseStatus,
      responseBody: record.responseBody,
    };
  }

  async #completeMutation(
    transaction: QueryExecutor,
    reservation: MutationReservation,
    status: number,
    body: unknown,
    now: Date,
  ): Promise<void> {
    await completeLifecycleIdempotency(transaction, {
      id: reservation.id,
      fingerprint: reservation.fingerprint,
      responseStatus: status,
      responseBody: body,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION),
    });
  }

  async #currentLifecycle(
    transaction: QueryExecutor,
    accountId: string,
    now: Date,
    capability:
      | "create_relationship_object"
      | "edit_relationship_object_content"
      | "delete_relationship_object"
      | "mutate_relationship_shared_state"
      | "curate_relationship_space"
      | "recipient_open_relationship_object"
      | "creator_reveal_relationship_object"
      | "create_relationship_signal",
  ): Promise<LockedPartnershipLifecycle> {
    const current = await loadPartnershipReadModelForAccount(transaction, accountId);
    if (!current) throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
    const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
    if (!lifecycle || !lifecycle.memberIds.includes(accountId)) {
      throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
    }
    const decision = evaluateCapability(capability, capabilityContext(accountId, lifecycle, now));
    if (!decision.allowed) {
      if (
        decision.reason === "RELATIONSHIP_OBJECTS_VIEW_ONLY" ||
        decision.reason === "ACCOUNT_LOCKED"
      ) {
        throw new ApiError(409, "RELATIONSHIP_SPACE_VIEW_ONLY");
      }
      if (decision.reason === "PARTNERSHIP_TERMINATED") {
        throw new ApiError(409, "PARTNERSHIP_TERMINATED");
      }
      throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
    }
    return lifecycle;
  }

  #requireCapability(
    actorAccountId: string,
    lifecycle: LockedPartnershipLifecycle,
    now: Date,
    capability:
      | "create_relationship_object"
      | "edit_relationship_object_content"
      | "delete_relationship_object"
      | "mutate_relationship_shared_state"
      | "curate_relationship_space"
      | "recipient_open_relationship_object"
      | "creator_reveal_relationship_object"
      | "create_relationship_signal",
  ): void {
    const decision = evaluateCapability(
      capability,
      capabilityContext(actorAccountId, lifecycle, now),
    );
    if (decision.allowed) return;
    if (
      decision.reason === "RELATIONSHIP_OBJECTS_VIEW_ONLY" ||
      decision.reason === "ACCOUNT_LOCKED"
    ) {
      throw new ApiError(409, "RELATIONSHIP_SPACE_VIEW_ONLY");
    }
    if (decision.reason === "PARTNERSHIP_TERMINATED") {
      throw new ApiError(409, "PARTNERSHIP_TERMINATED");
    }
    throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
  }

  async #validateReferences(
    transaction: QueryExecutor,
    partnershipId: string,
    actorAccountId: string,
    references: readonly RelationshipReferenceInput[],
  ): Promise<void> {
    for (const reference of references) {
      const resolver =
        reference.referenceType === "message"
          ? this.options.messageReferenceResolver
          : this.options.mediaReferenceResolver;
      if (!resolver) throw new ApiError(409, "REFERENCE_TYPE_UNAVAILABLE");
      const allowed = await resolver.authorize(transaction, {
        partnershipId,
        actorAccountId,
        referenceId: reference.referenceId,
      });
      if (!allowed) throw new ApiError(422, "INVALID_REFERENCE");
    }
  }

  async #validateLockedLinks(
    lockedItems: readonly RelationshipItemRecord[],
    ownerItemId: string | null,
    kind: RelationshipItemKind,
    links: readonly RelationshipLinkInput[],
  ): Promise<void> {
    const targets = new Map(lockedItems.map((item) => [item.id, item]));
    for (const link of links) {
      if (!linkTypeAllowed(kind, link)) throw new ApiError(400, "INVALID_ITEM_LINK");
      if (ownerItemId && link.targetItemId === ownerItemId) {
        throw new ApiError(400, "INVALID_ITEM_LINK");
      }
      const target = targets.get(link.targetItemId);
      if (!target || !canTargetBeLinked(target)) {
        throw new ApiError(422, "INVALID_ITEM_LINK");
      }
    }
  }

  #validateCreateSemantics(
    input: RelationshipItemCreateInput,
    now: Date,
  ): void {
    if (privatePayloadBytes(input.preview, input.content) > MAX_PROTECTED_JSON_BYTES) {
      throw new ApiError(400, "INVALID_RELATIONSHIP_ITEM");
    }
    const trustedDate = trustedUtcDate(now);
    if (
      !occurrenceIsValid(
        input.occurrence,
        trustedDate,
        historicalOccurrenceRequiredNotFuture(input.kind),
      )
    ) {
      throw new ApiError(400, "INVALID_OCCURRENCE");
    }
    if (
      input.featureState?.type === "reunion" &&
      compareCalendarDates(input.featureState.targetDate, trustedDate) < 0
    ) {
      throw new ApiError(422, "REUNION_DATE_INVALID");
    }
    if (
      input.references.some(
        (reference) =>
          reference.referenceType === "message" && input.kind !== "remember_this",
      )
    ) {
      throw new ApiError(400, "INVALID_REFERENCE");
    }
    if (input.release?.mode === "scheduled") {
      const unlock = new Date(input.release.unlockAt);
      if (!Number.isFinite(unlock.getTime()) || unlock.getTime() <= now.getTime()) {
        throw new ApiError(422, "RELEASE_TIME_INVALID");
      }
    }
  }

  async #project(
    executor: QueryExecutor,
    item: RelationshipItemRecord,
    actorAccountId: string,
  ): Promise<RelationshipItemProjection> {
    if (!isItemVisible(item, actorAccountId)) {
      throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
    }
    if (item.contentSchemaVersion !== 1) {
      throw new ApiError(409, "UNSUPPORTED_CONTENT_SCHEMA_VERSION");
    }
    const full = isFullItemVisible(item, actorAccountId);
    const state = await loadRelationshipFeatureState(executor, item.partnershipId, item.id);
    const references = full
      ? await loadRelationshipReferences(executor, item.partnershipId, item.id)
      : [];
    const links = full ? await loadRelationshipLinks(executor, item.partnershipId, item.id) : [];

    return {
      itemId: item.id,
      kind: item.kind,
      creatorAccountId: item.creatorAccountId,
      version: safeVersion(item.version),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      occurrence: occurrenceFromItem(item),
      storyIncluded: item.storyIncluded,
      release: item.releaseMode
        ? {
            mode: item.releaseMode,
            generation: safeVersion(item.releaseGeneration),
            unlockAt: item.unlockAt?.toISOString() ?? null,
            releasedAt: item.releasedAt?.toISOString() ?? null,
            state: item.releasedAt ? "released" : "locked",
          }
        : null,
      featureState: featureStateForContract(state),
      contentSchemaVersion: item.contentSchemaVersion,
      preview: (item.developmentPreviewPayload as Record<string, unknown> | null) ?? null,
      content: full
        ? ((item.developmentPlaintextPayload as Record<string, unknown> | null) ?? null)
        : null,
      references,
      links,
    };
  }

  async home(auth: AuthContext): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) return { space: null };

      const serverDate = trustedUtcDate(now);
      const recent = await listRelationshipItems(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        snapshotAt: now,
        storyOnly: false,
        sort: "created_desc",
        limit: 8,
      });
      const recentItems: RelationshipItemProjection[] = [];
      for (const item of recent) {
        recentItems.push(await this.#project(transaction, item, auth.session.accountId));
      }

      const upcomingRows = await listUpcomingRelationshipReleases(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        limit: 8,
      });
      const upcomingReleases: RelationshipItemProjection[] = [];
      for (const item of upcomingRows) {
        upcomingReleases.push(
          await this.#project(transaction, item, auth.session.accountId),
        );
      }

      const reunionRows = await listRelationshipItems(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        snapshotAt: now,
        kind: "reunion",
        storyOnly: false,
        sort: "created_desc",
        limit: 20,
      });
      let reunion: RelationshipItemProjection | null = null;
      for (const item of reunionRows) {
        const state = await loadRelationshipFeatureState(
          transaction,
          item.partnershipId,
          item.id,
        );
        if (
          state?.type === "reunion" &&
          compareCalendarDates(state.targetDate, serverDate) >= 0
        ) {
          reunion = await this.#project(transaction, item, auth.session.accountId);
          break;
        }
      }

      const signalRows = await listRelationshipItems(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        snapshotAt: now,
        kind: "relationship_signal",
        storyOnly: false,
        sort: "created_desc",
        limit: 5,
      });
      const recentSignals: RelationshipItemProjection[] = [];
      for (const item of signalRows) {
        recentSignals.push(await this.#project(transaction, item, auth.session.accountId));
      }

      const writable =
        current.lifecycleState === "active" && !current.accountDeletionViewOnly;
      const anniversaryYear = Number(serverDate.slice(0, 4));
      const anniversaryDate = anniversaryDateForYear(
        current.relationshipStartDate,
        anniversaryYear,
      );
      const anniversaryRows = await listRelationshipItems(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        snapshotAt: now,
        kind: "anniversary",
        storyOnly: false,
        sort: "created_desc",
        limit: 50,
      });
      let savedCurationItemId: string | null = null;
      for (const item of anniversaryRows) {
        const state = await loadRelationshipFeatureState(
          transaction,
          item.partnershipId,
          item.id,
        );
        if (
          state?.type === "curation" &&
          state.curationType === "anniversary" &&
          state.anchorYear === anniversaryYear
        ) {
          savedCurationItemId = item.id;
          break;
        }
      }

      return {
        space: {
          mode: current.accountDeletionViewOnly
            ? "account_deletion_view_only"
            : current.lifecycleState === "breakup_pending"
              ? "breakup_pending_view_only"
              : "active",
          relationshipStartDate: current.relationshipStartDate,
          serverDate,
          relationshipDuration: relationshipDuration(
            current.relationshipStartDate,
            serverDate,
          ),
          capabilities: {
            view: true,
            create: writable,
            edit: writable,
            delete: writable,
            manualRelease: writable,
            curate: writable,
            sendSignal: writable,
          },
          recentItems,
          upcomingReleases,
          reunion,
          anniversary: {
            date: anniversaryDate,
            savedCurationItemId,
          },
          recentSignals,
        },
      };
    });
  }

  async list(auth: AuthContext, input: RelationshipItemListQuery): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) return { items: [], nextCursor: null };

      let snapshotAt = now;
      let cursorCreatedAt: Date | undefined;
      let cursorItemId: string | undefined;
      let cursorOccurredYear: number | undefined;
      let cursorOccurredMonth: number | undefined;
      let cursorOccurredDay: number | undefined;
      const shape = queryShape(input);

      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        if (cursor.queryShape !== shape || cursor.sort !== input.sort) {
          throw new ApiError(400, "INVALID_CURSOR");
        }
        const parsedSnapshot = new Date(cursor.snapshotAt);
        if (
          !Number.isFinite(parsedSnapshot.getTime()) ||
          parsedSnapshot.getTime() > now.getTime()
        ) {
          throw new ApiError(400, "INVALID_CURSOR");
        }
        snapshotAt = parsedSnapshot;
        cursorItemId = cursor.itemId;
        if (cursor.sort === "created_desc") {
          const created = new Date(cursor.createdAt);
          if (!Number.isFinite(created.getTime())) throw new ApiError(400, "INVALID_CURSOR");
          cursorCreatedAt = created;
        } else {
          cursorOccurredYear = cursor.occurredYear;
          cursorOccurredMonth = cursor.occurredMonth;
          cursorOccurredDay = cursor.occurredDay;
        }
      }

      const rows = await listRelationshipItems(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        snapshotAt,
        ...(input.kind ? { kind: input.kind } : {}),
        storyOnly: input.storyOnly,
        ...(input.year ? { year: input.year } : {}),
        sort: input.sort,
        ...(cursorCreatedAt ? { cursorCreatedAt } : {}),
        ...(cursorItemId ? { cursorItemId } : {}),
        ...(cursorOccurredYear !== undefined ? { cursorOccurredYear } : {}),
        ...(cursorOccurredMonth !== undefined ? { cursorOccurredMonth } : {}),
        ...(cursorOccurredDay !== undefined ? { cursorOccurredDay } : {}),
        limit: input.limit + 1,
      });
      const visible = rows.slice(0, input.limit);
      const items: RelationshipItemProjection[] = [];
      for (const row of visible) {
        items.push(await this.#project(transaction, row, auth.session.accountId));
      }
      const last = visible.at(-1);
      const nextCursor =
        rows.length > input.limit && last
          ? input.sort === "created_desc"
            ? encodeCursor({
                v: 1,
                sort: "created_desc",
                snapshotAt: snapshotAt.toISOString(),
                createdAt: last.createdAt.toISOString(),
                itemId: last.id,
                queryShape: shape,
              })
            : encodeCursor({
                v: 1,
                sort: "occurred_asc",
                snapshotAt: snapshotAt.toISOString(),
                occurredYear: last.occurredYear ?? 10000,
                occurredMonth: last.occurredMonth ?? 0,
                occurredDay: last.occurredDay ?? 0,
                itemId: last.id,
                queryShape: shape,
              })
          : null;
      return { items, nextCursor };
    });
  }

  async get(auth: AuthContext, itemId: string): Promise<RelationshipItemProjection> {
    return withTransaction(this.database, async (transaction) => {
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      const item = await loadRelationshipItem(transaction, current.partnershipId, itemId);
      if (!item || !isItemVisible(item, auth.session.accountId)) {
        throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      }
      return this.#project(transaction, item, auth.session.accountId);
    });
  }

  async create(
    auth: AuthContext,
    input: RelationshipItemCreateInput,
    idempotencyKey: string,
  ): Promise<{ statusCode: number; body: unknown }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
      const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
      if (!lifecycle || !lifecycle.memberIds.includes(auth.session.accountId)) {
        throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
      }

      const completed = await this.#findCompletedMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: lifecycle.partnershipId,
        operation: "create",
        idempotencyKey,
        body: input,
        now,
      });
      if (completed) {
        return {
          statusCode: completed.responseStatus as number,
          body: completed.responseBody,
        };
      }

      this.#requireCapability(
        auth.session.accountId,
        lifecycle,
        now,
        input.kind === "relationship_signal"
          ? "create_relationship_signal"
          : "create_relationship_object",
      );
      this.#validateCreateSemantics(input, now);

      await this.#validateReferences(
        transaction,
        lifecycle.partnershipId,
        auth.session.accountId,
        input.references,
      );

      const targetIds = [...new Set(input.links.map((link) => link.targetItemId))].sort();
      const targets = await lockRelationshipItemsByIds(
        transaction,
        lifecycle.partnershipId,
        targetIds,
      );
      if (targets.length !== targetIds.length) throw new ApiError(422, "INVALID_ITEM_LINK");
      await this.#validateLockedLinks(targets, null, input.kind, input.links);

      const reservation = await this.#reserveMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: lifecycle.partnershipId,
        operation: "create",
        idempotencyKey,
        body: input,
        now,
      });
      if (reservation.replayed) {
        return {
          statusCode: reservation.responseStatus as number,
          body: reservation.responseBody,
        };
      }

      const itemId = randomUUID();
      const occurrence = occurrenceFields(input.occurrence);
      const release = releaseFields(input.release, now);
      await insertRelationshipItem(transaction, {
        id: itemId,
        partnershipId: lifecycle.partnershipId,
        creatorAccountId: auth.session.accountId,
        kind: input.kind,
        contentSchemaVersion: input.contentSchemaVersion,
        preview: input.preview,
        content: input.content,
        occurredPrecision: occurrence.precision,
        occurredYear: occurrence.year,
        occurredMonth: occurrence.month,
        occurredDay: occurrence.day,
        releaseMode: release.mode,
        releaseGeneration: 1n,
        unlockAt: release.unlockAt,
        releasedAt: release.releasedAt,
        createdAt: now,
      });

      await replaceRelationshipFeatureState(transaction, {
        partnershipId: lifecycle.partnershipId,
        itemId,
        state: featureStateForDatabase(input.featureState, null, now),
      });
      await replaceRelationshipReferences(transaction, {
        partnershipId: lifecycle.partnershipId,
        itemId,
        references: input.references.map((reference) => ({
          ...reference,
          id: randomUUID(),
        })),
        at: now,
      });
      await replaceRelationshipLinks(transaction, {
        partnershipId: lifecycle.partnershipId,
        ownerItemId: itemId,
        links: input.links,
        at: now,
      });
      await setRelationshipStoryIncluded(transaction, {
        partnershipId: lifecycle.partnershipId,
        itemId,
        actorAccountId: auth.session.accountId,
        included: input.storyIncluded,
        at: now,
      });

      if (release.mode === "scheduled" && release.unlockAt) {
        await insertScheduledAction(transaction, {
          id: randomUUID(),
          actionType: "relationship_item_release",
          aggregateType: "relationship_item",
          aggregateId: itemId,
          executeAt: release.unlockAt,
          expectedGeneration: 1n,
          deduplicationKey: "relationship-release:" + itemId + ":g:1",
          payload: {},
          payloadVersion: 1,
        });
      }

      await appendRelationshipEvent(transaction, {
        id: randomUUID(),
        partnershipId: lifecycle.partnershipId,
        itemId,
        eventType: "item_created",
        actorAccountId: auth.session.accountId,
        itemVersion: 1n,
        createdAt: now,
      });

      const response = {
        itemId,
        version: 1,
        createdAt: now.toISOString(),
      };
      await this.#completeMutation(transaction, reservation, 201, response, now);
      return { statusCode: 201, body: response };
    });
  }

  async patch(
    auth: AuthContext,
    itemId: string,
    input: RelationshipItemPatchInput,
    idempotencyKey: string,
  ): Promise<{ statusCode: number; body: unknown }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");

      const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
      if (
        !lifecycle ||
        lifecycle.lifecycleState === "terminated" ||
        !lifecycle.memberIds.includes(auth.session.accountId)
      ) {
        throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      }

      const completed = await this.#findCompletedMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: current.partnershipId,
        operation: "patch",
        targetItemId: itemId,
        idempotencyKey,
        body: input,
        now,
      });
      if (completed) {
        return {
          statusCode: completed.responseStatus as number,
          body: completed.responseBody,
        };
      }

      const incomingTargetIds = input.links?.map((link) => link.targetItemId) ?? [];
      const lockIds = [...new Set([itemId, ...incomingTargetIds])].sort();
      const locked = await lockRelationshipItemsByIds(
        transaction,
        current.partnershipId,
        lockIds,
      );
      const lockedById = new Map(locked.map((item) => [item.id, item]));
      const item = lockedById.get(itemId);
      if (!item || !isItemVisible(item, auth.session.accountId)) {
        throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      }
      const reservation = await this.#reserveMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: current.partnershipId,
        operation: "patch",
        targetItemId: itemId,
        idempotencyKey,
        body: input,
        now,
      });
      if (reservation.replayed) {
        return {
          statusCode: reservation.responseStatus as number,
          body: reservation.responseBody,
        };
      }

      if (item.version !== BigInt(input.expectedVersion)) {
        throw new ApiError(409, "VERSION_CONFLICT");
      }

      const currentFeatureState = await loadRelationshipFeatureState(
        transaction,
        item.partnershipId,
        item.id,
      );
      const currentReferences = await loadRelationshipReferences(
        transaction,
        item.partnershipId,
        item.id,
      );
      const currentLinks = await loadRelationshipLinks(
        transaction,
        item.partnershipId,
        item.id,
      );

      const candidate = parseAtBoundary(relationshipItemCreateSchema, {
        kind: item.kind,
        contentSchemaVersion: item.contentSchemaVersion,
        preview:
          input.preview !== undefined ? input.preview : item.developmentPreviewPayload,
        content:
          input.content !== undefined ? input.content : item.developmentPlaintextPayload,
        occurrence:
          input.occurrence !== undefined ? input.occurrence : occurrenceFromItem(item),
        storyIncluded:
          input.storyIncluded !== undefined ? input.storyIncluded : item.storyIncluded,
        release: input.release !== undefined ? input.release : releaseFromItem(item),
        featureState:
          input.featureState !== undefined
            ? input.featureState
            : featureStateForContract(currentFeatureState),
        references: input.references ?? currentReferences,
        links: input.links ?? currentLinks,
      });
      this.#validateCreateSemantics(candidate, now);

      const contentChanged =
        input.preview !== undefined ||
        input.content !== undefined ||
        input.occurrence !== undefined ||
        input.references !== undefined ||
        input.release !== undefined;
      const sharedStateChanged =
        input.featureState !== undefined || input.links !== undefined;
      const storyChanged = input.storyIncluded !== undefined;

      if (contentChanged) {
        const capability = evaluateCapability(
          "edit_relationship_object_content",
          capabilityContext(auth.session.accountId, lifecycle, now),
        );
        if (!capability.allowed) throw new ApiError(409, "RELATIONSHIP_SPACE_VIEW_ONLY");
        const contentDecision = canEditRelationshipContent({
          kind: item.kind,
          creatorAccountId: item.creatorAccountId,
          actorAccountId: auth.session.accountId,
          releasedAt: item.releasedAt?.toISOString() ?? null,
        });
        if (!contentDecision.allowed) {
          throw new ApiError(
            contentDecision.reason === "RELATIONSHIP_ITEM_IMMUTABLE" ? 409 : 403,
            contentDecision.reason,
          );
        }
      }

      if (sharedStateChanged) {
        const capabilityName =
          item.kind === "our_year" || item.kind === "anniversary"
            ? "curate_relationship_space"
            : "mutate_relationship_shared_state";
        const capability = evaluateCapability(
          capabilityName,
          capabilityContext(auth.session.accountId, lifecycle, now),
        );
        if (!capability.allowed) throw new ApiError(409, "RELATIONSHIP_SPACE_VIEW_ONLY");
        if (!canMutateRelationshipSharedState(item.kind)) {
          throw new ApiError(409, "RELATIONSHIP_SHARED_STATE_NOT_ALLOWED");
        }
      }

      if (storyChanged) {
        const capability = evaluateCapability(
          "curate_relationship_space",
          capabilityContext(auth.session.accountId, lifecycle, now),
        );
        if (!capability.allowed) throw new ApiError(409, "RELATIONSHIP_SPACE_VIEW_ONLY");
      }

      if (input.references !== undefined) {
        await this.#validateReferences(
          transaction,
          item.partnershipId,
          auth.session.accountId,
          candidate.references,
        );
      }
      if (input.links) {
        const targets = input.links.map((link) => lockedById.get(link.targetItemId)).filter(Boolean);
        if (targets.length !== incomingTargetIds.length) {
          throw new ApiError(422, "INVALID_ITEM_LINK");
        }
        await this.#validateLockedLinks(
          targets as RelationshipItemRecord[],
          item.id,
          item.kind,
          input.links,
        );
      }

      const occurrence = occurrenceFields(candidate.occurrence);
      const nextRelease = releaseFields(candidate.release, now);
      let releaseGeneration = item.releaseGeneration;
      const changedRelease = releaseChanged(item, candidate.release);
      if (changedRelease && (item.releaseMode === "scheduled" || nextRelease.mode === "scheduled")) {
        releaseGeneration += 1n;
      }

      if (changedRelease && item.releaseMode === "scheduled") {
        await cancelPendingScheduledActionsByDeduplicationKey(
          transaction,
          ["relationship-release:" + item.id + ":g:" + item.releaseGeneration],
          now,
        );
      }

      const nextVersion = await updateRelationshipItemRoot(transaction, {
        partnershipId: item.partnershipId,
        itemId: item.id,
        expectedVersion: item.version,
        preview: candidate.preview,
        content: candidate.content,
        occurredPrecision: occurrence.precision,
        occurredYear: occurrence.year,
        occurredMonth: occurrence.month,
        occurredDay: occurrence.day,
        releaseMode: nextRelease.mode,
        releaseGeneration,
        unlockAt: nextRelease.unlockAt,
        releasedAt:
          nextRelease.mode === "immediate"
            ? item.releasedAt ?? now
            : item.releasedAt,
        updatedAt: now,
      });
      if (nextVersion === null) throw new ApiError(409, "VERSION_CONFLICT");

      await replaceRelationshipFeatureState(transaction, {
        partnershipId: item.partnershipId,
        itemId: item.id,
        state: featureStateForDatabase(candidate.featureState, currentFeatureState, now),
      });
      await replaceRelationshipReferences(transaction, {
        partnershipId: item.partnershipId,
        itemId: item.id,
        references: candidate.references.map((reference) => ({
          ...reference,
          id: randomUUID(),
        })),
        at: now,
      });
      await replaceRelationshipLinks(transaction, {
        partnershipId: item.partnershipId,
        ownerItemId: item.id,
        links: candidate.links,
        at: now,
      });
      await setRelationshipStoryIncluded(transaction, {
        partnershipId: item.partnershipId,
        itemId: item.id,
        actorAccountId: auth.session.accountId,
        included: candidate.storyIncluded,
        at: now,
      });

      if (changedRelease && nextRelease.mode === "scheduled" && nextRelease.unlockAt) {
        await insertScheduledAction(transaction, {
          id: randomUUID(),
          actionType: "relationship_item_release",
          aggregateType: "relationship_item",
          aggregateId: item.id,
          executeAt: nextRelease.unlockAt,
          expectedGeneration: releaseGeneration,
          deduplicationKey:
            "relationship-release:" + item.id + ":g:" + releaseGeneration,
          payload: {},
          payloadVersion: 1,
        });
      }

      await appendRelationshipEvent(transaction, {
        id: randomUUID(),
        partnershipId: item.partnershipId,
        itemId: item.id,
        eventType:
          input.storyIncluded !== undefined && !contentChanged && !sharedStateChanged
            ? "story_membership_changed"
            : input.featureState?.type === "someday"
              ? "someday_state_changed"
              : "item_updated",
        actorAccountId: auth.session.accountId,
        itemVersion: nextVersion,
        createdAt: now,
      });

      const response = {
        itemId: item.id,
        version: safeVersion(nextVersion),
        updatedAt: now.toISOString(),
      };
      await this.#completeMutation(transaction, reservation, 200, response, now);
      return { statusCode: 200, body: response };
    });
  }

  async delete(
    auth: AuthContext,
    itemId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<{ statusCode: 204; body: null }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");

      const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
      if (
        !lifecycle ||
        lifecycle.lifecycleState === "terminated" ||
        !lifecycle.memberIds.includes(auth.session.accountId)
      ) {
        throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      }

      const completed = await this.#findCompletedMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: current.partnershipId,
        operation: "delete",
        targetItemId: itemId,
        idempotencyKey,
        body: { expectedVersion },
        now,
      });
      if (completed) return { statusCode: 204, body: null };

      this.#requireCapability(
        auth.session.accountId,
        lifecycle,
        now,
        "delete_relationship_object",
      );

      const ownerIds = await loadIncomingRelationshipLinkOwnerIds(
        transaction,
        lifecycle.partnershipId,
        itemId,
      );
      const lockIds = [...new Set([itemId, ...ownerIds])].sort();
      const locked = await lockRelationshipItemsByIds(
        transaction,
        lifecycle.partnershipId,
        lockIds,
      );
      const byId = new Map(locked.map((item) => [item.id, item]));
      const item = byId.get(itemId);
      if (!item || !isItemVisible(item, auth.session.accountId)) {
        const replayAfterWait = await this.#findCompletedMutation(transaction, {
          accountId: auth.session.accountId,
          partnershipId: current.partnershipId,
          operation: "delete",
          targetItemId: itemId,
          idempotencyKey,
          body: { expectedVersion },
          now,
        });
        if (replayAfterWait) return { statusCode: 204, body: null };
        throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      }

      const reservation = await this.#reserveMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: current.partnershipId,
        operation: "delete",
        targetItemId: itemId,
        idempotencyKey,
        body: { expectedVersion },
        now,
      });
      if (reservation.replayed) return { statusCode: 204, body: null };

      if (item.version !== BigInt(expectedVersion)) {
        throw new ApiError(409, "VERSION_CONFLICT");
      }

      const deletionDecision = canDeleteRelationshipItem({
        kind: item.kind,
        creatorAccountId: item.creatorAccountId,
        actorAccountId: auth.session.accountId,
      });
      if (!deletionDecision.allowed) {
        throw new ApiError(403, deletionDecision.reason);
      }

      if (item.releaseMode === "scheduled") {
        await cancelPendingScheduledActionsByDeduplicationKey(
          transaction,
          ["relationship-release:" + item.id + ":g:" + item.releaseGeneration],
          now,
        );
      }

      await deleteIncomingRelationshipLinks(transaction, item.partnershipId, item.id);
      for (const ownerId of ownerIds) {
        const owner = byId.get(ownerId);
        if (!owner) continue;
        const ownerVersion = await incrementRelationshipItemVersion(
          transaction,
          owner.partnershipId,
          owner.id,
          now,
        );
        await appendRelationshipEvent(transaction, {
          id: randomUUID(),
          partnershipId: owner.partnershipId,
          itemId: owner.id,
          eventType: "item_updated",
          actorAccountId: auth.session.accountId,
          itemVersion: ownerVersion,
          createdAt: now,
        });
      }

      const deleted = await deleteRelationshipItem(
        transaction,
        item.partnershipId,
        item.id,
        item.version,
      );
      if (!deleted) throw new ApiError(409, "VERSION_CONFLICT");

      await this.#completeMutation(
        transaction,
        reservation,
        204,
        { itemId: item.id, deleted: true },
        now,
      );
      return { statusCode: 204, body: null };
    });
  }

  async release(
    auth: AuthContext,
    itemId: string,
    input: RelationshipItemReleaseInput,
    idempotencyKey: string,
  ): Promise<{ statusCode: number; body: unknown }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");

      const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
      if (
        !lifecycle ||
        lifecycle.lifecycleState === "terminated" ||
        !lifecycle.memberIds.includes(auth.session.accountId)
      ) {
        throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      }

      const completed = await this.#findCompletedMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: current.partnershipId,
        operation: "release",
        targetItemId: itemId,
        idempotencyKey,
        body: input,
        now,
      });
      if (completed) {
        return {
          statusCode: completed.responseStatus as number,
          body: completed.responseBody,
        };
      }

      const locked = await lockRelationshipItemsByIds(
        transaction,
        current.partnershipId,
        [itemId],
      );
      const item = locked[0];
      if (!item || !isItemVisible(item, auth.session.accountId)) {
        throw new ApiError(404, "RELATIONSHIP_ITEM_NOT_FOUND");
      }
      const reservation = await this.#reserveMutation(transaction, {
        accountId: auth.session.accountId,
        partnershipId: current.partnershipId,
        operation: "release",
        targetItemId: itemId,
        idempotencyKey,
        body: input,
        now,
      });
      if (reservation.replayed) {
        return {
          statusCode: reservation.responseStatus as number,
          body: reservation.responseBody,
        };
      }

      if (item.version !== BigInt(input.expectedVersion)) {
        throw new ApiError(409, "VERSION_CONFLICT");
      }
      if (item.releasedAt) throw new ApiError(409, "ITEM_ALREADY_RELEASED");

      const capabilityName =
        item.releaseMode === "recipient_open"
          ? "recipient_open_relationship_object"
          : "creator_reveal_relationship_object";
      const capability = evaluateCapability(
        capabilityName,
        capabilityContext(auth.session.accountId, lifecycle, now),
      );
      if (!capability.allowed) throw new ApiError(409, "RELATIONSHIP_SPACE_VIEW_ONLY");

      if (
        !canManuallyReleaseRelationshipItem({
          kind: item.kind,
          releaseMode: item.releaseMode,
          creatorAccountId: item.creatorAccountId,
          actorAccountId: auth.session.accountId,
        })
      ) {
        throw new ApiError(409, "RELEASE_NOT_ALLOWED");
      }

      const nextVersion = await updateRelationshipItemRoot(transaction, {
        partnershipId: item.partnershipId,
        itemId: item.id,
        expectedVersion: item.version,
        preview: item.developmentPreviewPayload,
        content: item.developmentPlaintextPayload,
        occurredPrecision: item.occurredPrecision,
        occurredYear: item.occurredYear,
        occurredMonth: item.occurredMonth,
        occurredDay: item.occurredDay,
        releaseMode: item.releaseMode,
        releaseGeneration: item.releaseGeneration,
        unlockAt: item.unlockAt,
        releasedAt: now,
        updatedAt: now,
      });
      if (nextVersion === null) throw new ApiError(409, "VERSION_CONFLICT");

      await appendRelationshipEvent(transaction, {
        id: randomUUID(),
        partnershipId: item.partnershipId,
        itemId: item.id,
        eventType: "item_released",
        actorAccountId: auth.session.accountId,
        itemVersion: nextVersion,
        createdAt: now,
      });

      const response = {
        itemId: item.id,
        version: safeVersion(nextVersion),
        releasedAt: now.toISOString(),
      };
      await this.#completeMutation(transaction, reservation, 200, response, now);
      return { statusCode: 200, body: response };
    });
  }

  async thisDay(auth: AuthContext, input: ThisDayQuery): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) return { on: input.on, items: [] };
      const { month, day } = dateParts(input.on);
      const rows = await listRelationshipItemsForThisDay(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        month,
        day,
        limit: 100,
      });
      const items: RelationshipItemProjection[] = [];
      for (const row of rows) {
        items.push(await this.#project(transaction, row, auth.session.accountId));
      }
      return { on: input.on, items };
    });
  }

  async ourYear(auth: AuthContext, params: OurYearParams): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) return { year: params.year, savedCuration: null, candidates: [] };

      const rows = await listRelationshipItemsForYear(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        year: params.year,
        limit: 100,
      });
      const candidates: RelationshipItemProjection[] = [];
      for (const row of rows) {
        candidates.push(await this.#project(transaction, row, auth.session.accountId));
      }

      const curations = await listRelationshipItems(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        snapshotAt: now,
        kind: "our_year",
        storyOnly: false,
        sort: "created_desc",
        limit: 100,
      });
      let savedCuration: RelationshipItemProjection | null = null;
      for (const row of curations) {
        const state = await loadRelationshipFeatureState(
          transaction,
          row.partnershipId,
          row.id,
        );
        if (
          state?.type === "curation" &&
          state.curationType === "our_year" &&
          state.anchorYear === params.year
        ) {
          savedCuration = await this.#project(transaction, row, auth.session.accountId);
          break;
        }
      }
      return { year: params.year, savedCuration, candidates };
    });
  }

  async anniversary(auth: AuthContext, input: AnniversaryQuery): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(
        transaction,
        auth.session.accountId,
      );
      if (!current) {
        return {
          relationshipStartDate: null,
          anniversaryDate: null,
          savedCuration: null,
          eligibleItems: [],
        };
      }
      const serverDate = trustedUtcDate(now);
      const on = input.on ?? serverDate;
      dateParts(on);
      const year = Number(on.slice(0, 4));
      const anniversaryDate = anniversaryDateForYear(current.relationshipStartDate, year);

      const rows = await listRelationshipItemsForYear(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        year,
        limit: 100,
      });
      const eligibleItems: RelationshipItemProjection[] = [];
      for (const row of rows) {
        eligibleItems.push(await this.#project(transaction, row, auth.session.accountId));
      }

      const curations = await listRelationshipItems(transaction, {
        partnershipId: current.partnershipId,
        actorAccountId: auth.session.accountId,
        snapshotAt: now,
        kind: "anniversary",
        storyOnly: false,
        sort: "created_desc",
        limit: 100,
      });
      let savedCuration: RelationshipItemProjection | null = null;
      for (const row of curations) {
        const state = await loadRelationshipFeatureState(
          transaction,
          row.partnershipId,
          row.id,
        );
        if (
          state?.type === "curation" &&
          state.curationType === "anniversary" &&
          state.anchorYear === year
        ) {
          savedCuration = await this.#project(transaction, row, auth.session.accountId);
          break;
        }
      }

      return {
        relationshipStartDate: current.relationshipStartDate,
        anniversaryDate,
        savedCuration,
        eligibleItems,
      };
    });
  }
}
