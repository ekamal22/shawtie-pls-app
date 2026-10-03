import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.env.R2_WEB_DIST || "apps/web/dist");
const budgets = {
  totalBytes: Number(process.env.R2_BUDGET_TOTAL_BYTES ?? 24 * 1024 * 1024),
  totalJsBytes: Number(process.env.R2_BUDGET_JS_BYTES ?? 6 * 1024 * 1024),
  largestJsBytes: Number(process.env.R2_BUDGET_LARGEST_JS_BYTES ?? 4 * 1024 * 1024),
  totalCssBytes: Number(process.env.R2_BUDGET_CSS_BYTES ?? 2 * 1024 * 1024),
  totalWasmBytes: Number(process.env.R2_BUDGET_WASM_BYTES ?? 10 * 1024 * 1024),
};

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(absolute)));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

const files = await walk(root);
const measurements = { totalBytes: 0, totalJsBytes: 0, largestJsBytes: 0, totalCssBytes: 0, totalWasmBytes: 0 };
for (const file of files) {
  const bytes = (await stat(file)).size;
  measurements.totalBytes += bytes;
  if (file.endsWith(".js")) {
    measurements.totalJsBytes += bytes;
    measurements.largestJsBytes = Math.max(measurements.largestJsBytes, bytes);
  }
  if (file.endsWith(".css")) measurements.totalCssBytes += bytes;
  if (file.endsWith(".wasm")) measurements.totalWasmBytes += bytes;
}

const failed = Object.entries(budgets)
  .filter(([key, value]) => measurements[key] > value)
  .map(([key]) => key);

console.log(JSON.stringify({ files: files.length, measurements, budgets }, null, 2));
if (failed.length > 0) {
  console.error("R2_WEB_BUDGET_FAIL metrics=" + failed.join(","));
  process.exit(1);
}
console.log("R2_WEB_BUDGET_PASS");
