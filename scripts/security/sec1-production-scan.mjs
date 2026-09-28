import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

const webSourceFiles = walk("apps/web/src").filter((path) =>
  [".ts", ".tsx"].includes(extname(path)),
);

for (const path of webSourceFiles) {
  const source = readFileSync(path, "utf8");
  if (/\bstyle\s*=\s*\{/.test(source)) {
    throw new Error("SEC1 inline React style remains: " + path);
  }
  if (/\.style\s*\./.test(source) || /setAttribute\(\s*["']style["']/.test(source)) {
    throw new Error("SEC1 direct inline-style write remains: " + path);
  }
}

const distFiles = walk("apps/web/dist").filter((path) =>
  [".html", ".js", ".css"].includes(extname(path)),
);
const sentinel = "123456789987654321";
for (const path of distFiles) {
  const source = readFileSync(path, "utf8");
  if (source.includes(sentinel)) {
    throw new Error("SEC1 server-only common-password corpus leaked into web output: " + path);
  }
  if (/\beval\s*\(/.test(source) || /new\s+Function\s*\(/.test(source)) {
    throw new Error("SEC1 production web output contains dynamic JavaScript evaluation: " + path);
  }
}

const commonPasswordCorpus = readFileSync(
  "apps/api/src/security/common-passwords.generated.ts",
  "utf8",
);
for (const forbidden of ["passwordpassword", "123456789987654321"]) {
  if (commonPasswordCorpus.includes(forbidden)) {
    throw new Error("SEC1 common-password runtime corpus contains plaintext password data");
  }
}
const digestRows = [
  ...commonPasswordCorpus.matchAll(/\n\s*"([0-9a-f]{64})",/g),
].map((match) => match[1]);
if (digestRows.length !== 327 || new Set(digestRows).size !== 327) {
  throw new Error("SEC1 common-password runtime digest corpus is malformed");
}

const serverSecurity = readFileSync("apps/web/server-security.mjs", "utf8");
for (const required of [
  "'wasm-unsafe-eval'",
  '"Strict-Transport-Security"',
  '"Content-Security-Policy"',
  '"X-Content-Type-Options"',
  '"Referrer-Policy"',
  '"Permissions-Policy"',
  '"X-Frame-Options"',
]) {
  if (!serverSecurity.includes(required)) {
    throw new Error("SEC1 production header authority is missing " + required);
  }
}

console.log("SEC1_PRODUCTION_SCAN_PASS");
