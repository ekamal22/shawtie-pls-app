import { CameraController } from "../src/features/calling/camera-controller.ts";
import { CallMediaSession } from "../src/features/calling/media-controller.ts";

interface DeferredCapture {
  resolve: (stream: MediaStream) => void;
  reject: (error: unknown) => void;
}

const deferred = new Map<string, DeferredCapture>();
let nextCaptureName: string | null = null;
let authority = true;
let senderTrack: MediaStreamTrack | null = null;
let replaceCount = 0;
let lastState = "off";
let lastLocalStream: MediaStream | null = null;

const sender = {
  async replaceTrack(track: MediaStreamTrack | null) {
    replaceCount += 1;
    senderTrack = track;
  },
} as unknown as RTCRtpSender;

function syntheticVideoStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  context?.fillRect(0, 0, 32, 32);
  return canvas.captureStream(1);
}

const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async () => {
  const name = nextCaptureName;
  if (!name) return syntheticVideoStream();
  nextCaptureName = null;
  return new Promise<MediaStream>((resolve, reject) => {
    deferred.set(name, { resolve, reject });
  });
};

const controller = new CameraController(sender, {
  verifyAuthority: async () => authority,
  onState: (state) => {
    lastState = state;
  },
  onLocalStream: (stream) => {
    lastLocalStream = stream;
  },
  onError: () => undefined,
});

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    super();
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  deliver(frame: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
}

function countLines(sdp: string, pattern: RegExp): number {
  return (sdp.match(pattern) ?? []).length;
}

const api = {
  setAuthority(value: boolean) {
    authority = value;
  },
  begin(name: string) {
    nextCaptureName = name;
    return controller.enable();
  },
  resolve(name: string) {
    const capture = deferred.get(name);
    if (!capture) throw new Error("Missing deferred capture " + name);
    const stream = syntheticVideoStream();
    capture.resolve(stream);
    deferred.delete(name);
    return stream.getVideoTracks()[0]?.readyState ?? "missing";
  },
  reject(name: string) {
    const capture = deferred.get(name);
    if (!capture) throw new Error("Missing deferred capture " + name);
    capture.reject(new DOMException("denied", "NotAllowedError"));
    deferred.delete(name);
  },
  enableNow() {
    nextCaptureName = null;
    return controller.enable();
  },
  disable() {
    return controller.disable();
  },
  switchFacingMode() {
    nextCaptureName = null;
    return controller.switchFacingMode();
  },
  state() {
    return {
      state: lastState,
      senderHasTrack: senderTrack !== null,
      replaceCount,
      localHasTrack: Boolean(lastLocalStream?.getVideoTracks()[0]),
      facingMode: controller.facingMode,
    };
  },
  async videoCalleeNegotiation(callId: string, deviceId: string) {
    const peers: RTCPeerConnection[] = [];
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(NativePeer, {
      construct(target, args, newTarget) {
        const created = Reflect.construct(target, args, newTarget) as RTCPeerConnection;
        peers.push(created);
        return created;
      },
    });
    const NativeSocket = window.WebSocket;
    window.WebSocket = FakeSocket as unknown as typeof WebSocket;
    FakeSocket.instances = [];
    const audio = new AudioContext();
    let session: CallMediaSession | null = null;
    const callerPeer = new NativePeer();
    try {
      const callerAudio = audio.createMediaStreamDestination();
      callerPeer.addTrack(callerAudio.stream.getAudioTracks()[0]!, callerAudio.stream);
      callerPeer.addTransceiver("video", { direction: "sendrecv" });
      const offer = await callerPeer.createOffer();
      await callerPeer.setLocalDescription(offer);
      const offerSdp = (offer.sdp ?? "")
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("a=candidate:") && line !== "a=end-of-candidates")
        .join("\r\n");

      const calleeAudio = audio.createMediaStreamDestination();
      session = new CallMediaSession(callId, deviceId, calleeAudio.stream, "video", {
        onState: () => undefined,
        onAutoplayBlocked: () => undefined,
        onOwnershipLost: () => undefined,
        onUnrecoverableFailure: () => undefined,
        onError: () => undefined,
      });
      await session.start();
      const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
      if (!socket) throw new Error("Callee did not open a signaling socket");
      socket.deliver({ v: 2, type: "control.ready", generation: 1, payload: { polite: true } });
      socket.deliver({
        v: 2,
        type: "signal.description",
        generation: 1,
        payload: { descriptionType: "offer", sdp: offerSdp },
      });
      await new Promise((resolve) => window.setTimeout(resolve, 1500));

      const descriptions = socket.sent
        .map(
          (raw) =>
            JSON.parse(raw) as {
              type: string;
              payload: { descriptionType?: string; sdp?: string };
            },
        )
        .filter((frame) => frame.type === "signal.description")
        .map((frame) => ({
          type: frame.payload.descriptionType ?? "",
          audioLines: countLines(frame.payload.sdp ?? "", /^m=audio/gm),
          videoLines: countLines(frame.payload.sdp ?? "", /^m=video/gm),
          applicationLines: countLines(frame.payload.sdp ?? "", /^m=application/gm),
          sendrecvLines: countLines(frame.payload.sdp ?? "", /^a=sendrecv/gm),
        }));
      const calleePeer = peers[peers.length - 1];
      const videoTransceivers = calleePeer
        ? calleePeer.getTransceivers().filter((t) => t.receiver.track.kind === "video").length
        : -1;
      const enabled = await Promise.race([
        session.enableCamera().then(() => "settled"),
        new Promise<string>((resolve) => window.setTimeout(() => resolve("pending"), 3000)),
      ]);
      return { descriptions, videoTransceivers, cameraWaitSettled: enabled };
    } finally {
      await session?.stop().catch(() => undefined);
      callerPeer.close();
      window.RTCPeerConnection = NativePeer;
      window.WebSocket = NativeSocket;
    }
  },
  async cleanup() {
    await controller.stop();
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  },
};

declare global {
  interface Window {
    c2Harness: typeof api;
  }
}

window.c2Harness = api;
document.querySelector("#status")!.textContent = "ready";
