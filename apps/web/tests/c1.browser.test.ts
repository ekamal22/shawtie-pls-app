import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("C1 browser negotiates realtime v2 and canonicalizes call invalidations", async () => {
  const client = await source("../src/lib/realtime/realtime-client.ts");
  const runtime = await source("../src/lib/realtime/runtime-context.tsx");
  const panel = await source("../src/features/calling/CallingPanel.tsx");

  assert.equal(client.includes("C1_REALTIME_SUBPROTOCOL"), true);
  assert.equal(client.includes('frame.type === "call.changed"'), true);
  assert.equal(client.includes("coordinator.markDirty()"), true);
  assert.equal(runtime.includes('"shawtie:call-changed"'), true);
  assert.equal(panel.includes('registerSynchronizer("c1-call"'), true);
  assert.equal(panel.includes("fetchCurrentCall"), true);
});

test("C1 browser keeps one local media owner and relay-only audio", async () => {
  const lease = await source("../src/features/calling/media-owner-lease.ts");
  const media = await source("../src/features/calling/media-controller.ts");

  assert.equal(lease.includes("ownerGeneration"), true);
  assert.equal(lease.includes("indexedDB.open"), true);
  assert.equal(lease.includes("BroadcastChannel"), true);
  assert.equal(lease.includes("navigator as Navigator"), true);
  assert.equal(media.includes('iceTransportPolicy: "relay"'), true);
  assert.equal(media.includes("getAudioTracks"), true);
  assert.equal(media.includes("getVideoTracks"), false);
  assert.equal(media.includes("stripCandidates"), true);
  assert.equal(media.includes("/\\btyp relay\\b/i"), true);
  assert.equal(media.includes("reportEndpointConnected"), true);
  assert.equal(media.includes("#pendingEndOfCandidates"), true);
  assert.equal(media.includes("this.#pendingEndOfCandidates = true"), true);
  assert.equal(media.includes("#scheduleTurnRefresh"), true);
  assert.equal(media.includes("#refreshTurnAndRestart"), true);
  assert.equal(media.includes("peer.setConfiguration"), true);
  assert.equal(media.includes("fetchTurnCredentials(this.callId)"), true);
  assert.equal(media.includes("this.#isSettingRemoteAnswerPending = false"), true);
  assert.equal(media.includes("onUnrecoverableFailure"), true);
  assert.equal(media.includes('"network_failed"'), true);
});

test("C1 microphone and notification permissions stay on explicit user paths", async () => {
  const panel = await source("../src/features/calling/CallingPanel.tsx");
  const push = await source("../src/features/calling/push.ts");
  const worker = await source("../public/sw.js");

  assert.equal(panel.includes("navigator.mediaDevices.getUserMedia"), true);
  assert.equal(panel.includes("video: false"), true);
  assert.equal(panel.includes("startOutgoing"), true);
  assert.equal(panel.includes("acceptIncoming"), true);
  assert.equal(push.includes("Notification.requestPermission()"), true);
  assert.equal(worker.includes('type !== "call_state_changed"'), true);
  assert.equal(worker.includes('fetch("/api/v1/calls/current"'), true);
  assert.equal(worker.includes("notificationclick"), true);
  assert.equal(worker.includes("/accept"), false);
});


test("C1 local browser host disables camera and scopes microphone to self", async () => {
  const vite = await source("../vite.config.ts");
  assert.equal(vite.includes('"Permissions-Policy": "camera=(), microphone=(self)"'), true);
  assert.equal(vite.includes("headers: c1PermissionHeaders"), true);
});
