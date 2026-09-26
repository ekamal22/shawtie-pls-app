import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  bucketItems,
  calendarDateText,
  chapterOf,
  CHAPTER_KINDS,
  curate,
  durationText,
  hasVoiceLetter,
  itemAuthority,
  lensKinds,
  occurrenceText,
} from "../src/features/ours/chapters.ts";
import { CREATE_INTENTS } from "../src/features/ours/create-payload.ts";
import type { RelationshipItem } from "../src/features/relationship-space/model.ts";

const ME = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";

let counter = 0;
function item(overrides: Partial<RelationshipItem> = {}): RelationshipItem {
  counter += 1;
  return {
    itemId: "00000000-0000-4000-8000-" + String(counter).padStart(12, "0"),
    kind: "memory",
    creatorAccountId: ME,
    version: 1,
    createdAt: new Date(Date.UTC(2026, 0, counter)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, counter)).toISOString(),
    occurrence: null,
    storyIncluded: false,
    release: null,
    featureState: null,
    contentSchemaVersion: 1,
    preview: null,
    content: { title: "Title " + counter, note: null },
    references: [],
    links: [],
    ...overrides,
  } as RelationshipItem;
}

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("UX4 chapters map every creatable item kind to exactly one Then, Now, or Next chapter", () => {
  const all = [...CHAPTER_KINDS.then, ...CHAPTER_KINDS.now, ...CHAPTER_KINDS.next];
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 14);
  assert.equal(chapterOf("first"), "then");
  assert.equal(chapterOf("remember_this"), "then");
  assert.equal(chapterOf("for_you"), "now");
  assert.equal(chapterOf("relationship_signal"), "now");
  assert.equal(chapterOf("future_us"), "next");
  assert.equal(chapterOf("reunion"), "next");
});

test("UX4 lenses are presentation filters over existing kinds inside Then", () => {
  assert.deepEqual(lensKinds("then", "firsts"), ["first"]);
  assert.deepEqual(lensKinds("then", "places"), ["place"]);
  assert.deepEqual(lensKinds("then", "kept"), ["remember_this"]);
  assert.deepEqual(lensKinds("then", "all"), CHAPTER_KINDS.then);
  assert.deepEqual(lensKinds("now", "kept"), CHAPTER_KINDS.now);
});

test("UX4 sealed letters never appear as chapter content and duplicates collapse", () => {
  const sealed = item({
    kind: "for_you",
    release: {
      mode: "scheduled",
      generation: 1,
      unlockAt: "2027-01-01T00:00:00.000Z",
      releasedAt: null,
      state: "locked",
    },
  });
  const released = item({
    kind: "for_you",
    release: {
      mode: "immediate",
      generation: 1,
      unlockAt: null,
      releasedAt: "2026-01-01T00:00:00.000Z",
      state: "released",
    },
  });
  const signal = item({ kind: "relationship_signal", content: { sharedFeelingText: null } });
  const buckets = bucketItems([sealed, released, released, signal, item({ kind: "someday" })]);
  assert.deepEqual(
    buckets.now.map((entry) => entry.itemId),
    [released.itemId, signal.itemId],
  );
  assert.equal(buckets.next.length, 1);
  assert.equal(buckets.then.length, 0);
});

test("UX4 curation shows a few items, ordered by when it happened for Then", () => {
  const items = [
    item({ occurrence: { precision: "year", year: 2019, month: null, day: null } }),
    item({ occurrence: { precision: "day", year: 2024, month: 5, day: 3 } }),
    item({ occurrence: { precision: "month", year: 2022, month: 8, day: null } }),
    item({ occurrence: { precision: "day", year: 2021, month: 1, day: 1 } }),
  ];
  const shown = curate("then", items);
  assert.equal(shown.length, 3);
  assert.deepEqual(
    shown.map((entry) => occurrenceText(entry)),
    ["3 May 2024", "August 2022", "1 January 2021"],
  );
});

test("UX4 date wording never invents precision", () => {
  assert.equal(occurrenceText(item({ occurrence: null })), null);
  assert.equal(
    occurrenceText(
      item({ occurrence: { precision: "unknown", year: null, month: null, day: null } }),
    ),
    null,
  );
  assert.equal(calendarDateText("2025-06-01"), "1 June 2025");
  assert.equal(durationText({ years: 1, months: 0, days: 2 }), "1 year, 2 days");
  assert.equal(durationText({ years: 0, months: 0, days: 0 }), "Today");
});

test("UX4 Remember This is shared to read and creator-only to edit or delete", () => {
  const mine = item({
    kind: "remember_this",
    content: { snapshotText: "x", title: null, note: null },
  });
  const theirs = item({
    kind: "remember_this",
    creatorAccountId: PARTNER,
    content: { snapshotText: "x", title: null, note: null },
  });
  assert.deepEqual(itemAuthority(mine, ME, false), {
    canEdit: true,
    canDelete: true,
    isCreator: true,
  });
  assert.deepEqual(itemAuthority(theirs, ME, false), {
    canEdit: false,
    canDelete: false,
    isCreator: false,
  });
  // View-only removes every change control for everyone.
  assert.equal(itemAuthority(mine, ME, true).canDelete, false);
  assert.equal(itemAuthority(mine, ME, true).canEdit, false);
});

test("UX4 voice letters are detected from the existing media role", () => {
  const letter = item({
    kind: "for_you",
    references: [
      {
        referenceType: "media",
        referenceId: "10000000-0000-4000-8000-000000000001",
        role: "voice_letter",
        position: 0,
      },
    ],
  } as Partial<RelationshipItem>);
  assert.equal(hasVoiceLetter(letter), true);
  assert.equal(hasVoiceLetter(item()), false);
});

test("UX4 create intents cover every creatable kind exactly once", () => {
  const kinds = CREATE_INTENTS.flatMap((intent) => intent.kinds.map((entry) => entry.kind));
  assert.equal(new Set(kinds).size, kinds.length);
  assert.equal(kinds.length, 12);
  assert.equal(kinds.includes("our_year" as never), false);
  assert.equal(kinds.includes("anniversary" as never), false);
});

test("UX4 surfaces never make privacy claims the runtime cannot support", async () => {
  async function walk(directory: URL): Promise<URL[]> {
    const output: URL[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) output.push(...(await walk(child)));
      else if (/\.(tsx?|css)$/.test(entry.name)) output.push(child);
    }
    return output;
  }
  const files = [
    ...(await walk(new URL("../src/features/ours/", import.meta.url))),
    ...(await walk(new URL("../src/features/partnership/", import.meta.url))),
    ...(await walk(new URL("../src/features/notifications/", import.meta.url))),
    ...(await walk(new URL("../src/features/partner-requests/", import.meta.url))),
  ];
  const forbidden = [
    /end[- ]to[- ]end/i,
    /only (we|you|the two of you) can read/i,
    /\bencrypted\b/i,
    new RegExp(String.fromCodePoint(0x2014)),
  ];
  for (const file of files) {
    if (file.pathname.includes("/content/")) continue;
    const text = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, file.pathname + " matches " + pattern);
    }
  }
});

test("UX4 adds no teaser, countdown, or scheduled-release hint for unreleased release-gated items", async () => {
  const items = await source("../src/features/ours/OursItems.tsx");
  const screen = await source("../src/features/ours/OursScreen.tsx");
  for (const text of [items, screen]) {
    for (const teaser of [
      /Sealed/,
      /Scheduled for/,
      /Opens \w/,
      /This will open/,
      /coming soon/i,
    ]) {
      assert.equal(teaser.test(text), false, "teaser wording matches " + teaser);
    }
  }
  // Locked items are never chapter content and never counted.
  const chapters = await source("../src/features/ours/chapters.ts");
  assert.equal(chapters.includes("if (!isChapterContent(item)) continue;"), true);
  assert.equal(/\.length\s*\+?\s*"?\s*(waiting|sealed|hidden)/i.test(screen), false);
});

test("UX4 lifecycle copy stays neutral and Us keeps every action reachable", async () => {
  const partnership = await source("../src/features/partnership/PartnershipPanel.tsx");
  const notifications = await source("../src/features/notifications/NotificationsPanel.tsx");
  for (const action of [
    "Start breakup",
    "Cancel breakup",
    "Restore partnership",
    "Save relationship date",
  ]) {
    assert.equal(partnership.includes(action), true, "missing " + action);
  }
  // Confirmation consequence text is unchanged even though it now lives in a shared dialog.
  assert.equal(
    partnership.includes(
      "Start the breakup process? You can cancel directly only during the first hour.",
    ),
    true,
  );
  assert.equal(
    partnership.includes(
      "Submit your restore request? It cannot be withdrawn during this breakup process.",
    ),
    true,
  );
  assert.equal(partnership.includes("window.confirm"), false);
  const urgency = [/hurry/i, /last chance/i, /too late/i, /approaching/i, /running out/i];
  for (const pattern of urgency) {
    assert.equal(pattern.test(partnership), false, "partnership " + pattern);
    assert.equal(pattern.test(notifications), false, "notifications " + pattern);
  }
  const us = await source("../src/features/ours/us/UsScreen.tsx");
  assert.equal(us.includes("window.confirm"), false);
  assert.equal(us.includes("Request account deletion now?"), true);
});
