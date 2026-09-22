import { randomUUID } from "node:crypto";
import {
  M2_REALTIME_MAX_FRAME_BYTES,
  M2_REALTIME_PROTOCOL_VERSION,
  assertM2RealtimeFrameSize,
  m2RealtimeClientFrameSchema,
  m2RealtimeServerFrameSchema,
  type M2InternalRealtimeNotification,
  type M2RealtimeClientFrame,
  type M2RealtimeServerFrame,
} from "@shawtie/contracts";
import {
  getClockTimestamp,
  getCurrentPartnershipForAccount,
  loadCurrentConversationReadModel,
  type DatabasePool,
} from "@shawtie/db";
import type { RawData, WebSocket } from "ws";
import type { AuthContext } from "../../plugins/authentication.ts";
import { authenticateSessionToken } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";

const MAX_BUFFERED_BYTES = 64 * 1024;
const PING_INTERVAL_MS = 30_000;
const STALE_PONG_MS = 90_000;
const SESSION_REVALIDATE_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 15_000;
const MAX_PROTOCOL_ERRORS = 3;
const CLIENT_FRAME_WINDOW_MS = 60_000;
const MAX_CLIENT_FRAMES_PER_WINDOW = 240;

export interface RealtimeConnectionContext {
  readonly connectionId: string;
  readonly auth: AuthContext;
  readonly accountId: string;
  readonly deviceId: string | null;
  readonly partnershipId: string | null;
  readonly conversationId: string | null;
}

export type RealtimeClientFrameHandler = (
  connection: RealtimeConnectionContext,
  frame: M2RealtimeClientFrame,
) => Promise<void>;

interface ConnectionState extends RealtimeConnectionContext {
  readonly socket: WebSocket;
  lastPongAt: number;
  lastPingAt: number;
  lastPingNonce: string | null;
  lastSessionValidationAt: number;
  protocolErrors: number;
  frameWindowStartedAt: number;
  frameWindowCount: number;
  initialized: boolean;
  revalidating: boolean;
}

interface ScopeSnapshot {
  readonly partnershipId: string | null;
  readonly conversationId: string | null;
  readonly partnershipGeneration: number | null;
  readonly latestServerSequence: number;
  readonly latestChangeSequence: number;
  readonly serverTime: Date;
}

function safeNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Realtime sequence exceeds safe integer range");
  }
  return number;
}

function sameIdentity(a: ScopeSnapshot, connection: ConnectionState): boolean {
  return (
    a.partnershipId === connection.partnershipId &&
    a.conversationId === connection.conversationId
  );
}

export class RealtimeHub {
  readonly #connections = new Map<string, ConnectionState>();
  readonly #byAccount = new Map<string, Set<string>>();
  readonly #byPartnership = new Map<string, Set<string>>();
  readonly #byConversation = new Map<string, Set<string>>();
  readonly #maintenance: ReturnType<typeof setInterval>;

  constructor(
    private readonly database: DatabasePool,
    private readonly keys: AuthKeyRing,
    private readonly handleTransientFrame: RealtimeClientFrameHandler,
  ) {
    this.#maintenance = setInterval(() => {
      void this.#runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);
    this.#maintenance.unref?.();
  }

  accept(socket: WebSocket, auth: AuthContext): void {
    const state: ConnectionState = {
      connectionId: randomUUID(),
      socket,
      auth,
      accountId: auth.session.accountId,
      deviceId: auth.session.deviceId,
      partnershipId: null,
      conversationId: null,
      lastPongAt: Date.now(),
      lastPingAt: 0,
      lastPingNonce: null,
      lastSessionValidationAt: Date.now(),
      protocolErrors: 0,
      frameWindowStartedAt: Date.now(),
      frameWindowCount: 0,
      initialized: false,
      revalidating: false,
    };

    this.#connections.set(state.connectionId, state);
    this.#addIndex(this.#byAccount, state.accountId, state.connectionId);

    socket.on("message", (data, isBinary) => {
      void this.#onMessage(state, data, isBinary);
    });
    socket.on("close", () => this.#remove(state));
    socket.on("error", () => this.#remove(state));

    void this.#initialize(state);
  }

  dispatch(notification: M2InternalRealtimeNotification): void {
    switch (notification.kind) {
      case "message.changed":
        this.#sendTo(
          this.#byConversation.get(notification.scope.conversationId),
          {
            v: M2_REALTIME_PROTOCOL_VERSION,
            type: "message.changed",
            payload: notification.data,
          },
        );
        return;
      case "conversation.receipt_changed":
        this.#sendTo(this.#byConversation.get(notification.scope.conversationId), {
          v: M2_REALTIME_PROTOCOL_VERSION,
          type: "conversation.receipt_changed",
          payload: notification.data,
        });
        return;
      case "conversation.nickname_changed":
        this.#sendTo(this.#byPartnership.get(notification.scope.partnershipId), {
          v: M2_REALTIME_PROTOCOL_VERSION,
          type: "conversation.nickname_changed",
          payload: notification.data,
        });
        return;
      case "partnership.changed": {
        const ids = this.#byPartnership.get(notification.scope.partnershipId);
        this.#sendTo(ids, {
          v: M2_REALTIME_PROTOCOL_VERSION,
          type: "partnership.changed",
          payload: notification.data,
        });
        if (ids) {
          for (const id of ids) {
            const connection = this.#connections.get(id);
            if (connection) void this.#revalidate(connection);
          }
        }
        return;
      }
      case "relationship.changed":
        this.#sendTo(this.#byPartnership.get(notification.scope.partnershipId), {
          v: M2_REALTIME_PROTOCOL_VERSION,
          type: "relationship.changed",
          payload: notification.data,
        });
        return;
      case "account.security_changed": {
        const ids = this.#byAccount.get(notification.scope.accountId);
        this.#sendTo(ids, {
          v: M2_REALTIME_PROTOCOL_VERSION,
          type: "account.security_changed",
          payload: notification.data,
        });
        if (ids) {
          for (const id of ids) {
            const connection = this.#connections.get(id);
            if (connection) void this.#revalidate(connection);
          }
        }
        return;
      }
      case "presence.changed":
        this.#sendTo(
          this.#byPartnership.get(notification.scope.partnershipId),
          {
            v: M2_REALTIME_PROTOCOL_VERSION,
            type: "presence.changed",
            payload: { online: notification.data.online },
          },
          notification.data.actorAccountId,
        );
        return;
      case "typing.changed":
        this.#sendTo(
          this.#byConversation.get(notification.scope.conversationId),
          {
            v: M2_REALTIME_PROTOCOL_VERSION,
            type: "typing.changed",
            payload: {
              typing: notification.data.typing,
              expiresAt: notification.data.expiresAt,
            },
          },
          notification.data.actorAccountId,
        );
    }
  }

  requestResyncAll(reason: "listener_reset" | "anti_entropy" | "unknown_state"): void {
    for (const connection of this.#connections.values()) {
      if (!connection.initialized) continue;
      this.#send(connection, {
        v: M2_REALTIME_PROTOCOL_VERSION,
        type: "control.resync_required",
        payload: { scope: "account", reason },
      });
    }
  }

  close(): void {
    clearInterval(this.#maintenance);
    for (const connection of [...this.#connections.values()]) {
      try {
        connection.socket.close(1001, "Server shutdown");
      } finally {
        this.#remove(connection);
      }
    }
  }

  async #initialize(connection: ConnectionState): Promise<void> {
    try {
      const scope = await this.#loadScope(connection.accountId);
      if (!this.#connections.has(connection.connectionId)) return;

      (connection as { partnershipId: string | null }).partnershipId = scope.partnershipId;
      (connection as { conversationId: string | null }).conversationId = scope.conversationId;
      if (scope.partnershipId) {
        this.#addIndex(this.#byPartnership, scope.partnershipId, connection.connectionId);
      }
      if (scope.conversationId) {
        this.#addIndex(this.#byConversation, scope.conversationId, connection.connectionId);
      }

      connection.initialized = true;
      this.#send(connection, {
        v: M2_REALTIME_PROTOCOL_VERSION,
        type: "control.ready",
        payload: {
          connectionId: connection.connectionId,
          serverTime: scope.serverTime.toISOString(),
          accountId: connection.accountId,
          partnershipId: scope.partnershipId,
          conversationId: scope.conversationId,
          partnershipGeneration: scope.partnershipGeneration,
          latestServerSequence: scope.latestServerSequence,
          latestChangeSequence: scope.latestChangeSequence,
        },
      });
    } catch {
      this.#close(connection, 1011, "Initialization failed");
    }
  }

  async #loadScope(accountId: string): Promise<ScopeSnapshot> {
    const serverTime = await getClockTimestamp(this.database.pool);
    const partnership = await getCurrentPartnershipForAccount(this.database.pool, accountId);
    const conversation = await loadCurrentConversationReadModel(
      this.database.pool,
      accountId,
      serverTime,
    );

    if (!partnership || !conversation) {
      return {
        partnershipId: null,
        conversationId: null,
        partnershipGeneration: null,
        latestServerSequence: 0,
        latestChangeSequence: 0,
        serverTime,
      };
    }
    if (partnership.partnershipId !== conversation.partnershipId) {
      throw new Error("Realtime partnership/conversation scope mismatch");
    }

    return {
      partnershipId: partnership.partnershipId,
      conversationId: conversation.conversationId,
      partnershipGeneration: safeNumber(partnership.generation),
      latestServerSequence: safeNumber(conversation.latestServerSequence),
      latestChangeSequence: safeNumber(conversation.latestChangeSequence),
      serverTime,
    };
  }

  async #onMessage(connection: ConnectionState, data: RawData, isBinary: boolean): Promise<void> {
    if (!this.#connections.has(connection.connectionId)) return;
    if (isBinary) {
      this.#close(connection, 1003, "Text frames required");
      return;
    }
    const text = data.toString();
    if (Buffer.byteLength(text, "utf8") > M2_REALTIME_MAX_FRAME_BYTES) {
      this.#close(connection, 1009, "Frame too large");
      return;
    }
    if (!connection.initialized) {
      this.#close(connection, 1008, "Connection not ready");
      return;
    }

    const now = Date.now();
    if (now - connection.frameWindowStartedAt >= CLIENT_FRAME_WINDOW_MS) {
      connection.frameWindowStartedAt = now;
      connection.frameWindowCount = 0;
    }
    connection.frameWindowCount += 1;
    if (connection.frameWindowCount > MAX_CLIENT_FRAMES_PER_WINDOW) {
      this.#close(connection, 1008, "Rate limited");
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.#protocolError(connection);
      return;
    }
    const parsed = m2RealtimeClientFrameSchema.safeParse(raw);
    if (!parsed.success) {
      this.#protocolError(connection);
      return;
    }

    if (parsed.data.type === "control.pong") {
      if (parsed.data.payload.nonce === connection.lastPingNonce) {
        connection.lastPongAt = Date.now();
        connection.lastPingNonce = null;
      }
      return;
    }

    try {
      await this.handleTransientFrame(connection, parsed.data);
    } catch {
      this.#send(connection, {
        v: M2_REALTIME_PROTOCOL_VERSION,
        type: "control.resync_required",
        payload: { scope: "conversation", reason: "unknown_state" },
      });
    }
  }

  #protocolError(connection: ConnectionState): void {
    connection.protocolErrors += 1;
    if (connection.protocolErrors >= MAX_PROTOCOL_ERRORS) {
      this.#close(connection, 1008, "Protocol violation");
    }
  }

  async #runMaintenance(): Promise<void> {
    const now = Date.now();
    for (const connection of [...this.#connections.values()]) {
      if (!connection.initialized) continue;
      if (now - connection.lastPongAt > STALE_PONG_MS) {
        this.#close(connection, 1001, "Heartbeat timeout");
        continue;
      }
      if (now - connection.lastPingAt >= PING_INTERVAL_MS && connection.lastPingNonce === null) {
        const nonce = randomUUID();
        connection.lastPingAt = now;
        connection.lastPingNonce = nonce;
        this.#send(connection, {
          v: M2_REALTIME_PROTOCOL_VERSION,
          type: "control.ping",
          payload: { nonce },
        });
      }
      if (now - connection.lastSessionValidationAt >= SESSION_REVALIDATE_MS) {
        void this.#revalidate(connection);
      }
    }
  }

  async #revalidate(connection: ConnectionState): Promise<void> {
    if (connection.revalidating || !this.#connections.has(connection.connectionId)) return;
    connection.revalidating = true;
    try {
      const session = await authenticateSessionToken(
        connection.auth.rawToken,
        this.database,
        this.keys,
      );
      if (session.accountId !== connection.accountId || session.deviceId !== connection.deviceId) {
        this.#close(connection, 1008, "Authorization changed");
        return;
      }
      const scope = await this.#loadScope(connection.accountId);
      if (!sameIdentity(scope, connection)) {
        this.#send(connection, {
          v: M2_REALTIME_PROTOCOL_VERSION,
          type: "control.resync_required",
          payload: { scope: "partnership", reason: "scope_changed" },
        });
        this.#close(connection, 1008, "Scope changed");
        return;
      }
      connection.lastSessionValidationAt = Date.now();
    } catch {
      this.#close(connection, 1008, "Authorization expired");
    } finally {
      connection.revalidating = false;
    }
  }

  #sendTo(
    ids: Set<string> | undefined,
    frame: M2RealtimeServerFrame,
    exceptAccountId?: string,
  ): void {
    if (!ids) return;
    for (const id of [...ids]) {
      const connection = this.#connections.get(id);
      if (!connection || connection.accountId === exceptAccountId) continue;
      this.#send(connection, frame);
    }
  }

  #send(connection: ConnectionState, frame: M2RealtimeServerFrame): void {
    if (connection.socket.readyState !== 1) return;
    const parsed = m2RealtimeServerFrameSchema.safeParse(frame);
    if (!parsed.success) {
      this.#close(connection, 1011, "Invalid server frame");
      return;
    }
    try {
      assertM2RealtimeFrameSize(parsed.data);
    } catch {
      this.#close(connection, 1011, "Server frame too large");
      return;
    }
    if (connection.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#close(connection, 1013, "Backpressure");
      return;
    }
    connection.socket.send(JSON.stringify(parsed.data));
  }

  #close(connection: ConnectionState, code: number, reason: string): void {
    if (!this.#connections.has(connection.connectionId)) return;
    try {
      connection.socket.close(code, reason);
    } finally {
      this.#remove(connection);
    }
  }

  #remove(connection: ConnectionState): void {
    if (!this.#connections.delete(connection.connectionId)) return;
    this.#removeIndex(this.#byAccount, connection.accountId, connection.connectionId);
    if (connection.partnershipId) {
      this.#removeIndex(this.#byPartnership, connection.partnershipId, connection.connectionId);
    }
    if (connection.conversationId) {
      this.#removeIndex(this.#byConversation, connection.conversationId, connection.connectionId);
    }
  }

  #addIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    const set = index.get(key) ?? new Set<string>();
    set.add(id);
    index.set(key, set);
  }

  #removeIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    const set = index.get(key);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) index.delete(key);
  }
}
