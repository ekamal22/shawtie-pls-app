import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const webDist = join(repoRoot, "apps", "web", "dist");
const serverRoots = [
  join(repoRoot, "apps", "api", "src"),
  join(repoRoot, "apps", "worker", "src"),
  join(repoRoot, "packages", "db", "src"),
];

async function filesUnder(root) {
  const output = [];
  async function walk(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) output.push(target);
    }
  }
  await walk(root);
  return output;
}

async function assertAbsent(root, needles, label) {
  const files = await filesUnder(root);
  for (const path of files) {
    const info = await stat(path);
    if (info.size > 8 * 1024 * 1024) continue;
    const content = await readFile(path, "utf8").catch(() => null);
    if (content === null) continue;
    for (const needle of needles) {
      if (content.includes(needle)) {
        throw new Error(
          label + " contains forbidden marker " + JSON.stringify(needle)
            + " in " + relative(repoRoot, path),
        );
      }
    }
  }
}

await assertAbsent(
  webDist,
  [
    "m3-test-aes-gcm-v1",
    "VITE_M3_TEST_CRYPTO",
    "M3 production media crypto is unavailable until S1",
  ],
  "S1 production web bundle",
);

for (const root of serverRoots) {
  await assertAbsent(
    root,
    [
      "recoveryHpkePrivateKey",
      "recoveryAuthPrivateKey",
      "recoveryMasterSecret",
      "Recovery Master Secret",
      "privateKeyPkcs8",
    ],
    "S1 server source",
  );
}

console.log("S1_PRODUCTION_BUNDLE_SCAN_PASS");
