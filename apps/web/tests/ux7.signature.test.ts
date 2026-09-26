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

test("UX7 Memory Return: presentation-only shared-element transition honors reduced motion", async () => {
  const transition = await source("../src/design/motion/view-transition.ts");
  assert.equal(transition.includes("prefersReducedMotion()"), true);
  assert.equal(/apiRequest|fetch\(/.test(transition), false);
  const sourceModule = await source("../src/features/ours/content/source.ts");
  // The existing navigation and event are unchanged; the transition only wraps them.
  assert.equal(sourceModule.includes('"#/talk/message/"'), true);
  assert.equal(sourceModule.includes('"shawtie:open-message"'), true);
  const css = await source("../src/design/signature.css");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*view-transition-group/);
  const panel = await source("../src/features/messaging/MessagingPanel.tsx");
  assert.equal(panel.includes("Back to what we kept"), true);
  // No second-author annotation (PRODUCT_EXTENSION).
  assert.equal(/annotat/i.test(panel + transition), false);
});

test("UX7 Letter Unfolds: under one second, skippable, focus moves to the letter", async () => {
  const letters = await source("../src/features/ours/content/LetterViews.tsx");
  const ms = Number(/export const UNFOLD_MS = (\d+)/.exec(letters)?.[1]);
  const reducedMs = Number(/export const UNFOLD_REDUCED_MS = (\d+)/.exec(letters)?.[1]);
  assert.ok(ms > 0 && ms < 1000, "unfold stays under one second");
  assert.ok(reducedMs > 0 && reducedMs <= 200);
  assert.equal(letters.includes("signatureDuration("), true);
  assert.equal(letters.includes('event.key === "Escape"'), true);
  assert.equal(letters.includes("revealRef.current?.focus"), true);
  // The existing release action is still the only thing that opens a letter.
  assert.equal(letters.includes("actions.release()"), true);
});

test("UX7 Our Year book: keyboard, swipe and status paging with no metrics", async () => {
  const book = await source("../src/features/ours/content/curation.tsx");
  for (const key of ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End"]) {
    assert.equal(book.includes('"' + key + '"'), true, key);
  }
  assert.equal(book.includes('role="status"'), true);
  assert.equal(book.includes("onPointerUp"), true);
  assert.match(book, /"Page " \+ safe \+ " of " \+ pages\.length/);
  // Only a place in the book: no scoring, ranking or totals language on the paging surface.
  const paging = book.slice(book.indexOf("export function Book("));
  assert.equal(/score|rank|streak|total|most /i.test(paging), false);
});

test("UX7 Pair Mark: together in Ours or when the partner is online, never a metric", async () => {
  const shell = await source("../src/app/shell/AppShell.tsx");
  assert.equal(shell.includes('route === "ours" || partnerOnline'), true);
  const app = await source("../src/app/App.tsx");
  assert.equal(app.includes("conversation?.partner.presence.online === true"), true);
  const css = await source("../src/design/signature.css");
  const block = css.slice(css.indexOf("Pair Mark: when"));
  assert.match(block, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  assert.equal(/infinite/.test(css), false, "no looping signature animation");
});
