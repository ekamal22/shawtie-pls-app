import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const SOURCE_REPOSITORY = "danielmiessler/SecLists";
const SOURCE_COMMIT = "2e3e92569043d24297ca6c35070078e5cf41651e";
const SOURCE_PATH = "Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt";
const SOURCE_BLOB_SHA = "38eb37702244f55fda75cab281eb2145cd7685b6";
const SOURCE_FILE = "security-data/common-passwords/100k-most-used-passwords-NCSC.txt";
const OUTPUT = "apps/api/src/security/common-passwords.generated.ts";

function gitBlobSha(bytes) {
  const prefix = Buffer.from("blob " + bytes.length + "\0", "utf8");
  return createHash("sha1").update(prefix).update(bytes).digest("hex");
}

function utf8Bytes(value) {
  return Buffer.byteLength(value.normalize("NFC"), "utf8");
}

function structurallyRelevant(value) {
  const normalized = value.normalize("NFC");
  const length = [...normalized].length;
  return length >= 15 && length <= 128 && utf8Bytes(normalized) <= 1024;
}

function decodeSourceEntry(value) {
  const match = /^\$HEX\[([0-9a-f]+)\]$/i.exec(value);
  if (!match) return value;
  const hex = match[1];
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = Buffer.from(hex, "hex");
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) return null;
  return decoded;
}

async function loadSource() {
  const sourceFile = process.env.SEC1_COMMON_PASSWORD_SOURCE_FILE?.trim() || SOURCE_FILE;
  return readFile(sourceFile);
}

function generatedSource(rawBytes) {
  const blobSha = gitBlobSha(rawBytes);
  if (blobSha !== SOURCE_BLOB_SHA) {
    throw new Error(
      "Pinned common-password source checksum mismatch. expected=" +
        SOURCE_BLOB_SHA +
        " actual=" +
        blobSha,
    );
  }

  const raw = rawBytes
    .toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const effective = [
    ...new Set(
      raw
        .map(decodeSourceEntry)
        .filter((value) => value !== null)
        .map((value) => value.normalize("NFC").toLowerCase())
        .filter(structurallyRelevant),
    ),
  ].sort();

  const license = `// SecLists is distributed under the MIT License:
//
// Copyright (c) 2018 Daniel Miessler
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.\n`;

  return (
    "// GENERATED FILE. DO NOT EDIT BY HAND.\n" +
    "// Regenerate: npm run sec1:passwords:generate\n" +
    "// Source: https://github.com/" +
    SOURCE_REPOSITORY +
    "/blob/" +
    SOURCE_COMMIT +
    "/" +
    SOURCE_PATH +
    "\n" +
    "// Source repository commit: " +
    SOURCE_COMMIT +
    "\n" +
    "// Source Git blob SHA: " +
    SOURCE_BLOB_SHA +
    "\n" +
    "// Source entry count: " +
    raw.length +
    "\n" +
    "// Effective entries after Shawtie structural password bounds: " +
    effective.length +
    "\n//\n" +
    license +
    "\nexport const COMMON_PASSWORD_SOURCE = {\n" +
    "  repositoryCommit: " +
    JSON.stringify(SOURCE_COMMIT) +
    ",\n" +
    "  sourceBlobSha: " +
    JSON.stringify(SOURCE_BLOB_SHA) +
    ",\n" +
    "  sourceEntryCount: " +
    raw.length +
    ",\n" +
    "  effectiveEntryCount: " +
    effective.length +
    ",\n" +
    "} as const;\n\n" +
    "export const COMMON_PASSWORDS = new Set<string>([\n" +
    effective.map((value) => "  " + JSON.stringify(value) + ",").join("\n") +
    "\n]);\n"
  );
}

const source = await loadSource();
const generated = generatedSource(source);
const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  const current = await readFile(OUTPUT, "utf8");
  if (current !== generated) {
    throw new Error(
      "Committed common-password corpus is stale. Run npm run sec1:passwords:generate.",
    );
  }
  console.log("SEC1_COMMON_PASSWORDS_CHECK_PASS", {
    output: OUTPUT,
    sourceBlobSha: SOURCE_BLOB_SHA,
  });
} else {
  await writeFile(OUTPUT, generated, "utf8");
  console.log("SEC1_COMMON_PASSWORDS_GENERATED", {
    output: OUTPUT,
    sourceBlobSha: SOURCE_BLOB_SHA,
  });
}
