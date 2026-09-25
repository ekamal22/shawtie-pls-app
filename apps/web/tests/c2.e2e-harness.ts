import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VideoSurface } from "../src/features/calling/VideoSurface.tsx";
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

interface RemoteVideoRig {
  readonly senderPeer: RTCPeerConnection;
  readonly receiverPeer: RTCPeerConnection;
  readonly sender: RTCRtpSender;
  readonly track: MediaStreamTrack;
  readonly receivedTrack: MediaStreamTrack;
  readonly root: Root;
  readonly host: HTMLElement;
  readonly timer: number;
}

let remoteRig: RemoteVideoRig | null = null;

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
  async mountRemoteVideo() {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    let counter = 0;
    const timer = window.setInterval(() => {
      counter += 1;
      if (context) {
        context.fillStyle = "hsl(" + ((counter * 7) % 360) + ",70%,50%)";
        context.fillRect(0, 0, 160, 120);
      }
    }, 40);
    const captured = canvas.captureStream(15);
    const track = captured.getVideoTracks()[0]!;
    const senderPeer = new RTCPeerConnection();
    const receiverPeer = new RTCPeerConnection();
    senderPeer.onicecandidate = (event) => {
      if (event.candidate) void receiverPeer.addIceCandidate(event.candidate);
    };
    receiverPeer.onicecandidate = (event) => {
      if (event.candidate) void senderPeer.addIceCandidate(event.candidate);
    };
    const receivedPromise = new Promise<MediaStreamTrack>((resolve) => {
      receiverPeer.ontrack = (event) => resolve(event.track);
    });
    const transceiver = senderPeer.addTransceiver(track, { streams: [captured] });
    await senderPeer.setLocalDescription(await senderPeer.createOffer());
    await receiverPeer.setRemoteDescription(senderPeer.localDescription!);
    await receiverPeer.setLocalDescription(await receiverPeer.createAnswer());
    await senderPeer.setRemoteDescription(receiverPeer.localDescription!);
    const receivedTrack = await receivedPromise;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      createElement(VideoSurface, {
        localStream: null,
        remoteStream: new MediaStream([receivedTrack]),
      }),
    );
    remoteRig = {
      senderPeer,
      receiverPeer,
      sender: transceiver.sender,
      track,
      receivedTrack,
      root,
      host,
      timer,
    };
  },
  async remoteSenderCamera(on: boolean) {
    if (!remoteRig) throw new Error("Remote video rig is not mounted");
    await remoteRig.sender.replaceTrack(on ? remoteRig.track : null);
  },
  remoteVideoState() {
    if (!remoteRig) throw new Error("Remote video rig is not mounted");
    const video = remoteRig.host.querySelector("video.remote-video") as HTMLVideoElement | null;
    return {
      hasElement: video !== null,
      hidden: video ? video.style.visibility === "hidden" : null,
      totalFrames: video ? video.getVideoPlaybackQuality().totalVideoFrames : 0,
      placeholderVisible:
        remoteRig.host.textContent?.includes("Waiting for partner video") ?? false,
      receiverTrackMuted: remoteRig.receivedTrack.muted,
      receiverTrackState: remoteRig.receivedTrack.readyState,
    };
  },
  async unmountRemoteVideo() {
    if (!remoteRig) return;
    window.clearInterval(remoteRig.timer);
    remoteRig.root.unmount();
    remoteRig.host.remove();
    remoteRig.track.stop();
    remoteRig.senderPeer.close();
    remoteRig.receiverPeer.close();
    remoteRig = null;
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
