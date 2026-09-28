# Production Web Serving

Status: SEC1 IMPLEMENTED, FINAL CLOSURE PENDING.

Canonical security design: `../architecture/SEC1_PRE_V1_SECURITY_HARDENING_DESIGN.md`.

## Purpose

The commercial PWA now has a repository-controlled production serving path. Vite development and preview servers are not production evidence.

Production web entry point:

`apps/web/server.mjs`

Security-header authority:

`apps/web/server-security.mjs`

## Build and start

The OpenMLS WebAssembly output must exist before the web production build:

```text
npm ci
npm run build --workspace @shawtie/crypto
npm run build:s1-wasm
npm run build --workspace @shawtie/web
npm run start --workspace @shawtie/web
```

The web server serves `apps/web/dist` and reverse-proxies same-origin `/api` HTTP and WebSocket traffic to the internal Fastify API.

## Required production configuration

`NODE_ENV=production`

`APP_ORIGIN`
: Required bare public HTTPS origin, for example `https://app.example.com`. Credentials, paths, queries, fragments, and insecure non-loopback HTTP origins are rejected.

`BACKEND_PROXY_TARGET`
: Required internal API origin using HTTP or HTTPS, for example `http://api.internal:3000`. It is not exposed to the browser.

`WEB_MEDIA_CONNECT_SRC`
: Optional comma- or whitespace-separated list of approved HTTPS media/object-storage origins used by browser `fetch` for signed encrypted-media access. Paths collapse to origins. Credential-bearing or insecure remote origins are rejected.

`HOST`
: Optional bind address. Default: `0.0.0.0`.

`PORT`
: Optional web-server port. Default: `4173`.

The legacy `VITE_S3_CONNECT_SRC` value is accepted only as a compatibility fallback for `WEB_MEDIA_CONNECT_SRC`; new deployment configuration should use `WEB_MEDIA_CONNECT_SRC`.

## TLS boundary

`apps/web/server.mjs` is an HTTP application server intended to run behind the production platform's TLS terminator or ingress.

The externally visible origin must be HTTPS. `APP_ORIGIN` describes that public origin even when the internal hop from the TLS terminator to the Node process is HTTP.

SEC1 proves the repository-controlled header behavior and real Chromium compatibility. R2 must re-check the actual deployed HTTPS response after the ingress/CDN/load-balancer layer is present.

## Canonical Host

All application and API traffic except `/health` must use the Host from `APP_ORIGIN`.

A mismatched Host receives HTTP 421. WebSocket upgrades with a mismatched Host are dropped.

`/health` intentionally permits platform health checks that may use an internal Host.

## Same-origin API and WebSocket proxy

Browser code continues to use relative `/api` URLs.

The web adapter:

- proxies HTTP `/api` requests to `BACKEND_PROXY_TARGET`
- proxies `/api` WebSocket upgrades without changing the negotiated application subprotocol
- preserves the browser Origin header for Fastify's existing exact-origin authorization
- appends the immediate network hop to `X-Forwarded-For`
- sets forwarded Host and protocol from the canonical public origin
- reapplies the repository-controlled browser security headers to proxied HTTP responses

The Fastify deployment must keep its existing explicit trusted-proxy configuration. Wildcard trust remains prohibited. Correct client-IP derivation depends on trusting only the known ingress/web-adapter hops.

## Browser security headers

The adapter emits:

- `Content-Security-Policy`
- `Strict-Transport-Security: max-age=31536000` for HTTPS public origins
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(self), microphone=(self)`
- `X-Frame-Options: DENY`

HSTS deliberately does not include `includeSubDomains` or `preload` in SEC1.

The CSP keeps:

- scripts on self
- OpenMLS WebAssembly through `'wasm-unsafe-eval'`
- no general `'unsafe-eval'`
- no `'unsafe-inline'` script or style requirement
- styles on self
- workers on self
- realtime/call WebSocket connectivity to the public WSS origin
- approved media-storage origins only in `connect-src`
- no frames or object embeds

## Cache behavior

- HTML app shell: `no-cache`, allowing online revalidation while still permitting the existing service worker to retain an offline navigation shell
- service worker and manifest: `no-cache`
- fingerprinted `/assets/`: one-year immutable cache
- other static files: bounded one-hour public cache
- health and proxy-error responses: `no-store`

Private API caching remains owned by the Fastify endpoint contracts and is preserved through the proxy.

## Verification

Focused SEC1 commands:

```text
npm run test:sec1:headers
npm run test:sec1:browser:e2e
npm run sec1:production:scan
```

Full local closure:

```text
npm run test:sec1:closure
```

Public-origin verification, once deployed:

```text
npm run sec1:headers:check -- https://PUBLIC_ORIGIN/
```

Do not treat this document or source review as final PASS evidence. The executable closure and `docs/testing/SEC1_SECURITY_HARDENING_EVIDENCE.md` own SEC1 completion.
