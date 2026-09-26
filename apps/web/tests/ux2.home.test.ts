import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  daysBetween,
  daysPhrase,
  formatMessageWhen,
  latestPreview,
  pickMoment,
} from "../src/features/home/home-model.ts";
import type { RelationshipSpaceHome } from "../src/features/relationship-space/model.ts";

const ME = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "b0000000-0000-4000-8000-000000000002";

function message(overrides: Record<string, unknown> = {}) {
  return {
    senderAccountId: PARTNER,
    body: "  Good   morning\nlove ",
    createdAt: "2026-05-01T08:00:00.000Z",
    deletedAt: null,
    attachments: [] as Array<{ kind: string; role: string }>,
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "i1",
    kind: "memory",
    release: null,
    preview: { title: "Our first walk" },
    content: null,
    ...overrides,
  } as never;
}

function space(overrides: Record<string, unknown> = {}): RelationshipSpaceHome {
  return {
    mode: "active",
    serverDate: "2026-05-01",
    anniversary: { date: "2026-12-01", savedCurationItemId: null },
    recentItems: [],
    upcomingReleases: [],
    reunion: null,
    recentSignals: [],
    ...overrides,
  } as never;
}

test("UX2 latest preview normalizes text and identifies the sender without counting anything", () => {
  const preview = latestPreview(message(), ME);
  assert.deepEqual(preview && { fromMe: preview.fromMe, text: preview.text }, {
    fromMe: false,
    text: "Good morning love",
  });
  assert.equal(latestPreview(message({ senderAccountId: ME }), ME)?.fromMe, true);
});

test("UX2 latest preview hides deleted and empty messages and names attachments plainly", () => {
  assert.equal(latestPreview(null, ME), null);
  assert.equal(latestPreview(message({ deletedAt: "2026-05-01T09:00:00.000Z" }), ME), null);
  assert.equal(latestPreview(message({ body: null }), ME), null);
  assert.equal(
    latestPreview(
      message({ body: null, attachments: [{ kind: "voice", role: "voice_message" }] }),
      ME,
    )?.text,
    "Voice message",
  );
  assert.equal(
    latestPreview(message({ body: null, attachments: [{ kind: "image", role: "attachment" }] }), ME)
      ?.text,
    "Photo",
  );
  const long = latestPreview(message({ body: "x".repeat(400) }), ME);
  assert.ok(long && Array.from(long.text).length <= 140);
});

test("UX2 message time is the real timestamp, never invented precision", () => {
  const now = new Date("2026-05-01T20:00:00");
  assert.equal(formatMessageWhen("2026-04-30T10:00:00", now, "en-US"), "Yesterday");
  assert.match(formatMessageWhen("2026-05-01T09:30:00", now, "en-US"), /9:30/);
  assert.match(formatMessageWhen("2026-03-02T10:00:00", now, "en-US"), /Mar/);
  assert.equal(formatMessageWhen("not a date", now), "");
});

test("UX2 shows at most one moment and prefers the reunion the couple entered", () => {
  const reunion = item({
    kind: "reunion",
    featureState: { type: "reunion", targetDate: "2026-05-11" },
  });
  const moment = pickMoment(space({ reunion, recentItems: [item()] }), [item()]);
  assert.deepEqual(moment, { type: "reunion", days: 10, date: "2026-05-11" });
  assert.equal(daysPhrase(0), "Today");
  assert.equal(daysPhrase(1), "1 day");
  assert.equal(daysPhrase(10), "10 days");
  assert.equal(daysBetween("2026-05-01", "2026-05-11"), 10);
});

test("UX2 ignores a past reunion date and falls through gently", () => {
  const reunion = item({
    kind: "reunion",
    featureState: { type: "reunion", targetDate: "2026-04-01" },
  });
  assert.equal(pickMoment(space({ reunion }), []), null);
});

test("UX2 shows the anniversary only when it is close", () => {
  assert.equal(pickMoment(space({ anniversary: { date: "2026-05-04" } }), [])?.type, "anniversary");
  assert.equal(pickMoment(space({ anniversary: { date: "2026-08-04" } }), []), null);
});

test("UX2 this day and recent items never reveal locked, surprise, or proposal content", () => {
  const locked = item({ release: { state: "locked" } });
  const surprise = item({ kind: "surprise", preview: { title: "Secret" } });
  const proposal = item({ kind: "proposal", preview: { title: "Question" } });
  assert.equal(pickMoment(space({ recentItems: [locked, surprise, proposal] }), []), null);
  assert.deepEqual(pickMoment(space({ recentItems: [locked, item()] }), []), {
    type: "recent",
    title: "Our first walk",
  });
  assert.equal(pickMoment(space(), [item()])?.type, "this_day");
});

test("UX2 has nothing to show for unavailable or absent space", () => {
  assert.equal(pickMoment(null, []), null);
  assert.equal(pickMoment(space({ mode: "terminated_or_unavailable" }), [item()]), null);
});

test("UX2 Home is read-only and free of metrics, urgency, and encryption claims", async () => {
  const directory = new URL("../src/features/home/", import.meta.url);
  const forbidden = [
    /method:\s*["'](POST|PUT|PATCH|DELETE)["']/,
    /\/receipts?\b|markRead|readThrough/i,
    /streak|score|leaderboard|engagement|unread/i,
    /end-to-end|encrypted|only we can read/i,
    /\u2014/,
    /hurry|don't miss|running out|last chance/i,
  ];
  for (const entry of await readdir(directory)) {
    if (!/\.(tsx?|css)$/.test(entry)) continue;
    const text = await readFile(new URL(entry, directory), "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, entry + " matches " + pattern);
    }
  }
});
