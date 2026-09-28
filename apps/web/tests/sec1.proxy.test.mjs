import assert from "node:assert/strict";
import test from "node:test";
import {
  createTrustedProxyPolicy,
  resolveClientAddress,
  sanitizedForwardHeaders,
  sanitizedProxyResponseHeaders,
} from "../proxy-security.mjs";

test("SEC1 untrusted socket cannot spoof forwarded client address", () => {
  const policy = createTrustedProxyPolicy("10.0.0.0/8");
  assert.equal(
    resolveClientAddress("198.51.100.20", "203.0.113.9", policy),
    "198.51.100.20",
  );
});

test("SEC1 trusted proxy chain resolves the first untrusted client", () => {
  const policy = createTrustedProxyPolicy("10.0.0.0/8,127.0.0.1");
  assert.equal(
    resolveClientAddress("10.0.0.4", "203.0.113.9, 10.0.0.3, 10.0.0.2", policy),
    "203.0.113.9",
  );
  assert.equal(
    resolveClientAddress("::ffff:127.0.0.1", "203.0.113.10", policy),
    "203.0.113.10",
  );
});

test("SEC1 trusted proxy canonicalizes equivalent IPv6 spellings", () => {
  const policy = createTrustedProxyPolicy("2001:db8:1::/64");
  assert.equal(
    resolveClientAddress(
      "2001:0db8:0001:0000:0000:0000:0000:0002",
      "2001:0db8:0002:0000:0000:0000:0000:0009",
      policy,
    ),
    "2001:db8:2::9",
  );
  assert.equal(
    resolveClientAddress("::ffff:127.0.0.1", "203.0.113.10", createTrustedProxyPolicy("127.0.0.1")),
    "203.0.113.10",
  );
});

test("SEC1 malformed forwarded chain fails closed to the socket address", () => {
  const policy = createTrustedProxyPolicy("10.0.0.0/8");
  assert.equal(
    resolveClientAddress("10.0.0.4", "203.0.113.9, not-an-ip", policy),
    "10.0.0.4",
  );
});

test("SEC1 trusted proxy policy rejects wildcard and hop-count shortcuts", () => {
  assert.throws(() => createTrustedProxyPolicy("*"), /explicit IP or CIDR/);
  assert.throws(() => createTrustedProxyPolicy("true"), /explicit IP or CIDR/);
  assert.throws(() => createTrustedProxyPolicy("2"), /explicit IP or CIDR/);
  assert.throws(() => createTrustedProxyPolicy("10.0.0.0/99"), /CIDR prefix/);
});

test("SEC1 proxy overwrites forwarded metadata and strips hop-by-hop headers", () => {
  const policy = createTrustedProxyPolicy("127.0.0.1");
  const request = {
    headers: {
      host: "app.example.test",
      cookie: "session=opaque",
      connection: "keep-alive, x-hop-secret",
      "x-hop-secret": "must-not-forward",
      "x-forwarded-for": "203.0.113.8",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
      forwarded: "for=192.0.2.2",
      "x-real-ip": "192.0.2.3",
    },
    socket: { remoteAddress: "127.0.0.1" },
  };

  const headers = sanitizedForwardHeaders(request, {
    backendTarget: new URL("http://api.internal:3000"),
    appOrigin: "https://app.example.test",
    trustedProxyPolicy: policy,
  });

  assert.equal(headers.host, "api.internal:3000");
  assert.equal(headers.cookie, "session=opaque");
  assert.equal(headers["x-forwarded-for"], "203.0.113.8");
  assert.equal(headers["x-forwarded-host"], "app.example.test");
  assert.equal(headers["x-forwarded-proto"], "https");
  assert.equal(headers.forwarded, undefined);
  assert.equal(headers["x-real-ip"], undefined);
  assert.equal(headers.connection, undefined);
  assert.equal(headers["x-hop-secret"], undefined);
});

test("SEC1 proxied responses strip fixed and connection-nominated hop-by-hop headers", () => {
  const headers = sanitizedProxyResponseHeaders(
    {
      "content-type": "application/json",
      connection: "keep-alive, x-backend-hop",
      "x-backend-hop": "must-not-forward",
      "transfer-encoding": "chunked",
      "x-content-type-options": "backend-value",
      "set-cookie": ["a=1; HttpOnly", "b=2; HttpOnly"],
    },
    {
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self';",
    },
  );

  assert.equal(headers.connection, undefined);
  assert.equal(headers["x-backend-hop"], undefined);
  assert.equal(headers["transfer-encoding"], undefined);
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(headers["set-cookie"], ["a=1; HttpOnly", "b=2; HttpOnly"]);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["content-security-policy"], "default-src 'self';");
});

test("SEC1 websocket proxy keeps handshake headers but still overwrites forwarded metadata", () => {
  const policy = createTrustedProxyPolicy("127.0.0.1");
  const request = {
    headers: {
      host: "app.example.test",
      connection: "Upgrade",
      upgrade: "websocket",
      origin: "https://app.example.test",
      "sec-websocket-key": "test-key",
      "sec-websocket-version": "13",
      "sec-websocket-protocol": "shawtie.realtime.v1",
      "x-forwarded-for": "203.0.113.11",
    },
    socket: { remoteAddress: "127.0.0.1" },
  };

  const headers = sanitizedForwardHeaders(request, {
    backendTarget: new URL("http://api.internal:3000"),
    appOrigin: "https://app.example.test",
    trustedProxyPolicy: policy,
    upgrade: true,
  });

  assert.equal(headers.connection, "Upgrade");
  assert.equal(headers.upgrade, "websocket");
  assert.equal(headers.origin, "https://app.example.test");
  assert.equal(headers["sec-websocket-key"], "test-key");
  assert.equal(headers["x-forwarded-for"], "203.0.113.11");
});
