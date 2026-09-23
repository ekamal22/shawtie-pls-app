import {
  C1_REALTIME_SUBPROTOCOL,
  c1RealtimeServerFrameSchema,
  type C1RealtimeServerFrame,
  type M2RealtimeClientFrame,
} from "@shawtie/contracts";
import type { SyncCoordinator } from "./sync-coordinator.ts";

const ANTI_ENTROPY_MS = 60_000;

export interface RealtimeScope {
  readonly partnershipId: string | null;
  readonly conversationId: string | null;
}

export interface RealtimeClientCallbacks {
  onScopeChange(previous: RealtimeScope, next: RealtimeScope): Promise<void> | void;
  onFrame(frame: C1RealtimeServerFrame): Promise<void> | void;
}

export class RealtimeClient {
  #socket: WebSocket | null = null;
  #generation = 0;
  #stopped = true;
  #reconnectAttempt = 0;
  #reconnectTimer: number | null = null;
  #antiEntropyTimer: number | null = null;
  #scope: RealtimeScope = { partnershipId: null, conversationId: null };

  constructor(
    private readonly accountId: string,
    private readonly coordinator: SyncCoordinator,
    private readonly callbacks: RealtimeClientCallbacks,
  ) {}

  get scope(): RealtimeScope {
    return this.#scope;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    window.addEventListener("online", this.#onOnline);
    window.addEventListener("offline", this.#onOffline);
    document.addEventListener("visibilitychange", this.#onVisibility);
    this.#antiEntropyTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      this.coordinator.markDirty();
      void this.coordinator.requestSync();
    }, ANTI_ENTROPY_MS);
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#generation += 1;
    window.removeEventListener("online", this.#onOnline);
    window.removeEventListener("offline", this.#onOffline);
    document.removeEventListener("visibilitychange", this.#onVisibility);
    if (this.#reconnectTimer !== null) {
      window.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#antiEntropyTimer !== null) {
      window.clearInterval(this.#antiEntropyTimer);
      this.#antiEntropyTimer = null;
    }
    const socket = this.#socket;
    this.#socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Client stopped");
    }
  }

  sendPresenceHeartbeat(): boolean {
    return this.#send({
      v: 1,
      type: "presence.heartbeat",
      payload: {},
    });
  }

  sendTyping(typing: boolean): boolean {
    return this.#send({
      v: 1,
      type: "typing.set",
      payload: { typing },
    });
  }

  #connect(): void {
    if (this.#stopped || !navigator.onLine) {
      this.coordinator.markOffline();
      return;
    }
    if (
      this.#socket &&
      (this.#socket.readyState === WebSocket.CONNECTING ||
        this.#socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    const generation = ++this.#generation;
    const url = new URL("/api/v1/realtime", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, C1_REALTIME_SUBPROTOCOL);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      if (generation !== this.#generation || this.#stopped) return;
      this.#reconnectAttempt = 0;
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.#generation || this.#stopped) return;
      void this.#handleMessage(socket, generation, event.data);
    });

    socket.addEventListener("close", () => {
      if (generation !== this.#generation || this.#stopped) return;
      if (this.#socket === socket) this.#socket = null;
      this.coordinator.markOffline();
      this.#scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (generation !== this.#generation || this.#stopped) return;
      if (socket.readyState < WebSocket.CLOSING) socket.close();
    });
  }

  async #handleMessage(socket: WebSocket, generation: number, raw: unknown): Promise<void> {
    if (typeof raw !== "string") {
      socket.close(1003, "Text frames required");
      return;
    }

    let rawFrame: unknown;
    try {
      rawFrame = JSON.parse(raw);
    } catch {
      socket.close(1008, "Invalid JSON");
      return;
    }

    const parsed = c1RealtimeServerFrameSchema.safeParse(rawFrame);
    if (!parsed.success) {
      socket.close(1008, "Invalid realtime frame");
      return;
    }
    if (generation !== this.#generation || this.#stopped) return;

    const frame = parsed.data;

    if (frame.type === "control.ping") {
      this.#send({
        v: 1,
        type: "control.pong",
        payload: { nonce: frame.payload.nonce },
      });
      return;
    }

    if (frame.type === "control.update_required") {
      this.coordinator.markUpdateRequired();
      socket.close(1008, "Update required");
      return;
    }

    if (frame.type === "control.ready") {
      if (frame.payload.accountId !== this.accountId) {
        socket.close(1008, "Account mismatch");
        return;
      }
      const previous = this.#scope;
      const next = {
        partnershipId: frame.payload.partnershipId,
        conversationId: frame.payload.conversationId,
      };
      await this.callbacks.onScopeChange(previous, next);
      if (generation !== this.#generation || this.#stopped) return;
      this.#scope = next;
      this.coordinator.markDirty(frame.payload.latestChangeSequence);
      await this.coordinator.requestSync();
      return;
    }

    if (frame.type === "control.resync_required") {
      this.coordinator.markDirty();
      await this.coordinator.requestSync();
      return;
    }

    if (frame.type === "message.changed") {
      this.coordinator.markDirty(frame.payload.changeSequence);
      await this.callbacks.onFrame(frame);
      await this.coordinator.requestSync();
      return;
    }

    if (frame.type === "call.changed") {
      this.coordinator.markDirty();
      await this.callbacks.onFrame(frame);
      await this.coordinator.requestSync();
      return;
    }

    if (
      frame.type === "partnership.changed" ||
      frame.type === "relationship.changed" ||
      frame.type === "conversation.receipt_changed" ||
      frame.type === "conversation.nickname_changed" ||
      frame.type === "account.security_changed" ||
      frame.type === "namespace.revoked"
    ) {
      this.coordinator.markDirty();
      await this.callbacks.onFrame(frame);
      await this.coordinator.requestSync();
      return;
    }

    await this.callbacks.onFrame(frame);
  }

  #send(frame: M2RealtimeClientFrame): boolean {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer !== null || !navigator.onLine) return;
    const base = Math.min(30_000, 1_000 * 2 ** Math.min(this.#reconnectAttempt, 5));
    const delay = document.visibilityState === "visible" ? base : Math.max(base, 15_000);
    const jitter = Math.floor(Math.random() * Math.min(1_000, Math.max(1, delay / 5)));
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = window.setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay + jitter);
  }

  #onOnline = () => {
    if (this.#stopped) return;
    this.#reconnectAttempt = 0;
    this.#connect();
    this.coordinator.markDirty();
    void this.coordinator.requestSync();
  };

  #onOffline = () => {
    this.coordinator.markOffline();
  };

  #onVisibility = () => {
    if (this.#stopped || document.visibilityState !== "visible") return;
    this.#connect();
    this.coordinator.markDirty();
    void this.coordinator.requestSync();
  };
}
