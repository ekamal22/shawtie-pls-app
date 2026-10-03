import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const roots = [
  "scripts/ci",
  "scripts/operations",
  "scripts/performance",
  "scripts/release",
  "scripts/security",
];

async function collect(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await collect(absolute)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) output.push(absolute);
  }
  return output;
}

const files = (await Promise.all(roots.map(collect))).flat().sort();
for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log("R2_SCRIPT_SYNTAX_PASS files=" + files.length);
