import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  keptSourcesSnapshot,
  publishKeptSources,
  subscribeKeptSources,
} from "../src/features/messaging/kept-registry.ts";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

const EM_DASH = String.fromCodePoint(0x2014);

function kept(messageId: string) {
  return {
    kind: "remember_this",
    references: [{ referenceType: "message", referenceId: messageId, role: "source" }],
  };
}

test("UX7 Ribbon: kept sources are read from already loaded Remember This lists", () => {
  publishKeptSources([], true);
  let notified = 0;
  const off = subscribeKeptSources(() => (notified += 1));
  publishKeptSources([kept("m1"), kept("m2")], true);
  assert.deepEqual([...keptSourcesSnapshot()].sort(), ["m1", "m2"]);
  // A later page only adds.
  publishKeptSources([kept("m3")], false);
  assert.equal(keptSourcesSnapshot().size, 3);
  // Non message references and other kinds are ignored.
  publishKeptSources(
    [
      {
        kind: "memory",
        references: [{ referenceType: "message", referenceId: "x", role: "source" }],
      },
      { kind: "remember_this", references: [{ referenceType: "media", referenceId: "y" }] },
    ],
    false,
  );
  assert.equal(keptSourcesSnapshot().has("x"), false);
  assert.equal(keptSourcesSnapshot().has("y"), false);
  // A complete first page replaces, so a removed kept item loses its mark.
  publishKeptSources([kept("m2")], true);
  assert.deepEqual([...keptSourcesSnapshot()], ["m2"]);
  const before = notified;
  publishKeptSources([kept("m2")], true);
  assert.equal(notified, before, "unchanged sets do not notify");
  off();
});

test("UX7 Ribbon: no new endpoint, poll or persistence and reduced motion is covered", async () => {
  const registry = await source("../src/features/messaging/kept-registry.ts");
  assert.equal(/fetch|apiRequest|setInterval|localStorage|indexedDB/.test(registry), false);
  const css = await source("../src/design/signature.css");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*ribbon/);
  const bubble = await source("../src/features/messaging/TalkBubble.tsx");
  assert.equal(bubble.includes("data-ribbon"), true);
  assert.equal(bubble.includes("talk-ribbon"), true);
});

test("UX7 sources never contain the Unicode em dash", async () => {
  for (const file of [
    "../src/design/signature.css",
    "../src/design/motion/reduced.ts",
    "../src/features/messaging/kept-registry.ts",
    "./ux7.signature.test.ts",
  ]) {
    assert.equal((await source(file)).includes(EM_DASH), false, file);
  }
});
