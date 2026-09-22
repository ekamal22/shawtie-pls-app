import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const WEB_PORT = Number(process.env.M2_DEVICE_WEB_PORT ?? "4173");
const CDP_PORT = Number(process.env.M2_DEVICE_CDP_PORT ?? "9222");
const APP_URL =
  process.env.M2_DEVICE_URL ?? "http://127.0.0.1:" + WEB_PORT + "/";
const cleanupOnly = process.argv.includes("--cleanup");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function findAdb() {
  const candidates = [
    process.env.ADB_CLI,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? join(
          process.env.LOCALAPPDATA,
          "Android",
          "Sdk",
          "platform-tools",
          "adb.exe",
        )
      : undefined,
    "adb",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = run(candidate, ["version"], { stdio: "ignore" });
    if (!result.error && result.status === 0) return candidate;
  }

  throw new Error(
    "ADB is unavailable. Put adb on PATH or set ADB_CLI to adb.exe.",
  );
}

function adb(adbCli, serial, args, options = {}) {
  const result = run(
    adbCli,
    [...(serial ? ["-s", serial] : []), ...args],
    options,
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim()
        || result.stdout?.trim()
        || "adb exited with status " + result.status,
    );
  }
  return result.stdout?.trim() ?? "";
}

function discoverSerial(adbCli) {
  const output = adb(adbCli, null, ["devices", "-l"]);
  const devices = output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/, 2);
      return { serial, state, line };
    })
    .filter((device) => device.state === "device");

  const requested = process.env.ADB_SERIAL;
  if (requested) {
    const match = devices.find((device) => device.serial === requested);
    if (!match) {
      throw new Error(
        "ADB_SERIAL=" + requested + " is not an authorized connected device.",
      );
    }
    return requested;
  }

  if (devices.length !== 1) {
    throw new Error(
      "Expected exactly one authorized Android device. Found "
        + devices.length
        + ". Set ADB_SERIAL when multiple devices are attached.",
    );
  }
  return devices[0].serial;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status + " from " + url);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const adbCli = findAdb();
const serial = discoverSerial(adbCli);

if (cleanupOnly) {
  adb(adbCli, serial, ["reverse", "--remove", "tcp:" + WEB_PORT]);
  adb(adbCli, serial, ["forward", "--remove", "tcp:" + CDP_PORT]);
  console.log("M2_ANDROID_CLEANUP_PASS serial=" + serial);
  process.exit(0);
}

const state = adb(adbCli, serial, ["get-state"]);
if (state !== "device") throw new Error("Android device is not ready: " + state);

const model = adb(adbCli, serial, ["shell", "getprop", "ro.product.model"]);
const androidVersion = adb(adbCli, serial, [
  "shell",
  "getprop",
  "ro.build.version.release",
]);
const chromePath = adb(adbCli, serial, [
  "shell",
  "pm",
  "path",
  "com.android.chrome",
]);
if (!chromePath.startsWith("package:")) {
  throw new Error("Google Chrome package com.android.chrome is unavailable.");
}

const chromePackage = adb(adbCli, serial, [
  "shell",
  "dumpsys",
  "package",
  "com.android.chrome",
]);
const chromeVersion =
  chromePackage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("versionName="))
    ?.slice("versionName=".length) ?? "unknown";

const power = adb(adbCli, serial, ["shell", "dumpsys", "power"]);
const awake =
  /mWakefulness=Awake/.test(power)
  || /Display Power: state=ON/.test(power)
  || /mScreenOn=true/.test(power);
if (!awake) {
  throw new Error(
    "Android device screen appears locked or asleep. Unlock it and retry.",
  );
}

adb(adbCli, serial, [
  "reverse",
  "tcp:" + WEB_PORT,
  "tcp:" + WEB_PORT,
]);
adb(adbCli, serial, [
  "shell",
  "am",
  "start",
  "-W",
  "-a",
  "android.intent.action.VIEW",
  "-d",
  APP_URL,
  "com.android.chrome",
]);
adb(adbCli, serial, [
  "forward",
  "tcp:" + CDP_PORT,
  "localabstract:chrome_devtools_remote",
]);

await new Promise((resolve) => setTimeout(resolve, 1_500));

let targets;
try {
  targets = await fetchJson("http://127.0.0.1:" + CDP_PORT + "/json");
} catch (error) {
  throw new Error(
    "Chrome DevTools Protocol was not reachable through adb forward. "
      + "Open Chrome on the device, confirm USB debugging/remote inspection, and retry. "
      + (error instanceof Error ? error.message : String(error)),
  );
}

const pages = Array.isArray(targets)
  ? targets.filter((target) => target?.type === "page")
  : [];
const target = pages.find(
  (page) =>
    typeof page.url === "string"
    && page.url.startsWith("http://127.0.0.1:" + WEB_PORT),
);
if (!target) {
  throw new Error(
    "Chrome is reachable through CDP but no page target is open at " + APP_URL,
  );
}

const evidence = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  serial,
  model,
  androidVersion,
  chromeVersion,
  appUrl: APP_URL,
  webPort: WEB_PORT,
  cdpPort: CDP_PORT,
  target: {
    id: target.id ?? null,
    title: target.title ?? null,
    url: target.url ?? null,
    webSocketDebuggerUrl:
      typeof target.webSocketDebuggerUrl === "string"
        ? target.webSocketDebuggerUrl
        : null,
  },
  nonDestructiveChecks: {
    adbAuthorized: true,
    deviceAwake: true,
    chromeInstalled: true,
    webReverseConfigured: true,
    cdpForwardConfigured: true,
    appTargetDiscovered: true,
  },
  destructiveNetworkChangesPerformed: false,
};

await mkdir("validation-logs", { recursive: true });
const path = join(
  "validation-logs",
  "m2-android-prepare-" + timestamp() + ".json",
);
await writeFile(path, JSON.stringify(evidence, null, 2) + "\n", "utf8");

console.log(
  "M2_ANDROID_PREPARE_PASS serial="
    + serial
    + " model="
    + JSON.stringify(model)
    + " android="
    + androidVersion
    + " chrome="
    + chromeVersion,
);
console.log("M2_ANDROID_EVIDENCE " + path);
console.log(
  "M2_ANDROID_NEXT run the documented foreground/background, offline/reconnect, lifecycle, revocation, update, and namespace-isolation scenarios manually; do not mark the milestone DONE from this preflight alone.",
);
