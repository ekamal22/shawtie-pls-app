import assert from "node:assert/strict";
import test from "node:test";
import { buildWebSecurityHeaders, parseConnectOrigins } from "../server-security.mjs";

test("SEC1 production CSP preserves OpenMLS WASM without general eval", () => {
  const headers = buildWebSecurityHeaders({
    appOrigin: "https://app.example.test",
    mediaConnectSrc: "https://media.example.test https://storage.example.test/path",
  });

  const csp = headers["Content-Security-Policy"];
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' wss:\/\/app\.example\.test/);
  assert.match(csp, /https:\/\/media\.example\.test/);
  assert.match(csp, /https:\/\/storage\.example\.test/);
  assert.match(csp, /upgrade-insecure-requests/);

  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000");
  assert.doesNotMatch(headers["Strict-Transport-Security"], /includeSubDomains|preload/i);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Permissions-Policy"], "camera=(self), microphone=(self)");
  assert.equal(headers["X-Frame-Options"], "DENY");
});

test("SEC1 connect origins collapse paths and reject insecure remote origins", () => {
  assert.deepEqual(
    parseConnectOrigins(
      "https://media.example.test/path, https://media.example.test/other https://s3.example.test",
    ),
    ["https://media.example.test", "https://s3.example.test"],
  );
  assert.throws(
    () => parseConnectOrigins("http://media.example.test"),
    /Insecure media connect origins/,
  );
});

test("SEC1 production header configuration rejects ambiguous origins", () => {
  assert.throws(
    () =>
      buildWebSecurityHeaders({
        appOrigin: "https://app.example.test/path",
      }),
    /APP_ORIGIN must be a bare origin/,
  );
  assert.throws(
    () =>
      buildWebSecurityHeaders({
        appOrigin: "https://app.example.test",
        mediaConnectSrc: "https://user:secret@media.example.test",
      }),
    /must not contain credentials/,
  );
});

test("SEC1 loopback production-mode harness may use explicit insecure test opt-in", () => {
  const headers = buildWebSecurityHeaders({
    appOrigin: "http://127.0.0.1:4173",
    mediaConnectSrc: "http://127.0.0.1:9000",
    allowInsecureLoopback: true,
  });
  assert.match(headers["Content-Security-Policy"], /ws:\/\/127\.0\.0\.1:4173/);
  assert.equal(headers["Strict-Transport-Security"], undefined);
});
