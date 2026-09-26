import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { formatPresence } from "../src/design/presence.ts";
import { parseRoute, routeHash } from "../src/app/shell/routes.ts";
import { resolveTheme } from "../src/design/theme-model.ts";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

type Tokens = Record<string, string>;

function blockAfter(css: string, marker: string): string {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, "missing token block: " + marker);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error("unterminated block: " + marker);
}

function parseTokens(block: string): Tokens {
  const tokens: Tokens = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[match[1] as string] = (match[2] as string).trim();
  }
  return tokens;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] as number) +
    0.7152 * (channels[1] as number) +
    0.0722 * (channels[2] as number)
  );
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const REQUIRED_ROLES = [
  "room",
  "surface",
  "surface-2",
  "raised",
  "mine",
  "paper",
  "glass",
  "ink",
  "ink-2",
  "ink-3",
  "ink-onpaper",
  "rose",
  "accent-fill",
  "accent-text",
  "on-accent",
  "candle",
  "accept",
  "accept-text",
  "end",
  "on-end",
  "end-text",
  "caution",
  "focus",
  "line",
  "line-strong",
];

const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ["ink", "room", 4.5],
  ["ink", "surface", 4.5],
  ["ink", "raised", 4.5],
  ["ink", "mine", 4.5],
  ["ink-2", "room", 4.5],
  ["ink-2", "surface", 4.5],
  ["ink-2", "raised", 4.5],
  ["ink-2", "surface-2", 4.5],
  ["ink-3", "room", 3],
  ["ink-onpaper", "paper", 4.5],
  ["accent-text", "room", 4.5],
  ["accent-text", "surface", 4.5],
  ["accent-text", "raised", 4.5],
  ["on-accent", "accent-fill", 4.5],
  ["on-end", "end", 4.5],
  ["end-text", "end-wash", 4.5],
  ["accept-text", "accept-wash", 4.5],
  ["ink", "caution-wash", 4.5],
  ["candle", "room", 3],
  ["candle", "surface", 3],
  ["rose", "room", 3],
  ["focus", "room", 3],
  ["focus", "surface", 3],
];

test("UX1 themes define every frozen color role and meet WCAG AA contrast", async () => {
  const css = await source("../src/design/tokens.css");
  const dawn = parseTokens(blockAfter(css, ':root,\n:root[data-theme="dawn"]'));
  const midnight = parseTokens(blockAfter(css, ':root[data-theme="midnight"]'));
  const systemDark = parseTokens(blockAfter(css, ":root:not([data-theme])"));

  for (const [name, tokens] of [
    ["dawn", dawn],
    ["midnight", midnight],
    ["system-dark", systemDark],
  ] as const) {
    for (const role of REQUIRED_ROLES) {
      assert.ok(tokens[role], name + " is missing role --" + role);
    }
    for (const [foreground, background, minimum] of PAIRS) {
      const ratio = contrast(tokens[foreground] as string, tokens[background] as string);
      assert.ok(
        ratio >= minimum,
        name +
          ": --" +
          foreground +
          " on --" +
          background +
          " is " +
          ratio.toFixed(2) +
          ", needs " +
          minimum,
      );
    }
  }
  assert.deepEqual(systemDark, midnight, "system dark must mirror Midnight exactly");
});

test("UX1 reduced motion collapses motion tokens and disables transform animation", async () => {
  const tokens = await source("../src/design/tokens.css");
  const design = await source("../src/design/design.css");
  const reduced = blockAfter(tokens, "@media (prefers-reduced-motion: reduce)");
  assert.equal(reduced.includes("--dur-move: 120ms"), true);
  const designReduced = blockAfter(design, "@media (prefers-reduced-motion: reduce)");
  assert.equal(designReduced.includes("animation-name: ds-fade-in"), true);
  assert.equal(designReduced.includes("animation: none"), true);
});

test("UX1 presence formatting reflects only the authoritative contract", () => {
  const now = new Date("2026-09-26T22:30:00");
  assert.equal(formatPresence({ online: true, lastSeenAt: null }, now), "Online");
  assert.equal(formatPresence({ online: false, lastSeenAt: null }, now), "Offline");
  assert.equal(formatPresence({ online: false, lastSeenAt: "not-a-date" }, now), "Offline");
  assert.equal(
    formatPresence({ online: false, lastSeenAt: "2026-09-26T22:25:00" }, now),
    "Last seen recently",
  );
  assert.match(
    formatPresence({ online: false, lastSeenAt: "2026-09-26T20:05:00" }, now, "en-US"),
    /^Last seen 8:05\s?PM$/,
  );
  assert.match(
    formatPresence({ online: false, lastSeenAt: "2026-09-25T21:00:00" }, now, "en-US"),
    /^Last seen yesterday 9:00\s?PM$/,
  );
  assert.match(
    formatPresence({ online: false, lastSeenAt: "2026-09-12T21:00:00" }, now, "en-US"),
    /^Last seen 12 Sep|Sep 12, 9:00\s?PM$/,
  );
  // Online always wins, even if a stale last-seen is present.
  assert.equal(formatPresence({ online: true, lastSeenAt: "2026-09-01T00:00:00" }, now), "Online");
});

test("UX1 routes map hashes to Home, Talk, Ours, and Us with Home as the default", () => {
  assert.equal(parseRoute(""), "home");
  assert.equal(parseRoute("#/talk"), "talk");
  assert.equal(parseRoute("#/ours/then"), "ours");
  assert.equal(parseRoute("#/us"), "us");
  assert.equal(parseRoute("#/unknown"), "home");
  assert.equal(routeHash("ours"), "#/ours");
  assert.equal(resolveTheme("system", true), "midnight");
  assert.equal(resolveTheme("system", false), "dawn");
  assert.equal(resolveTheme("dawn", true), "dawn");
});

test("UX1 keeps presence, typing, last seen, and read receipts non-optional", async () => {
  const forbidden = [
    /read[ -]?receipts?[^\n]{0,60}(toggle|switch|opt[ -]?out|disable|turn off|hide)/i,
    /(toggle|switch|opt[ -]?out|disable|turn off|hide)[^\n]{0,60}read[ -]?receipts?/i,
    /(hide|disable|turn off|toggle)[^\n]{0,40}last seen/i,
    /last seen[^\n]{0,40}(hidden|nobody|contacts only|privacy setting)/i,
    /(hide|disable|turn off|toggle)[^\n]{0,40}typing indicator/i,
    /(hide|disable|turn off|toggle)[^\n]{0,40}online status/i,
  ];
  async function walk(directory: URL): Promise<URL[]> {
    const output: URL[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) output.push(...(await walk(child)));
      else if (/\.(tsx?|css)$/.test(entry.name)) output.push(child);
    }
    return output;
  }
  for (const file of await walk(new URL("../src/", import.meta.url))) {
    const text = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, file.pathname + " matches " + pattern);
    }
  }
});

test("UX1 shell exposes Home, Talk, Ours navigation and keeps Talk and calls mounted", async () => {
  const shell = await source("../src/app/shell/AppShell.tsx");
  const app = await source("../src/app/App.tsx");
  const us = await source("../src/features/ours/us/UsScreen.tsx");
  assert.equal(app.includes("<UsScreen"), true);
  assert.equal(shell.includes('aria-label="Primary"'), true);
  assert.equal(shell.includes('aria-current={route === name ? "page" : undefined}'), true);
  assert.equal(app.includes('<RouteView active={route === "talk"} keepMounted>'), true);
  assert.equal(app.includes("calls={<CallingPanel"), true);
  for (const reachable of [
    "<PartnershipPanel />",
    "<PartnerRequestsPanel />",
    "Request account deletion",
  ]) {
    // UX4 moved the Us account sections into UsScreen; reachability is the invariant.
    assert.equal(us.includes(reachable), true, "Us must keep " + reachable);
  }
});
