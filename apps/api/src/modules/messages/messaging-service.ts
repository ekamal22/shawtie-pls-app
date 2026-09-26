import { randomUUID } from "node:crypto";
import {
  allocateChangeSequence,
  allocateMessageAndChangeSequence,
  completeLifecycleIdempotency,
  consumeRateLimitBuckets,
  deleteProtectedContentKey,
  findMessageByIdempotencyKey,
  getTransactionTimestamp,
  hasActiveMessageReaction,
  heartbeatPresence,
  loadActiveMessageReactionContentKeyId,
  insertConversationChange,
  insertMessage,
  insertOutboxEvent,
  insertScheduledAction,
  listConversationChanges,
  listConversationMessages,
  listBoundMediaForContainer,
  loadConversationParticipants,
  loadCurrentConversationReadModel,
  loadMessageProjection,
  loadPartnershipCryptoPolicy,
  loadPartnershipMemberIds,
  loadPartnershipNicknameContentKeyId,
  loadProtectedContentKeys,
  lockAccounts,
  lockConversationForMutation,
  lockMessageForMutation,
  lockMediaObjectsForBinding,
  lockPartnershipLifecycle,
  markBoundMediaDeletionPending,
  messageExistsInConversation,
  removeMessageReaction,
  reserveLifecycleIdempotency,
  setConversationTypingState,
  setMessageReaction,
  setProtectedMessageReaction,
  bindMediaObject,
  tombstoneMessage,
  updateMessageBody,
  updatePartnershipNickname,
  updateProtectedPartnershipNickname,
  upsertConversationReceipt,
  withTransaction,
  type DatabasePool,
  type LifecycleIdempotencyRecord,
  type LockedConversation,
  type LockedMessage,
  type LockedPartnershipLifecycle,
  type MessageProjectionRowModel,
  type ProtectedContentKeyRecord,
  type QueryExecutor,
} from "@shawtie/db";
import {
  evaluateCapability,
  mediaRoleAllowed,
  type CapabilityContext,
  type CapabilityName,
  type PartnershipState,
} from "@shawtie/domain";
import {
  M1_CHANGE_MAX_LIMIT,
  S1_CRYPTO_PROFILE,
  M1_PRESENCE_HEARTBEAT_MIN_MS,
  M1_PRESENCE_ONLINE_TTL_MS,
  M1_PRESENCE_RATE_LIMIT,
  M1_PRESENCE_RATE_WINDOW_MS,
  M1_TYPING_MIN_REFRESH_MS,
  M1_TYPING_RATE_LIMIT,
  M1_TYPING_RATE_WINDOW_MS,
  M1_TYPING_TTL_MS,
  type MessageChangeQuery,
  type MessageEditInput,
  type MessageHistoryQuery,
  type MessageReactionInput,
  type MessageReceiptInput,
  type MessageSendInput,
  type NicknameMutationInput,
  type TypingStateInput,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import { queueRealtimeNicknameChanged, queueRealtimeReceiptChanged } from "../realtime/outbox.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import {
  ciphertextDigest,
  protectedContentProjection,
  requireCryptoProtectedWrite,
} from "../crypto/protected-content.ts";

const DAY = 24 * 60 * 60_000;
const IDEMPOTENCY_RETENTION_MS = 7 * DAY;
type MessageMutationCapability =
  | "view_shared_data"
  | "send_message"
  | "reply_message"
  | "edit_message"
  | "delete_message"
  | "react_message";

interface LockedMessagingContext {
  readonly transaction: QueryExecutor;
  readonly now: Date;
  readonly lifecycle: LockedPartnershipLifecycle;
  readonly conversation: LockedConversation;
  readonly message: LockedMessage | null;
}

function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Messaging sequence exceeds safe integer range");
  }
  return Number(value);
}

function addMs(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function lifecycleContext(
  actorAccountId: string,
  lifecycle: LockedPartnershipLifecycle,
  now: Date,
  message: LockedMessage | null,
): CapabilityContext {
  const first = lifecycle.memberIds[0];
  const second = lifecycle.memberIds[1];
  if (!first || !second) throw new Error("Partnership must have exactly two members");

  const partnership: PartnershipState = {
    id: lifecycle.partnershipId,
    members: [first, second],
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
    partnerEligibleAt: {
      [first]: null,
      [second]: null,
    },
  };

  return {
    actor: {
      id: actorAccountId,
      status: lifecycle.accountStatuses[actorAccountId] ?? "deleted",
      nextUsernameChangeEligibleAt: null,
    },
    partnership,
    now: now.toISOString(),
    ...(message
      ? {
          message: {
            id: message.id,
            senderId: message.senderAccountId,
            createdAt: message.createdAt.toISOString(),
            deletedAt: message.deletedAt?.toISOString() ?? null,
            serverSequence: safeNumber(message.serverSequence),
          },
        }
      : {}),
  };
}

export class MessagingService {
  readonly database: DatabasePool;
  readonly keys: AuthKeyRing;
  readonly mediaBindingEnabled: boolean;

  constructor(database: DatabasePool, keys: AuthKeyRing, mediaBindingEnabled = true) {
    this.database = database;
    this.keys = keys;
    this.mediaBindingEnabled = mediaBindingEnabled;
  }

  #capabilityError(reason: string | null, messageScoped: boolean): ApiError {
    if (reason === "MESSAGE_NOT_OWNED") return new ApiError(403, reason);
    if (reason === "MESSAGE_DELETED") return new ApiError(409, reason);
    if (reason === "MESSAGE_EDIT_WINDOW_EXPIRED") return new ApiError(409, reason);
    if (reason === "PRE_BREAKUP_MESSAGE_LOCKED") return new ApiError(409, reason);
    if (reason === "ACCOUNT_LOCKED" || reason === "PARTNERSHIP_TERMINATED") {
      return new ApiError(409, reason);
    }
    return new ApiError(404, messageScoped ? "MESSAGE_NOT_FOUND" : "CONVERSATION_NOT_FOUND");
  }

  async #withConversation<T>(
    auth: AuthContext,
    conversationId: string,
    capability: MessageMutationCapability | null,
    messageId: string | null,
    work: (context: LockedMessagingContext) => Promise<T>,
  ): Promise<T> {
    const participants = await loadConversationParticipants(this.database.pool, conversationId);
    if (
      !participants ||
      participants.memberIds.length !== 2 ||
      !participants.memberIds.includes(auth.session.accountId)
    ) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND");
    }

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const accounts = await lockAccounts(transaction, participants.memberIds);
      if (accounts.length !== 2) throw new ApiError(404, "CONVERSATION_NOT_FOUND");

      const lifecycle = await lockPartnershipLifecycle(transaction, participants.partnershipId);
      if (
        !lifecycle ||
        lifecycle.lifecycleState === "terminated" ||
        !lifecycle.memberIds.includes(auth.session.accountId)
      ) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND");
      }

      const conversation = await lockConversationForMutation(transaction, conversationId);
      if (!conversation || conversation.partnershipId !== lifecycle.partnershipId) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND");
      }

      const message = messageId
        ? await lockMessageForMutation(transaction, conversationId, messageId)
        : null;
      if (messageId && !message) throw new ApiError(404, "MESSAGE_NOT_FOUND");

      if (capability !== null) {
        this.#assertCapability(auth, lifecycle, now, message, capability, messageId !== null);
      }

      return work({
        transaction,
        now,
        lifecycle,
        conversation,
        message,
      });
    });
  }

  #assertCapability(
    auth: AuthContext,
    lifecycle: LockedPartnershipLifecycle,
    now: Date,
    message: LockedMessage | null,
    capability: MessageMutationCapability,
    messageScoped: boolean,
  ): void {
    const decision = evaluateCapability(
      capability as CapabilityName,
      lifecycleContext(auth.session.accountId, lifecycle, now, message),
    );
    if (decision.allowed) return;
    if (capability === "view_shared_data") {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND");
    }
    throw this.#capabilityError(decision.reason, messageScoped);
  }

  #privateFingerprintPayload(action: string, fields: Record<string, unknown>): string {
    return JSON.stringify({
      v: 1,
      action,
      ...fields,
    });
  }

  async #reservePrivateMutation(
    transaction: QueryExecutor,
    input: {
      readonly accountId: string;
      readonly scope: string;
      readonly idempotencyKey: string;
      readonly payload: string;
      readonly now: Date;
    },
  ): Promise<LifecycleIdempotencyRecord> {
    const active = this.keys.activeVerifier("message-request-fingerprint", input.payload);
    const record = await reserveLifecycleIdempotency(transaction, {
      id: randomUUID(),
      accountId: input.accountId,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      fingerprint: active.value,
      fingerprintVersion: active.version,
      createdAt: input.now,
    });

    if (!record.fingerprint || record.fingerprintVersion === null) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    }

    let expected: Buffer;
    try {
      expected = this.keys.verifier(
        "message-request-fingerprint",
        input.payload,
        record.fingerprintVersion,
      );
    } catch {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    }

    if (!this.keys.safeEqual(record.fingerprint, expected)) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
    }
    return record;
  }

  async #completePrivateMutation(
    transaction: QueryExecutor,
    record: LifecycleIdempotencyRecord,
    responseBody: unknown,
    now: Date,
  ): Promise<void> {
    if (!record.fingerprint) throw new Error("M1 idempotency fingerprint missing");
    await completeLifecycleIdempotency(transaction, {
      id: record.id,
      fingerprint: record.fingerprint,
      responseStatus: 200,
      responseBody,
      expiresAt: addMs(now, IDEMPOTENCY_RETENTION_MS),
    });
  }

  async #consumeInteractionRateLimit(
    accountId: string,
    scope: string,
    limit: number,
    windowMs: number,
  ): Promise<void> {
    const decision = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      return consumeRateLimitBuckets(
        transaction,
        this.keys.versions.map((version) => ({
          scope,
          keyVersion: version,
          keyHash: this.keys.verifier("rate-limit-key", "m1\0" + scope + "\0" + accountId, version),
          windowMs,
          limit,
          blockMs: windowMs,
        })),
        now,
      );
    });

    if (!decision.allowed) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "RATE_LIMITED",
        Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)),
      );
    }
  }

  #protectedEnvelopeProjection(
    record: ProtectedContentKeyRecord,
    accountId: string,
  ): unknown {
    return protectedContentProjection(record, accountId);
  }

  async #projectMessageRows(
    transaction: QueryExecutor,
    rows: readonly MessageProjectionRowModel[],
    conversationId: string,
    accountId: string,
  ): Promise<readonly unknown[]> {
    const contentKeyIds = new Set<string>();
    for (const row of rows) {
      if (row.protectedBody) contentKeyIds.add(row.protectedBody.contentKeyId);
      if (row.replyContext?.protectedBody) {
        contentKeyIds.add(row.replyContext.protectedBody.contentKeyId);
      }
      for (const reaction of row.reactions) {
        if (reaction.contentKeyId) contentKeyIds.add(reaction.contentKeyId);
      }
    }
    const keys = await loadProtectedContentKeys(transaction, [...contentKeyIds]);
    const requireKey = (contentKeyId: string): ProtectedContentKeyRecord => {
      const record = keys.get(contentKeyId);
      if (!record) throw new Error("Protected content key metadata is missing");
      return record;
    };

    return rows.map((row) => ({
      messageId: row.messageId,
      conversationId,
      senderAccountId: row.senderAccountId,
      senderDeviceId: row.senderDeviceId,
      serverSequence: safeNumber(row.serverSequence),
      contentVersion: safeNumber(row.contentVersion),
      lastChangeSequence: safeNumber(row.lastChangeSequence),
      replyToMessageId: row.replyToMessageId,
      replyContext: row.replyContext
        ? {
            messageId: row.replyContext.messageId,
            senderAccountId: row.replyContext.senderAccountId,
            body: row.replyContext.body,
            protectedBody: row.replyContext.protectedBody
              ? {
                  ciphertext: row.replyContext.protectedBody.ciphertext.toString("base64url"),
                  envelope: this.#protectedEnvelopeProjection(
                    requireKey(row.replyContext.protectedBody.contentKeyId),
                    accountId,
                  ),
                }
              : null,
            deleted: row.replyContext.deleted,
          }
        : null,
      body: row.body,
      protectedBody: row.protectedBody
        ? {
            ciphertext: row.protectedBody.ciphertext.toString("base64url"),
            envelope: this.#protectedEnvelopeProjection(
              requireKey(row.protectedBody.contentKeyId),
              accountId,
            ),
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      reactions: row.reactions.map((reaction) => ({
        reactionId: reaction.reactionId,
        accountId: reaction.accountId,
        emoji: reaction.emoji,
        protectedReaction:
          reaction.encryptedReaction && reaction.contentKeyId
            ? {
                ciphertext: reaction.encryptedReaction.toString("base64url"),
                envelope: this.#protectedEnvelopeProjection(
                  requireKey(reaction.contentKeyId),
                  accountId,
                ),
              }
            : null,
      })),
      attachments: row.attachments,
    }));
  }

  async current(auth: AuthContext): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const row = await loadCurrentConversationReadModel(transaction, auth.session.accountId, now);
      if (!row) return { conversation: null };

      const nicknameKeyIds = [
        row.self.nicknameContentKeyId,
        row.partner.nicknameContentKeyId,
      ].filter((value): value is string => value !== null);
      const nicknameKeys = await loadProtectedContentKeys(transaction, nicknameKeyIds);
      const nicknameProjection = (
        ciphertext: Buffer | null,
        contentKeyId: string | null,
      ): unknown => {
        if (!ciphertext || !contentKeyId) return null;
        const record = nicknameKeys.get(contentKeyId);
        if (!record) throw new Error("Nickname protected-content metadata is missing");
        return {
          ciphertext: ciphertext.toString("base64url"),
          envelope: this.#protectedEnvelopeProjection(record, auth.session.accountId),
        };
      };

      const interactionMode = row.accountDeletionViewOnly
        ? "account_deletion_view_only"
        : row.lifecycleState === "breakup_pending"
          ? "breakup_restricted"
          : "normal";
      const writable = !row.accountDeletionViewOnly;

      return {
        conversation: {
          conversationId: row.conversationId,
          partnershipId: row.partnershipId,
          lifecycleState: row.lifecycleState,
          interactionMode,
          latestServerSequence: safeNumber(row.latestServerSequence),
          latestChangeSequence: safeNumber(row.latestChangeSequence),
          breakup:
            row.lifecycleState === "breakup_pending"
              ? {
                  initiatedAt: row.breakupInitiatedAt?.toISOString() ?? null,
                  messageFreezeSequence:
                    row.messageFreezeSequence === null
                      ? null
                      : safeNumber(row.messageFreezeSequence),
                }
              : null,
          self: {
            accountId: row.self.accountId,
            username: row.self.username,
            displayName: row.self.displayName,
            nickname: row.self.nickname,
            protectedNickname: nicknameProjection(
              row.self.nicknameCiphertext,
              row.self.nicknameContentKeyId,
            ),
            nicknameVersion: safeNumber(row.self.nicknameVersion),
          },
          partner: {
            accountId: row.partner.accountId,
            username: row.partner.username,
            displayName: row.partner.displayName,
            nickname: row.partner.nickname,
            protectedNickname: nicknameProjection(
              row.partner.nicknameCiphertext,
              row.partner.nicknameContentKeyId,
            ),
            nicknameVersion: safeNumber(row.partner.nicknameVersion),
            presence: {
              online: Boolean(
                row.partner.onlineUntil && row.partner.onlineUntil.getTime() > now.getTime(),
              ),
              lastSeenAt: row.partner.lastSeenAt?.toISOString() ?? null,
            },
            typing: Boolean(
              row.partner.typingUntil && row.partner.typingUntil.getTime() > now.getTime(),
            ),
          },
          receipts: {
            selfDeliveredThrough: safeNumber(row.self.deliveredThrough),
            selfReadThrough: safeNumber(row.self.readThrough),
            partnerDeliveredThrough: safeNumber(row.partner.deliveredThrough),
            partnerReadThrough: safeNumber(row.partner.readThrough),
          },
          capabilities: {
            sendMessage: writable,
            changeNickname: writable,
            typing: writable,
            viewMessages: true,
          },
        },
      };
    });
  }

  async listMessages(
    auth: AuthContext,
    conversationId: string,
    input: MessageHistoryQuery,
  ): Promise<unknown> {
    return this.#withConversation(
      auth,
      conversationId,
      "view_shared_data",
      null,
      async ({ transaction, conversation }) => {
        const requested = input.limit;
        const rows = await listConversationMessages(transaction, {
          conversationId,
          beforeSequence: input.beforeSequence === undefined ? null : BigInt(input.beforeSequence),
          afterSequence: input.afterSequence === undefined ? null : BigInt(input.afterSequence),
          limit: requested + 1,
        });
        const hasMore = rows.length > requested;
        const visible =
          input.afterSequence === undefined && hasMore
            ? rows.slice(rows.length - requested)
            : rows.slice(0, requested);
        const items = await this.#projectMessageRows(
          transaction,
          visible,
          conversationId,
          auth.session.accountId,
        );

        return {
          items,
          hasMore,
          oldestSequence: visible[0] ? safeNumber(visible[0].serverSequence) : null,
          newestSequence: visible.at(-1) ? safeNumber(visible.at(-1)!.serverSequence) : null,
          latestServerSequence: safeNumber(conversation.nextServerSequence - 1n),
        };
      },
    );
  }

  async listChanges(
    auth: AuthContext,
    conversationId: string,
    input: MessageChangeQuery,
  ): Promise<unknown> {
    return this.#withConversation(
      auth,
      conversationId,
      "view_shared_data",
      null,
      async ({ transaction, conversation }) => {
        const requested = Math.min(input.limit, M1_CHANGE_MAX_LIMIT);
        const rows = await listConversationChanges(
          transaction,
          conversationId,
          BigInt(input.afterChangeSequence),
          requested + 1,
        );
        const visible = rows.slice(0, requested);
        return {
          items: visible.map((row) => ({
            changeSequence: safeNumber(row.changeSequence),
            type: row.changeType,
            messageId: row.messageId,
            contentVersion: row.contentVersion === null ? null : safeNumber(row.contentVersion),
            changedAt: row.createdAt.toISOString(),
          })),
          latestChangeSequence: safeNumber(conversation.nextChangeSequence - 1n),
          hasMore: rows.length > requested,
        };
      },
    );
  }

  async send(
    auth: AuthContext,
    conversationId: string,
    input: MessageSendInput,
    idempotencyKey: string,
  ): Promise<unknown> {
    const messageId = input.messageId ?? randomUUID();
    const payload = this.#privateFingerprintPayload("message.send", {
      conversationId,
      messageId,
      body: input.body,
      protectedBody: input.protectedBody,
      replyToMessageId: input.replyToMessageId,
      attachments: [...input.attachments]
        .sort((left, right) => left.position - right.position)
        .map((attachment) => ({
          mediaId: attachment.mediaId,
          role: attachment.role,
          position: attachment.position,
        })),
    });

    return this.#withConversation(
      auth,
      conversationId,
      null,
      null,
      async ({ transaction, now, lifecycle, conversation }) => {
        const existing = await findMessageByIdempotencyKey(transaction, {
          conversationId,
          senderAccountId: auth.session.accountId,
          idempotencyKey,
        });
        if (existing) {
          if (existing.requestFingerprint === null || existing.requestFingerprintVersion === null) {
            throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
          }
          let expected: Buffer;
          try {
            expected = this.keys.verifier(
              "message-request-fingerprint",
              payload,
              existing.requestFingerprintVersion,
            );
          } catch {
            throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
          }
          if (!this.keys.safeEqual(existing.requestFingerprint, expected)) {
            throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED");
          }
          return {
            messageId: existing.id,
            serverSequence: safeNumber(existing.serverSequence),
            contentVersion: 1,
            changeSequence: safeNumber(existing.createdChangeSequence),
            createdAt: existing.createdAt.toISOString(),
          };
        }

        this.#assertCapability(
          auth,
          lifecycle,
          now,
          null,
          input.replyToMessageId ? "reply_message" : "send_message",
          false,
        );

        if (input.attachments.length > 0) {
          if (!this.mediaBindingEnabled) throw new ApiError(503, "MEDIA_BINDING_DISABLED");
          this.#assertCapability(
            auth,
            lifecycle,
            now,
            null,
            "send_media" as MessageMutationCapability,
            false,
          );
        }

        if (
          input.replyToMessageId &&
          !(await messageExistsInConversation(transaction, conversationId, input.replyToMessageId))
        ) {
          throw new ApiError(404, "MESSAGE_NOT_FOUND");
        }

        const policy = await loadPartnershipCryptoPolicy(
          transaction,
          conversation.partnershipId,
        );
        if (policy?.cryptoRequiredFrom && input.body !== null) {
          throw new ApiError(409, "CRYPTO_REQUIRED");
        }

        const protectedCiphertext = input.protectedBody
          ? Buffer.from(input.protectedBody.ciphertext, "base64url")
          : null;
        if (input.protectedBody && protectedCiphertext) {
          await requireCryptoProtectedWrite(
            transaction,
            auth,
            {
              partnershipId: conversation.partnershipId,
              contentType: "message",
              contentId: messageId,
              contentVersion: 1n,
              payloadRole: "message_body",
              schemaVersion: 1,
              ciphertextSha256: ciphertextDigest(protectedCiphertext),
              at: now,
            },
            input.protectedBody.envelope,
          );
        }

        const mediaIds = input.attachments.map((attachment) => attachment.mediaId);
        if (new Set(mediaIds).size !== mediaIds.length) {
          throw new ApiError(400, "MEDIA_BINDING_INVALID");
        }
        const lockedMedia = await lockMediaObjectsForBinding(
          transaction,
          conversation.partnershipId,
          auth.session.accountId,
          [...mediaIds].sort(),
        );
        if (lockedMedia.length !== mediaIds.length) {
          throw new ApiError(404, "MEDIA_NOT_FOUND");
        }
        const mediaById = new Map(lockedMedia.map((media) => [media.id, media]));
        for (const attachment of input.attachments) {
          const media = mediaById.get(attachment.mediaId);
          if (!media || media.state !== "ready_unbound" || media.deletedAt !== null) {
            throw new ApiError(409, "MEDIA_NOT_READY");
          }
          if (!mediaRoleAllowed(media.mediaKind, attachment.role)) {
            throw new ApiError(400, "MEDIA_BINDING_INVALID");
          }
          if (
            policy?.cryptoRequiredFrom &&
            (media.cryptoProtocolVersion !== S1_CRYPTO_PROFILE || !media.contentKeyId)
          ) {
            throw new ApiError(409, "CRYPTO_REQUIRED");
          }
        }

        const fingerprint = this.keys.activeVerifier("message-request-fingerprint", payload);
        const sequences = await allocateMessageAndChangeSequence(transaction, conversationId);

        await insertMessage(transaction, {
          id: messageId,
          conversationId,
          partnershipId: conversation.partnershipId,
          senderAccountId: auth.session.accountId,
          senderDeviceId: auth.session.deviceId,
          replyToMessageId: input.replyToMessageId,
          idempotencyKey,
          requestFingerprint: fingerprint.value,
          requestFingerprintVersion: fingerprint.version,
          serverSequence: sequences.serverSequence,
          changeSequence: sequences.changeSequence,
          body: input.body,
          ciphertext: protectedCiphertext,
          ciphertextVersion: input.protectedBody ? S1_CRYPTO_PROFILE : null,
          bodyContentKeyId: input.protectedBody?.envelope.contentKeyId ?? null,
          createdAt: now,
        });
        for (const attachment of [...input.attachments].sort(
          (left, right) => left.position - right.position,
        )) {
          const bound = await bindMediaObject(transaction, {
            mediaId: attachment.mediaId,
            bindingType: "message",
            bindingId: messageId,
            bindingRole: attachment.role,
            position: attachment.position,
          });
          if (!bound) throw new ApiError(409, "MEDIA_ALREADY_BOUND");
        }
        await insertConversationChange(transaction, {
          conversationId,
          changeSequence: sequences.changeSequence,
          changeType: "message.created",
          messageId,
          contentVersion: 1n,
          createdAt: now,
        });
        await this.#queueInvalidation(transaction, {
          conversationId,
          messageId,
          type: "message.created",
          serverSequence: sequences.serverSequence,
          changeSequence: sequences.changeSequence,
          contentVersion: 1n,
        });

        return {
          messageId,
          serverSequence: safeNumber(sequences.serverSequence),
          contentVersion: 1,
          changeSequence: safeNumber(sequences.changeSequence),
          createdAt: now.toISOString(),
        };
      },
    );
  }

  async #queueInvalidation(
    transaction: QueryExecutor,
    input: {
      readonly conversationId: string;
      readonly messageId: string;
      readonly type:
        "message.created" | "message.updated" | "message.deleted" | "message.reaction_changed";
      readonly serverSequence?: bigint;
      readonly changeSequence: bigint;
      readonly contentVersion: bigint | null;
    },
  ): Promise<void> {
    await insertOutboxEvent(transaction, {
      id: randomUUID(),
      eventType: input.type,
      aggregateType: "conversation",
      aggregateId: input.conversationId,
      deduplicationKey: "m1-change:" + input.conversationId + ":" + input.changeSequence.toString(),
      payload: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        ...(input.serverSequence === undefined
          ? {}
          : { serverSequence: safeNumber(input.serverSequence) }),
        changeSequence: safeNumber(input.changeSequence),
        contentVersion: input.contentVersion === null ? null : safeNumber(input.contentVersion),
      },
      payloadVersion: 1,
    });
  }

  async edit(
    auth: AuthContext,
    conversationId: string,
    messageId: string,
    input: MessageEditInput,
    idempotencyKey: string,
  ): Promise<unknown> {
    const payload = this.#privateFingerprintPayload("message.edit", {
      conversationId,
      messageId,
      body: input.body,
      protectedBody: input.protectedBody,
      expectedContentVersion: input.expectedContentVersion,
    });

    return this.#withConversation(
      auth,
      conversationId,
      null,
      messageId,
      async ({ transaction, now, lifecycle, conversation, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.edit",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) return reservation.responseBody;

        this.#assertCapability(auth, lifecycle, now, message, "edit_message", true);

        const boundMedia = await listBoundMediaForContainer(transaction, "message", messageId);
        if (boundMedia.some((media) => media.bindingRole === "voice_message")) {
          throw new ApiError(409, "VOICE_MESSAGE_NOT_EDITABLE");
        }

        if (message.contentVersion !== BigInt(input.expectedContentVersion)) {
          throw new ApiError(409, "VERSION_CONFLICT");
        }

        const policy = await loadPartnershipCryptoPolicy(
          transaction,
          conversation.partnershipId,
        );
        if (policy?.cryptoRequiredFrom && input.body !== null) {
          throw new ApiError(409, "CRYPTO_REQUIRED");
        }

        const nextContentVersion = message.contentVersion + 1n;
        const protectedCiphertext = input.protectedBody
          ? Buffer.from(input.protectedBody.ciphertext, "base64url")
          : null;
        if (input.protectedBody && protectedCiphertext) {
          await requireCryptoProtectedWrite(
            transaction,
            auth,
            {
              partnershipId: conversation.partnershipId,
              contentType: "message",
              contentId: messageId,
              contentVersion: nextContentVersion,
              payloadRole: "message_body",
              schemaVersion: 1,
              ciphertextSha256: ciphertextDigest(protectedCiphertext),
              at: now,
            },
            input.protectedBody.envelope,
          );
        }

        const previousContentKeyId = message.bodyContentKeyId;
        const changeSequence = await allocateChangeSequence(transaction, conversationId);
        const nextVersion = await updateMessageBody(transaction, {
          messageId,
          expectedContentVersion: message.contentVersion,
          body: input.body,
          ciphertext: protectedCiphertext,
          ciphertextVersion: input.protectedBody ? S1_CRYPTO_PROFILE : null,
          bodyContentKeyId: input.protectedBody?.envelope.contentKeyId ?? null,
          changeSequence,
          editedAt: now,
        });
        if (nextVersion === null) throw new ApiError(409, "VERSION_CONFLICT");
        if (
          previousContentKeyId &&
          previousContentKeyId !== input.protectedBody?.envelope.contentKeyId
        ) {
          await deleteProtectedContentKey(transaction, previousContentKeyId);
        }

        await insertConversationChange(transaction, {
          conversationId,
          changeSequence,
          changeType: "message.updated",
          messageId,
          contentVersion: nextVersion,
          createdAt: now,
        });
        await this.#queueInvalidation(transaction, {
          conversationId,
          messageId,
          type: "message.updated",
          changeSequence,
          contentVersion: nextVersion,
        });

        const response = {
          messageId,
          contentVersion: safeNumber(nextVersion),
          changeSequence: safeNumber(changeSequence),
          editedAt: now.toISOString(),
        };
        await this.#completePrivateMutation(transaction, reservation, response, now);
        return response;
      },
    );
  }

  async delete(
    auth: AuthContext,
    conversationId: string,
    messageId: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    const payload = this.#privateFingerprintPayload("message.delete", {
      conversationId,
      messageId,
    });

    return this.#withConversation(
      auth,
      conversationId,
      null,
      messageId,
      async ({ transaction, now, lifecycle, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.delete",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) return reservation.responseBody;

        this.#assertCapability(auth, lifecycle, now, message, "delete_message", true);

        const mediaToDelete = await markBoundMediaDeletionPending(
          transaction,
          "message",
          messageId,
          now,
        );
        for (const media of mediaToDelete) {
          await insertScheduledAction(transaction, {
            id: randomUUID(),
            actionType: "m3.media_delete",
            aggregateType: "media_object",
            aggregateId: media.mediaId,
            executeAt: now,
            expectedGeneration: media.generation,
            deduplicationKey: "m3-media-delete:" + media.mediaId + ":g:" + media.generation,
            payload: {},
            payloadVersion: 1,
          });
        }

        const changeSequence = await allocateChangeSequence(transaction, conversationId);
        const nextVersion = await tombstoneMessage(transaction, {
          messageId,
          changeSequence,
          deletedAt: now,
        });
        if (nextVersion === null) throw new ApiError(409, "MESSAGE_DELETED");

        await insertConversationChange(transaction, {
          conversationId,
          changeSequence,
          changeType: "message.deleted",
          messageId,
          contentVersion: nextVersion,
          createdAt: now,
        });
        await this.#queueInvalidation(transaction, {
          conversationId,
          messageId,
          type: "message.deleted",
          changeSequence,
          contentVersion: nextVersion,
        });

        const response = {
          messageId,
          changeSequence: safeNumber(changeSequence),
          deletedAt: now.toISOString(),
        };
        await this.#completePrivateMutation(transaction, reservation, response, now);
        return response;
      },
    );
  }

  async setReaction(
    auth: AuthContext,
    conversationId: string,
    messageId: string,
    input: MessageReactionInput,
    idempotencyKey: string,
  ): Promise<unknown> {
    const reactionId = input.reactionId ?? randomUUID();
    const payload = this.#privateFingerprintPayload("message.reaction.set", {
      conversationId,
      messageId,
      reactionId,
      emoji: input.emoji,
      protectedReaction: input.protectedReaction,
    });

    return this.#withConversation(
      auth,
      conversationId,
      null,
      messageId,
      async ({ transaction, now, lifecycle, conversation, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.reaction.set",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) return reservation.responseBody;

        this.#assertCapability(auth, lifecycle, now, message, "react_message", true);

        const policy = await loadPartnershipCryptoPolicy(
          transaction,
          conversation.partnershipId,
        );
        if (policy?.cryptoRequiredFrom && input.emoji !== null) {
          throw new ApiError(409, "CRYPTO_REQUIRED");
        }

        const previousContentKeyId = await loadActiveMessageReactionContentKeyId(
          transaction,
          messageId,
          auth.session.accountId,
        );
        const changeSequence = await allocateChangeSequence(transaction, conversationId);

        let protectedReaction: unknown = null;
        if (input.protectedReaction) {
          const ciphertext = Buffer.from(input.protectedReaction.ciphertext, "base64url");
          await requireCryptoProtectedWrite(
            transaction,
            auth,
            {
              partnershipId: conversation.partnershipId,
              contentType: "message_reaction",
              contentId: reactionId,
              contentVersion: 1n,
              payloadRole: "reaction_value",
              schemaVersion: 1,
              ciphertextSha256: ciphertextDigest(ciphertext),
              at: now,
            },
            input.protectedReaction.envelope,
          );
          await setProtectedMessageReaction(transaction, {
            id: reactionId,
            messageId,
            partnershipId: conversation.partnershipId,
            accountId: auth.session.accountId,
            ciphertext,
            ciphertextVersion: S1_CRYPTO_PROFILE,
            contentKeyId: input.protectedReaction.envelope.contentKeyId,
            changeSequence,
            at: now,
          });
          const key = (
            await loadProtectedContentKeys(transaction, [
              input.protectedReaction.envelope.contentKeyId,
            ])
          ).get(input.protectedReaction.envelope.contentKeyId);
          if (!key) throw new Error("Protected reaction key metadata disappeared");
          protectedReaction = {
            ciphertext: input.protectedReaction.ciphertext,
            envelope: this.#protectedEnvelopeProjection(key, auth.session.accountId),
          };
        } else {
          if (input.emoji === null) throw new ApiError(400, "VALIDATION_FAILED");
          await setMessageReaction(transaction, {
            id: reactionId,
            messageId,
            partnershipId: conversation.partnershipId,
            accountId: auth.session.accountId,
            emoji: input.emoji,
            changeSequence,
            at: now,
          });
        }

        if (
          previousContentKeyId &&
          previousContentKeyId !== input.protectedReaction?.envelope.contentKeyId
        ) {
          await deleteProtectedContentKey(transaction, previousContentKeyId);
        }

        await insertConversationChange(transaction, {
          conversationId,
          changeSequence,
          changeType: "message.reaction_changed",
          messageId,
          contentVersion: message.contentVersion,
          createdAt: now,
        });
        await this.#queueInvalidation(transaction, {
          conversationId,
          messageId,
          type: "message.reaction_changed",
          changeSequence,
          contentVersion: message.contentVersion,
        });

        const response = {
          messageId,
          changeSequence: safeNumber(changeSequence),
          reaction: {
            reactionId,
            accountId: auth.session.accountId,
            emoji: input.emoji,
            protectedReaction,
          },
        };
        await this.#completePrivateMutation(transaction, reservation, response, now);
        return response;
      },
    );
  }

  async removeReaction(
    auth: AuthContext,
    conversationId: string,
    messageId: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    const payload = this.#privateFingerprintPayload("message.reaction.remove", {
      conversationId,
      messageId,
    });

    return this.#withConversation(
      auth,
      conversationId,
      null,
      messageId,
      async ({ transaction, now, lifecycle, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.reaction.remove",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) return reservation.responseBody;

        this.#assertCapability(auth, lifecycle, now, message, "react_message", true);

        const previousContentKeyId = await loadActiveMessageReactionContentKeyId(
          transaction,
          messageId,
          auth.session.accountId,
        );
        const exists = await hasActiveMessageReaction(
          transaction,
          messageId,
          auth.session.accountId,
        );
        if (!exists) {
          const stored = {
            messageId,
            changeSequence: safeNumber(message.lastChangeSequence),
            reaction: null,
          };
          await this.#completePrivateMutation(transaction, reservation, stored, now);
          return stored;
        }

        const changeSequence = await allocateChangeSequence(transaction, conversationId);
        const removed = await removeMessageReaction(
          transaction,
          messageId,
          auth.session.accountId,
          changeSequence,
        );
        if (!removed) throw new Error("Active reaction disappeared while message lock was held");
        if (previousContentKeyId) {
          await deleteProtectedContentKey(transaction, previousContentKeyId);
        }

        await insertConversationChange(transaction, {
          conversationId,
          changeSequence,
          changeType: "message.reaction_changed",
          messageId,
          contentVersion: message.contentVersion,
          createdAt: now,
        });
        await this.#queueInvalidation(transaction, {
          conversationId,
          messageId,
          type: "message.reaction_changed",
          changeSequence,
          contentVersion: message.contentVersion,
        });

        const stored = {
          messageId,
          changeSequence: safeNumber(changeSequence),
          reaction: null,
        };
        await this.#completePrivateMutation(transaction, reservation, stored, now);
        return stored;
      },
    );
  }

  async receipt(
    auth: AuthContext,
    conversationId: string,
    input: MessageReceiptInput,
  ): Promise<unknown> {
    return this.#withConversation(
      auth,
      conversationId,
      "view_shared_data",
      null,
      async ({ transaction, now, conversation }) => {
        const latest = conversation.nextServerSequence - 1n;
        const requested = BigInt(input.throughSequence);
        if (requested > latest) throw new ApiError(409, "RECEIPT_SEQUENCE_AHEAD");

        const receipt = await upsertConversationReceipt(transaction, {
          conversationId,
          partnershipId: conversation.partnershipId,
          accountId: auth.session.accountId,
          type: input.type,
          throughSequence: requested,
          at: now,
        });
        await queueRealtimeReceiptChanged(transaction, {
          conversationId,
          deliveredThrough: receipt.deliveredThrough,
          readThrough: receipt.readThrough,
        });
        return {
          deliveredThrough: safeNumber(receipt.deliveredThrough),
          readThrough: safeNumber(receipt.readThrough),
        };
      },
    );
  }

  async typing(
    auth: AuthContext,
    conversationId: string,
    input: TypingStateInput,
  ): Promise<unknown> {
    await this.#consumeInteractionRateLimit(
      auth.session.accountId,
      "m1.typing",
      M1_TYPING_RATE_LIMIT,
      M1_TYPING_RATE_WINDOW_MS,
    );

    return this.#withConversation(
      auth,
      conversationId,
      "send_message",
      null,
      async ({ transaction, now, conversation }) => {
        const expiresAt = addMs(now, M1_TYPING_TTL_MS);
        const stored = await setConversationTypingState(transaction, {
          conversationId,
          partnershipId: conversation.partnershipId,
          accountId: auth.session.accountId,
          typing: input.typing,
          at: now,
          expiresAt,
          minRefreshBefore: addMs(now, -M1_TYPING_MIN_REFRESH_MS),
        });
        return {
          typing: input.typing && stored !== null && stored.getTime() > now.getTime(),
          expiresAt: stored?.toISOString() ?? null,
        };
      },
    );
  }

  async presence(auth: AuthContext): Promise<unknown> {
    await this.#consumeInteractionRateLimit(
      auth.session.accountId,
      "m1.presence",
      M1_PRESENCE_RATE_LIMIT,
      M1_PRESENCE_RATE_WINDOW_MS,
    );

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const conversation = await loadCurrentConversationReadModel(
        transaction,
        auth.session.accountId,
        now,
      );
      const snapshot = await heartbeatPresence(transaction, {
        accountId: auth.session.accountId,
        at: now,
        onlineUntil: addMs(now, M1_PRESENCE_ONLINE_TTL_MS),
        minRefreshBefore: addMs(now, -M1_PRESENCE_HEARTBEAT_MIN_MS),
        forceRefreshAfter: conversation?.activatedAt ?? null,
      });
      return {
        online: snapshot.onlineUntil.getTime() > now.getTime(),
        lastSeenAt: snapshot.lastSeenAt.toISOString(),
        onlineUntil: snapshot.onlineUntil.toISOString(),
      };
    });
  }

  async nickname(
    auth: AuthContext,
    partnershipId: string,
    subjectAccountId: string,
    input: NicknameMutationInput,
    idempotencyKey: string,
  ): Promise<unknown> {
    const memberIds = await loadPartnershipMemberIds(this.database.pool, partnershipId);
    if (
      memberIds.length !== 2 ||
      !memberIds.includes(auth.session.accountId) ||
      !memberIds.includes(subjectAccountId)
    ) {
      throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
    }

    const payload = this.#privateFingerprintPayload("partnership.nickname", {
      partnershipId,
      subjectAccountId,
      nickname: input.nickname,
      protectedNickname: input.protectedNickname,
      expectedVersion: input.expectedVersion,
    });

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const locked = await lockAccounts(transaction, memberIds);
      if (locked.length !== 2) throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      const lifecycle = await lockPartnershipLifecycle(transaction, partnershipId);
      if (!lifecycle || !lifecycle.memberIds.includes(auth.session.accountId)) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }

      const reservation = await this.#reservePrivateMutation(transaction, {
        accountId: auth.session.accountId,
        scope: "m1.partnership.nickname",
        idempotencyKey,
        payload,
        now,
      });
      if (reservation.responseStatus !== null) return reservation.responseBody;

      const nicknameDecision = evaluateCapability(
        "change_nickname",
        lifecycleContext(auth.session.accountId, lifecycle, now, null),
      );
      if (!nicknameDecision.allowed) {
        throw new ApiError(409, nicknameDecision.reason ?? "PARTNERSHIP_UNAVAILABLE");
      }

      const policy = await loadPartnershipCryptoPolicy(transaction, partnershipId);
      if (policy?.cryptoRequiredFrom && input.nickname !== null) {
        throw new ApiError(409, "CRYPTO_REQUIRED");
      }

      const previousContentKeyId = await loadPartnershipNicknameContentKeyId(
        transaction,
        partnershipId,
        subjectAccountId,
      );
      let protectedNickname: unknown = null;
      let version: bigint | null;

      if (input.protectedNickname) {
        const ciphertext = Buffer.from(input.protectedNickname.ciphertext, "base64url");
        const nextVersion = BigInt(input.expectedVersion) + 1n;
        await requireCryptoProtectedWrite(
          transaction,
          auth,
          {
            partnershipId,
            contentType: "partnership_nickname",
            contentId: subjectAccountId,
            contentVersion: nextVersion,
            payloadRole: "nickname_value",
            schemaVersion: 1,
            ciphertextSha256: ciphertextDigest(ciphertext),
            at: now,
          },
          input.protectedNickname.envelope,
        );
        version = await updateProtectedPartnershipNickname(transaction, {
          partnershipId,
          subjectAccountId,
          actorAccountId: auth.session.accountId,
          ciphertext,
          ciphertextVersion: S1_CRYPTO_PROFILE,
          contentKeyId: input.protectedNickname.envelope.contentKeyId,
          expectedVersion: BigInt(input.expectedVersion),
          at: now,
        });
        if (version === null) throw new ApiError(409, "VERSION_CONFLICT");
        const key = (
          await loadProtectedContentKeys(transaction, [
            input.protectedNickname.envelope.contentKeyId,
          ])
        ).get(input.protectedNickname.envelope.contentKeyId);
        if (!key) throw new Error("Protected nickname key metadata disappeared");
        protectedNickname = {
          ciphertext: input.protectedNickname.ciphertext,
          envelope: this.#protectedEnvelopeProjection(key, auth.session.accountId),
        };
      } else if (policy?.cryptoRequiredFrom) {
        version = await updateProtectedPartnershipNickname(transaction, {
          partnershipId,
          subjectAccountId,
          actorAccountId: auth.session.accountId,
          ciphertext: null,
          ciphertextVersion: null,
          contentKeyId: null,
          expectedVersion: BigInt(input.expectedVersion),
          at: now,
        });
      } else {
        version = await updatePartnershipNickname(transaction, {
          partnershipId,
          subjectAccountId,
          actorAccountId: auth.session.accountId,
          nickname: input.nickname,
          expectedVersion: BigInt(input.expectedVersion),
          at: now,
        });
      }
      if (version === null) throw new ApiError(409, "VERSION_CONFLICT");

      if (
        previousContentKeyId &&
        previousContentKeyId !== input.protectedNickname?.envelope.contentKeyId
      ) {
        await deleteProtectedContentKey(transaction, previousContentKeyId);
      }

      const response = {
        partnershipId,
        accountId: subjectAccountId,
        version: safeNumber(version),
        updatedAt: now.toISOString(),
        nickname: input.nickname,
        protectedNickname,
      };
      await queueRealtimeNicknameChanged(transaction, {
        partnershipId,
        subjectAccountId,
        version,
      });
      await this.#completePrivateMutation(transaction, reservation, response, now);
      return response;
    });
  }

  async message(auth: AuthContext, conversationId: string, messageId: string): Promise<unknown> {
    return this.#withConversation(
      auth,
      conversationId,
      "view_shared_data",
      null,
      async ({ transaction }) => {
        const row = await loadMessageProjection(transaction, conversationId, messageId);
        if (!row) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const [projected] = await this.#projectMessageRows(
          transaction,
          [row],
          conversationId,
          auth.session.accountId,
        );
        return projected;
      },
    );
  }
}
