import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HIGH_CONFIDENCE_PATTERNS = [
  ["BREVO_API_KEY", /xkeysib-[A-Za-z0-9_-]{16,}/g],
  ["GITHUB_TOKEN", /gh[pousr]_[A-Za-z0-9_]{30,}/g],
  ["GITHUB_FINE_GRAINED_TOKEN", /github_pat_[A-Za-z0-9_]{40,}/g],
  ["AWS_ACCESS_KEY", /AKIA[0-9A-Z]{16}/g],
  ["SLACK_TOKEN", /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ["GOOGLE_API_KEY", /AIza[0-9A-Za-z_-]{30,}/g],
  ["STRIPE_LIVE_SECRET", /sk_live_[0-9A-Za-z]{16,}/g],
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];

const PLACEHOLDER_MARKERS = [
  "<secret",
  "<paste",
  "<read from",
  "your_",
  "your-",
  "example",
  "placeholder",
  "test-key",
  "dummy",
];

function command(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function placeholderContext(line) {
  const value = line.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

function scan(label, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (placeholderContext(line)) continue;
    for (const [name, pattern] of HIGH_CONFIDENCE_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({ source: label, line: index + 1, rule: name });
      }
    }
  }
  return findings;
}

const shallow = command(["rev-parse", "--is-shallow-repository"]).trim() === "true";
if (process.env.SECRET_SCAN_REQUIRE_FULL_HISTORY === "1" && shallow) {
  console.error("SECRET_SCAN_FAIL repository_is_shallow=true");
  process.exit(1);
}

const findings = [];

const tracked = command(["ls-files", "-z"]).split("\0").filter(Boolean);
for (const path of tracked) {
  if (
    path.startsWith("node_modules/") ||
    path.startsWith("apps/web/dist/") ||
    path.endsWith(".lock")
  ) {
    continue;
  }
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  findings.push(...scan(path, text));
}

const historyPatch = command([
  "log",
  "--all",
  "--no-ext-diff",
  "--format=commit:%H",
  "--patch",
  "--no-color",
  "--",
  ".",
]);
findings.push(...scan("git-history", historyPatch));

if (findings.length > 0) {
  console.error("SECRET_SCAN_FAIL");
  for (const finding of findings.slice(0, 100)) {
    console.error(
      finding.source + ":" + finding.line + " rule=" + finding.rule,
    );
  }
  if (findings.length > 100) {
    console.error("Additional findings: " + String(findings.length - 100));
  }
  process.exit(1);
}

console.log("SECRET_SCAN_PASS tracked=" + tracked.length + " history=" + (shallow ? "shallow" : "full"));
