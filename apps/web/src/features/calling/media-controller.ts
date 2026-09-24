import {
  C1_SIGNALING_PROTOCOL_VERSION,
  C1_SIGNALING_SUBPROTOCOL,
  C2_SIGNALING_PROTOCOL_VERSION,
  C2_SIGNALING_SUBPROTOCOL,
  c1SignalServerFrameSchema,
  c2SignalServerFrameSchema,
  type CallFailureCategory,
  type CallProjection,
} from "@shawtie/contracts";
import { fetchCall, fetchTurnCredentials, reportEndpointConnected } from "./api.ts";
import { CameraController, type CameraFacingMode, type CameraState } from "./camera-controller.ts";
import { MediaOwnerLease } from "./media-owner-lease.ts";

export interface CallMediaCallbacks {
  readonly onState: (state: RTCPeerConnectionState | "starting" | "stopped") => void;
  readonly onAutoplayBlocked: (blocked: boolean) => void;
  readonly onOwnershipLost: () => void;
  readonly onUnrecoverableFailure: (category: CallFailureCategory) => void;
  readonly onError: (message: string) => void;
  readonly onCameraState?: (state: CameraState) => void;
  readonly onLocalVideoStream?: (stream: MediaStream | null) => void;
  readonly onRemoteVideoStream?: (stream: MediaStream | null) => void;
}

function stripCandidates(sdp: string | undefined): string {
  return (sdp ?? "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("a=candidate:") && line !== "a=end-of-candidates")
    .join("\r\n");
}

function websocketUrl(callId: string): string {
  const url = new URL(
    "/api/v1/calls/" + encodeURIComponent(callId) + "/signal",
    window.location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class CallMediaSession {
  readonly #lease: MediaOwnerLease;
  readonly #remoteAudio = new Audio();
  readonly #pendingCandidates: RTCIceCandidateInit[] = [];
  readonly #kind: "voice" | "video";
  #pendingEndOfCandidates = false;
  #peer: RTCPeerConnection | null = null;
  #socket: WebSocket | null = null;
  #videoSender: RTCRtpSender | null = null;
  #camera: CameraController | null = null;
  #remoteVideoStream: MediaStream | null = null;
  #signalingGeneration = 0;
  #stopped = false;
  #reconnectTimer: number | null = null;
  #reconnectAttempt = 0;
  #makingOffer = false;
  #ignoreOffer = false;
  #isSettingRemoteAnswerPending = false;
  #polite = false;
  #endpointReported = false;
  #restartAttempts = 0;
  #failureReported = false;
  #turnRefreshTimer: number | null = null;
  #turnRefreshPromise: Promise<void> | null = null;
  #muted = false;
  readonly #visibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      void this.#camera?.disable();
    }
  };

  constructor(
    readonly callId: string,
    readonly deviceId: string,
    readonly localStream: MediaStream,
    kind: CallProjection["kind"],
    private readonly callbacks: CallMediaCallbacks,
  ) {
    this.#kind = kind;
    this.#lease = new MediaOwnerLease(callId, deviceId);
    this.#remoteAudio.autoplay = true;
    this.#remoteAudio.setAttribute("playsinline", "");
  }

  get muted(): boolean {
    return this.#muted;
  }

  get cameraState(): CameraState {
    return this.#camera?.state ?? "off";
  }

  get cameraFacingMode(): CameraFacingMode {
    return this.#camera?.facingMode ?? "user";
  }

  async start(): Promise<void> {
    this.callbacks.onState("starting");
    const ownerGeneration = await this.#lease.acquire();
    if (ownerGeneration === null) {
      this.#stopAudioTracks();
      throw new Error("CALL_ACTIVE_IN_ANOTHER_TAB");
    }
    this.#lease.startHeartbeat(() => {
      this.callbacks.onOwnershipLost();
      void this.stop();
    });

    const canonical = await fetchCall(this.callId);
    if (
      canonical.kind !== this.#kind ||
      !canonical.isThisDeviceSelectedEndpoint ||
      (canonical.state !== "accepted" && canonical.state !== "connected")
    ) {
      throw new Error("CALL_ENDPOINT_AUTHORITY_CHANGED");
    }

    const turn = await fetchTurnCredentials(this.callId);
    if (!(await this.#stillOwner())) return;
    const peer = new RTCPeerConnection({
      iceTransportPolicy: "relay",
      bundlePolicy: this.#kind === "video" ? "max-bundle" : undefined,
      iceCandidatePoolSize: 0,
      iceServers: [
        {
          urls: [...turn.urls],
          username: turn.username,
          credential: turn.credential,
        },
      ],
    });
    this.#peer = peer;
    this.#scheduleTurnRefresh(turn.expiresAt);

    for (const track of this.localStream.getAudioTracks()) {
      peer.addTrack(track, this.localStream);
    }

    if (this.#kind === "video") {
      const transceiver = peer.addTransceiver("video", { direction: "sendrecv" });
      this.#videoSender = transceiver.sender;
      this.#camera = new CameraController(transceiver.sender, {
        verifyAuthority: () => this.#verifyCameraAuthority(),
        onState: (state) => this.callbacks.onCameraState?.(state),
        onLocalStream: (stream) => this.callbacks.onLocalVideoStream?.(stream),
        onError: (message) => this.callbacks.onError(message),
      });
      document.addEventListener("visibilitychange", this.#visibilityHandler);
    }

    peer.addEventListener("track", (event) => {
      if (event.track.kind === "video") {
        const stream = new MediaStream([event.track]);
        this.#remoteVideoStream = stream;
        this.callbacks.onRemoteVideoStream?.(stream);
        event.track.addEventListener(
          "ended",
          () => {
            if (this.#remoteVideoStream === stream) {
              this.#remoteVideoStream = null;
              this.callbacks.onRemoteVideoStream?.(null);
            }
          },
          { once: true },
        );
        return;
      }
      if (event.track.kind === "audio") {
        const stream = new MediaStream([event.track]);
        this.#remoteAudio.srcObject = stream;
        void this.#remoteAudio.play().then(
          () => this.callbacks.onAutoplayBlocked(false),
          () => this.callbacks.onAutoplayBlocked(true),
        );
      }
    });

    peer.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        const candidate = event.candidate.candidate;
        if (!/\btyp relay\b/i.test(candidate)) return;
        if (this.#kind === "video") {
          const sdpMid = event.candidate.sdpMid;
          const sdpMLineIndex = event.candidate.sdpMLineIndex;
          if (sdpMid === null && sdpMLineIndex === null) return;
          this.#send("signal.ice_candidate", {
            candidate,
            sdpMid,
            sdpMLineIndex,
          });
        } else {
          this.#send("signal.ice_candidate", { candidate });
        }
        return;
      }
      this.#send("signal.end_of_candidates", {});
    });

    peer.addEventListener("negotiationneeded", () => {
      void this.#negotiate();
    });

    peer.addEventListener("connectionstatechange", () => {
      const state = peer.connectionState;
      this.callbacks.onState(state);
      if (state === "connected") {
        this.#restartAttempts = 0;
        this.#failureReported = false;
        if (!this.#endpointReported) {
          this.#endpointReported = true;
          void reportEndpointConnected(this.callId).catch(() => {
            this.#endpointReported = false;
          });
        }
      }
      if (state === "failed") {
        if (this.#restartAttempts < 3) {
          this.#restartAttempts += 1;
          void this.#refreshTurnAndRestart(true);
        } else if (!this.#failureReported) {
          this.#failureReported = true;
          this.callbacks.onUnrecoverableFailure("network_failed");
        }
      }
    });

    this.#connectSignaling();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  async enableCamera(facingMode?: CameraFacingMode): Promise<boolean> {
    if (this.#kind !== "video" || !this.#camera) return false;
    return this.#camera.enable(facingMode);
  }

  async disableCamera(): Promise<void> {
    await this.#camera?.disable();
  }

  async switchCamera(): Promise<boolean> {
    if (this.#kind !== "video" || !this.#camera) return false;
    return this.#camera.switchFacingMode();
  }

  async resumeRemoteAudio(): Promise<boolean> {
    try {
      await this.#remoteAudio.play();
      this.callbacks.onAutoplayBlocked(false);
      return true;
    } catch {
      this.callbacks.onAutoplayBlocked(true);
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    document.removeEventListener("visibilitychange", this.#visibilityHandler);
    if (this.#reconnectTimer !== null) {
      window.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#turnRefreshTimer !== null) {
      window.clearTimeout(this.#turnRefreshTimer);
      this.#turnRefreshTimer = null;
    }
    await this.#camera?.stop().catch(() => undefined);
    this.#camera = null;
    this.#videoSender = null;
    this.#remoteVideoStream = null;
    this.callbacks.onRemoteVideoStream?.(null);
    const socket = this.#socket;
    this.#socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Call ended");
    }
    this.#peer?.close();
    this.#peer = null;
    this.#remoteAudio.pause();
    this.#remoteAudio.srcObject = null;
    this.#stopAudioTracks();
    await this.#lease.release().catch(() => undefined);
    this.callbacks.onState("stopped");
  }

  async #verifyCameraAuthority(): Promise<boolean> {
    if (this.#stopped || this.#kind !== "video") return false;
    if (!(await this.#stillOwner())) return false;
    const canonical = await fetchCall(this.callId);
    return (
      canonical.kind === "video" &&
      canonical.isThisDeviceSelectedEndpoint &&
      (canonical.state === "accepted" || canonical.state === "connected")
    );
  }

  async #stillOwner(): Promise<boolean> {
    if (this.#stopped) return false;
    const owned = await this.#lease.verifyOwnership();
    if (this.#stopped) return false;
    if (!owned) {
      this.callbacks.onOwnershipLost();
      await this.stop();
      return false;
    }
    return true;
  }

  #stopAudioTracks(): void {
    for (const track of this.localStream.getAudioTracks()) track.stop();
  }

  #connectSignaling(): void {
    if (this.#stopped) return;
    this.#signalingGeneration = 0;
    this.#pendingCandidates.length = 0;
    this.#pendingEndOfCandidates = false;
    this.#ignoreOffer = false;
    this.#isSettingRemoteAnswerPending = false;

    const protocol =
      this.#kind === "video" ? C2_SIGNALING_SUBPROTOCOL : C1_SIGNALING_SUBPROTOCOL;
    const socket = new WebSocket(websocketUrl(this.callId), protocol);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      if (this.#stopped || this.#socket !== socket) return;
      this.#reconnectAttempt = 0;
    });
    socket.addEventListener("message", (event) => {
      if (this.#stopped || this.#socket !== socket) return;
      void this.#onSignal(socket, event.data).catch(() => {
        this.callbacks.onError("Call signaling failed.");
      });
    });
    socket.addEventListener("close", () => {
      if (this.#stopped || this.#socket !== socket) return;
      this.#socket = null;
      this.#signalingGeneration = 0;
      this.#scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (socket.readyState < WebSocket.CLOSING) socket.close();
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer !== null) return;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.#reconnectAttempt, 5));
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = window.setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#stillOwner().then(
        (owned) => {
          if (owned) this.#connectSignaling();
        },
        () => this.#scheduleReconnect(),
      );
    }, delay);
  }

  async #onSignal(socket: WebSocket, raw: unknown): Promise<void> {
    if (this.#stopped || this.#socket !== socket || typeof raw !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.callbacks.onError("Invalid call signaling data.");
      return;
    }
    const parsed =
      this.#kind === "video"
        ? c2SignalServerFrameSchema.safeParse(json)
        : c1SignalServerFrameSchema.safeParse(json);
    if (!parsed.success) {
      this.callbacks.onError("Unsupported call signaling data.");
      return;
    }
    const frame = parsed.data;

    if (frame.type === "control.superseded") {
      this.callbacks.onOwnershipLost();
      await this.stop();
      return;
    }

    if (frame.type === "control.ready") {
      this.#signalingGeneration = frame.generation;
      this.#polite = frame.payload.polite;
      if (!this.#polite) await this.#negotiate();
      return;
    }

    if (frame.generation !== this.#signalingGeneration || !this.#peer) return;

    if (frame.type === "signal.description") {
      const description: RTCSessionDescriptionInit = {
        type: frame.payload.descriptionType,
        sdp: frame.payload.sdp,
      };
      const readyForOffer =
        !this.#makingOffer &&
        (this.#peer.signalingState === "stable" || this.#isSettingRemoteAnswerPending);
      const offerCollision = description.type === "offer" && !readyForOffer;
      this.#ignoreOffer = !this.#polite && offerCollision;
      if (this.#ignoreOffer) return;

      this.#isSettingRemoteAnswerPending = description.type === "answer";
      try {
        await this.#peer.setRemoteDescription(description);
      } finally {
        this.#isSettingRemoteAnswerPending = false;
      }
      while (this.#pendingCandidates.length > 0) {
        const candidate = this.#pendingCandidates.shift();
        if (candidate) await this.#peer.addIceCandidate(candidate);
      }
      if (this.#pendingEndOfCandidates) {
        this.#pendingEndOfCandidates = false;
        await this.#peer.addIceCandidate(null).catch(() => undefined);
      }
      if (description.type === "offer") {
        await this.#peer.setLocalDescription();
        this.#sendDescription();
      }
      return;
    }

    if (frame.type === "signal.ice_candidate") {
      const candidate: RTCIceCandidateInit =
        this.#kind === "video"
          ? {
              candidate: frame.payload.candidate,
              sdpMid: "sdpMid" in frame.payload ? frame.payload.sdpMid : null,
              sdpMLineIndex:
                "sdpMLineIndex" in frame.payload ? frame.payload.sdpMLineIndex : null,
            }
          : { candidate: frame.payload.candidate, sdpMLineIndex: 0 };
      if (this.#peer.remoteDescription) {
        await this.#peer.addIceCandidate(candidate).catch((error) => {
          if (!this.#ignoreOffer) throw error;
        });
      } else {
        this.#pendingCandidates.push(candidate);
      }
      return;
    }

    if (frame.type === "signal.end_of_candidates") {
      if (this.#peer.remoteDescription) {
        await this.#peer.addIceCandidate(null).catch(() => undefined);
      } else {
        this.#pendingEndOfCandidates = true;
      }
      return;
    }

    if (frame.type === "signal.restart") {
      await this.#refreshTurnAndRestart(false);
    }
  }

  #scheduleTurnRefresh(expiresAt: string): void {
    if (this.#turnRefreshTimer !== null) {
      window.clearTimeout(this.#turnRefreshTimer);
      this.#turnRefreshTimer = null;
    }
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) return;
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0) return;
    const delay = Math.max(1_000, Math.floor(remainingMs * 0.8));
    this.#turnRefreshTimer = window.setTimeout(() => {
      this.#turnRefreshTimer = null;
      void this.#refreshTurnAndRestart(true);
    }, delay);
  }

  async #refreshTurnAndRestart(announce: boolean): Promise<void> {
    if (this.#turnRefreshPromise) return this.#turnRefreshPromise;
    const task = (async () => {
      const peer = this.#peer;
      if (this.#stopped || !peer) return;
      const turn = await fetchTurnCredentials(this.callId);
      if (this.#stopped || this.#peer !== peer) return;
      if (!(await this.#stillOwner()) || this.#peer !== peer) return;
      peer.setConfiguration({
        iceTransportPolicy: "relay",
        iceServers: [
          {
            urls: [...turn.urls],
            username: turn.username,
            credential: turn.credential,
          },
        ],
      });
      this.#scheduleTurnRefresh(turn.expiresAt);
      peer.restartIce();
      if (announce) this.#send("signal.restart", {});
    })();
    this.#turnRefreshPromise = task;
    try {
      await task;
    } catch {
      this.callbacks.onError("Call network recovery failed.");
    } finally {
      if (this.#turnRefreshPromise === task) this.#turnRefreshPromise = null;
    }
  }

  async #negotiate(): Promise<void> {
    if (
      this.#stopped ||
      !this.#peer ||
      this.#signalingGeneration <= 0 ||
      this.#socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    try {
      this.#makingOffer = true;
      await this.#peer.setLocalDescription();
      this.#sendDescription();
    } catch {
      this.callbacks.onError("Call negotiation failed.");
    } finally {
      this.#makingOffer = false;
    }
  }

  #sendDescription(): void {
    if (!this.#peer?.localDescription) return;
    const description = this.#peer.localDescription;
    if (description.type !== "offer" && description.type !== "answer") return;
    this.#send("signal.description", {
      descriptionType: description.type,
      sdp: stripCandidates(description.sdp),
    });
  }

  #send(
    type:
      | "signal.description"
      | "signal.ice_candidate"
      | "signal.end_of_candidates"
      | "signal.restart",
    payload: Record<string, unknown>,
  ): void {
    const socket = this.#socket;
    if (
      this.#stopped ||
      this.#signalingGeneration <= 0 ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    socket.send(
      JSON.stringify({
        v:
          this.#kind === "video"
            ? C2_SIGNALING_PROTOCOL_VERSION
            : C1_SIGNALING_PROTOCOL_VERSION,
        type,
        generation: this.#signalingGeneration,
        payload,
      }),
    );
  }
}
