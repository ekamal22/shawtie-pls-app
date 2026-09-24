import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("C2 browser keeps camera behind accepted selected media ownership", async () => {
  const panel = await source("../src/features/calling/CallingPanel.tsx");
  const media = await source("../src/features/calling/media-controller.ts");
  const camera = await source("../src/features/calling/camera-controller.ts");

  assert.equal(panel.includes("pendingCameraIntentRef"), true);
  assert.equal(panel.includes('pendingCameraIntentRef.current = kind === "video"'), true);
  assert.equal(panel.includes("await media.start();"), true);
  assert.equal(panel.includes("await media.enableCamera();"), true);
  assert.equal(panel.indexOf("await media.start();") < panel.indexOf("await media.enableCamera();"), true);
  assert.equal(panel.includes('document.visibilityState === "hidden"'), true);
  assert.equal(panel.includes("pendingCameraIntentRef.current = false"), true);
  assert.equal(panel.includes('document.visibilityState === "visible"'), true);
  assert.equal(media.includes("async #verifyCameraAuthority()"), true);
  assert.equal(media.includes("canonical.isThisDeviceSelectedEndpoint"), true);
  assert.equal(media.includes("this.#lease.verifyOwnership()"), true);
  assert.equal(camera.includes("verifyAuthority"), true);
  assert.equal(camera.includes("generation !== this.#generation"), true);
  assert.equal(camera.includes("stopStream(acquired)"), true);
});

test("C2 browser uses one stable video transceiver and signaling v2", async () => {
  const media = await source("../src/features/calling/media-controller.ts");

  assert.equal(media.includes("C2_SIGNALING_SUBPROTOCOL"), true);
  assert.equal(media.includes("C2_SIGNALING_PROTOCOL_VERSION"), true);
  assert.equal(media.includes('peer.addTransceiver("video", { direction: "sendrecv" })'), true);
  assert.equal(media.includes('peerConfiguration.bundlePolicy = "max-bundle"'), true);
  assert.equal(media.includes("iceCandidatePoolSize: 0"), true);
  assert.equal(media.includes("replaceTrack"), false);
  assert.equal(media.includes("sdpMid"), true);
  assert.equal(media.includes("sdpMLineIndex"), true);
  assert.equal(media.includes("addIceCandidate(null)"), true);
});

test("C2 camera controller owns replacement, switching, background stop and local-only state", async () => {
  const camera = await source("../src/features/calling/camera-controller.ts");
  const media = await source("../src/features/calling/media-controller.ts");

  assert.equal(camera.includes("this.sender.replaceTrack(track)"), true);
  assert.equal(camera.includes("this.sender.replaceTrack(null)"), true);
  assert.equal(camera.includes("exactFacing ? { exact: facingMode } : { ideal: facingMode }"), true);
  assert.equal(camera.includes("return this.enable(next, true)"), true);
  assert.equal(camera.includes("async #hasAuthority()"), true);
  assert.equal(camera.includes('error.name !== "OverconstrainedError"'), true);
  assert.equal(media.includes('document.visibilityState === "hidden"'), true);
  assert.equal(media.includes("this.#camera?.disable()"), true);
  assert.equal(media.includes("onLocalVideoStream"), true);
  assert.equal(media.includes("onRemoteVideoStream"), true);
  assert.equal(media.includes('event.track.addEventListener("mute"'), true);
  assert.equal(media.includes('event.track.addEventListener("unmute"'), true);
});

test("C2 product UI exposes explicit video consent and camera-off acceptance", async () => {
  const panel = await source("../src/features/calling/CallingPanel.tsx");
  const api = await source("../src/features/calling/api.ts");
  const vite = await source("../vite.config.ts");

  assert.equal(panel.includes("Video call"), true);
  assert.equal(panel.includes("Incoming video call"), true);
  assert.equal(panel.includes("Accept video"), true);
  assert.equal(panel.includes("Accept with camera off"), true);
  assert.equal(panel.includes("Turn camera on"), true);
  assert.equal(panel.includes("Switch camera"), true);
  assert.equal(api.includes("C2_VIDEO_MEDIA_PROFILE"), true);
  assert.equal(vite.includes('camera=(self), microphone=(self)'), true);
});
