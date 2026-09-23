import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { M2RealtimeServerFrame } from "@shawtie/contracts";
import {
  ShawtieLocalDatabase,
  requestPersistentLocalStorage,
  type ChatQueueOperation,
  type RelationshipQueueOperation,
} from "../offline/local-db.ts";
import { M2ReplayEngine } from "../offline/replay-engine.ts";
import { RealtimeClient, type RealtimeScope } from "./realtime-client.ts";
import { subscribeLocalLogout } from "../offline/account-control.ts";
import {
  activateWaitingM2ServiceWorker,
  hasWaitingM2ServiceWorker,
  registerM2ServiceWorker,
  subscribeM2UpdateWaiting,
} from "../pwa/service-worker-registration.ts";
import {
  SyncCoordinator,
  type Synchronizer,
  type SynchronizerPhase,
  type SyncStatus,
} from "./sync-coordinator.ts";

const RuntimeContext = createContext<M2Runtime | null>(null);
let activeRuntime: M2Runtime | null = null;

function dispatch(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export class M2Runtime {
  readonly coordinator = new SyncCoordinator();
  readonly realtime: RealtimeClient;
  readonly replay: M2ReplayEngine;
  readonly accountId: string;
  #databasePromise: Promise<ShawtieLocalDatabase> | null = null;

  constructor(accountId: string) {
    this.accountId = accountId;
    this.realtime = new RealtimeClient(accountId, this.coordinator, {
      onScopeChange: async (previous, next) => this.#scopeChanged(previous, next),
      onFrame: async (frame) => this.#frame(frame),
    });
    this.replay = new M2ReplayEngine(
      () => this.database(),
      () => this.realtime.scope,
      (changeSequence) => this.coordinator.markDirty(changeSequence),
      () => {
        void this.coordinator.requestSync();
      },
    );
    this.coordinator.register("offline-replay", async () => this.replay.replay(), "replay");
  }

  async start(): Promise<void> {
    if (!this.#databasePromise) {
      this.#databasePromise = ShawtieLocalDatabase.open(this.accountId);
    }
    await Promise.all([
      this.#databasePromise,
      requestPersistentLocalStorage(),
      registerM2ServiceWorker(),
    ]);
    this.realtime.start();
  }

  async stop(): Promise<void> {
    this.realtime.stop();
    this.replay.dispose();
    await this.coordinator.stop();
    const database = await this.#databasePromise?.catch(() => null);
    database?.close();
    this.#databasePromise = null;
  }

  database(): Promise<ShawtieLocalDatabase> {
    if (!this.#databasePromise) {
      this.#databasePromise = ShawtieLocalDatabase.open(this.accountId);
    }
    return this.#databasePromise;
  }

  registerSynchronizer(
    name: string,
    synchronizer: Synchronizer,
    phase: SynchronizerPhase = "reconcile",
  ): () => void {
    return this.coordinator.register(name, synchronizer, phase);
  }

  async queueChat(input: {
    operationType: ChatQueueOperation["operationType"];
    messageId?: string | null;
    requestBody: unknown;
    expectedContentVersion?: number | null;
    idempotencyKey?: string;
  }): Promise<ChatQueueOperation> {
    const operation = await this.replay.enqueueChat(input);
    void this.coordinator.requestSync();
    return operation;
  }

  async queueRelationshipCreate(
    body: unknown,
    idempotencyKey?: string,
  ): Promise<RelationshipQueueOperation> {
    const operation = await this.replay.enqueueRelationshipCreate(body, idempotencyKey);
    void this.coordinator.requestSync();
    return operation;
  }

  async queueRelationshipPatch(
    itemId: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<RelationshipQueueOperation> {
    const operation = await this.replay.enqueueRelationshipPatch(itemId, body, idempotencyKey);
    void this.coordinator.requestSync();
    return operation;
  }

  async retryQueuedOperation(kind: "chat" | "relationship", operationId: string): Promise<void> {
    const database = await this.database();
    const retried =
      kind === "chat"
        ? await database.retryChatOperation(operationId)
        : await database.retryRelationshipOperation(operationId);
    if (!retried) return;
    dispatch(kind === "chat" ? "shawtie:chat-queue-changed" : "shawtie:relationship-queue-changed");
    this.coordinator.markDirty();
    void this.coordinator.requestSync();
  }

  async discardQueuedOperation(kind: "chat" | "relationship", operationId: string): Promise<void> {
    const database = await this.database();
    if (kind === "chat") {
      await database.discardChatOperation(operationId);
      dispatch("shawtie:chat-queue-changed");
    } else {
      await database.discardRelationshipOperation(operationId);
      dispatch("shawtie:relationship-queue-changed");
    }
  }

  async queueRelationshipDelete(
    itemId: string,
    expectedVersion: number,
    idempotencyKey?: string,
  ): Promise<RelationshipQueueOperation> {
    const operation = await this.replay.enqueueRelationshipDelete(
      itemId,
      expectedVersion,
      idempotencyKey,
    );
    void this.coordinator.requestSync();
    return operation;
  }

  sendPresenceHeartbeat(): boolean {
    return this.realtime.sendPresenceHeartbeat();
  }

  sendTyping(typing: boolean): boolean {
    return this.realtime.sendTyping(typing);
  }

  async #scopeChanged(previous: RealtimeScope, next: RealtimeScope): Promise<void> {
    const database = await this.database();
    if (previous.partnershipId && previous.partnershipId !== next.partnershipId) {
      await database.purgePartnership(previous.partnershipId);
      dispatch("shawtie:partnership-changed");
    }
    if (next.partnershipId && next.conversationId) {
      await database.rememberNamespace(next.partnershipId, next.conversationId);
    }
  }

  async #frame(frame: M2RealtimeServerFrame): Promise<void> {
    switch (frame.type) {
      case "partnership.changed":
        dispatch("shawtie:partnership-changed", frame.payload);
        return;
      case "relationship.changed":
        dispatch("shawtie:relationship-changed", frame.payload);
        return;
      case "message.changed":
      case "conversation.receipt_changed":
      case "conversation.nickname_changed":
        dispatch("shawtie:message-changed", frame.payload);
        return;
      case "presence.changed":
        dispatch("shawtie:presence-changed", frame.payload);
        return;
      case "typing.changed":
        dispatch("shawtie:typing-changed", frame.payload);
        return;
      case "namespace.revoked": {
        const database = await this.database();
        await database.purgePartnership(frame.payload.partnershipId);
        dispatch("shawtie:partnership-changed");
        return;
      }
      case "account.security_changed":
        dispatch("shawtie:security-changed");
        return;
      default:
        return;
    }
  }
}

export function getActiveM2Runtime(): M2Runtime | null {
  return activeRuntime;
}

export async function closeActiveM2Runtime(accountId: string): Promise<void> {
  const runtime = activeRuntime;
  if (!runtime || runtime.accountId !== accountId) return;
  activeRuntime = null;
  await runtime.stop();
}

export function M2RuntimeProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const runtime = useMemo(() => new M2Runtime(accountId), [accountId]);

  useEffect(() => {
    const updateRequired = () => runtime.coordinator.markUpdateRequired();
    window.addEventListener("shawtie:update-required", updateRequired);
    activeRuntime = runtime;
    void runtime.start();
    const unsubscribeLogout = subscribeLocalLogout(accountId, () => {
      void runtime.stop().finally(() => {
        window.dispatchEvent(new CustomEvent("shawtie:local-logout", { detail: accountId }));
      });
    });
    return () => {
      window.removeEventListener("shawtie:update-required", updateRequired);
      unsubscribeLogout();
      if (activeRuntime === runtime) activeRuntime = null;
      void runtime.stop();
    };
  }, [accountId, runtime]);

  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useM2Runtime(): M2Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("M2RuntimeProvider is required");
  return runtime;
}

export function useM2SyncStatus(): SyncStatus {
  const runtime = useM2Runtime();
  const [status, setStatus] = useState<SyncStatus>(runtime.coordinator.status);
  useEffect(() => runtime.coordinator.subscribe(setStatus), [runtime]);
  return status;
}

function attemptedText(value: unknown): string | null {
  if (
    value !== null &&
    typeof value === "object" &&
    "body" in value &&
    typeof value.body === "string"
  ) {
    return value.body;
  }
  return null;
}

export function M2QueueStatus() {
  const runtime = useM2Runtime();
  const syncStatus = useM2SyncStatus();
  const [chat, setChat] = useState<ChatQueueOperation[]>([]);
  const [relationship, setRelationship] = useState<RelationshipQueueOperation[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const partnershipId = runtime.realtime.scope.partnershipId;
      if (!partnershipId) {
        if (!cancelled) {
          setChat([]);
          setRelationship([]);
        }
        return;
      }
      const database = await runtime.database();
      const [chatQueue, relationshipQueue] = await Promise.all([
        database.listChatQueue(partnershipId),
        database.listRelationshipQueue(partnershipId),
      ]);
      if (!cancelled) {
        setChat(chatQueue);
        setRelationship(relationshipQueue);
      }
    };

    void load();
    const refresh = () => void load();
    window.addEventListener("shawtie:chat-queue-changed", refresh);
    window.addEventListener("shawtie:relationship-queue-changed", refresh);
    window.addEventListener("shawtie:partnership-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("shawtie:chat-queue-changed", refresh);
      window.removeEventListener("shawtie:relationship-queue-changed", refresh);
      window.removeEventListener("shawtie:partnership-changed", refresh);
    };
  }, [runtime, syncStatus]);

  const blockedChat = chat.filter((operation) => operation.status === "blocked");
  const blockedRelationship = relationship.filter((operation) => operation.status === "blocked");
  const pendingCount =
    chat.filter((operation) => operation.status !== "blocked").length +
    relationship.filter((operation) => operation.status !== "blocked").length;

  if (blockedChat.length === 0 && blockedRelationship.length === 0 && pendingCount === 0) {
    return null;
  }

  return (
    <section className="panel">
      <h2>Offline changes</h2>
      {pendingCount > 0 ? (
        <p className="hint">
          {pendingCount} change{pendingCount === 1 ? "" : "s"} waiting to sync.
        </p>
      ) : null}

      {[
        ...blockedChat.map((operation) => ({ kind: "chat" as const, operation })),
        ...blockedRelationship.map((operation) => ({
          kind: "relationship" as const,
          operation,
        })),
      ].map(({ kind, operation }) => {
        const text = kind === "chat" ? attemptedText(operation.requestBody) : null;
        return (
          <article className="device" key={kind + ":" + operation.operationId}>
            <div className="stack">
              <strong>{operation.operationType}</strong>
              <span className="hint">{operation.lastErrorCode ?? "Server authority changed."}</span>
              {text ? (
                <p className="muted">Attempted text is still stored locally: {text}</p>
              ) : null}
            </div>
            <div className="row">
              <button
                className="secondary compact"
                onClick={() => void runtime.retryQueuedOperation(kind, operation.operationId)}
              >
                Retry
              </button>
              <button
                className="danger compact"
                onClick={() => void runtime.discardQueuedOperation(kind, operation.operationId)}
              >
                Discard
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function M2UpdateBanner() {
  const runtime = useM2Runtime();
  const status = useM2SyncStatus();
  const [waiting, setWaiting] = useState(hasWaitingM2ServiceWorker());

  useEffect(
    () =>
      subscribeM2UpdateWaiting(() => {
        setWaiting(true);
      }),
    [],
  );

  if (!waiting && status !== "update-required") return null;

  return (
    <section className="panel">
      <h2>App update available</h2>
      <p className="hint">
        Offline replay is paused while the app switches to a compatible version.
      </p>
      <button
        className="primary"
        onClick={() => {
          if (!activateWaitingM2ServiceWorker(runtime.coordinator)) {
            window.location.reload();
          }
        }}
      >
        Update and reload
      </button>
    </section>
  );
}
