# SEC1 Pre-V1 Security Hardening Design

## Status

FROZEN DESIGN, IMPLEMENTED AND LOCALLY CLOSED ON FEATURE BRANCH.

Implementation and automated local closure are complete on `feat/sec1-pre-v1-security-hardening`. The final executable SHA is `91ca920d9a7cdfc4268f8c57425ed8dd7ef726d5`; observed evidence is recorded in `../testing/SEC1_SECURITY_HARDENING_EVIDENCE.md`.

SEC1 is DONE on its feature branch. V1 Hosted CI Verification is the next pre-release milestone, subject to GitHub Actions capacity.

## Baseline

Design baseline: `main @ 6c70b3791dd79cd2eeb898a7495751800d4f91fb`.

SEC1 preserves the frozen architecture:

- React/TypeScript PWA
- Fastify modular monolith
- separate durable worker
- PostgreSQL authoritative state
- server-side revocable sessions
- existing F2 worker substrate
- existing A1 PostgreSQL-backed security rate-limit buckets
- existing Argon2id credential storage
- existing S1/OpenMLS cryptographic architecture

SEC1 does not introduce Redis, a new authentication service, an online password-checking provider, a password pepper, or a new cryptographic protocol.

No ADR is required because the design stays inside accepted architecture boundaries. Exact schema details, hosting adapter, and bounded maintenance implementation are not frozen baseline choices as long as the accepted security boundaries remain intact.

## Implemented realization

The implementation resolves the intentionally unfrozen details as follows:

- password admission lives in `apps/api/src/security/password-admission.ts`
- the common-password source is pinned by SecLists repository commit, path, Git blob SHA, and entry count, but plaintext source data is intentionally not committed; `scripts/security/generate-common-passwords.mjs` requires an explicitly supplied local copy for regeneration and emits a server-only hash set
- the pinned source has 99,839 entries; after NFC normalization, case folding, decoding valid `$HEX[...]` rows, structural filtering, and deduplication, 327 reachable entries are committed only as sorted SHA-256 membership digests
- registration and password recovery use `PasswordAdmissionService.hashNewCredential()`; recovery performs challenge authorization before the expensive replacement-password Argon2 hash
- reauthentication reuses `security_rate_limit_buckets` with `reauth_account`, `reauth_session`, and `reauth_network` scopes
- registration cleanup uses a 60-second worker maintenance loop with batches of 100 and `FOR UPDATE SKIP LOCKED`; the delete returns IDs only and never selects `password_hash`
- no PostgreSQL migration and no new scheduled-action type were required
- the production web adapter is `apps/web/server.mjs`, serving `dist`, proxying same-origin HTTP and WebSocket `/api` traffic, enforcing canonical Host, and applying `apps/web/server-security.mjs` headers; `apps/web/proxy-security.mjs` owns explicit upstream proxy trust, sanitized client-address forwarding, and hop-by-hop header removal
- CSP uses `script-src 'self' 'wasm-unsafe-eval'` and `style-src 'self'`; the implementation sweep removed the initially known React style attributes plus additional video, Talk, and View Transition inline-style writers found during source audit
- focused verification is centralized in `npm run test:sec1:closure`; the final complete closure passed on executable SHA `91ca920d9a7cdfc4268f8c57425ed8dd7ef726d5`

These are implementation choices inside the frozen SEC1 boundaries, not new architecture decisions.

## Problem statement

The post-UX8 audit confirmed that password storage itself is sound: passwords are hashed with Argon2id rather than stored in plaintext or reversibly encrypted.

At the design baseline, the audit identified five hardening gaps:

1. password-recovery completion bypassed the canonical password-admission policy
2. password reauthentication had no explicit durable abuse throttle
3. the common-password denylist contained only ten entries
4. expired abandoned registration intents could retain Argon2id password hashes indefinitely
5. the production PWA serving path had no repository-backed CSP/HSTS contract or evidence

SEC1 closes these gaps without reopening unrelated product or cryptographic milestones.

## Security invariants

The implementation must preserve all of the following:

1. Existing passwords continue to verify even if a later password-admission policy would reject that value for a newly created credential.
2. A password must pass canonical admission before it is stored as a new credential.
3. Password verification and opportunistic rehash-on-login must not be coupled to current password-admission rules.
4. Raw passwords never enter logs, security events, rate-limit subjects, outbox payloads, scheduled work, analytics, or browser durable storage.
5. Reauthentication throttling is authoritative in PostgreSQL and survives API process restarts.
6. Network abuse controls bound Argon2 compute before password verification.
7. Successful reauthentication continues to rotate the session token and advance token-generation fencing.
8. Expired registration intents are no longer valid user operations before asynchronous cleanup occurs.
9. Credential cleanup does not depend on a single process timer, worker identity, or external provider.
10. CSP must preserve OpenMLS WebAssembly execution without enabling general JavaScript eval.
11. Production JavaScript must not require `unsafe-inline` or `unsafe-eval`.
12. The stable release must have HSTS at the actual public HTTPS serving layer.
13. SEC1 does not require Xiaomi/Android acceptance unless implementation creates a device-specific behavior that cannot be adequately proven in the real desktop browser harness.

## Architecture overview

```text
Browser / PWA
    |
    | HTTPS + enforced browser security headers
    v
Fastify API
    |
    +--> canonical password admission
    |      |
    |      +--> pure structural rules
    |      +--> server-only common-password corpus
    |      +--> Argon2id for newly accepted credentials
    |
    +--> authenticated reauthentication
    |      |
    |      +--> durable account budget
    |      +--> durable session budget
    |      +--> durable network compute budget
    |      +--> Argon2id verification
    |      +--> session-token rotation
    |
    v
PostgreSQL
    |
    +--> account_password_credentials
    +--> registration_intents
    +--> security_rate_limit_buckets
    +--> security_events
    |
    v
Durable worker
    |
    +--> bounded auth-maintenance sweep
           |
           +--> delete expired abandoned registration intents
                without loading password_hash into application memory
```

## SEC1-A: password admission and credential hashing

### Separation of responsibilities

The current `PasswordHasher` remains a cryptographic primitive wrapper. It owns:

- NFC normalization before hashing/verifying
- Argon2id hashing
- Argon2id verification
- dummy verification for login enumeration resistance
- `needsRehash()`

It must not become the password-admission authority.

This separation is deliberate. A user with an existing password that later becomes present in the common-password corpus must still be able to sign in and migrate away from it. Successful login rehash must also remain possible without forcing current admission rules onto an already-valid credential.

SEC1 adds a server-side password-admission boundary for new credentials.

Representative shape:

```text
packages/domain
  password structural rules
        |
        v
apps/api/security
  PasswordAdmissionService
        |
        +--> common-password corpus
        +--> PasswordHasher
```

### Pure structural rules

The pure domain rule continues to own:

- NFC-normalized length
- minimum 15 Unicode code points
- maximum 128 Unicode code points
- maximum 1024 encoded UTF-8 bytes
- no composition requirements
- no silent truncation

The common-password corpus moves out of the general domain package and becomes server-only security data.

Reason:

- a large corpus is not business-domain logic
- it must not accidentally inflate a future browser bundle
- it must not become an externally callable password oracle
- API-side admission is the authoritative credential boundary

### PasswordAdmissionService

Add a narrow service under `apps/api/src/security/`.

Representative interface:

```ts
interface PasswordAdmissionResult {
  normalizedPassword: string;
}

class PasswordAdmissionService {
  validateForNewCredential(password: string): PasswordAdmissionResult;
  hashNewCredential(password: string): Promise<string>;
}
```

`hashNewCredential()` performs:

```text
structural validation
  -> common-password exact-match check
  -> PasswordHasher.hash()
```

Registration and password-recovery completion must call the same admission method.

Future password-change functionality must also use this boundary.

No other path may create or replace `account_password_credentials.password_hash` from a raw password without going through canonical admission.

### Common-password corpus

The corpus is local, committed, generated, and server-only.

Requirements:

- no runtime network call
- no plaintext password leaves Shawtie for checking
- deterministic output
- exact normalized full-password comparison, not substring heuristics
- materially larger than the current ten-entry set
- pin a source universe materially larger than the historical ten-entry list
- do not commit plaintext source password rows
- commit only exact membership digests for source entries that can pass the structural password policy
- source provenance, license, normalized entry count, source checksum, and generation command are committed
- generated output is reproducible and the canonical sorted digest membership set is pinned by SHA-256 `2614e892e747d06fd0861733ffc0c9187b5c242a8aae8e029e938db860a537ca`
- tests include known blocked values that are not part of the historical ten-entry set

The implementation uses a generated server-only `Set<string>` of SHA-256 digests. The candidate is NFC-normalized, case-folded, hashed in-process, and checked for exact digest membership. SHA-256 here is only a deterministic local set representation. It is not account credential storage and must not be confused with the Argon2id credential KDF. A Bloom filter remains disallowed because false-positive password rejection is unnecessary.

### Recovery parity

`passwordRecoveryCompleteSchema` remains a defensive transport bound. It is not the credential policy authority.

Recovery completion flow:

```text
parse bounded request
  -> verify recovery challenge
  -> canonical password admission
  -> Argon2id hash
  -> update credential
  -> revoke all existing sessions
  -> consume challenge
  -> security event
```

The password should be admitted before the expensive new Argon2id hash is produced.

Existing challenge authorization and session-revocation behavior remain unchanged.

## SEC1-B: password reauthentication abuse protection

### Threats

The authenticated reauthentication endpoint performs expensive Argon2 verification.

Without a durable throttle, an attacker holding a stolen session can:

- repeatedly guess the account password
- consume CPU through repeated Argon2 operations
- rotate through sessions unless the account itself is a rate-limit subject

SEC1 reuses the existing PostgreSQL `security_rate_limit_buckets` implementation.

No new rate-limit table or in-memory limiter is introduced.

### Required subjects

Three independent budgets are consumed before Argon2 verification:

| Scope | Subject | Initial policy |
| --- | --- | --- |
| `reauth_account` | authenticated account ID | 5 attempts / 15 min, block 15 min |
| `reauth_session` | authenticated session ID | 5 attempts / 15 min, block 15 min |
| `reauth_network` | existing normalized network prefix | 50 attempts / 15 min, block 15 min |

All subjects continue through the existing versioned HMAC `rate-limit-key` derivation before persistence.

Before HMAC derivation, network identity is canonicalized: IPv4 uses a `/24`, IPv4-mapped IPv6 collapses to the same IPv4 bucket, and normalized IPv6 uses a stable `/64`. Equivalent textual IPv6 spellings therefore cannot split the network budget.

Raw IP addresses, passwords, cookies, session tokens, and device handles are not stored as rate-limit keys.

The account budget prevents trivial session rotation from bypassing the credential-guess limit.

The session budget contains a stolen individual session.

The network budget is deliberately broader and primarily limits aggregate Argon2 CPU pressure.

### Success and failure behavior

Flow:

```text
require authenticated session
  -> parse password
  -> consume account/session/network budgets
  -> if blocked: 429 RATE_LIMITED
  -> load current password hash
  -> Argon2id verify
      |
      +--> failure
      |      -> append reauthentication_failed
      |      -> 401 AUTH_INVALID
      |
      +--> success
             -> rotate session token with generation fencing
             -> set recent reauthentication timestamp
             -> reset reauth_account buckets for all configured key versions
             -> reset reauth_session buckets for all configured key versions
             -> do not reset reauth_network
             -> append reauthentication_succeeded
             -> return rotated secure cookie
```

The network budget is not reset after one user's success because it protects shared compute capacity, not credential validity.

Successful account/session reset follows the same key-rotation compatibility pattern already used by login identifier buckets.

### Failure events

`reauthentication_failed` is an allowlisted security event with:

- account ID
- current device ID when present
- event type
- timestamp

It must not include:

- attempted password
- password length or character classes
- network address
- rate-limit HMAC
- session token

Requests rejected by the rate limiter do not need a per-request failure event. The durable rate-limit row already provides bounded operational evidence and this avoids event amplification.

### Concurrency

The existing rate-limit repository already:

- sorts buckets deterministically
- locks bucket rows
- updates counters atomically
- spans every configured HMAC key version

SEC1 must add integration coverage for concurrent reauthentication attempts proving the effective limit cannot be exceeded through request races beyond requests already admitted before a blocking write commits.

No new distributed lock is introduced.

## SEC1-C: expired registration-intent credential cleanup

### Refinement from the initial design

SEC1 will not introduce a new `scheduled_actions` action type for registration expiry.

Reason:

The current scheduled consumer claims generic due actions before handler dispatch. An older worker that sees a newly produced action type can mark it failed as `UNSUPPORTED_ACTION_OR_PAYLOAD_VERSION`.

API and worker services may deploy independently, so producing a new action type creates an unnecessary mixed-version rollout hazard.

Registration-intent cleanup is retention maintenance, not a product deadline. Authorization already fails synchronously at `expires_at`.

The safer architecture is a bounded worker maintenance sweep.

### Cleanup authority

Add a narrow database repository operation that deletes only expired, incomplete registration intents.

Representative SQL shape:

```sql
WITH doomed AS (
  SELECT id
  FROM registration_intents
  WHERE completed_at IS NULL
    AND expires_at <= $1
  ORDER BY expires_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
DELETE FROM registration_intents intent
USING doomed
WHERE intent.id = doomed.id
RETURNING intent.id;
```

Important properties:

- uses PostgreSQL authoritative time supplied from the same transaction
- uses the existing partial expiry index
- does not SELECT or return `password_hash`
- keeps the Argon2id hash out of worker application memory
- DELETE cascades registration email challenges through the existing foreign key
- concurrent workers are safe through `FOR UPDATE SKIP LOCKED`
- deletion is idempotent
- an expired intent is already unusable before cleanup runs

### Worker loop

Add a fourth bounded worker loop:

```text
scheduled
outbox
deletion
auth-maintenance
```

The maintenance loop runs independently of product-deadline scheduling.

Recommended initial defaults:

- maintenance interval: 60 seconds
- bounded batch: 100 expired intents
- short transaction only
- no external calls
- no lease required because the row lock and deletion occur in one transaction
- process crash rolls the transaction back and the next poll retries naturally

The worker configuration should expose the maintenance interval and batch size only if operational testing shows the normal worker batch configuration is inappropriate. Avoid unnecessary configuration surface.

### Cleanup SLA

Under a healthy worker and no large backlog, an expired abandoned registration intent should normally be removed within approximately one maintenance interval.

The security invariant is stronger than a wall-clock SLA:

```text
now >= expires_at
  => registration verification is denied immediately
  => password hash becomes cleanup-only data
  => bounded worker sweep eventually deletes the row
```

Worker outage can delay physical deletion but cannot restore registration eligibility.

### Races

#### Verify vs cleanup before expiry

Cleanup predicate is false. Verification proceeds normally.

#### Verify vs cleanup at/after expiry

The intent is already logically expired.

If cleanup locks/deletes first, verification sees no valid intent.

If verification locks first, its existing expiry check rejects the request. Cleanup deletes it on this or a later sweep.

No account can be created after the authoritative expiry boundary.

#### Successful registration vs cleanup

Successful registration clears `password_hash` in the existing completion transaction.

The SEC1 maintenance sweep selects only `completed_at IS NULL`, so completed intents are outside the credential-retention finding.

Retention of already-scrubbed completed intent metadata may be handled separately under normal retention policy and is not required for SEC1.

### Migration impact

No PostgreSQL migration is required by the refined SEC1-C design.

The existing schema and partial expiry index are sufficient.

Therefore SEC1 should preserve the current migration chain unless implementation uncovers a separate schema requirement.

Do not reserve migration 0022 merely to satisfy a milestone convention.

## SEC1-D: production browser security headers

### Serving-layer authority

At the design baseline, the commercial repository did not contain a production static-serving adapter or deployment configuration.

SEC1 must not treat Vite dev/preview headers as production evidence.

The hosting provider remains unfrozen architecture. The implemented SEC1-D serving authority is `apps/web/server.mjs` plus `apps/web/server-security.mjs`: it serves the production bundle, proxies same-origin API and WebSocket traffic, and owns the repository-level browser security headers. `apps/web/proxy-security.mjs` separately owns explicit upstream proxy trust and sanitizes forwarding metadata before requests reach Fastify. Deployment-layer HTTPS behavior must still be re-proved at the actual public origin during R2 if no live commercial origin exists during SEC1 closure.

If there is no live public commercial environment yet, SEC1 may close the code/config portion against an enforced production-mode serving harness. R2 must still re-prove the headers against the actual public HTTPS origin before stable release.

### CSP and OpenMLS WebAssembly

S1 uses OpenMLS WebAssembly.

A normal CSP `script-src 'self'` blocks WebAssembly compilation in modern browsers. SEC1 must allow the narrower WebAssembly capability rather than opening general JavaScript evaluation.

Required script policy:

```text
script-src 'self' 'wasm-unsafe-eval'
```

Forbidden:

```text
script-src 'unsafe-inline'
script-src 'unsafe-eval'
```

`'wasm-unsafe-eval'` permits WebAssembly compilation without enabling normal JavaScript `eval()` or `Function()`.

### Inline-style removal

The initial code audit found three React inline-style sites in `AppShell.tsx` and `primitives.tsx`. Implementation-wide CSP review then found additional direct style writers in video calling, Talk, and View Transition presentation code.

SEC1-D removes every production inline-style writer found by that sweep and replaces the behavior with CSS classes, bounded variants, or data attributes.

That allows:

```text
style-src 'self'
```

without `'unsafe-inline'`.

Do not weaken the CSP merely to preserve presentation-time convenience style writes.

### Required CSP baseline

The production policy should start from:

```text
default-src 'self';
base-uri 'none';
object-src 'none';
frame-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
font-src 'self';
img-src 'self' blob: data:;
media-src 'self' blob:;
manifest-src 'self';
worker-src 'self';
connect-src 'self' <explicit-app-wss-origin> <explicit-approved-media-storage-origins>;
upgrade-insecure-requests;
```

The exact serialized form may differ by serving adapter.

### connect-src

Do not rely only on `connect-src 'self'` for realtime sockets because WebSocket scheme handling of `'self'` is not uniform across browsers.

The production policy must include the explicit WSS origin derived from the public application origin.

Direct signed media upload/download uses browser `fetch()`, so every permitted media-storage origin must also appear explicitly in `connect-src`.

Do not use:

- `connect-src *`
- broad `https:`
- broad `wss:`

unless a later reviewed requirement proves exact-origin allowlisting impossible.

### HSTS

Initial enforced production HSTS:

```text
Strict-Transport-Security: max-age=31536000
```

Do not add `includeSubDomains` or `preload` until the domain and all relevant subdomains have been explicitly reviewed as permanently HTTPS-only.

HSTS must be tested on HTTPS responses from the actual serving layer. Browsers ignore HSTS delivered over HTTP.

### Additional browser headers

The production PWA serving layer should also prove:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(self), microphone=(self)
X-Frame-Options: DENY
```

`frame-ancestors 'none'` remains the modern clickjacking authority; `X-Frame-Options: DENY` is defense in depth.

Do not add aggressive cross-origin isolation headers in SEC1 unless required and separately proven against media, WebRTC, service workers, and browser compatibility.

### Reverse-proxy trust boundary

The web adapter does not trust forwarded-address metadata merely because it is present.

`WEB_TRUSTED_PROXY` accepts only explicit IP or CIDR entries. Wildcard trust, boolean trust-all values, and hop-count shortcuts are rejected.

For normal HTTP and WebSocket requests:

- an untrusted immediate socket peer causes all incoming forwarded-address metadata to be ignored
- a trusted socket peer permits right-to-left resolution of the supplied address chain until the first untrusted client address
- malformed chains fail closed to the immediate socket peer
- `Forwarded`, `X-Real-IP`, and client-supplied `X-Forwarded-*` metadata are removed
- the adapter writes one sanitized `X-Forwarded-For`, canonical forwarded Host, and canonical forwarded protocol
- fixed and Connection-nominated hop-by-hop headers are removed on normal HTTP request and response paths
- the API still uses its own explicit `TRUSTED_PROXY` IP/CIDR configuration and must trust only the known web-adapter peer

This keeps network-rate-limit subjects meaningful behind a deployment ingress without allowing a browser to choose its own network key.

### Header authority and drift control

There must be one canonical policy representation or one executable assertion contract.

Add a security assertion script such as:

```text
scripts/security/check-web-security-headers.mjs
```

It must be able to validate an HTTP(S) target and fail when:

- CSP is missing
- HSTS is missing on an HTTPS production-mode target
- `unsafe-inline` appears in script policy
- `unsafe-eval` appears in script policy
- `wasm-unsafe-eval` is missing while S1 WASM remains enabled
- `frame-ancestors 'none'` is missing
- `object-src 'none'` is missing
- explicit WSS origin is missing
- required media connect origins are missing
- Permissions-Policy loses camera/microphone restriction
- `nosniff` is missing

If hosting configuration cannot import a shared policy builder, the assertion script becomes the drift detector between the canonical documented contract and the serving adapter.

### Browser verification

A focused real-Chromium SEC1 browser harness must prove under enforced CSP:

- application shell boots
- OpenMLS WASM initializes
- login/session API works
- service worker registers
- same-origin WebSocket can connect
- media signed upload/download origin is allowed
- no unexpected CSP violation is required for normal flow

Voice/video full physical acceptance is not repeated. A focused call-page browser smoke is sufficient unless the serving change breaks a device-specific permission or PWA behavior.

## SEC1-E: verification architecture

### During implementation

Use focused tests only.

Do not rerun the full repository after every slice.

Expected focused commands should cover:

```text
password-domain tests
A1 auth/security unit tests
SEC1 PostgreSQL/API integration
SEC1 worker maintenance integration
SEC1 browser/header harness
```

### Final closure

Run one coherent final closure after all SEC1 source changes are stable.

Required final evidence:

1. password structural-policy tests
2. server-side common-password corpus tests
3. registration/recovery policy-parity tests
4. reauthentication rate-limit tests
5. concurrent rate-limit integration
6. registration-intent cleanup worker integration
7. production-mode browser header assertion
8. real Chromium boot + WASM + WebSocket + media connectivity under enforced CSP
9. retained A1 session/cookie/CSRF/recovery regression
10. `npm run health`
11. `npm audit --audit-level=high`
12. `git diff --check`
13. no new Unicode em dash
14. all SEC1 commits contain `[skip ci]` while hosted Actions capacity is being conserved
15. final evidence in `docs/testing/SEC1_SECURITY_HARDENING_EVIDENCE.md`

### Proposed command surface

```text
npm run test:sec1
npm run test:sec1:postgres
npm run test:sec1:browser:e2e
npm run test:sec1:headers
npm run test:sec1:local
npm run test:sec1:closure
```

The closure wrapper should orchestrate the final run once. It must not turn normal development into repeated full-health execution.

## Physical-device rule

Xiaomi Redmi Note 9S testing is not a mandatory SEC1 gate.

Add a focused physical check only if implementation changes or uncovers behavior specific to:

- Android Chrome cookie semantics
- PWA/service-worker installation or update
- Android permission behavior
- device-specific WebRTC behavior
- a security-header interaction that desktop Chromium cannot reproduce adequately

The five currently known SEC1 findings do not independently require physical Android execution.

## Deployment and rollback

### Password admission

Deployment is backward compatible.

Existing credentials are not invalidated.

Rollback restores previous new-password admission behavior but does not alter already-hashed credentials.

### Reauthentication throttling

New scopes use the existing generic rate-limit table.

Rollback leaves harmless scoped rows that can expire or be cleaned later.

No migration rollback is required.

### Registration-intent cleanup

The worker only deletes already-expired, incomplete registration intents.

Those intents are unusable before deletion, so cleanup does not revoke a still-valid registration.

Rollback stops future cleanup sweeps but cannot and should not restore already-expired intents.

### CSP/HSTS

CSP must be proven in staging/production-mode browser testing before enforcement at the public edge.

HSTS rollback requires special caution because browsers cache the policy for `max-age`. This is why SEC1 starts without `includeSubDomains` or `preload`.

Do not increase HSTS scope until R2 operational review.

## Expected implementation slices

### SEC1-A: credential admission

- split structural policy from server-only common-password screening
- add generated corpus + provenance
- add `PasswordAdmissionService`
- route registration and password recovery through canonical admission
- retain `PasswordHasher` verification/rehash semantics
- focused tests only

### SEC1-B: reauthentication abuse control

- pass normalized network subject to reauthentication service
- consume account/session/network budgets before Argon2 verification
- add failure event
- reset only account/session budgets on success
- preserve token rotation
- add focused unit/integration/concurrency tests

### SEC1-C: registration credential cleanup

- add narrow DB cleanup repository
- add bounded auth-maintenance worker loop
- keep password hashes out of worker memory
- add replica/concurrency/expiry-boundary tests
- no migration unless implementation proves schema change necessary

### SEC1-D: browser hardening

- choose repository-controlled production serving adapter/config
- remove the three inline style sites
- enforce CSP including `wasm-unsafe-eval`
- enforce HSTS and companion headers
- add header assertion script
- add focused Chromium CSP/WASM/WebSocket/media smoke

### SEC1-E: integrated closure

- run the SEC1 local matrix
- run full health once
- run dependency audit once
- record final executable SHA and evidence

### SEC1-F: documentation reconciliation

- update SEC1 evidence
- update project state/roadmap/testing/security docs repo-wide
- mark SEC1 DONE only after every acceptance gate is closed
- unblock V1 Hosted CI Verification

## Expected source impact

Likely touched areas:

```text
packages/domain/src/account/password-policy.ts
packages/domain/tests/accounts.test.ts

apps/api/src/security/password-admission.ts
apps/api/src/security/common-passwords.generated.*
apps/api/src/security/password-hasher.ts              retained primitive
apps/api/src/modules/accounts/account-service.ts
apps/api/src/modules/auth/routes.ts
apps/api/tests/a1.security.test.ts
apps/api/tests/a1.integration.test.ts
apps/api/tests/a1.acceptance.integration.test.ts

packages/db/src/repositories/account-auth.ts
packages/db/src/index.ts

apps/worker/src/auth/auth-maintenance.ts
apps/worker/src/runtime/worker-application.ts
apps/worker/src/config.ts                              only if a separate maintenance cadence is needed
apps/worker/tests/a1.worker.test.ts
apps/worker/tests/a1.integration.test.ts

apps/web/src/app/shell/AppShell.tsx
apps/web/src/design/primitives.tsx
apps/web/server.mjs
apps/web/server-security.mjs
apps/web/proxy-security.mjs
apps/web/tests/sec1.headers.test.mjs
apps/web/tests/sec1.proxy.test.mjs
apps/web/tests/sec1.server.test.mjs
scripts/security/check-web-security-headers.mjs
tests/e2e/sec1-security.spec.ts
package.json

docs/testing/SEC1_SECURITY_HARDENING_EVIDENCE.md
```

## Explicit non-goals

SEC1 does not:

- change Argon2id parameters
- encrypt passwords
- add a password pepper
- force existing users to rotate passwords solely because the denylist expands
- add MFA
- add CAPTCHA as an authentication dependency
- change session-token format
- change secure-cookie semantics
- change account recovery authority
- change S1/OpenMLS group or recovery protocols
- change M1/M2/M3 content semantics
- change WebRTC/TURN privacy architecture
- introduce Redis
- introduce a new microservice
- require Xiaomi physical closure by default

## Completion markers

Target evidence markers:

```text
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

SEC1 is complete only when those claims are backed by committed executable evidence, not by design text alone.
