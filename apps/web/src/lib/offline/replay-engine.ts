import type {
  MessageProjection,
  RelationshipItemProjection,
} from "@shawtie/contracts";
import { ApiClientError, apiRequest } from "../api-client.ts";
import type {
  ChatQueueOperation,
  RelationshipQueueOperation,
  ShawtieLocalDatabase,
} from "./local-db.ts";
import type { RealtimeScope } from "../realtime/realtime-client.ts";

const CLAIM_LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface CurrentConversationAuthority {
  conversation: {
    conversationId: string;
    partnershipId: string;
    capabilities: { sendMessage: boolean };
  } | null;
}

interface RelationshipAuthority {
  space: {
    capabilities: {
      create: boolean;
      edit: boolean;
      delete: boolean;
    };
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function retryDelay(operation: { retryCount: number }, error: ApiClientError | null): number {
  if (error?.status === 429 && error.retryAfterSeconds !== null) {
    return Math.min(MAX_BACKOFF_MS, Math.max(1_000, error.retryAfterSeconds * 1_000));
  }
  return Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(operation.retryCount, 8));
}

function retryable(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

function authenticationFailure(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

function safeRelationshipCreate(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const release = body.release;
  if (
    release !== null &&
    !(
      isRecord(release) &&
      release.mode === "immediate"
    )
  ) {
    return false;
  }
  const references = body.references;
  if (!Array.isArray(references)) return false;
  return references.every(
    (reference) =>
      isRecord(reference) &&
      reference.referenceType === "message",
  );
}

function safeRelationshipPatch(body: unknown): body is Record<string, unknown> {
  return (
    isRecord(body) &&
    !Object.prototype.hasOwnProperty.call(body, "release") &&
    typeof body.expectedVersion === "number" &&
    Number.isSafeInteger(body.expectedVersion) &&
    body.expectedVersion > 0
  );
}

export class M2ReplayEngine {
  readonly #owner = crypto.randomUUID();

  constructor(
    private readonly database: () => Promise<ShawtieLocalDatabase>,
    private readonly scope: () => RealtimeScope,
    private readonly markDirty: (changeSequence?: number) => void,
  ) {}

  async enqueueChat(input: {
    operationType: ChatQueueOperation["operationType"];
    messageId?: string | null;
    requestBody: unknown;
    expectedContentVersion?: number | null;
    idempotencyKey?: string;
  }): Promise<ChatQueueOperation> {
    const scope = this.scope();
    if (!scope.partnershipId || !scope.conversationId) {
      throw new Error("No authoritative conversation namespace");
    }
    const now = Date.now();
    const operation: ChatQueueOperation = {
      operationId: crypto.randomUUID(),
      partnershipId: scope.partnershipId,
      conversationId: scope.conversationId,
      operationType: input.operationType,
      messageId: input.messageId ?? null,
      idempotencyKey: input.idempotencyKey ?? "m2-" + crypto.randomUUID(),
      requestBody: input.requestBody,
      expectedContentVersion: input.expectedContentVersion ?? null,
      queuedAt: now,
      retryCount: 0,
      nextAttemptAt: now,
      status: "queued",
      lastErrorCode: null,
      claimOwner: null,
      claimGeneration: 0,
      claimExpiresAt: null,
    };
    await (await this.database()).enqueueChat(operation);
    window.dispatchEvent(new CustomEvent("shawtie:chat-queue-changed"));
    if (navigator.onLine) {
      this.markDirty();
    }
    return operation;
  }

  async enqueueRelationshipCreate(
    body: unknown,
    idempotencyKey = "m2-" + crypto.randomUUID(),
  ): Promise<RelationshipQueueOperation> {
    if (!safeRelationshipCreate(body)) {
      throw new Error("Relationship create is not eligible for M2 offline replay");
    }
    return this.#enqueueRelationship({
      operationType: "item.create",
      itemId: null,
      requestBody: body,
      expectedVersion: null,
      idempotencyKey,
    });
  }

  async enqueueRelationshipPatch(
    itemId: string,
    body: unknown,
    idempotencyKey = "m2-" + crypto.randomUUID(),
  ): Promise<RelationshipQueueOperation> {
    if (!safeRelationshipPatch(body)) {
      throw new Error("Relationship patch is not eligible for M2 offline replay");
    }
    return this.#enqueueRelationship({
      operationType: "item.patch",
      itemId,
      requestBody: body,
      expectedVersion: Number(body.expectedVersion),
      idempotencyKey,
    });
  }

  async enqueueRelationshipDelete(
    itemId: string,
    expectedVersion: number,
    idempotencyKey = "m2-" + crypto.randomUUID(),
  ): Promise<RelationshipQueueOperation> {
    return this.#enqueueRelationship({
      operationType: "item.delete",
      itemId,
      requestBody: { expectedVersion },
      expectedVersion,
      idempotencyKey,
    });
  }

  async replay(): Promise<void> {
    if (!navigator.onLine) return;

    await apiRequest("/api/v1/auth/session");
    const scope = this.scope();
    if (!scope.partnershipId) return;

    await this.#replayChat(scope);
    await this.#replayRelationship(scope);
  }

  async #enqueueRelationship(input: {
    operationType: RelationshipQueueOperation["operationType"];
    itemId: string | null;
    requestBody: unknown;
    expectedVersion: number | null;
    idempotencyKey: string;
  }): Promise<RelationshipQueueOperation> {
    const scope = this.scope();
    if (!scope.partnershipId) {
      throw new Error("No authoritative relationship namespace");
    }
    const now = Date.now();
    const operation: RelationshipQueueOperation = {
      operationId: crypto.randomUUID(),
      partnershipId: scope.partnershipId,
      itemId: input.itemId,
      operationType: input.operationType,
      idempotencyKey: input.idempotencyKey,
      requestBody: input.requestBody,
      expectedVersion: input.expectedVersion,
      queuedAt: now,
      retryCount: 0,
      nextAttemptAt: now,
      status: "queued",
      lastErrorCode: null,
      claimOwner: null,
      claimGeneration: 0,
      claimExpiresAt: null,
    };
    await (await this.database()).enqueueRelationship(operation);
    window.dispatchEvent(new CustomEvent("shawtie:relationship-queue-changed"));
    if (navigator.onLine) this.markDirty();
    return operation;
  }

  async #replayChat(scope: RealtimeScope): Promise<void> {
    if (!scope.partnershipId || !scope.conversationId) return;
    const authority = await apiRequest<CurrentConversationAuthority>(
      "/api/v1/conversations/current",
    );
    if (
      !authority.conversation ||
      authority.conversation.partnershipId !== scope.partnershipId ||
      authority.conversation.conversationId !== scope.conversationId
    ) {
      return;
    }

    const database = await this.database();
    const queue = await database.listChatQueue(scope.partnershipId);
    for (const queued of queue) {
      if (queued.status === "blocked" || queued.nextAttemptAt > Date.now()) continue;
      if (
        queued.conversationId !== scope.conversationId ||
        (queued.operationType === "message.send" &&
          !authority.conversation.capabilities.sendMessage)
      ) {
        await this.#blockChat(database, queued, "LIFECYCLE_CHANGED");
        continue;
      }

      const claimed = await database.claimChat(
        queued.operationId,
        this.#owner,
        Date.now(),
        CLAIM_LEASE_MS,
      );
      if (!claimed) continue;
      try {
        const message = await this.#executeChat(claimed);
        const completed = message
          ? await database.completeChatWithMessage(
              claimed,
              this.#owner,
              claimed.claimGeneration,
              message,
            )
          : await database.completeChatWithoutProjection(
              claimed,
              this.#owner,
              claimed.claimGeneration,
            );
        if (completed) {
          this.markDirty(message?.lastChangeSequence);
          window.dispatchEvent(new CustomEvent("shawtie:chat-queue-changed"));
        }
      } catch (error) {
        if (authenticationFailure(error)) throw error;
        if (retryable(error)) {
          await this.#retryChat(database, claimed, error);
        } else {
          await this.#blockChat(
            database,
            claimed,
            error instanceof ApiClientError ? error.code : "REPLAY_BLOCKED",
          );
        }
      }
    }
  }

  async #executeChat(operation: ChatQueueOperation): Promise<MessageProjection | null> {
    const base =
      "/api/v1/conversations/" + operation.conversationId;
    let messageId = operation.messageId;

    if (operation.operationType === "message.send") {
      const created = await apiRequest<{ messageId: string }>(
        base + "/messages",
        {
          method: "POST",
          headers: { "idempotency-key": operation.idempotencyKey },
          body: operation.requestBody,
        },
      );
      messageId = created.messageId;
    } else if (!messageId) {
      throw new Error("Queued chat operation has no message ID");
    } else if (operation.operationType === "message.edit") {
      await apiRequest(base + "/messages/" + messageId, {
        method: "PATCH",
        headers: { "idempotency-key": operation.idempotencyKey },
        body: operation.requestBody,
      });
    } else if (operation.operationType === "message.delete") {
      await apiRequest(base + "/messages/" + messageId, {
        method: "DELETE",
        headers: { "idempotency-key": operation.idempotencyKey },
      });
    } else if (operation.operationType === "reaction.set") {
      await apiRequest(base + "/messages/" + messageId + "/reaction", {
        method: "PUT",
        headers: { "idempotency-key": operation.idempotencyKey },
        body: operation.requestBody,
      });
    } else if (operation.operationType === "reaction.remove") {
      await apiRequest(base + "/messages/" + messageId + "/reaction", {
        method: "DELETE",
        headers: { "idempotency-key": operation.idempotencyKey },
      });
    }

    if (!messageId) return null;
    return apiRequest<MessageProjection>(base + "/messages/" + messageId);
  }

  async #replayRelationship(scope: RealtimeScope): Promise<void> {
    if (!scope.partnershipId) return;
    const authority = await apiRequest<RelationshipAuthority>(
      "/api/v1/relationship-space",
    );
    if (!authority.space) return;

    const database = await this.database();
    const queue = await database.listRelationshipQueue(scope.partnershipId);
    for (const queued of queue) {
      if (queued.status === "blocked" || queued.nextAttemptAt > Date.now()) continue;

      const allowed =
        (queued.operationType === "item.create" && authority.space.capabilities.create) ||
        (queued.operationType === "item.patch" && authority.space.capabilities.edit) ||
        (queued.operationType === "item.delete" && authority.space.capabilities.delete);
      if (!allowed) {
        await this.#blockRelationship(database, queued, "RELATIONSHIP_SPACE_VIEW_ONLY");
        continue;
      }

      const claimed = await database.claimRelationship(
        queued.operationId,
        this.#owner,
        Date.now(),
        CLAIM_LEASE_MS,
      );
      if (!claimed) continue;

      try {
        const item = await this.#executeRelationship(claimed);
        const completed = await database.completeRelationship(
          claimed,
          this.#owner,
          claimed.claimGeneration,
          item,
        );
        if (completed) {
          this.markDirty();
          window.dispatchEvent(new CustomEvent("shawtie:relationship-queue-changed"));
        }
      } catch (error) {
        if (authenticationFailure(error)) throw error;
        if (retryable(error)) {
          await this.#retryRelationship(database, claimed, error);
        } else {
          await this.#blockRelationship(
            database,
            claimed,
            error instanceof ApiClientError ? error.code : "REPLAY_BLOCKED",
          );
        }
      }
    }
  }

  async #executeRelationship(
    operation: RelationshipQueueOperation,
  ): Promise<RelationshipItemProjection | null> {
    if (operation.operationType === "item.create") {
      if (!safeRelationshipCreate(operation.requestBody)) {
        throw new Error("Unsafe queued relationship create");
      }
      const created = await apiRequest<{ itemId: string }>(
        "/api/v1/relationship-space/items",
        {
          method: "POST",
          headers: { "idempotency-key": operation.idempotencyKey },
          body: operation.requestBody,
        },
      );
      return apiRequest<RelationshipItemProjection>(
        "/api/v1/relationship-space/items/" + created.itemId,
      );
    }

    if (!operation.itemId) throw new Error("Queued relationship operation has no item ID");

    if (operation.operationType === "item.patch") {
      if (!safeRelationshipPatch(operation.requestBody)) {
        throw new Error("Unsafe queued relationship patch");
      }
      await apiRequest(
        "/api/v1/relationship-space/items/" + operation.itemId,
        {
          method: "PATCH",
          headers: { "idempotency-key": operation.idempotencyKey },
          body: operation.requestBody,
        },
      );
      return apiRequest<RelationshipItemProjection>(
        "/api/v1/relationship-space/items/" + operation.itemId,
      );
    }

    await apiRequest(
      "/api/v1/relationship-space/items/" + operation.itemId,
      {
        method: "DELETE",
        headers: { "idempotency-key": operation.idempotencyKey },
        body: operation.requestBody,
      },
    );
    return null;
  }

  async #retryChat(
    database: ShawtieLocalDatabase,
    operation: ChatQueueOperation,
    error: unknown,
  ): Promise<void> {
    const apiError = error instanceof ApiClientError ? error : null;
    await database.updateChat(
      {
        ...operation,
        retryCount: operation.retryCount + 1,
        nextAttemptAt: Date.now() + retryDelay(operation, apiError),
        status: "retrying",
        lastErrorCode: apiError?.code ?? "NETWORK_ERROR",
        claimOwner: null,
        claimExpiresAt: null,
      },
      this.#owner,
      operation.claimGeneration,
    );
  }

  async #blockChat(
    database: ShawtieLocalDatabase,
    operation: ChatQueueOperation,
    code: string,
  ): Promise<void> {
    const claimed =
      operation.claimOwner === this.#owner
        ? operation
        : await database.claimChat(
            operation.operationId,
            this.#owner,
            Date.now(),
            CLAIM_LEASE_MS,
          );
    if (!claimed) return;
    await database.updateChat(
      {
        ...claimed,
        status: "blocked",
        lastErrorCode: code,
        claimOwner: null,
        claimExpiresAt: null,
      },
      this.#owner,
      claimed.claimGeneration,
    );
    window.dispatchEvent(new CustomEvent("shawtie:chat-queue-changed"));
  }

  async #retryRelationship(
    database: ShawtieLocalDatabase,
    operation: RelationshipQueueOperation,
    error: unknown,
  ): Promise<void> {
    const apiError = error instanceof ApiClientError ? error : null;
    await database.updateRelationship(
      {
        ...operation,
        retryCount: operation.retryCount + 1,
        nextAttemptAt: Date.now() + retryDelay(operation, apiError),
        status: "retrying",
        lastErrorCode: apiError?.code ?? "NETWORK_ERROR",
        claimOwner: null,
        claimExpiresAt: null,
      },
      this.#owner,
      operation.claimGeneration,
    );
  }

  async #blockRelationship(
    database: ShawtieLocalDatabase,
    operation: RelationshipQueueOperation,
    code: string,
  ): Promise<void> {
    const claimed =
      operation.claimOwner === this.#owner
        ? operation
        : await database.claimRelationship(
            operation.operationId,
            this.#owner,
            Date.now(),
            CLAIM_LEASE_MS,
          );
    if (!claimed) return;
    await database.updateRelationship(
      {
        ...claimed,
        status: "blocked",
        lastErrorCode: code,
        claimOwner: null,
        claimExpiresAt: null,
      },
      this.#owner,
      claimed.claimGeneration,
    );
    window.dispatchEvent(new CustomEvent("shawtie:relationship-queue-changed"));
  }
}
