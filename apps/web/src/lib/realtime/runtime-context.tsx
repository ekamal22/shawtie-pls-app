import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { M2RealtimeServerFrame } from "@shawtie/contracts";
import {
  ShawtieLocalDatabase,
  requestPersistentLocalStorage,
  type ChatQueueOperation,
  type RelationshipQueueOperation,
} from "../offline/local-db.ts";
import { M2ReplayEngine } from "../offline/replay-engine.ts";
import { RealtimeClient, type RealtimeScope } from "./realtime-client.ts";
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
    );
    this.coordinator.register(
      "offline-replay",
      async () => this.replay.replay(),
      "replay",
    );
  }

  async start(): Promise<void> {
    if (!this.#databasePromise) {
      this.#databasePromise = ShawtieLocalDatabase.open(this.accountId);
    }
    await Promise.all([
      this.#databasePromise,
      requestPersistentLocalStorage(),
    ]);
    this.realtime.start();
  }

  async stop(): Promise<void> {
    this.realtime.stop();
    const database = await this.#databasePromise?.catch(() => null);
    database?.close();
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
    const operation = await this.replay.enqueueRelationshipCreate(
      body,
      idempotencyKey,
    );
    void this.coordinator.requestSync();
    return operation;
  }

  async queueRelationshipPatch(
    itemId: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<RelationshipQueueOperation> {
    const operation = await this.replay.enqueueRelationshipPatch(
      itemId,
      body,
      idempotencyKey,
    );
    void this.coordinator.requestSync();
    return operation;
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

  async #scopeChanged(
    previous: RealtimeScope,
    next: RealtimeScope,
  ): Promise<void> {
    const database = await this.database();
    if (
      previous.partnershipId &&
      previous.partnershipId !== next.partnershipId
    ) {
      await database.purgePartnership(previous.partnershipId);
      dispatch("shawtie:partnership-changed");
    }
    if (next.partnershipId && next.conversationId) {
      await database.rememberNamespace(
        next.partnershipId,
        next.conversationId,
      );
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

export function M2RuntimeProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const runtime = useMemo(() => new M2Runtime(accountId), [accountId]);

  useEffect(() => {
    activeRuntime = runtime;
    void runtime.start();
    return () => {
      if (activeRuntime === runtime) activeRuntime = null;
      void runtime.stop();
    };
  }, [runtime]);

  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function useM2Runtime(): M2Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("M2RuntimeProvider is required");
  return runtime;
}

export function useM2SyncStatus(): SyncStatus {
  const runtime = useM2Runtime();
  const [status, setStatus] = useState<SyncStatus>(
    runtime.coordinator.status,
  );
  useEffect(
    () => runtime.coordinator.subscribe(setStatus),
    [runtime],
  );
  return status;
}
