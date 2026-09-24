import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { apiConfigFromEnv } from "../src/config.ts";

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

function baseEnv(nodeEnv: "test" | "production"): NodeJS.ProcessEnv {
  return {
    NODE_ENV: nodeEnv,
    APP_ORIGIN: nodeEnv === "production" ? "https://shawtie.example.test" : "http://127.0.0.1:4173",
    AUTH_HMAC_KEYS: "1:" + Buffer.alloc(32, 7).toString("base64"),
    AUTH_HMAC_ACTIVE_VERSION: "1",
  };
}

test("C2 video feature defaults off in production and on outside production", () => {
  assert.equal(apiConfigFromEnv(baseEnv("production")).calling?.videoEnabled, false);
  assert.equal(apiConfigFromEnv(baseEnv("test")).calling?.videoEnabled, true);
  assert.equal(
    apiConfigFromEnv({ ...baseEnv("test"), C2_VIDEO_ENABLED: "0" }).calling?.videoEnabled,
    false,
  );
});

test("C2 server admission preserves C1 voice and persists the validated call kind", async () => {
  const service = await source("../src/modules/calls/calling-service.ts");
  const routes = await source("../src/modules/calls/routes.ts");
  const repository = await source("../../../packages/db/src/repositories/calls.ts");

  const profileCheck = service.indexOf("CALL_MEDIA_PROFILE_UNSUPPORTED");
  const reserve = service.indexOf("const reserved = await this.#reserve", profileCheck);
  assert.ok(profileCheck >= 0);
  assert.ok(reserve > profileCheck);
  assert.equal(service.includes("kind: input.kind"), true);
  assert.equal(service.includes('kind: "voice"'), false);
  assert.equal(routes.includes('for (const action of ["reject", "cancel", "end"] as const)'), true);
  assert.equal(routes.includes("callAcceptMutationSchema"), true);
  assert.equal(repository.includes("session.call_type"), true);
});

test("C2 registers signaling v2 globally without replacing C1 v1", async () => {
  const application = await source("../src/application.ts");
  assert.equal(application.includes("C1_SIGNALING_SUBPROTOCOL"), true);
  assert.equal(application.includes("C2_SIGNALING_SUBPROTOCOL"), true);
  assert.equal(application.includes("C2_SIGNALING_MAX_FRAME_BYTES"), true);
});
