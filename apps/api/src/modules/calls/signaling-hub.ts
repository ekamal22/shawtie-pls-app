import { randomUUID } from "node:crypto";
import {
  C1_SIGNALING_MAX_CANDIDATES,
  C1_SIGNALING_MAX_FRAME_BYTES,
  C1_SIGNALING_PROTOCOL_VERSION,
  C1_SIGNALING_SUBPROTOCOL,
  C2_SIGNALING_MAX_CANDIDATES,
  C2_SIGNALING_MAX_FRAME_BYTES,
  C2_SIGNALING_PROTOCOL_VERSION,
  C2_SIGNALING_SUBPROTOCOL,
  c1SignalClientFrameSchema,
  c1SignalServerFrameSchema,
  c2SignalClientFrameSchema,
  c2SignalServerFrameSchema,
} from "@shawtie/contracts";
import { loadCallEndpointAuthorization, type DatabasePool } from "@shawtie/db";
import type { RawData, WebSocket } from "ws";
import type { AuthContext } from "../../plugins/authentication.ts";
import { authenticateSessionToken } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";
import {
  validateCallDescription,
  validateCallRelayCandidate,
  validateVideoCallDescription,
} from "./signaling-validation.ts";

const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_FRAMES_PER_MINUTE = 360;
const REVALIDATE_MS = 30_000;

type CallKind = "voice" | "video";
type CallProtocol = typeof C1_SIGNALING_SUBPROTOCOL | typeof C2_SIGNALING_SUBPROTOCOL;

interface EndpointAuthorization {
  readonly partnershipId: string;
  readonly kind: CallKind;
  readonly role: "caller" | "callee";
  readonly protocol: CallProtocol;
}

interface ConnectionState {
  readonly id: string;
  readonly key: string;
  readonly callId: string;
  readonly socket: WebSocket;
  readonly auth: AuthContext;
  readonly deviceId: string;
  readonly kind: CallKind;
  readonly protocol: CallProtocol;
  readonly role: "caller" | "callee";
  readonly generation: number;
  candidateCount: number;
  frameWindowStartedAt: number;
  frameWindowCount: number;
  lastValidatedAt: number;
  revalidationPromise: Promise<boolean> | null;
}

interface PendingSignal {
  readonly fromRole: "caller" | "callee";
  readonly fromKey: string;
  readonly fromGeneration: number;
  readonly protocol: CallProtocol;
  readonly frame: unknown;
}

function frameBytes(frame: unknown): number {
  return new TextEncoder().encode(JSON.stringify(frame)).byteLength;
}

function protocolVersion(state: ConnectionState): 1 | 2 {
  return state.protocol === C2_SIGNALING_SUBPROTOCOL
    ? C2_SIGNALING_PROTOCOL_VERSION
    : C1_SIGNALING_PROTOCOL_VERSION;
}

function maxFrameBytes(state: ConnectionState): number {
  return state.protocol === C2_SIGNALING_SUBPROTOCOL
    ? C2_SIGNALING_MAX_FRAME_BYTES
    : C1_SIGNALING_MAX_FRAME_BYTES;
}

function maxCandidates(state: ConnectionState): number {
  return state.protocol === C2_SIGNALING_SUBPROTOCOL
    ? C2_SIGNALING_MAX_CANDIDATES
    : C1_SIGNALING_MAX_CANDIDATES;
}

export class CallSignalingHub {
  private readonly database: DatabasePool;
  private readonly keys: AuthKeyRing;
  readonly #connections = new Map<string, ConnectionState>();
  readonly #generations = new Map<string, number>();
  readonly #pendingByCall = new Map<string, PendingSignal[]>();
  readonly #maintenance: ReturnType<typeof setInterval>;

  constructor(database: DatabasePool, keys: AuthKeyRing) {
    this.database = database;
    this.keys = keys;
    this.#maintenance = setInterval(() => {
      for (const state of [...this.#connections.values()]) {
        void this.#revalidate(state);
      }
    }, REVALIDATE_MS);
    this.#maintenance.unref?.();
  }

  accept(
    socket: WebSocket,
    auth: AuthContext,
    callId: string,
    authorization: EndpointAuthorization,
  ): void {
    const deviceId = auth.session.deviceId;
    if (!deviceId) {
      socket.close(1008, "Device required");
      return;
    }
    const key = `${callId}:${deviceId}`;
    const old = this.#connections.get(key);
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);

    if (old) {
      this.#send(old, {
        v: protocolVersion(old),
        type: "control.superseded",
        generation: old.generation,
        payload: {},
      });
      this.#close(old, 1008, "Superseded");
    }

    const state: ConnectionState = {
      id: randomUUID(),
      key,
      callId,
      socket,
      auth,
      deviceId,
      kind: authorization.kind,
      protocol: authorization.protocol,
      role: authorization.role,
      generation,
      candidateCount: 0,
      frameWindowStartedAt: Date.now(),
      frameWindowCount: 0,
      lastValidatedAt: Date.now(),
      revalidationPromise: null,
    };
    this.#connections.set(key, state);
    socket.on("message", (data, isBinary) => {
      void this.#onMessage(state, data, isBinary);
    });
    socket.on("close", () => this.#remove(state));
    socket.on("error", () => this.#remove(state));

    this.#send(state, {
      v: protocolVersion(state),
      type: "control.ready",
      generation,
      payload: { polite: state.role === "callee" },
    });
    this.#flushPending(state);
  }

  close(): void {
    clearInterval(this.#maintenance);
    for (const state of [...this.#connections.values()]) {
      this.#close(state, 1001, "Server shutdown");
    }
  }

  async #onMessage(state: ConnectionState, data: RawData, isBinary: boolean): Promise<void> {
    if (this.#connections.get(state.key) !== state) return;
    if (isBinary) {
      this.#close(state, 1003, "Text frames required");
      return;
    }
    const text = data.toString();
    if (Buffer.byteLength(text, "utf8") > maxFrameBytes(state)) {
      this.#close(state, 1009, "Frame too large");
      return;
    }

    const now = Date.now();
    if (now - state.frameWindowStartedAt >= 60_000) {
      state.frameWindowStartedAt = now;
      state.frameWindowCount = 0;
    }
    state.frameWindowCount += 1;
    if (state.frameWindowCount > MAX_FRAMES_PER_MINUTE) {
      this.#close(state, 1008, "Rate limited");
      return;
    }

    const valid = await this.#revalidate(state);
    if (!valid || this.#connections.get(state.key) !== state) return;

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.#close(state, 1008, "Invalid JSON");
      return;
    }

    const parsed =
      state.protocol === C2_SIGNALING_SUBPROTOCOL
        ? c2SignalClientFrameSchema.safeParse(raw)
        : c1SignalClientFrameSchema.safeParse(raw);
    if (!parsed.success || parsed.data.generation !== state.generation) {
      this.#close(state, 1008, "Invalid signaling frame");
      return;
    }

    if (parsed.data.type === "signal.description") {
      const validDescription =
        state.kind === "video"
          ? validateVideoCallDescription(parsed.data.payload.sdp)
          : validateCallDescription(parsed.data.payload.sdp);
      if (!validDescription) {
        this.#close(state, 1008, "Invalid SDP");
        return;
      }
    }

    if (parsed.data.type === "signal.ice_candidate") {
      state.candidateCount += 1;
      if (
        state.candidateCount > maxCandidates(state) ||
        !validateCallRelayCandidate(parsed.data.payload.candidate)
      ) {
        this.#close(state, 1008, "Invalid ICE candidate");
        return;
      }
    }

    const peer = this.#peer(state);
    if (peer) {
      this.#send(peer, { ...parsed.data, generation: peer.generation });
      return;
    }

    const pending = this.#pendingByCall.get(state.callId) ?? [];
    if (pending.length >= 128) {
      this.#close(state, 1013, "Peer signaling backlog exceeded");
      return;
    }
    pending.push({
      fromRole: state.role,
      fromKey: state.key,
      fromGeneration: state.generation,
      protocol: state.protocol,
      frame: parsed.data,
    });
    this.#pendingByCall.set(state.callId, pending);
  }

  async #revalidate(state: ConnectionState): Promise<boolean> {
    if (state.revalidationPromise) return state.revalidationPromise;

    const task = (async (): Promise<boolean> => {
      try {
        const session = await authenticateSessionToken(
          state.auth.rawToken,
          this.database,
          this.keys,
        );
        if (
          session.accountId !== state.auth.session.accountId ||
          session.deviceId !== state.deviceId ||
          session.sessionId !== state.auth.session.sessionId
        ) {
          this.#close(state, 1008, "Authorization changed");
          return false;
        }
        const authorization = await loadCallEndpointAuthorization(this.database.pool, {
          callId: state.callId,
          accountId: session.accountId,
          deviceId: state.deviceId,
          sessionId: session.sessionId,
        });
        if (
          !authorization ||
          authorization.role !== state.role ||
          authorization.kind !== state.kind
        ) {
          this.#close(state, 1008, "Authorization changed");
          return false;
        }
        state.lastValidatedAt = Date.now();
        return true;
      } catch {
        this.#close(state, 1008, "Authorization expired");
        return false;
      }
    })();

    state.revalidationPromise = task;
    try {
      return await task;
    } finally {
      if (state.revalidationPromise === task) state.revalidationPromise = null;
    }
  }

  #flushPending(state: ConnectionState): void {
    const pending = this.#pendingByCall.get(state.callId);
    if (!pending || pending.length === 0) return;
    const remaining: PendingSignal[] = [];
    for (const item of pending) {
      if (item.fromRole === state.role) {
        remaining.push(item);
        continue;
      }
      const source = this.#connections.get(item.fromKey);
      if (
        !source ||
        source.generation !== item.fromGeneration ||
        item.protocol !== state.protocol
      ) {
        continue;
      }
      if (!this.#forwardPending(state, item.frame)) continue;
    }
    if (remaining.length === 0) {
      this.#pendingByCall.delete(state.callId);
    } else {
      this.#pendingByCall.set(state.callId, remaining);
    }
  }

  #forwardPending(state: ConnectionState, frame: unknown): boolean {
    if (!frame || typeof frame !== "object") return false;
    this.#send(state, { ...(frame as Record<string, unknown>), generation: state.generation });
    return true;
  }

  #peer(state: ConnectionState): ConnectionState | null {
    for (const candidate of this.#connections.values()) {
      if (
        candidate.callId === state.callId &&
        candidate.deviceId !== state.deviceId &&
        candidate.role !== state.role &&
        candidate.kind === state.kind &&
        candidate.protocol === state.protocol
      ) {
        return candidate;
      }
    }
    return null;
  }

  #send(state: ConnectionState, frame: unknown): void {
    if (state.socket.readyState !== 1) return;
    const parsed =
      state.protocol === C2_SIGNALING_SUBPROTOCOL
        ? c2SignalServerFrameSchema.safeParse(frame)
        : c1SignalServerFrameSchema.safeParse(frame);
    if (!parsed.success || frameBytes(parsed.data) > maxFrameBytes(state)) {
      this.#close(state, 1011, "Invalid server frame");
      return;
    }
    if (state.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#close(state, 1013, "Backpressure");
      return;
    }
    state.socket.send(JSON.stringify(parsed.data));
  }

  #close(state: ConnectionState, code: number, reason: string): void {
    if (this.#connections.get(state.key) !== state) return;
    try {
      state.socket.close(code, reason);
    } finally {
      this.#remove(state);
    }
  }

  #remove(state: ConnectionState): void {
    if (this.#connections.get(state.key) === state) {
      this.#connections.delete(state.key);
    }
    const pending = this.#pendingByCall.get(state.callId);
    if (pending) {
      const retained = pending.filter(
        (item) => item.fromKey !== state.key || item.fromGeneration !== state.generation,
      );
      if (retained.length === 0) this.#pendingByCall.delete(state.callId);
      else this.#pendingByCall.set(state.callId, retained);
    }
    const hasCallConnection = [...this.#connections.values()].some(
      (candidate) => candidate.callId === state.callId,
    );
    if (!hasCallConnection) this.#pendingByCall.delete(state.callId);
  }
}
