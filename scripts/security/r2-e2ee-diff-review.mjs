import { execFileSync } from "node:child_process";

const BASELINE = "2dc24424e228777765d767f052db57ea8086a6ce";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const protectedPrefixes = [
  "apps/api/src/modules/crypto/",
  "apps/web/src/lib/crypto/",
  "apps/web/src/features/security/crypto-",
  "packages/contracts/src/crypto/",
  "packages/crypto/",
];

const protectedExact = new Set([
  "apps/web/src/lib/media/crypto-port.ts",
  "packages/db/src/repositories/crypto.ts",
  "packages/db/src/repositories/protected-content.ts",
  "packages/db/migrations/0019_s1_device_crypto_runtime.sql",
  "packages/db/migrations/0020_s1_partnership_crypto_runtime.sql",
  "packages/db/migrations/0021_s1_protected_content_runtime.sql",
]);

const head = git(["rev-parse", "HEAD"]);
try {
  git(["cat-file", "-e", BASELINE + "^{commit}"]);
} catch {
  throw new Error(
    "R2 E2EE diff review requires repository history containing baseline " + BASELINE,
  );
}

const changed = git(["diff", "--name-only", BASELINE + "..." + head])
  .split("\n")
  .filter(Boolean);

const sensitive = changed.filter(
  (path) =>
    protectedExact.has(path) ||
    protectedPrefixes.some((prefix) => path.startsWith(prefix)),
);

if (sensitive.length > 0) {
  console.error("R2_E2EE_DIFF_REVIEW_REQUIRED");
  for (const path of sensitive) console.error("- " + path);
  console.error(
    "A protected cryptographic trust-boundary path changed after the reviewed pre-R2 baseline.",
  );
  process.exit(1);
}

console.log(
  "R2_E2EE_DIFF_REVIEW_PASS baseline=" +
    BASELINE +
    " head=" +
    head +
    " changed=" +
    changed.length +
    " protected_changes=0",
);
