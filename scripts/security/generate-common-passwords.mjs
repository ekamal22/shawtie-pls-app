import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const SOURCE_REPOSITORY = "danielmiessler/SecLists";
const SOURCE_COMMIT = "2e3e92569043d24297ca6c35070078e5cf41651e";
const SOURCE_PATH = "Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt";
const SOURCE_BLOB_SHA = "38eb37702244f55fda75cab281eb2145cd7685b6";
const SOURCE_ENTRY_COUNT = 99_839;
const EFFECTIVE_ENTRY_COUNT = 327;
const EFFECTIVE_DIGEST_SET_SHA256 =
  "2614e892e747d06fd0861733ffc0c9187b5c242a8aae8e029e938db860a537ca";
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

  const raw = rawBytes.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (raw.length !== SOURCE_ENTRY_COUNT) {
    throw new Error(
      "Pinned common-password source entry count mismatch. expected=" +
        SOURCE_ENTRY_COUNT +
        " actual=" +
        raw.length,
    );
  }

  const normalized = [
    ...new Set(
      raw
        .map(decodeSourceEntry)
        .filter((value) => value !== null)
        .map((value) => value.normalize("NFC").toLowerCase())
        .filter(structurallyRelevant),
    ),
  ].sort();

  const digests = normalized
    .map((value) => createHash("sha256").update(value, "utf8").digest("hex"))
    .sort();

  if (digests.length !== EFFECTIVE_ENTRY_COUNT) {
    throw new Error(
      "Effective common-password entry count changed. expected=" +
        EFFECTIVE_ENTRY_COUNT +
        " actual=" +
        digests.length,
    );
  }
  const digestSetSha256 = createHash("sha256")
    .update(digests.join("\n") + "\n", "utf8")
    .digest("hex");
  if (digestSetSha256 !== EFFECTIVE_DIGEST_SET_SHA256) {
    throw new Error(
      "Effective common-password digest set changed. expected=" +
        EFFECTIVE_DIGEST_SET_SHA256 +
        " actual=" +
        digestSetSha256,
    );
  }

  return (
    "// GENERATED FILE. DO NOT EDIT BY HAND.\n" +
    "// Regenerate with a local copy of the pinned source: npm run sec1:passwords:generate\n" +
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
    SOURCE_ENTRY_COUNT +
    "\n" +
    "// Effective entries after Shawtie structural password bounds and case folding: " +
    EFFECTIVE_ENTRY_COUNT +
    "\n" +
    "// Effective digest-set SHA-256: " +
    EFFECTIVE_DIGEST_SET_SHA256 +
    "\n//\n" +
    "// The committed runtime corpus contains only SHA-256 membership digests, never the\n" +
    "// source password strings. SHA-256 is used only as a local exact-set representation;\n" +
    "// account credentials continue to use Argon2id.\n//\n" +
    "// SecLists is distributed under the MIT License. Source/license provenance is\n" +
    "// documented in security-data/common-passwords/README.md.\n\n" +
    "export const COMMON_PASSWORD_SOURCE = {\n" +
    "  repositoryCommit: " +
    JSON.stringify(SOURCE_COMMIT) +
    ",\n" +
    "  sourceBlobSha: " +
    JSON.stringify(SOURCE_BLOB_SHA) +
    ",\n" +
    "  sourceEntryCount: " +
    SOURCE_ENTRY_COUNT +
    ",\n" +
    "  effectiveEntryCount: " +
    EFFECTIVE_ENTRY_COUNT +
    ",\n" +
    "  digestSetSha256: " +
    JSON.stringify(EFFECTIVE_DIGEST_SET_SHA256) +
    ",\n" +
    "} as const;\n\n" +
    "export const COMMON_PASSWORD_DIGESTS = new Set<string>([\n" +
    digests.map((value) => "  " + JSON.stringify(value) + ",").join("\n") +
    "\n]);\n"
  );
}

async function checkCommittedOutput() {
  const current = await readFile(OUTPUT, "utf8");
  if (current.includes("passwordpassword") || current.includes("123456789987654321")) {
    throw new Error("Committed common-password corpus contains forbidden plaintext entries");
  }
  const setStart = current.indexOf("export const COMMON_PASSWORD_DIGESTS");
  const setEnd = current.indexOf("]);", setStart);
  if (setStart < 0 || setEnd < 0) {
    throw new Error("Committed common-password digest set is missing");
  }
  const setBody = current.slice(setStart, setEnd);
  const digests = [...setBody.matchAll(/\n\s*"([0-9a-f]{64})",/g)].map((match) => match[1]);
  if (digests.length !== EFFECTIVE_ENTRY_COUNT) {
    throw new Error(
      "Committed common-password digest count mismatch. expected=" +
        EFFECTIVE_ENTRY_COUNT +
        " actual=" +
        digests.length,
    );
  }
  if (new Set(digests).size !== digests.length) {
    throw new Error("Committed common-password digest set contains duplicates");
  }
  const digestSetSha256 = createHash("sha256")
    .update(digests.join("\n") + "\n", "utf8")
    .digest("hex");
  if (digestSetSha256 !== EFFECTIVE_DIGEST_SET_SHA256) {
    throw new Error(
      "Committed common-password digest checksum mismatch. expected=" +
        EFFECTIVE_DIGEST_SET_SHA256 +
        " actual=" +
        digestSetSha256,
    );
  }
  const sorted = [...digests].sort();
  if (digests.some((digest, index) => digest !== sorted[index])) {
    throw new Error("Committed common-password digest set is not sorted deterministically");
  }
  const residue = setBody
    .replace(/export const COMMON_PASSWORD_DIGESTS = new Set<string>\(\[/, "")
    .replace(/\n\s*"[0-9a-f]{64}",/g, "")
    .trim();
  if (residue) {
    throw new Error("Committed common-password digest set contains non-digest data");
  }
  if (!current.includes('sourceBlobSha: "' + SOURCE_BLOB_SHA + '"')) {
    throw new Error("Committed common-password source metadata is stale");
  }
  if (!current.includes('digestSetSha256: "' + EFFECTIVE_DIGEST_SET_SHA256 + '"')) {
    throw new Error("Committed common-password digest-set metadata is stale");
  }
  console.log("SEC1_COMMON_PASSWORDS_CHECK_PASS", {
    output: OUTPUT,
    sourceBlobSha: SOURCE_BLOB_SHA,
    effectiveEntryCount: EFFECTIVE_ENTRY_COUNT,
  });
}

if (process.argv.includes("--check")) {
  await checkCommittedOutput();
} else {
  const sourceFile = process.env.SEC1_COMMON_PASSWORD_SOURCE_FILE?.trim();
  if (!sourceFile) {
    throw new Error(
      "SEC1_COMMON_PASSWORD_SOURCE_FILE is required for regeneration. " +
        "Use the pinned SecLists source documented in security-data/common-passwords/README.md.",
    );
  }
  const source = await readFile(sourceFile);
  const generated = generatedSource(source);
  await writeFile(OUTPUT, generated, "utf8");
  console.log("SEC1_COMMON_PASSWORDS_GENERATED", {
    output: OUTPUT,
    sourceBlobSha: SOURCE_BLOB_SHA,
    effectiveEntryCount: EFFECTIVE_ENTRY_COUNT,
  });
}
