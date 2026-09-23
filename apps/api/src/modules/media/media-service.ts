import { randomBytes, randomUUID } from "node:crypto";
import {
  completeLifecycleIdempotency,
  getTransactionTimestamp,
  insertMediaUpload,
  insertScheduledAction,
  loadCurrentConversationReadModel,
  loadMediaObject,
  loadMessageProjection,
  loadPartnershipReadModelForAccount,
  loadRelationshipItem,
  lockMediaObject,
  lockPartnershipLifecycle,
  markMediaDeletionPending,
  markMediaReady,
  refreshMediaUpload,
  reserveLifecycleIdempotency,
  withTransaction,
  type DatabasePool,
  type LockedPartnershipLifecycle,
  type MediaObjectRecord,
  type QueryExecutor,
} from "@shawtie/db";
import {
  evaluateCapability,
  mediaFormatAllowed,
  type CapabilityContext,
  type PartnershipState,
} from "@shawtie/domain";
import type {
  MediaUploadCreateInput,
  MediaUploadGenerationInput,
} from "@shawtie/contracts";
import type { MediaObjectStore } from "@shawtie/media-storage";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import { resolveMediaApiConfig, type ApiConfig, type MediaApiConfig } from "../../config.ts";

const DAY = 24 * 60 * 60_000;
const IDEMPOTENCY_RETENTION_MS = 7 * DAY;

function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Media generation exceeds safe integer range");
  }
  return Number(value);
}

function lifecycleContext(
  actorAccountId: string,
  lifecycle: LockedPartnershipLifecycle,
  now: Date,
): CapabilityContext {
  const first = lifecycle.memberIds[0];
  const second = lifecycle.memberIds[1];
  if (!first || !second) throw new Error("M3 partnership must have exactly two members");
  const members: readonly [string, string] = [first, second];
  const partnership: PartnershipState = {
    id: lifecycle.partnershipId,
    members,
    lifecycle: lifecycle.lifecycleState,
    generation: safeNumber(lifecycle.generation),
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
          generation: safeNumber(lifecycle.breakup.generation),
          messageFreezeSequence:
            lifecycle.breakup.messageFreezeSequence === null
              ? null
              : safeNumber(lifecycle.breakup.messageFreezeSequence),
        }
      : null,
    accountDeletion: lifecycle.accountDeletion
      ? {
          accountId: lifecycle.accountDeletion.accountId,
          requestedAt: lifecycle.accountDeletion.requestedAt.toISOString(),
          recoverUntil: lifecycle.accountDeletion.recoverUntil.toISOString(),
          generation: safeNumber(lifecycle.accountDeletion.generation),
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

function fullRelationshipItemVisible(
  item: {
    readonly releaseMode: string | null;
    readonly releasedAt: Date | null;
    readonly creatorAccountId: string;
  },
  actorAccountId: string,
): boolean {
  return item.releaseMode === null || item.releasedAt !== null || item.creatorAccountId === actorAccountId;
}

function projection(media: MediaObjectRecord) {
  return {
    mediaId: media.id,
    kind: media.mediaKind,
    formatCode: media.formatCode,
    state: media.state,
    ciphertextBytes: safeNumber(media.ciphertextSize),
    cryptoProtocolVersion: media.cryptoProtocolVersion,
    durationSeconds: media.durationSeconds,
    uploadGeneration: safeNumber(media.uploadGeneration),
    uploadExpiresAt: media.uploadExpiresAt?.toISOString() ?? null,
    readyAt: media.readyAt?.toISOString() ?? null,
    binding:
      media.bindingId && media.bindingType && media.bindingRole && media.bindingPosition !== null
        ? {
            type: media.bindingType,
            id: media.bindingId,
            role: media.bindingRole,
            position: media.bindingPosition,
          }
        : null,
    createdAt: media.createdAt.toISOString(),
  };
}

function mediaIdFromResponse(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const mediaId = "mediaId" in value ? value.mediaId : null;
  return typeof mediaId === "string" ? mediaId : null;
}

export class MediaService {
  readonly #database: DatabasePool;
  readonly #keys: AuthKeyRing;
  readonly #config: ApiConfig;
  readonly #media: MediaApiConfig;
  readonly #store: MediaObjectStore | null;

  constructor(
    database: DatabasePool,
    keys: AuthKeyRing,
    config: ApiConfig,
    store: MediaObjectStore | null,
  ) {
    this.#database = database;
    this.#keys = keys;
    this.#config = config;
    this.#media = resolveMediaApiConfig(config);
    this.#store = store;
  }

  policy() {
    return {
      imageSourceMaxBytes: 10 * 1024 * 1024,
      imageProcessedLongestEdge: 4096,
      imageTargetBytes: 2 * 1024 * 1024,
      videoMaxBytes: 50 * 1024 * 1024,
      videoMaxDurationSeconds: 120,
      fileMaxBytes: 25 * 1024 * 1024,
      voiceMaxBytes: 15 * 1024 * 1024,
      voiceMaxDurationSeconds: 600,
      attachmentsPerMessage: 10,
      uploadGrantTtlSeconds: Math.floor(this.#media.uploadGrantTtlMs / 1000),
      downloadGrantTtlSeconds: Math.floor(this.#media.downloadGrantTtlMs / 1000),
      unboundUploadRetentionSeconds: Math.floor(this.#media.unboundRetentionMs / 1000),
      wholeObjectTransfer: true,
    };
  }

  #requireStore(): MediaObjectStore {
    if (!this.#store) throw new ApiError(503, "MEDIA_UNAVAILABLE");
    return this.#store;
  }

  #assertProductionCrypto(protocol: string): void {
    if (
      this.#config.environment === "production" &&
      (protocol.startsWith("test-") || protocol.startsWith("m3-test-"))
    ) {
      throw new ApiError(409, "MEDIA_CRYPTO_PROTOCOL_UNAVAILABLE");
    }
  }

  async #lockWritableLifecycle(
    transaction: QueryExecutor,
    accountId: string,
    now: Date,
  ): Promise<LockedPartnershipLifecycle> {
    const current = await loadPartnershipReadModelForAccount(transaction, accountId);
    if (!current) throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
    const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
    if (!lifecycle || !lifecycle.memberIds.includes(accountId)) {
      throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
    }
    const decision = evaluateCapability("send_media", lifecycleContext(accountId, lifecycle, now));
    if (decision.allowed) return lifecycle;
    if (decision.reason === "ACCOUNT_LOCKED") throw new ApiError(409, "ACCOUNT_LOCKED");
    if (decision.reason === "PARTNERSHIP_TERMINATED") {
      throw new ApiError(409, "PARTNERSHIP_TERMINATED");
    }
    throw new ApiError(409, "NO_CURRENT_PARTNERSHIP");
  }

  async #grant(media: MediaObjectRecord, now: Date) {
    if (media.state !== "uploading" || !media.uploadExpiresAt) {
      return { ...projection(media), uploadUrl: null, requiredHeaders: null };
    }
    if (media.uploadExpiresAt.getTime() <= now.getTime()) {
      throw new ApiError(409, "MEDIA_UPLOAD_EXPIRED");
    }
    const store = this.#requireStore();
    const grantExpiresAt = new Date(
      Math.min(
        media.uploadExpiresAt.getTime(),
        now.getTime() + this.#media.uploadGrantTtlMs,
      ),
    );
    const grant = await store.createUploadGrant({
      objectKey: media.storageObjectKey,
      sha256: media.ciphertextSha256,
      expiresAt: grantExpiresAt,
    });
    return {
      ...projection(media),
      uploadUrl: grant.url,
      requiredHeaders: grant.requiredHeaders,
      grantExpiresAt: grant.expiresAt.toISOString(),
    };
  }

  async createUpload(
    auth: AuthContext,
    input: MediaUploadCreateInput,
    idempotencyKey: string,
  ): Promise<unknown> {
    if (!this.#media.uploadInitiationEnabled) {
      throw new ApiError(503, "MEDIA_UPLOAD_DISABLED");
    }
    this.#requireStore();
    this.#assertProductionCrypto(input.cryptoProtocolVersion);
    if (!mediaFormatAllowed(input.kind, input.formatCode)) {
      throw new ApiError(400, "MEDIA_FORMAT_UNSUPPORTED");
    }

    const fingerprintPayload = JSON.stringify({
      v: 1,
      action: "m3.media.create",
      kind: input.kind,
      formatCode: input.formatCode,
      ciphertextBytes: input.ciphertextBytes,
      ciphertextSha256: input.ciphertextSha256,
      cryptoProtocolVersion: input.cryptoProtocolVersion,
      durationSeconds: input.durationSeconds,
    });
    const fingerprint = this.#keys.activeVerifier("media-request-fingerprint", fingerprintPayload);

    const media = await withTransaction(this.#database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const lifecycle = await this.#lockWritableLifecycle(
        transaction,
        auth.session.accountId,
        now,
      );
      const reservation = await reserveLifecycleIdempotency(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        scope: "m3.media.create",
        idempotencyKey,
        fingerprint: fingerprint.value,
        fingerprintVersion: fingerprint.version,
        createdAt: now,
      });

      if (!reservation.fingerprint || reservation.fingerprintVersion === null) {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
      }
      let expected: Buffer;
      try {
        expected = this.#keys.verifier(
          "media-request-fingerprint",
          fingerprintPayload,
          reservation.fingerprintVersion,
        );
      } catch {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
      }
      if (!this.#keys.safeEqual(reservation.fingerprint, expected)) {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
      }

      if (reservation.responseStatus !== null) {
        const existingId = mediaIdFromResponse(reservation.responseBody);
        if (!existingId) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
        const existing = await loadMediaObject(transaction, existingId);
        if (
          !existing ||
          existing.uploaderAccountId !== auth.session.accountId ||
          existing.partnershipId !== lifecycle.partnershipId
        ) {
          throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { media: existing, now };
      }

      const mediaId = randomUUID();
      const objectKey = "media/v1/" + randomBytes(24).toString("hex");
      const uploadExpiresAt = new Date(now.getTime() + this.#media.uploadRetentionMs);
      await insertMediaUpload(transaction, {
        id: mediaId,
        partnershipId: lifecycle.partnershipId,
        uploaderAccountId: auth.session.accountId,
        uploaderDeviceId: auth.session.deviceId,
        storageObjectKey: objectKey,
        mediaKind: input.kind,
        formatCode: input.formatCode,
        ciphertextSize: BigInt(input.ciphertextBytes),
        ciphertextSha256: input.ciphertextSha256,
        cryptoProtocolVersion: input.cryptoProtocolVersion,
        durationSeconds: input.durationSeconds,
        uploadExpiresAt,
        createdAt: now,
      });
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "m3.media_upload_expire",
        aggregateType: "media_object",
        aggregateId: mediaId,
        executeAt: uploadExpiresAt,
        expectedGeneration: 1n,
        deduplicationKey: "m3-media-upload-expire:" + mediaId + ":g:1",
        payload: {},
        payloadVersion: 1,
      });
      await completeLifecycleIdempotency(transaction, {
        id: reservation.id,
        fingerprint: reservation.fingerprint,
        responseStatus: 201,
        responseBody: { mediaId },
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
      });
      const created = await loadMediaObject(transaction, mediaId);
      if (!created) throw new Error("Media upload insert disappeared");
      return { media: created, now };
    });

    return this.#grant(media.media, media.now);
  }

  async refreshUpload(
    auth: AuthContext,
    mediaId: string,
    input: MediaUploadGenerationInput,
  ): Promise<unknown> {
    if (!this.#media.uploadInitiationEnabled) {
      throw new ApiError(503, "MEDIA_UPLOAD_DISABLED");
    }
    this.#requireStore();
    const result = await withTransaction(this.#database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const lifecycle = await this.#lockWritableLifecycle(transaction, auth.session.accountId, now);
      const media = await lockMediaObject(transaction, mediaId);
      if (
        !media ||
        media.partnershipId !== lifecycle.partnershipId ||
        media.uploaderAccountId !== auth.session.accountId
      ) {
        throw new ApiError(404, "MEDIA_NOT_FOUND");
      }
      if (media.state !== "uploading") throw new ApiError(409, "MEDIA_NOT_READY");
      if (media.uploadGeneration !== BigInt(input.expectedUploadGeneration)) {
        throw new ApiError(409, "VERSION_CONFLICT");
      }
      const expiresAt = new Date(now.getTime() + this.#media.uploadRetentionMs);
      const generation = await refreshMediaUpload(
        transaction,
        media.id,
        media.uploadGeneration,
        expiresAt,
      );
      if (generation === null) throw new ApiError(409, "VERSION_CONFLICT");
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "m3.media_upload_expire",
        aggregateType: "media_object",
        aggregateId: media.id,
        executeAt: expiresAt,
        expectedGeneration: generation,
        deduplicationKey: "m3-media-upload-expire:" + media.id + ":g:" + generation,
        payload: {},
        payloadVersion: 1,
      });
      const refreshed = await loadMediaObject(transaction, media.id);
      if (!refreshed) throw new Error("Media disappeared after refresh");
      return { media: refreshed, now };
    });
    return this.#grant(result.media, result.now);
  }

  async completeUpload(
    auth: AuthContext,
    mediaId: string,
    input: MediaUploadGenerationInput,
  ): Promise<unknown> {
    const store = this.#requireStore();
    const snapshot = await loadMediaObject(this.#database.pool, mediaId);
    if (!snapshot || snapshot.uploaderAccountId !== auth.session.accountId) {
      throw new ApiError(404, "MEDIA_NOT_FOUND");
    }
    if (snapshot.state === "ready_unbound") return projection(snapshot);
    if (snapshot.state !== "uploading") throw new ApiError(409, "MEDIA_NOT_READY");
    if (snapshot.uploadGeneration !== BigInt(input.expectedUploadGeneration)) {
      throw new ApiError(409, "VERSION_CONFLICT");
    }
    const verified = await store.verifyObject({
      objectKey: snapshot.storageObjectKey,
      expectedBytes: snapshot.ciphertextSize,
      sha256: snapshot.ciphertextSha256,
    });
    if (!verified) throw new ApiError(409, "MEDIA_OBJECT_MISMATCH");

    return withTransaction(this.#database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const lifecycle = await this.#lockWritableLifecycle(transaction, auth.session.accountId, now);
      const media = await lockMediaObject(transaction, mediaId);
      if (
        !media ||
        media.partnershipId !== lifecycle.partnershipId ||
        media.uploaderAccountId !== auth.session.accountId
      ) {
        throw new ApiError(404, "MEDIA_NOT_FOUND");
      }
      if (media.state === "ready_unbound") return projection(media);
      if (media.state !== "uploading") throw new ApiError(409, "MEDIA_NOT_READY");
      if (media.uploadGeneration !== BigInt(input.expectedUploadGeneration)) {
        throw new ApiError(409, "VERSION_CONFLICT");
      }
      const expiresAt = new Date(now.getTime() + this.#media.unboundRetentionMs);
      const ready = await markMediaReady(
        transaction,
        media.id,
        media.uploadGeneration,
        now,
        expiresAt,
      );
      if (!ready) throw new ApiError(409, "VERSION_CONFLICT");
      const completed = await loadMediaObject(transaction, media.id);
      if (!completed) throw new Error("Media disappeared after completion");
      return projection(completed);
    });
  }

  async metadata(auth: AuthContext, mediaId: string): Promise<unknown> {
    const media = await this.#authorizeRead(auth, mediaId);
    return projection(media);
  }

  async access(auth: AuthContext, mediaId: string): Promise<unknown> {
    if (!this.#media.downloadGrantEnabled) {
      throw new ApiError(503, "MEDIA_DOWNLOAD_DISABLED");
    }
    const store = this.#requireStore();
    const media = await this.#authorizeRead(auth, mediaId);
    const expiresAt = new Date(Date.now() + this.#media.downloadGrantTtlMs);
    const grant = await store.createDownloadGrant({
      objectKey: media.storageObjectKey,
      expiresAt,
    });
    return {
      media: projection(media),
      downloadUrl: grant.url,
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  async deleteUnbound(auth: AuthContext, mediaId: string): Promise<void> {
    await withTransaction(this.#database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const media = await lockMediaObject(transaction, mediaId);
      if (!media || media.uploaderAccountId !== auth.session.accountId) {
        throw new ApiError(404, "MEDIA_NOT_FOUND");
      }
      if (media.bindingId !== null || !["uploading", "ready_unbound"].includes(media.state)) {
        throw new ApiError(409, "MEDIA_ALREADY_BOUND");
      }
      const generation = await markMediaDeletionPending(transaction, media.id, now);
      if (generation === null) return;
      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "m3.media_delete",
        aggregateType: "media_object",
        aggregateId: media.id,
        executeAt: now,
        expectedGeneration: generation,
        deduplicationKey: "m3-media-delete:" + media.id + ":g:" + generation,
        payload: {},
        payloadVersion: 1,
      });
    });
  }

  async #authorizeRead(auth: AuthContext, mediaId: string): Promise<MediaObjectRecord> {
    return withTransaction(this.#database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await loadPartnershipReadModelForAccount(transaction, auth.session.accountId);
      if (!current) throw new ApiError(404, "MEDIA_NOT_FOUND");
      const lifecycle = await lockPartnershipLifecycle(transaction, current.partnershipId);
      if (
        !lifecycle ||
        lifecycle.lifecycleState === "terminated" ||
        !lifecycle.memberIds.includes(auth.session.accountId)
      ) {
        throw new ApiError(404, "MEDIA_NOT_FOUND");
      }
      const view = evaluateCapability(
        "view_shared_data",
        lifecycleContext(auth.session.accountId, lifecycle, now),
      );
      if (!view.allowed) throw new ApiError(404, "MEDIA_NOT_FOUND");

      const media = await loadMediaObject(transaction, mediaId);
      if (
        !media ||
        media.partnershipId !== lifecycle.partnershipId ||
        media.deletedAt !== null ||
        !["ready_unbound", "bound"].includes(media.state)
      ) {
        throw new ApiError(404, "MEDIA_NOT_FOUND");
      }

      if (media.state === "ready_unbound") {
        if (media.uploaderAccountId !== auth.session.accountId) {
          throw new ApiError(404, "MEDIA_NOT_FOUND");
        }
        return media;
      }

      if (!media.bindingId || !media.bindingType) throw new ApiError(404, "MEDIA_NOT_FOUND");

      if (media.bindingType === "message") {
        const conversation = await loadCurrentConversationReadModel(
          transaction,
          auth.session.accountId,
          now,
        );
        if (!conversation || conversation.partnershipId !== media.partnershipId) {
          throw new ApiError(404, "MEDIA_NOT_FOUND");
        }
        const message = await loadMessageProjection(
          transaction,
          conversation.conversationId,
          media.bindingId,
        );
        if (!message || message.deletedAt !== null) throw new ApiError(404, "MEDIA_NOT_FOUND");
        return media;
      }

      const item = await loadRelationshipItem(transaction, media.partnershipId, media.bindingId);
      if (!item || !fullRelationshipItemVisible(item, auth.session.accountId)) {
        throw new ApiError(404, "MEDIA_NOT_FOUND");
      }
      return media;
    });
  }
}
