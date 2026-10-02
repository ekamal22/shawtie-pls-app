import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("R2 keeps a global keyboard focus treatment and reduced-motion behavior", async () => {
  const design = await source("../src/design/design.css");
  const tokens = await source("../src/design/tokens.css");
  assert.equal(design.includes(":focus-visible"), true);
  assert.equal(design.includes("outline:"), true);
  assert.equal(tokens.includes("@media (prefers-reduced-motion: reduce)"), true);
});

test("R2 registration policy controls remain explicitly labelled", async () => {
  const app = await source("../src/app/App.tsx");
  assert.equal(app.includes('href="/terms.html"'), true);
  assert.equal(app.includes('href="/privacy.html"'), true);
  assert.equal(app.includes("termsAccepted"), true);
  assert.equal(app.includes("privacyAccepted"), true);
});

test("R2 notification privacy and support controls retain programmatic labels", async () => {
  const us = await source("../src/features/ours/us/UsScreen.tsx");
  assert.equal(us.includes("<label"), true);
  assert.equal(us.includes("Show notification type details on this device"), true);
  assert.equal(us.includes("<select"), true);
  assert.equal(us.includes("<textarea"), true);
  assert.equal(us.includes("Report or get support"), true);
});

test("R2 retains semantic names on primary private surfaces", async () => {
  const talk = await source("../src/features/messaging/MessagingPanel.tsx");
  const ours = await source("../src/features/relationship-space/RelationshipSpacePanel.tsx");
  const calls = await source("../src/features/calling/ui/CallSurface.tsx");
  assert.equal(talk.includes('aria-label="Conversation"'), true);
  assert.equal(ours.includes('aria-label="Ours"'), true);
  assert.equal(calls.includes('aria-label="Call controls"'), true);
});
