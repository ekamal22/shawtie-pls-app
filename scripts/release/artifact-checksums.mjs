import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.env.R2_ARTIFACT_DIR || "");
if (!process.argv[2] && !process.env.R2_ARTIFACT_DIR) {
  throw new Error("Artifact directory is required");
}
if (!(await stat(root)).isDirectory()) throw new Error("Artifact path must be a directory");

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(absolute)));
    else if (entry.isFile() && entry.name !== "SHA256SUMS") output.push(absolute);
  }
  return output;
}

const files = (await walk(root)).sort();
if (files.length === 0) throw new Error("Artifact directory is empty");
const lines = [];
for (const file of files) {
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  lines.push(digest + "  " + path.relative(root, file).replaceAll("\\", "/"));
}
await writeFile(path.join(root, "SHA256SUMS"), lines.join("\n") + "\n");
console.log("R2_ARTIFACT_CHECKSUMS_PASS files=" + files.length);
