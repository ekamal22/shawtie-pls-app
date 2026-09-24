import { CameraController } from "../src/features/calling/camera-controller.ts";

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
} as RTCRtpSender;

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
