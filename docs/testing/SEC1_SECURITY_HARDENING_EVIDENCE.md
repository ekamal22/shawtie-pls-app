# SEC1 Security Hardening Evidence

Status: PENDING EXECUTION.

Milestone: SEC1 Pre-V1 Security Hardening.

Branch: `feat/sec1-pre-v1-security-hardening`.

Branch base: `main @ 61a9a3485b061da4c192481739c52305a29d81d1`.

Canonical scope: `../security/PRE_V1_SECURITY_HARDENING.md`.

Canonical design: `../architecture/SEC1_PRE_V1_SECURITY_HARDENING_DESIGN.md`.

Production serving contract: `../operations/PRODUCTION_WEB_SERVING.md`.

## Evidence rule

This file intentionally does not claim SEC1 PASS yet.

Source implementation and executable harnesses are committed, but the final coherent local closure has not been run from a clean checkout at this checkpoint. Do not copy expected markers below into project state as observed results until the command exits successfully and the raw/local output has been reviewed.

Final closure command:

```text
npm run test:sec1:closure
```

## Implemented remediation under test

### SEC1-A password admission

Implemented:

- pure structural password rules remain in `packages/domain`
- canonical new-credential admission lives in `apps/api/src/security/password-admission.ts`
- registration and password recovery use the same admission+Argon2 hashing boundary
- existing login verification and opportunistic rehash do not invoke new-password admission
- password recovery challenge authorization occurs before the replacement-password Argon2 hash
- common-password screening is server-only and exact after NFC normalization
- plaintext source corpus data is intentionally not committed
- source provenance is pinned to SecLists commit `2e3e92569043d24297ca6c35070078e5cf41651e`, source path `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`, Git blob `38eb37702244f55fda75cab281eb2145cd7685b6`, and source count 99,839
- the committed runtime corpus contains 327 sorted unique SHA-256 membership digests for structurally reachable, NFC-normalized, case-folded source entries
- `npm run sec1:passwords:check` verifies digest count/shape/order/uniqueness, pinned metadata, and absence of plaintext sentinel values without needing the raw source
- regeneration requires an explicit untracked `SEC1_COMMON_PASSWORD_SOURCE_FILE`; the generator verifies the pinned Git blob SHA and source count before writing output
- SecLists MIT provenance and license notice are preserved under `security-data/common-passwords/`

### SEC1-B reauthentication throttling

Implemented before Argon2 verification:

- `reauth_account`: 5 attempts per 15 minutes, 15-minute block
- `reauth_session`: 5 attempts per 15 minutes, 15-minute block
- `reauth_network`: 50 attempts per 15 minutes, 15-minute block

Implemented success behavior:

- session token rotates with generation fencing
- recent-reauthentication timestamp advances
- account and session reauthentication buckets reset across configured HMAC key versions
- network compute budget does not reset

Implemented failure behavior:

- generic `AUTH_INVALID`
- `reauthentication_failed` security event contains no attempted password, network address, token, or rate-limit subject
- requests stopped by the limiter do not amplify failure events

Integration coverage includes repeated failures, success reset behavior, and concurrent guesses racing against the durable limit.

### SEC1-C expired registration-intent cleanup

Implemented:

- independent auth-maintenance worker loop
- 60-second maintenance interval
- bounded batch size 100
- PostgreSQL authoritative timestamp
- `FOR UPDATE SKIP LOCKED`
- delete only `completed_at IS NULL AND expires_at <= now`
- returned application data is ID only; `password_hash` is not selected into worker memory
- existing foreign-key cascade removes registration challenges
- multiple worker replicas can sweep concurrently
- no new migration
- no new scheduled-action type

### SEC1-D production browser hardening

Implemented production adapter:

- `apps/web/server.mjs`
- `apps/web/server-security.mjs`
- serves production `dist`
- same-origin HTTP `/api` reverse proxy
- same-origin WebSocket `/api` reverse proxy
- canonical Host enforcement
- explicit `WEB_TRUSTED_PROXY` IP/CIDR trust with spoofed forwarded-header rejection and right-to-left trusted-chain resolution
- sanitized canonical forwarding metadata to Fastify plus fixed/dynamic hop-by-hop request and response stripping
- repository-controlled headers on static and proxied HTTP responses
- service-worker-compatible HTML caching
- explicit media `connect-src` origin configuration
- public-origin WSS allowance
- OpenMLS WebAssembly through `'wasm-unsafe-eval'`
- no general `'unsafe-eval'`
- no `'unsafe-inline'` script/style dependency
- HSTS one-year max-age for HTTPS public origin, without `includeSubDomains` or `preload`
- nosniff, no-referrer, camera/microphone Permissions-Policy, clickjacking denial

The implementation sweep removed every production inline-style writer found in the web source, including additional Talk, video-call, and View Transition paths discovered after the initial three-site audit.

## Closure matrix

| Gate | Command / evidence source | Current status |
| --- | --- | --- |
| Hash-only common-password corpus integrity and provenance check | `npm run sec1:passwords:check` via closure | NOT RUN |
| SEC1 artifact formatting | `npm run sec1:format:check` | NOT RUN |
| Proxy trust/header sanitization unit tests | `npm run test:sec1:headers` | NOT RUN |
| Focused password/admission/security unit tests | `npm run test:sec1` | NOT RUN |
| Disposable PostgreSQL A1/API/worker integration | `npm run test:sec1:local` | NOT RUN |
| Real Chromium production CSP/OpenMLS/SW/WS/media smoke | `npm run test:sec1:browser:e2e` | NOT RUN |
| Production bundle/source security scan | `npm run sec1:production:scan` | NOT RUN |
| Full repository health | `npm run health` | NOT RUN |
| High-severity dependency audit | `npm audit --audit-level=high` | NOT RUN |
| Git diff hygiene | `git diff --check` | NOT RUN |
| Feature branch local/remote parity | closure wrapper | NOT RUN |
| Every feature commit contains `[skip ci]` | closure wrapper | NOT RUN |
| No new Unicode em dash in feature diff | closure wrapper | NOT RUN |

## Expected final markers

These are the markers emitted by the committed closure wrapper on success. They are expectations, not observed evidence at this checkpoint.

```text
SEC1_AUTOMATED_CLOSURE_HEAD <sha>
SEC1_PASSWORD_ADMISSION_PASS
SEC1_RECOVERY_POLICY_PARITY_PASS
SEC1_REAUTH_RATE_LIMIT_PASS
SEC1_REGISTRATION_HASH_CLEANUP_PASS
SEC1_BROWSER_HEADERS_PASS
SEC1_CSP_WASM_PASS
SEC1_A1_REGRESSION_PASS
SEC1_REPOSITORY_HEALTH_PASS
SEC1_DEPENDENCY_AUDIT_PASS
SEC1_SECURITY_HARDENING_PASS
```

## Closure prerequisites

Local closure requires:

- clean feature-branch checkout matching `origin/feat/sec1-pre-v1-security-hardening`
- Node.js 22.18.0 or newer
- `npm ci`
- Docker engine for disposable PostgreSQL
- Rust 1.91.0 or newer and `wasm-pack` for the OpenMLS build
- Playwright Chromium installed

The closure wrapper intentionally uses local infrastructure and does not spend GitHub-hosted Actions capacity.

## Physical Android

Physical Android is not a default SEC1 gate.

The changed browser behavior is covered by the real desktop Chromium production-serving harness. Add a focused Redmi regression only if final closure exposes device-specific cookie, service-worker, media, WebRTC, or browser-header behavior that desktop Chromium cannot prove.

## Public HTTPS re-proof

If no live commercial origin exists during SEC1 closure, R2 must run the committed public header checker against the actual deployed HTTPS origin after CDN/ingress/TLS termination is present:

```text
npm run sec1:headers:check -- https://PUBLIC_ORIGIN/
```

R2 owns that deployment-layer re-proof. SEC1 owns the repository-controlled serving behavior.

## Finalization procedure

After a successful clean closure:

1. replace every NOT RUN row above with the observed result
2. record the final executable SHA and UTC run time
3. record focused test counts and PostgreSQL/browser results from the actual output
4. record the dependency-audit result
5. record any defect discovered during closure and its corrective commit
6. rerun the affected gate after every corrective source change
7. commit this evidence with `[skip ci]`
8. reconcile `PROJECT_STATE.md`, `ROADMAP.md`, `ROADMAP_EPICS.md`, security docs, and README
9. only then mark SEC1 DONE and unblock V1 subject to Actions capacity
