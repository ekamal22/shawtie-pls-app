import { randomUUID } from "node:crypto";
import {
  C1_SIGNALING_MAX_CANDIDATES,
  C1_SIGNALING_MAX_FRAME_BYTES,
  C1_SIGNALING_PROTOCOL_VERSION,
  c1SignalClientFrameSchema,
  c1SignalServerFrameSchema,
  type C1SignalServerFrame,
} from "@shawtie/contracts";
import { loadCallEndpointAuthorization, type DatabasePool } from "@shawtie/db";
import type { RawData, WebSocket } from "ws";
import type { AuthContext } from "../../plugins/authentication.ts";
import { authenticateSessionToken } from "../../plugins/authentication.ts";
import type { AuthKeyRing } from "../../security/auth-key-ring.ts";

const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_FRAMES_PER_MINUTE = 360;
const REVALIDATE_MS = 30_000;

interface EndpointAuthorization {
  readonly partnershipId: string;
  readonly role: "caller" | "callee";
}

interface ConnectionState {
  readonly id: string;
  readonly key: string;
  readonly callId: string;
  readonly socket: WebSocket;
  readonly auth: AuthContext;
  readonly deviceId: string;
  readonly role: "caller" | "callee";
  readonly generation: number;
  candidateCount: number;
  frameWindowStartedAt: number;
  frameWindowCount: number;
  lastValidatedAt: number;
  revalidationPromise: Promise<boolean> | null;
}

function frameBytes(frame: unknown): number {
  return new TextEncoder().encode(JSON.stringify(frame)).byteLength;
}

function validateDescription(sdp: string): boolean {
  const lines = sdp.split(/\\r?\\n/).map((line) => line.trim());
  if (lines.some((line) => /^a=(candidate:|end-of-candidates)/i.test(line))) return false;
  const media = lines.filter((line) => line.startsWith("m="));
  return media.length === 1 && /^m=audio\\s/i.test(media[0] ?? "");
}

function validateRelayCandidate(candidate: string): boolean {
  const tokens = candidate.trim().split(/\\s+/);
  if (tokens.length < 8) return false;

  const foundation = tokens[0] ?? "";
  const component = tokens[1] ?? "";
  const transport = (tokens[2] ?? "").toLowerCase();
  const priority = tokens[3] ?? "";
  const address = tokens[4] ?? "";
  const port = tokens[5] ?? "";
  const typ = (tokens[6] ?? "").toLowerCase();
  const candidateType = (tokens[7] ?? "").toLowerCase();

  if (!foundation.startsWith("candidate:") || foundation.length <= "candidate:".length) return false;
  if (!/^[12]$/.test(component)) return false;
  if (transport !== "udp" && transport !== "tcp") return false;
  if (!/^\\d+$/.test(priority) || BigInt(priority) > 4_294_967_295n) return false;
  if (!address) return false;
  if (!/^\\d+$/.test(port)) return false;
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) return false;
  if (typ !== "typ" || candidateType !== "relay") return false;

  const extensions = tokens.slice(8);
  if (extensions.some((token) => token.toLowerCase() === "typ")) return false;

  const raddrIndexes = extensions
    .map((token, index) => (token.toLowerCase() === "raddr" ? index : -1))
    .filter((index) => index >= 0);
  const rportIndexes = extensions
    .map((token, index) => (token.toLowerCase() === "rport" ? index : -1))
    .filter((index) => index >= 0);
  if (raddrIndexes.length > 1 || rportIndexes.length > 1) return false;

  if (raddrIndexes.length === 1) {
    const related = extensions[(raddrIndexes[0] ?? -1) + 1]?.toLowerCase();
    if (!related || !["0.0.0.0", "::", "0", "0:0:0:0:0:0:0:0"].includes(related)) return false;
  }
  if (rportIndexes.length === 1) {
    const relatedPort = extensions[(rportIndexes[0] ?? -1) + 1];
    if (!relatedPort || relatedPort !== "0") return false;
  }
  return true;
}

interface PendingSignal {
  readonly fromRole: "caller" | "callee";
  readonly fromKey: string;
  readonly fromGeneration: number;
  readonly frame: Extract<
    C1SignalServerFrame,
    { type: "signal.description" | "signal.ice_candidate" | "signal.end_of_candidates" | "signal.restart" }
  >;
}

export class CallSignalingHub {
  readonly #connections = new Map<string, ConnectionState>();
  readonly #generations = new Map<string, number>();
  readonly #pendingByCall = new Map<string, PendingSignal[]>();
  readonly #maintenance: ReturnType<typeof setInterval>;

  constructor(
    private readonly database: DatabasePool,
    private readonly keys: AuthKeyRing,
  ) {
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
        v: C1_SIGNALING_PROTOCOL_VERSION,
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
      v: C1_SIGNALING_PROTOCOL_VERSION,
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
    if (Buffer.byteLength(text, "utf8") > C1_SIGNALING_MAX_FRAME_BYTES) {
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
    const parsed = c1SignalClientFrameSchema.safeParse(raw);
    if (!parsed.success || parsed.data.generation !== state.generation) {
      this.#close(state, 1008, "Invalid signaling frame");
      return;
    }

    if (parsed.data.type === "signal.description" && !validateDescription(parsed.data.payload.sdp)) {
      this.#close(state, 1008, "Invalid SDP");
      return;
    }

    if (parsed.data.type === "signal.ice_candidate") {
      state.candidateCount += 1;
      if (
        state.candidateCount > C1_SIGNALING_MAX_CANDIDATES
        || !validateRelayCandidate(parsed.data.payload.candidate)
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
          session.accountId !== state.auth.session.accountId
          || session.deviceId !== state.deviceId
          || session.sessionId !== state.auth.session.sessionId
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
        if (!authorization || authorization.role !== state.role) {
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
      if (!source || source.generation !== item.fromGeneration) continue;
      this.#send(state, { ...item.frame, generation: state.generation });
    }
    if (remaining.length === 0) {
      this.#pendingByCall.delete(state.callId);
    } else {
      this.#pendingByCall.set(state.callId, remaining);
    }
  }

  #peer(state: ConnectionState): ConnectionState | null {
    for (const candidate of this.#connections.values()) {
      if (
        candidate.callId === state.callId
        && candidate.deviceId !== state.deviceId
        && candidate.role !== state.role
      ) {
        return candidate;
      }
    }
    return null;
  }

  #send(state: ConnectionState, frame: C1SignalServerFrame): void {
    if (state.socket.readyState !== 1) return;
    const parsed = c1SignalServerFrameSchema.safeParse(frame);
    if (!parsed.success || frameBytes(parsed.data) > C1_SIGNALING_MAX_FRAME_BYTES) {
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
