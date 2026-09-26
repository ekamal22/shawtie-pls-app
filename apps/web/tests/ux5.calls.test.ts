import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  derivePhase,
  elapsedLabel,
  endedCopy,
  phaseCopy,
} from "../src/features/calling/ui/call-model.ts";

const base = {
  kind: "voice",
  direction: "outgoing",
  outcome: null,
  connectedAt: null,
  endedAt: null,
} as const;

test("UX5 phase derivation follows the existing projection and local media state", () => {
  const call = {
    state: "connected",
    direction: "outgoing",
    isThisDeviceSelectedEndpoint: true,
  } as const;
  assert.equal(
    derivePhase({ call: { ...call, state: "ringing" }, mediaState: "idle", hasMedia: false }),
    "outgoing-ringing",
  );
  assert.equal(
    derivePhase({
      call: { ...call, state: "ringing", direction: "incoming" },
      mediaState: "idle",
      hasMedia: false,
    }),
    "incoming-ringing",
  );
  assert.equal(derivePhase({ call, mediaState: "connected", hasMedia: true }), "connected");
  assert.equal(derivePhase({ call, mediaState: "muted", hasMedia: true }), "connected");
  assert.equal(derivePhase({ call, mediaState: "disconnected", hasMedia: true }), "reconnecting");
  assert.equal(derivePhase({ call, mediaState: "connecting", hasMedia: true }), "connecting");
  assert.equal(derivePhase({ call, mediaState: "idle", hasMedia: false }), "connecting");
  assert.equal(derivePhase({ call, mediaState: "observer", hasMedia: false }), "observer");
  assert.equal(
    derivePhase({
      call: { ...call, isThisDeviceSelectedEndpoint: false },
      mediaState: "idle",
      hasMedia: false,
    }),
    "elsewhere",
  );
  assert.equal(
    derivePhase({ call: { ...call, state: "ended" }, mediaState: "idle", hasMedia: false }),
    "ended",
  );
});

test("UX5 copy is calm, names the person, and never blames them", () => {
  assert.equal(phaseCopy("outgoing-ringing", base, "Maya").title, "Calling Maya...");
  assert.equal(
    phaseCopy("reconnecting", base, "Maya").status,
    "Reconnecting... you are still in the call.",
  );
  assert.equal(endedCopy({ ...base, outcome: "missed" }, "Maya").status, "No answer.");
  assert.equal(
    endedCopy({ ...base, outcome: "failed" }, "Maya").status,
    "Couldn't connect. Check your connection and try again.",
  );
  assert.equal(
    endedCopy(
      {
        ...base,
        outcome: "completed",
        connectedAt: "2026-01-01T10:00:00Z",
        endedAt: "2026-01-01T10:12:31Z",
      },
      null,
    ).status,
    "Call lasted 12:31.",
  );
  assert.equal(elapsedLabel(3725), "1:02:05");
  assert.equal(elapsedLabel(9), "0:09");
});

test("UX5 call sources make no encryption claim, use no em dash, and offer no privacy toggles", async () => {
  const directory = new URL("../src/features/calling/", import.meta.url);
  const files: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const inner of await readdir(new URL(entry.name + "/", directory))) {
        files.push(new URL(entry.name + "/" + inner, directory));
      }
    } else if (/\.(tsx?|css)$/.test(entry.name)) files.push(new URL(entry.name, directory));
  }
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.equal(text.includes("2014"), false, file.pathname + " contains an em dash");
    assert.equal(
      /end-to-end|e2ee|encrypted/i.test(text),
      false,
      file.pathname + " claims encryption",
    );
  }
  const entry = await readFile(
    new URL("../src/features/calling/ui/CallEntry.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(entry.includes("Private relay calling"), true);
});

test("UX5 keeps the shell contract and explicit answer gestures", async () => {
  const panel = await readFile(
    new URL("../src/features/calling/CallingPanel.tsx", import.meta.url),
    "utf8",
  );
  const surface = await readFile(
    new URL("../src/features/calling/ui/CallSurface.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(panel.includes("data-call-state"), true);
  assert.equal(panel.includes('className={"call-panel"'), true);
  assert.equal(surface.includes('role="dialog"'), true);
  assert.equal(surface.includes("force-midnight"), true);
  assert.equal(surface.includes("onAnswer(true)"), true);
  assert.equal(surface.includes("onAnswer(false)"), true);
});
