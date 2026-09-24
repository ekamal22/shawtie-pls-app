import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const WEB_PORT = Number(process.env.M3_DEVICE_WEB_PORT ?? "4174");
const CDP_PORT = Number(process.env.M3_DEVICE_CDP_PORT ?? "9223");
const APP_URL = process.env.M3_DEVICE_URL ?? "http://127.0.0.1:" + WEB_PORT + "/";
const cleanupOnly = process.argv.includes("--cleanup");

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}
function findAdb() {
  const candidates = [
    process.env.ADB_CLI,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe")
      : undefined,
    "adb",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = run(candidate, ["version"], { stdio: "ignore" });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("ADB is unavailable. Put adb on PATH or set ADB_CLI.");
}
function adb(cli, serial, args) {
  const result = run(cli, [...(serial ? ["-s", serial] : []), ...args]);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || result.stdout?.trim() || "adb failed");
  return result.stdout?.trim() ?? "";
}
function serial(cli) {
  const devices = adb(cli, null, ["devices", "-l"])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/, 2))
    .filter(([, state]) => state === "device")
    .map(([id]) => id);
  if (process.env.ADB_SERIAL) {
    if (!devices.includes(process.env.ADB_SERIAL)) throw new Error("ADB_SERIAL is not connected/authorized");
    return process.env.ADB_SERIAL;
  }
  if (devices.length !== 1) throw new Error("Expected exactly one authorized device; set ADB_SERIAL otherwise.");
  return devices[0];
}
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const cli = findAdb();
const id = serial(cli);
if (cleanupOnly) {
  adb(cli, id, ["reverse", "--remove", "tcp:" + WEB_PORT]);
  adb(cli, id, ["forward", "--remove", "tcp:" + CDP_PORT]);
  console.log("M3_ANDROID_CLEANUP_PASS serial=" + id);
  process.exit(0);
}

if (adb(cli, id, ["get-state"]) !== "device") throw new Error("Android device is not ready");
const model = adb(cli, id, ["shell", "getprop", "ro.product.model"]);
const androidVersion = adb(cli, id, ["shell", "getprop", "ro.build.version.release"]);
const chromePackage = adb(cli, id, ["shell", "dumpsys", "package", "com.android.chrome"]);
const chromeVersion =
  chromePackage.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("versionName="))?.slice(12)
  ?? "unknown";

adb(cli, id, ["reverse", "tcp:" + WEB_PORT, "tcp:" + WEB_PORT]);
adb(cli, id, ["shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", APP_URL, "com.android.chrome"]);
adb(cli, id, ["forward", "tcp:" + CDP_PORT, "localabstract:chrome_devtools_remote"]);
await new Promise((resolve) => setTimeout(resolve, 1_500));
const targets = await fetchJson("http://127.0.0.1:" + CDP_PORT + "/json");
const page = Array.isArray(targets)
  ? targets.find((target) => target?.type === "page" && typeof target.url === "string" && target.url.startsWith("http://127.0.0.1:" + WEB_PORT))
  : null;
if (!page) throw new Error("Chrome CDP is reachable but the M3 commercial page target is missing");

const evidence = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  serial: id,
  model,
  androidVersion,
  chromeVersion,
  appUrl: APP_URL,
  webPort: WEB_PORT,
  cdpPort: CDP_PORT,
  target: { id: page.id ?? null, title: page.title ?? null, url: page.url ?? null },
  requiredScenarios: 20,
  syntheticMediaOnly: true,
};
await mkdir("validation-logs", { recursive: true });
const path = join("validation-logs", "m3-android-prepare-" + stamp() + ".json");
await writeFile(path, JSON.stringify(evidence, null, 2) + "\n", "utf8");

console.log("M3_ANDROID_PREPARE_PASS serial=" + id + " model=" + JSON.stringify(model) + " android=" + androidVersion + " chrome=" + chromeVersion);
console.log("M3_ANDROID_EVIDENCE " + path);
console.log("M3_ANDROID_NEXT execute all 20 documented synthetic physical scenarios; this preflight alone does not close M3.");
