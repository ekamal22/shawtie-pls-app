import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildSequencePages,
  buildSignalPayload,
  canDeleteItem,
  canEditItem,
  describeOccurrence,
  formatCalendarDate,
  groupStoryByYear,
  messageReferenceId,
  orderByCurationLinks,
  reunionPhrase,
  sealInfo,
  sortByOccurrence,
  togetherPhrase,
  voiceLetterReferences,
  yearsAgoPhrase,
} from "../src/features/ours/content/model.ts";
import type { RelationshipItem } from "../src/features/relationship-space/model.ts";

const ME = "a0000000-0000-4000-8000-000000000001";
const THEM = "b0000000-0000-4000-8000-000000000002";

function item(overrides: Partial<RelationshipItem> = {}): RelationshipItem {
  return {
    itemId: "10000000-0000-4000-8000-000000000001",
    kind: "memory",
    creatorAccountId: ME,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    occurrence: null,
    storyIncluded: true,
    release: null,
    featureState: null,
    contentSchemaVersion: 1,
    preview: null,
    content: { title: "Title" },
    references: [],
    links: [],
    ...overrides,
  };
}

const locked = (mode: "scheduled" | "recipient_open" | "creator_reveal", unlockAt: string | null) =>
  ({
    mode,
    generation: 1,
    unlockAt,
    releasedAt: null,
    state: "locked" as const,
  }) as const;

test("occurrence precision is explicit and never shifted by timezone", () => {
  const day = describeOccurrence({ precision: "day", year: 2024, month: 2, day: 14 });
  assert.equal(day.lead, "14");
  assert.equal(day.rest, "February 2024");
  assert.equal(day.precisionLabel, "Exact day");
  assert.equal(day.dateTime, "2024-02-14");
  const month = describeOccurrence({ precision: "month", year: 2024, month: 2, day: null });
  assert.equal(month.lead, "February");
  assert.equal(month.dateTime, "2024-02");
  const year = describeOccurrence({ precision: "year", year: 2023, month: null, day: null });
  assert.equal(year.lead, "2023");
  assert.equal(year.dateTime, "2023");
  const unknown = describeOccurrence({ precision: "unknown", year: null, month: null, day: null });
  assert.equal(unknown.dateTime, null);
  assert.equal(unknown.full, "Date unknown");
  assert.equal(describeOccurrence(null).lead, "Undated");
  assert.equal(formatCalendarDate("2025-06-01"), "1 June 2025");
});

test("story grouping builds a year rail only from years that exist, undated last", () => {
  const items = [
    item({ itemId: "1", occurrence: { precision: "year", year: 2022, month: null, day: null } }),
    item({ itemId: "2", occurrence: { precision: "day", year: 2022, month: 3, day: 4 } }),
    item({ itemId: "3", occurrence: null }),
    item({ itemId: "4", occurrence: { precision: "unknown", year: null, month: null, day: null } }),
    item({ itemId: "5", occurrence: { precision: "month", year: 2021, month: 8, day: null } }),
  ];
  const groups = groupStoryByYear(items);
  assert.deepEqual(
    groups.map((group) => group.key),
    ["y2021", "y2022", "undated"],
  );
  assert.equal(groups[1]?.items.length, 2);
  assert.equal(groups[2]?.items.length, 2);
  assert.deepEqual(
    sortByOccurrence(items).map((entry) => entry.itemId),
    ["5", "1", "2", "3", "4"],
  );
});

test("Remember This authority: reads are shared, edit and delete are creator only", () => {
  const mine = item({ kind: "remember_this", creatorAccountId: ME });
  const theirs = item({ kind: "remember_this", creatorAccountId: THEM });
  assert.equal(canEditItem(mine, ME, false), true);
  assert.equal(canDeleteItem(mine, ME, false), true);
  assert.equal(canEditItem(theirs, ME, false), false);
  assert.equal(canDeleteItem(theirs, ME, false), false);
  assert.equal(canEditItem(mine, ME, true), false);
  assert.equal(canDeleteItem(mine, ME, true), false);
  // Shared curated kinds remain either-partner per the existing policy.
  assert.equal(canDeleteItem(item({ kind: "reunion", creatorAccountId: THEM }), ME, false), true);
});

test("Memory Return reads only the loose message source reference", () => {
  const messageId = "20000000-0000-4000-8000-000000000009";
  const withSource = item({
    kind: "remember_this",
    references: [{ referenceType: "message", referenceId: messageId, role: "source", position: 0 }],
  });
  assert.equal(messageReferenceId(withSource), messageId);
  assert.equal(messageReferenceId(item({ kind: "remember_this" })), null);
  const voice = item({
    kind: "for_you",
    references: [
      { referenceType: "media", referenceId: messageId, role: "voice_letter", position: 0 },
      { referenceType: "media", referenceId: THEM, role: "attachment", position: 1 },
    ],
  });
  assert.equal(voiceLetterReferences(voice).length, 1);
});

test("sealed presentation exposes only what the projection returns and never teases", () => {
  const when = (iso: string) => "at " + iso;
  const scheduled = item({
    kind: "for_you",
    release: locked("scheduled", "2026-12-24T09:00:00.000Z"),
  });
  const recipient = sealInfo(scheduled, THEM, false, when);
  assert.equal(recipient?.band, "Sealed");
  assert.equal(recipient?.canRelease, false);
  const creator = sealInfo(scheduled, ME, false, when);
  assert.equal(creator?.band, "Sealed until it arrives");

  const open = sealInfo(
    item({
      kind: "for_you",
      preview: { conditionLabel: "Open when you need reassurance" },
      release: locked("recipient_open", null),
    }),
    THEM,
    false,
    when,
  );
  assert.equal(open?.canRelease, true);
  assert.equal(open?.releaseLabel, "Open the letter");
  assert.equal(open?.detail, "Open when you need reassurance");

  const reveal = item({ kind: "surprise", release: locked("creator_reveal", null) });
  assert.equal(sealInfo(reveal, THEM, false, when)?.canRelease, false);
  assert.equal(sealInfo(reveal, THEM, false, when)?.band, "Sealed");
  assert.equal(sealInfo(reveal, ME, false, when)?.canRelease, true);
  // View-only states never offer a release action.
  assert.equal(sealInfo(reveal, ME, true, when)?.canRelease, false);
  // Released items carry no sealed band.
  assert.equal(
    sealInfo(
      item({
        release: {
          mode: "recipient_open",
          generation: 1,
          unlockAt: null,
          releasedAt: "2026-02-01T00:00:00.000Z",
          state: "released",
        },
      }),
      ME,
      false,
      when,
    ),
    null,
  );
});

test("time language is calm and coarse", () => {
  assert.equal(reunionPhrase("2026-01-01", "2026-01-01"), "Together today");
  assert.equal(reunionPhrase("2026-01-01", "2026-01-02"), "Tomorrow");
  assert.equal(reunionPhrase("2026-01-01", "2026-01-06"), "In 5 days");
  assert.equal(reunionPhrase("2026-01-01", "2026-01-29"), "In about 4 weeks");
  assert.equal(reunionPhrase("2026-01-01", "2026-06-01"), "In about 5 months");
  assert.equal(togetherPhrase({ years: 1, months: 3, days: 9 }), "1 year, 3 months");
  assert.equal(togetherPhrase({ years: 0, months: 0, days: 0 }), "Just beginning");
  assert.equal(
    yearsAgoPhrase(
      "2026-05-05",
      item({ occurrence: { precision: "day", year: 2023, month: 5, day: 5 } }),
    ),
    "3 years ago today",
  );
});

test("signal payload keeps the existing contract shape", () => {
  const payload = buildSignalPayload("thinking_of_you", "") as Record<string, unknown>;
  assert.equal(payload.kind, "relationship_signal");
  assert.deepEqual(payload.featureState, {
    type: "relationship_signal",
    signalKind: "thinking_of_you",
  });
  assert.equal(payload.occurrence, null);
  assert.deepEqual(payload.references, []);
});

test("sequence pages and curation order follow the stored payloads", () => {
  const surprise = item({
    kind: "surprise",
    content: {
      intro: "Hello",
      steps: [
        { type: "text", text: "One" },
        { type: "text", text: "Two" },
      ],
    },
    references: [{ referenceType: "media", referenceId: THEM, role: "voice_letter", position: 0 }],
  });
  assert.deepEqual(
    buildSequencePages(surprise).map((page) => page.kind),
    ["intro", "step", "step", "media"],
  );
  const a = item({ itemId: "a" });
  const b = item({ itemId: "b" });
  const saved = item({
    kind: "our_year",
    links: [
      { linkType: "curation", targetItemId: "b", position: 0 },
      { linkType: "curation", targetItemId: "a", position: 1 },
      { linkType: "curation", targetItemId: "missing", position: 2 },
    ],
  });
  assert.deepEqual(
    orderByCurationLinks([a, b], saved).map((entry) => entry.itemId),
    ["b", "a"],
  );
});

async function contentSources(): Promise<Array<{ name: string; text: string }>> {
  const directory = new URL("../src/features/ours/content/", import.meta.url);
  const output: Array<{ name: string; text: string }> = [];
  for (const entry of await readdir(directory)) {
    if (/\.(tsx?|css)$/.test(entry)) {
      output.push({ name: entry, text: await readFile(new URL(entry, directory), "utf8") });
    }
  }
  const panel = "../src/features/relationship-space/RelationshipSpacePanel.tsx";
  output.push({
    name: "RelationshipSpacePanel.tsx",
    text: await readFile(new URL(panel, import.meta.url), "utf8"),
  });
  return output;
}

test("UX6 copy claims no encryption for user content and uses no em dash", async () => {
  for (const { name, text } of await contentSources()) {
    assert.equal(
      /encrypt/i.test(text.replace(/ciphertextBytes/g, "")),
      false,
      name + " mentions encryption",
    );
    assert.equal(/only we can read/i.test(text), false, name);
    assert.equal(text.includes(String.fromCharCode(0x2014)), false, name + " contains an em dash");
  }
});

test("UX6 keeps receipts, presence and typing non-optional and adds no teaser wording", async () => {
  for (const { name, text: raw } of await contentSources()) {
    // Comments may explain what is deliberately absent; only shipped code and copy count.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(
      /(toggle|opt[ -]?out|turn off)[^\n]{0,40}(receipt|last seen|typing|presence)/i.test(text),
      false,
      name,
    );
    assert.equal(
      /something is waiting|something is being prepared|you have \d+ (letters|surprises)/i.test(
        text,
      ),
      false,
      name,
    );
    assert.equal(/streak|days in a row|of 365|leaderboard/i.test(text), false, name);
  }
});

test("UX6 composer keeps the offline media rule and the idempotent create flow", async () => {
  const composer = await readFile(
    new URL("../src/features/ours/content/Composer.tsx", import.meta.url),
    "utf8",
  );
  const submit = composer.slice(composer.indexOf("async function submit"));
  assert.ok(submit.indexOf("mediaDrafts.length > 0 && !navigator.onLine") >= 0);
  assert.ok(
    submit.indexOf("OFFLINE_OPERATION_REQUIRES_CONNECTION") < submit.indexOf("uploadMediaDraft"),
  );
  assert.equal(composer.includes("createRelationshipItem"), true);
  assert.equal(composer.includes("saved on this device"), true);
});
