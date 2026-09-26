import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { relationshipItemCreateSchema } from "@shawtie/contracts";
import {
  buildRememberThisPayload,
  buildRows,
  deliveryLabel,
  isLongMessage,
  timeSeparatorLabel,
} from "../src/features/messaging/talk-model.ts";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

const NOW = new Date("2026-09-26T15:00:00");

test("UX3 time separators read like people talk", () => {
  assert.equal(timeSeparatorLabel(new Date("2026-09-26T09:15:00"), NOW), "This morning");
  assert.equal(timeSeparatorLabel(new Date("2026-09-26T13:00:00"), NOW), "This afternoon");
  assert.equal(timeSeparatorLabel(new Date("2026-09-26T14:59:00"), NOW), "This afternoon");
  assert.equal(timeSeparatorLabel(new Date("2026-09-25T19:30:00"), NOW), "Yesterday evening");
  assert.equal(timeSeparatorLabel(new Date("2026-09-25T23:30:00"), NOW), "Yesterday night");
  // 2026-09-22 is a Tuesday.
  assert.equal(
    timeSeparatorLabel(new Date("2026-09-22T18:00:00"), NOW, "en-US"),
    "Tuesday evening",
  );
  assert.equal(
    timeSeparatorLabel(new Date("2026-08-01T08:00:00"), NOW, "en-US"),
    "August 1, morning",
  );
  assert.match(
    timeSeparatorLabel(new Date("2025-08-01T08:00:00"), NOW, "en-US"),
    /^August 1, 2025, morning$/,
  );
});

test("UX3 grouping keeps speakers together and separates them by time of day", () => {
  const SELF = "self";
  const messages = [
    { messageId: "a", senderAccountId: "them", createdAt: "2026-09-25T10:00:00" },
    { messageId: "b", senderAccountId: "them", createdAt: "2026-09-25T10:02:00" },
    { messageId: "c", senderAccountId: "them", createdAt: "2026-09-25T10:04:00" },
    { messageId: "d", senderAccountId: SELF, createdAt: "2026-09-25T10:05:00" },
    { messageId: "e", senderAccountId: SELF, createdAt: "2026-09-25T10:40:00" },
    { messageId: "f", senderAccountId: "them", createdAt: "2026-09-26T09:00:00" },
  ];
  const rows = buildRows(messages, SELF, NOW, "en-US");
  const summary = rows.map((row) =>
    row.type === "separator" ? "sep:" + row.label : row.message.messageId + ":" + row.position,
  );
  assert.deepEqual(summary, [
    "sep:Yesterday morning",
    "a:first",
    "b:middle",
    "c:last",
    "d:single",
    // e is the same person but 35 minutes later, so it starts a new group.
    "e:single",
    "sep:This morning",
    "f:single",
  ]);
  const own = rows.filter((row) => row.type === "message" && row.own);
  assert.equal(own.length, 2);
});

test("UX3 delivery labels follow the existing receipt high-water marks", () => {
  const receipts = { partnerDeliveredThrough: 5, partnerReadThrough: 3 };
  assert.equal(deliveryLabel(receipts, 2), "Read");
  assert.equal(deliveryLabel(receipts, 3), "Read");
  assert.equal(deliveryLabel(receipts, 4), "Delivered");
  assert.equal(deliveryLabel(receipts, 6), "Sent");
});

test("UX3 long messages collapse by length or line count", () => {
  assert.equal(isLongMessage(null), false);
  assert.equal(isLongMessage("short"), false);
  assert.equal(isLongMessage("x".repeat(601)), true);
  assert.equal(isLongMessage(Array.from({ length: 11 }, () => "a").join("\n")), true);
});

test("UX3 Remember This payload satisfies the existing R1 create contract", () => {
  const payload = buildRememberThisPayload({
    messageId: "e0000001-0000-4000-8000-000000000001",
    body: "You are my favorite person",
    authorName: "Gulnur",
    createdAt: "2026-09-25T10:00:00.000Z",
  });
  const parsed = relationshipItemCreateSchema.parse(payload);
  assert.equal(parsed.kind, "remember_this");
  assert.equal(parsed.release, null);
  assert.deepEqual(parsed.references, [
    {
      referenceType: "message",
      referenceId: "e0000001-0000-4000-8000-000000000001",
      role: "source",
      position: 0,
    },
  ]);
  // Snapshot is an independent client copy; provenance is only the loose reference.
  assert.equal(payload.content.snapshotText, "You are my favorite person");
});

async function talkFiles(): Promise<URL[]> {
  const dirs = ["../src/features/messaging/", "../src/features/media/"];
  const out: URL[] = [];
  for (const dir of dirs) {
    for (const name of await readdir(new URL(dir, import.meta.url))) {
      if (/\.(tsx?|css)$/.test(name)) out.push(new URL(dir + name, import.meta.url));
    }
  }
  return out;
}

test("UX3 copy claims no encryption and uses no Unicode em dash", async () => {
  for (const file of await talkFiles()) {
    const text = await readFile(file, "utf8");
    assert.equal(
      text.includes(String.fromCodePoint(0x2014)),
      false,
      file.pathname + " contains an em dash",
    );
    // User-facing strings only: identifiers such as ciphertextBytes are not claims.
    const strings = [...text.matchAll(/"([^"\n]{3,})"/g)].map((match) => match[1] ?? "");
    for (const value of strings) {
      assert.equal(
        /encrypted|end-to-end|only we can read|protected (media|attachment|voice)/i.test(value),
        false,
        file.pathname + " makes an unverified privacy claim: " + value,
      );
    }
  }
});

test("UX3 keeps receipts, presence, and typing mutual with no controls to hide them", async () => {
  const panel = await source("../src/features/messaging/MessagingPanel.tsx");
  assert.equal(panel.includes("PresenceLine"), true);
  assert.equal(panel.includes("toLocaleString"), false, "last seen uses the shared formatting");
  assert.equal(panel.includes("partner.presence"), true);
  assert.equal(panel.includes("partner.typing"), true);
  assert.equal(/setting|toggle|opt[ -]?out/i.test(panel.replace(/\/\*[\s\S]*?\*\//g, "")), false);
});

test("UX3 message actions map only to existing operations and gate on existing capabilities", async () => {
  const panel = await source("../src/features/messaging/MessagingPanel.tsx");
  for (const operation of [
    '"message.edit"',
    '"message.delete"',
    '"reaction.set"',
    '"reaction.remove"',
  ]) {
    assert.equal(panel.includes(operation), true, operation);
  }
  assert.equal(panel.includes("window.confirm"), false);
  assert.equal(panel.includes("window.prompt"), false);
  assert.equal(panel.includes("conversation.capabilities.sendMessage"), true);
  assert.equal(panel.includes("messageMutable(actionMessage, conversation)"), true);
  assert.equal(panel.includes("messageEditable(actionMessage, conversation)"), true);
  assert.equal(panel.includes("account_deletion_view_only"), true);
});

test("UX3 Keep uses the existing R1 create and reports the shared visibility truthfully", async () => {
  const panel = await source("../src/features/messaging/MessagingPanel.tsx");
  const actions = await source("../src/features/messaging/TalkActions.tsx");
  assert.equal(panel.includes("createRelationshipItem"), true);
  assert.equal(panel.includes("buildRememberThisPayload"), true);
  assert.equal(panel.includes('"Kept for us."'), true);
  assert.equal(actions.includes("Only you can change or remove it."), true);
  // No edit or delete of a kept item is offered from Talk.
  assert.equal(/patchRelationshipItem|deleteRelationshipItem/.test(panel), false);
});
