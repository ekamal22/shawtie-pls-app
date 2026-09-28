import assert from "node:assert/strict";
import test from "node:test";
import { createProductionWebServer } from "../server.mjs";

function baseEnv(overrides = {}) {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "4180",
    APP_ORIGIN: "http://127.0.0.1:4180",
    BACKEND_PROXY_TARGET: "http://127.0.0.1:4190",
    ALLOW_INSECURE_LOOPBACK_WEB_ORIGIN: "1",
    WEB_TRUSTED_PROXY: "127.0.0.1",
    ...overrides,
  };
}

test("SEC1 production server rejects path-bearing backend target", () => {
  assert.throws(
    () =>
      createProductionWebServer(
        baseEnv({ BACKEND_PROXY_TARGET: "http://127.0.0.1:4190/api" }),
      ),
    /BACKEND_PROXY_TARGET must be a bare origin/,
  );
});

test("SEC1 production server rejects credentialed backend target", () => {
  assert.throws(
    () =>
      createProductionWebServer(
        baseEnv({ BACKEND_PROXY_TARGET: "http://user:secret@127.0.0.1:4190" }),
      ),
    /BACKEND_PROXY_TARGET must be a bare origin/,
  );
});

test("SEC1 production server rejects wildcard trusted proxy configuration", () => {
  assert.throws(
    () => createProductionWebServer(baseEnv({ WEB_TRUSTED_PROXY: "*" })),
    /WEB_TRUSTED_PROXY must use explicit IP or CIDR/,
  );
});

test("SEC1 production server accepts explicit loopback test configuration", () => {
  const application = createProductionWebServer(baseEnv());
  assert.equal(application.host, "127.0.0.1");
  assert.equal(application.port, 4180);
  application.server.close();
});
