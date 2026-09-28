# SEC1 Security Hardening Evidence

Status: PASS.

Milestone: SEC1 Pre-V1 Security Hardening.

Branch: `feat/sec1-pre-v1-security-hardening`.

Branch base: `main @ 61a9a3485b061da4c192481739c52305a29d81d1`.

Fast-forward merge anchor: `a2badf7a357f36c075d44e1378fc2d6c2d20e300`.

Canonical scope: `../security/PRE_V1_SECURITY_HARDENING.md`.

Canonical design: `../architecture/SEC1_PRE_V1_SECURITY_HARDENING_DESIGN.md`.

Production serving contract: `../operations/PRODUCTION_WEB_SERVING.md`.

## Final execution record

Final executable SHA: `91ca920d9a7cdfc4268f8c57425ed8dd7ef726d5`.

Final successful run time: `2026-09-28T19:18:11Z` UTC.

Final closure command:

```text
npm run test:sec1:closure
```

The command ran from a clean `feat/sec1-pre-v1-security-hardening` checkout matching the remote branch and exited successfully. It emitted `SEC1_SECURITY_HARDENING_PASS` for the exact executable SHA above. GitHub-hosted Actions and physical Android testing were not run.

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
- the canonical sorted digest-set checksum is `2614e892e747d06fd0861733ffc0c9187b5c242a8aae8e029e938db860a537ca`
- `npm run sec1:passwords:check` verifies digest count/shape/order/uniqueness, pinned metadata, the canonical digest-set checksum, and absence of plaintext sentinel values without needing the raw source
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

The network subject is normalized before HMAC derivation: IPv4 uses a canonical `/24`, IPv4-mapped IPv6 collapses to the equivalent IPv4 bucket, and canonicalized IPv6 uses a stable `/64`. Equivalent textual IPv6 spellings therefore cannot create separate reauthentication network buckets.

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

## Source-audit corrections before closure

The implementation review caught and corrected defects before any SEC1 PASS claim:

- the generated common-password runtime file had drifted from the hash-only generator/evidence contract; the final source now contains the canonical 327 digest membership set derived from the pinned SecLists source
- the digest pipeline is now protected by the canonical digest-set checksum above, preventing stale or accidentally double-hashed generated output from matching metadata alone
- `PasswordAdmissionService` now performs the intended SHA-256 exact-membership lookup over the normalized lowercase candidate
- network-prefix normalization was hardened so IPv4-mapped IPv6 and equivalent IPv6 text forms cannot split the network abuse budget
- the final SEC1 web unit command now executes header-policy, proxy-trust, and production-server configuration tests, and SEC1 lint explicitly includes the proxy authority and public header checker
- API `APP_ORIGIN` now requires a bare HTTP(S) origin and API `TRUSTED_PROXY` now accepts only literal IP/CIDR entries, matching the web-adapter trust model
- an API regression now proves registration cannot complete at or after the authoritative registration-intent expiry boundary

These corrections are committed source changes and were exercised by the final successful closure.

## Defects found during closure

The first closure attempt at `c043dc0ea0e571e8765e88de6923d5f509d11e3d` stopped at the SEC1 formatting gate because nine committed SEC1 JavaScript and TypeScript test artifacts were not in canonical Prettier form. Commit `487517c98e0ce8008e860de4172ab5d70af05939` formatted only those reported files.

The next closure attempt at `487517c98e0ce8008e860de4172ab5d70af05939` passed focused security, PostgreSQL 36/36, Chromium 1/1, and the production scan, then full repository health found nine additional SEC1 implementation and test files outside the narrow SEC1 format glob that were not in canonical Prettier form. Commit `91ca920d9a7cdfc4268f8c57425ed8dd7ef726d5` formatted only those reported files.

Both findings were repository-hygiene defects. No production behavior, security assertion, acceptance expectation, database migration, or test semantics changed. The focused format checks passed after each repair, and the complete closure was rerun from the beginning after the final repair.

## Closure matrix

| Gate | Command / evidence source | Current status |
| --- | --- | --- |
| Hash-only common-password corpus integrity and provenance check | `npm run sec1:passwords:check` via closure | PASS, 327 sorted unique digests, pinned blob and digest-set checksum |
| SEC1 artifact formatting | `npm run sec1:format:check` | PASS |
| Proxy trust/header sanitization unit tests | `npm run test:sec1:headers` | PASS, 16/16 |
| Focused password/admission/security unit tests | `npm run test:sec1` | PASS, 16/16 focused unit tests plus 16/16 header/proxy/server tests |
| Disposable PostgreSQL A1/API/worker integration | `npm run test:sec1:local` | PASS, 36/36, PostgreSQL 16 Alpine, migrations 0001 through 0021, `reserved=0`, invariants PASS |
| Real Chromium production CSP/OpenMLS/SW/WS/media smoke | `npm run test:sec1:browser:e2e` | PASS, Chromium 1/1 |
| Production bundle/source security scan | `npm run sec1:production:scan` | PASS, `SEC1_PRODUCTION_SCAN_PASS` |
| Full repository health | `npm run health` | PASS |
| High-severity dependency audit | `npm audit --audit-level=high` | PASS, 0 vulnerabilities |
| Git diff hygiene | `git diff --check` | PASS |
| Feature branch local/remote parity | closure wrapper | PASS at executable SHA |
| Every feature commit contains `[skip ci]` | closure wrapper | PASS |
| No new Unicode em dash in feature diff | closure wrapper | PASS |

## Observed final markers

```text
SEC1_AUTOMATED_CLOSURE_HEAD 91ca920d9a7cdfc4268f8c57425ed8dd7ef726d5
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

## Closure conclusion

All SEC1 acceptance gates are closed. The evidence-bearing branch was fast-forward merged to `main @ a2badf7a357f36c075d44e1378fc2d6c2d20e300`. The repository-controlled production behavior is locally proven; R2 still owns re-proof of browser headers at the actual public HTTPS origin. V1 Hosted CI Verification is the next milestone and remains subject to GitHub Actions capacity.
