import { randomUUID } from "node:crypto";
import {
  allocateChangeSequence,
  allocateMessageAndChangeSequence,
  completeLifecycleIdempotency,
  consumeRateLimitBuckets,
  findMessageByIdempotencyKey,
  getTransactionTimestamp,
  heartbeatPresence,
  insertConversationChange,
  insertMessage,
  insertOutboxEvent,
  listConversationChanges,
  listConversationMessages,
  loadConversationParticipants,
  loadCurrentConversationReadModel,
  loadMessageProjection,
  loadPartnershipMemberIds,
  lockAccounts,
  lockConversationForMutation,
  lockMessageForMutation,
  lockPartnershipLifecycle,
  messageExistsInConversation,
  removeMessageReaction,
  reserveLifecycleIdempotency,
  setConversationTypingState,
  setMessageReaction,
  tombstoneMessage,
  updateMessageBody,
  updatePartnershipNickname,
  upsertConversationReceipt,
  withTransaction,
  type DatabasePool,
  type LifecycleIdempotencyRecord,
  type LockedConversation,
  type LockedMessage,
  type LockedPartnershipLifecycle,
  type QueryExecutor,
} from "@shawtie/db";
import {
  MESSAGE_CHANGE_MAX_LIMIT,
  PRESENCE_HEARTBEAT_MIN_MS,
  PRESENCE_ONLINE_TTL_MS,
  TYPING_MIN_REFRESH_MS,
  TYPING_TTL_MS,
  evaluateCapability,
  type CapabilityContext,
  type CapabilityName,
  type PartnershipState,
} from "@shawtie/domain";
import type {
  MessageChangeQuery,
  MessageEditInput,
  MessageHistoryQuery,
  MessageReactionInput,
  MessageReceiptInput,
  MessageSendInput,
  NicknameMutationInput,
  TypingStateInput,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";

const DAY = 24 * 60 * 60_000;
const IDEMPOTENCY_RETENTION_MS = 7 * DAY;
const TYPING_RATE_WINDOW_MS = 60_000;
const TYPING_RATE_LIMIT = 60;
const PRESENCE_RATE_WINDOW_MS = 60_000;
const PRESENCE_RATE_LIMIT = 30;

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

  constructor(database: DatabasePool, keys: AuthKeyRing) {
    this.database = database;
    this.keys = keys;
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
    capability: MessageMutationCapability,
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

      const decision = evaluateCapability(
        capability as CapabilityName,
        lifecycleContext(auth.session.accountId, lifecycle, now, message),
      );
      if (!decision.allowed) {
        if (capability === "view_shared_data") {
          throw new ApiError(404, "CONVERSATION_NOT_FOUND");
        }
        throw this.#capabilityError(decision.reason, messageId !== null);
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
          keyHash: this.keys.verifier(
            "rate-limit-key",
            "m1\0" + scope + "\0" + accountId,
            version,
          ),
          windowMs,
          limit,
          blockMs: windowMs,
        })),
        now,
      );
    });

    if (!decision.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "RATE_LIMITED", Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)));
    }
  }

  async current(auth: AuthContext): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const row = await loadCurrentConversationReadModel(
        transaction,
        auth.session.accountId,
        now,
      );
      if (!row) return { conversation: null };

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
            nicknameVersion: safeNumber(row.self.nicknameVersion),
          },
          partner: {
            accountId: row.partner.accountId,
            username: row.partner.username,
            displayName: row.partner.displayName,
            nickname: row.partner.nickname,
            nicknameVersion: safeNumber(row.partner.nicknameVersion),
            presence: {
              online: Boolean(row.partner.onlineUntil && row.partner.onlineUntil.getTime() > now.getTime()),
              lastSeenAt: row.partner.lastSeenAt?.toISOString() ?? null,
            },
            typing: Boolean(row.partner.typingUntil && row.partner.typingUntil.getTime() > now.getTime()),
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
          beforeSequence:
            input.beforeSequence === undefined ? null : BigInt(input.beforeSequence),
          afterSequence: input.afterSequence === undefined ? null : BigInt(input.afterSequence),
          limit: requested + 1,
        });
        const hasMore = rows.length > requested;
        const visible =
          input.afterSequence === undefined && hasMore
            ? rows.slice(rows.length - requested)
            : rows.slice(0, requested);

        return {
          items: visible.map((row) => ({
            messageId: row.messageId,
            conversationId,
            senderAccountId: row.senderAccountId,
            senderDeviceId: row.senderDeviceId,
            serverSequence: safeNumber(row.serverSequence),
            contentVersion: safeNumber(row.contentVersion),
            lastChangeSequence: safeNumber(row.lastChangeSequence),
            replyToMessageId: row.replyToMessageId,
            replyContext: row.replyContext,
            body: row.body,
            createdAt: row.createdAt.toISOString(),
            editedAt: row.editedAt?.toISOString() ?? null,
            deletedAt: row.deletedAt?.toISOString() ?? null,
            reactions: row.reactions,
          })),
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
        const requested = Math.min(input.limit, MESSAGE_CHANGE_MAX_LIMIT);
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
            contentVersion:
              row.contentVersion === null ? null : safeNumber(row.contentVersion),
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
    const payload = this.#privateFingerprintPayload("message.send", {
      conversationId,
      body: input.body,
      replyToMessageId: input.replyToMessageId,
    });

    return this.#withConversation(
      auth,
      conversationId,
      input.replyToMessageId ? "reply_message" : "send_message",
      null,
      async ({ transaction, now, conversation }) => {
        const existing = await findMessageByIdempotencyKey(transaction, {
          conversationId,
          senderAccountId: auth.session.accountId,
          idempotencyKey,
        });
        if (existing) {
          if (
            existing.requestFingerprint === null ||
            existing.requestFingerprintVersion === null
          ) {
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
            contentVersion: safeNumber(existing.contentVersion),
            changeSequence: safeNumber(existing.lastChangeSequence),
            createdAt: existing.createdAt.toISOString(),
          };
        }

        if (
          input.replyToMessageId &&
          !(await messageExistsInConversation(
            transaction,
            conversationId,
            input.replyToMessageId,
          ))
        ) {
          throw new ApiError(404, "MESSAGE_NOT_FOUND");
        }

        const fingerprint = this.keys.activeVerifier(
          "message-request-fingerprint",
          payload,
        );
        const sequences = await allocateMessageAndChangeSequence(
          transaction,
          conversationId,
        );
        const messageId = randomUUID();

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
          createdAt: now,
        });
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
        | "message.created"
        | "message.updated"
        | "message.deleted"
        | "message.reaction_changed";
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
      deduplicationKey:
        "m1-change:" + input.conversationId + ":" + input.changeSequence.toString(),
      payload: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        ...(input.serverSequence === undefined
          ? {}
          : { serverSequence: safeNumber(input.serverSequence) }),
        changeSequence: safeNumber(input.changeSequence),
        contentVersion:
          input.contentVersion === null ? null : safeNumber(input.contentVersion),
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
      expectedContentVersion: input.expectedContentVersion,
    });

    return this.#withConversation(
      auth,
      conversationId,
      "edit_message",
      messageId,
      async ({ transaction, now, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.edit",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) return reservation.responseBody;

        if (message.contentVersion !== BigInt(input.expectedContentVersion)) {
          throw new ApiError(409, "VERSION_CONFLICT");
        }

        const changeSequence = await allocateChangeSequence(transaction, conversationId);
        const nextVersion = await updateMessageBody(transaction, {
          messageId,
          expectedContentVersion: message.contentVersion,
          body: input.body,
          changeSequence,
          editedAt: now,
        });
        if (nextVersion === null) throw new ApiError(409, "VERSION_CONFLICT");

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
      "delete_message",
      messageId,
      async ({ transaction, now, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.delete",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) return reservation.responseBody;

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
    const payload = this.#privateFingerprintPayload("message.reaction.set", {
      conversationId,
      messageId,
      emoji: input.emoji,
    });

    return this.#withConversation(
      auth,
      conversationId,
      "react_message",
      messageId,
      async ({ transaction, now, conversation, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.reaction.set",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) {
          return {
            ...objectRecord(reservation.responseBody),
            reaction: {
              accountId: auth.session.accountId,
              emoji: input.emoji,
            },
          };
        }

        const changeSequence = await allocateChangeSequence(transaction, conversationId);
        await setMessageReaction(transaction, {
          id: randomUUID(),
          messageId,
          partnershipId: conversation.partnershipId,
          accountId: auth.session.accountId,
          emoji: input.emoji,
          changeSequence,
          at: now,
        });
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
        };
        await this.#completePrivateMutation(transaction, reservation, stored, now);
        return {
          ...stored,
          reaction: {
            accountId: auth.session.accountId,
            emoji: input.emoji,
          },
        };
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
      "react_message",
      messageId,
      async ({ transaction, now, message }) => {
        if (!message) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        const reservation = await this.#reservePrivateMutation(transaction, {
          accountId: auth.session.accountId,
          scope: "m1.message.reaction.remove",
          idempotencyKey,
          payload,
          now,
        });
        if (reservation.responseStatus !== null) {
          return {
            ...objectRecord(reservation.responseBody),
            reaction: null,
          };
        }

        const changeSequence = await allocateChangeSequence(transaction, conversationId);
        const removed = await removeMessageReaction(
          transaction,
          messageId,
          auth.session.accountId,
          changeSequence,
        );
        if (!removed) {
          const stored = {
            messageId,
            changeSequence: safeNumber(message.lastChangeSequence),
          };
          await this.#completePrivateMutation(transaction, reservation, stored, now);
          return { ...stored, reaction: null };
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
        };
        await this.#completePrivateMutation(transaction, reservation, stored, now);
        return { ...stored, reaction: null };
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
      TYPING_RATE_LIMIT,
      TYPING_RATE_WINDOW_MS,
    );

    return this.#withConversation(
      auth,
      conversationId,
      "send_message",
      null,
      async ({ transaction, now, conversation }) => {
        const expiresAt = addMs(now, TYPING_TTL_MS);
        const stored = await setConversationTypingState(transaction, {
          conversationId,
          partnershipId: conversation.partnershipId,
          accountId: auth.session.accountId,
          typing: input.typing,
          at: now,
          expiresAt,
          minRefreshBefore: addMs(now, -TYPING_MIN_REFRESH_MS),
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
      PRESENCE_RATE_LIMIT,
      PRESENCE_RATE_WINDOW_MS,
    );

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const snapshot = await heartbeatPresence(transaction, {
        accountId: auth.session.accountId,
        at: now,
        onlineUntil: addMs(now, PRESENCE_ONLINE_TTL_MS),
        minRefreshBefore: addMs(now, -PRESENCE_HEARTBEAT_MIN_MS),
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

      const decision = evaluateCapability(
        "change_nickname",
        lifecycleContext(auth.session.accountId, lifecycle, now, null),
      );
      if (!decision.allowed) {
        throw new ApiError(409, decision.reason ?? "PARTNERSHIP_UNAVAILABLE");
      }

      const reservation = await this.#reservePrivateMutation(transaction, {
        accountId: auth.session.accountId,
        scope: "m1.partnership.nickname",
        idempotencyKey,
        payload,
        now,
      });
      if (reservation.responseStatus !== null) {
        return {
          ...objectRecord(reservation.responseBody),
          nickname: input.nickname,
        };
      }

      const version = await updatePartnershipNickname(transaction, {
        partnershipId,
        subjectAccountId,
        actorAccountId: auth.session.accountId,
        nickname: input.nickname,
        expectedVersion: BigInt(input.expectedVersion),
        at: now,
      });
      if (version === null) throw new ApiError(409, "VERSION_CONFLICT");

      const stored = {
        partnershipId,
        accountId: subjectAccountId,
        version: safeNumber(version),
        updatedAt: now.toISOString(),
      };
      await this.#completePrivateMutation(transaction, reservation, stored, now);
      return {
        ...stored,
        nickname: input.nickname,
      };
    });
  }

  async message(
    auth: AuthContext,
    conversationId: string,
    messageId: string,
  ): Promise<unknown> {
    return this.#withConversation(
      auth,
      conversationId,
      "view_shared_data",
      null,
      async ({ transaction }) => {
        const row = await loadMessageProjection(transaction, conversationId, messageId);
        if (!row) throw new ApiError(404, "MESSAGE_NOT_FOUND");
        return {
          messageId: row.messageId,
          conversationId,
          senderAccountId: row.senderAccountId,
          senderDeviceId: row.senderDeviceId,
          serverSequence: safeNumber(row.serverSequence),
          contentVersion: safeNumber(row.contentVersion),
          lastChangeSequence: safeNumber(row.lastChangeSequence),
          replyToMessageId: row.replyToMessageId,
          replyContext: row.replyContext,
          body: row.body,
          createdAt: row.createdAt.toISOString(),
          editedAt: row.editedAt?.toISOString() ?? null,
          deletedAt: row.deletedAt?.toISOString() ?? null,
          reactions: row.reactions,
        };
      },
    );
  }
}
