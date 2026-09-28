# SEC1 Pre-V1 Security Hardening

Status: IMPLEMENTED ON FEATURE BRANCH, AUTOMATED CLOSURE PENDING

Priority: highest remaining pre-release priority.

Canonical implementation architecture: `../architecture/SEC1_PRE_V1_SECURITY_HARDENING_DESIGN.md`.

Ordering:

```text
UX8 DONE
  -> SEC1 Pre-V1 Security Hardening
  -> V1 Hosted CI Verification
  -> R2 Public Readiness
  -> Stable Release
```

V1 must not be intentionally run as release evidence before SEC1 is DONE, even if GitHub Actions capacity becomes available first.

## Implementation checkpoint

SEC1 source implementation is complete on `feat/sec1-pre-v1-security-hardening`. This is not yet a DONE claim: the final coherent local closure and evidence commit have not been executed.

Implemented remediation:

- canonical `PasswordAdmissionService` is the only new-credential admission+hash boundary used by registration and password recovery
- the pure domain password rule now owns structural bounds only; existing credential verification and login rehash remain independent
- a pinned MIT-licensed SecLists source corpus with 99,839 entries is committed under `security-data/common-passwords/`; generation is offline, checksum-verified, exact NFC/full-password matching, and emits only structurally reachable server-side entries
- password recovery verifies the authorized recovery challenge before spending the new Argon2 hash
- reauthentication consumes PostgreSQL-backed account, session, and network budgets before password verification; success resets account/session budgets but not the network compute budget
- a separate worker auth-maintenance loop deletes expired incomplete registration intents in bounded `FOR UPDATE SKIP LOCKED` batches without selecting `password_hash`; no new migration or scheduled-action type was introduced
- `apps/web/server.mjs` is the repository-controlled production static/API/WebSocket serving adapter with canonical-host enforcement and CSP/HSTS/browser-header authority
- strict `style-src 'self'` is supported by removing every identified production inline-style writer, including additional Talk, video-call, and View Transition sites discovered during implementation
- the SEC1 test surface now includes focused admission tests, reauthentication concurrency/integration coverage, multi-worker cleanup coverage, production-header tests, a real Chromium OpenMLS/WASM/service-worker/WebSocket/media smoke, an offline corpus reproducibility gate, a production bundle scan, and one final `npm run test:sec1:closure` wrapper

The remaining work is verification only: run the closure from a clean local checkout, fix any discovered defect, commit `docs/testing/SEC1_SECURITY_HARDENING_EVIDENCE.md`, then reconcile final PASS counts before marking SEC1 DONE.

## Purpose

A post-UX8 source audit found several concrete security gaps worth fixing before public-readiness verification. This milestone turns those findings into objective implementation and regression gates.

The audit did not find plaintext password storage or reversible password encryption. Passwords are hashed with Argon2id in `apps/api/src/security/password-hasher.ts`.

Current password-hashing policy:

- Argon2id
- memory cost 19,456 KiB
- time cost 2
- parallelism 1
- 32-byte output
- Unicode NFC normalization before hashing
- rehash-on-login when the stored Argon2 parameters or salt policy are outdated

The existing password-hashing primitive is therefore a retained baseline, not an SEC1 defect.

## Finding 1: password-recovery policy parity

Severity: Medium.

At the audit baseline, registration validated the domain password policy before hashing while password-recovery completion accepted the contract-level non-empty password without the same admission boundary. The feature branch now routes both new-credential paths through the server-side admission service.

Required remediation:

- apply the same domain password policy to replacement passwords before hashing
- reject too-short, too-long, oversized, and common passwords through password recovery
- keep error behavior deterministic and privacy-safe
- add focused regression tests proving parity between registration and recovery

## Finding 2: password reauthentication throttling

Severity: Medium.

At the audit baseline, the normal login path had durable PostgreSQL-backed rate limiting while `/api/v1/auth/reauthenticate` had no explicit durable abuse budget. The feature branch now consumes account, session, and network PostgreSQL buckets before Argon2 verification.

Required remediation:

- add server-authoritative durable throttling for repeated password reauthentication failures
- cover both account/session abuse and network-level CPU abuse so trivial subject changes cannot bypass the control
- preserve generic authentication failures
- retain session-token rotation after successful reauthentication
- add contention and abuse regressions where appropriate

## Finding 3: stronger common-password screening

Severity: Low-Medium.

At the audit baseline, the domain policy included only a ten-entry `COMMON_PASSWORDS` set. The feature branch replaces that set with the pinned server-only corpus described above.

Required remediation:

- keep structural password rules pure and separate from credential verification
- add one server-side password-admission boundary for all newly created/replaced credentials
- move the common-password corpus to server-only security data so a large corpus cannot accidentally inflate a browser bundle
- use a committed, reproducible, offline corpus with source/license/checksum provenance and at least 10,000 entries, preferring 50,000 to 100,000 if repository health remains reasonable
- avoid any runtime external password-checking provider
- preserve the product's no-composition-rule approach
- add deterministic tests for rejected common passwords and accepted strong passphrases

## Finding 4: expired registration-intent password-hash cleanup

Severity: Low-Medium.

Successful registration already cleared the transient `registration_intents.password_hash` in the account-creation transaction. The audit baseline lacked cleanup for expired abandoned intents; the feature branch now deletes those expired incomplete rows through bounded replica-safe worker maintenance, with existing foreign-key cascade removing their registration challenges.

Required remediation:

- use a bounded, replica-safe worker maintenance sweep rather than a new scheduled-action type
- delete only expired incomplete registration intents using PostgreSQL authoritative time and the existing expiry index
- do not SELECT or return password_hash into worker application memory
- use short transactions with FOR UPDATE SKIP LOCKED so multiple worker replicas remain safe
- rely on the existing foreign key cascade to remove registration email challenges
- prove completed intents still clear the transient hash immediately
- prove expired abandoned intents cannot retain password hashes indefinitely
- do not reserve a new PostgreSQL migration unless implementation discovers a real schema requirement

## Finding 5: production browser CSP and HSTS evidence

Severity: Conditional Medium.

At the audit baseline, the API registered `@fastify/helmet`, secure cookies were enforced in production, and Vite development configuration set a restrictive camera/microphone `Permissions-Policy`, but the repository had no production PWA serving adapter. The feature branch now owns that serving boundary in `apps/web/server.mjs`; actual public-HTTPS re-proof remains an R2 obligation if no live commercial origin exists during SEC1.

Required remediation:

- determine and commit the repository-controlled production serving adapter/configuration for the PWA
- do not treat Vite dev/preview headers as production evidence
- enforce CSP with script-src 'self' 'wasm-unsafe-eval' so OpenMLS WebAssembly remains usable without general JavaScript unsafe-eval
- remove every production inline-style writer found by the SEC1 source sweep so production style-src can remain 'self' without unsafe-inline
- explicitly allow the public WSS origin and approved media-storage origins in connect-src
- enforce HSTS with an initial max-age of 31536000 and do not add includeSubDomains/preload until domain scope is separately reviewed
- retain restrictive Permissions-Policy and add executable checks for CSP, HSTS, nosniff, referrer policy, and clickjacking protection
- if no live public commercial environment exists yet, prove the enforced production-mode serving configuration in real Chromium during SEC1 and re-prove the actual public HTTPS origin during R2

## Retained strengths

SEC1 must preserve these already-implemented controls:

- Argon2id password hashing
- 15 to 128 Unicode-code-point password policy with defensive encoded-size bound
- opaque 32-byte random browser session tokens
- only keyed session-token verifiers stored server-side
- production `__Host-` cookies with Secure, HttpOnly, SameSite=Strict, Path=/, and no Domain attribute
- session absolute and idle expiry
- session-token generation fencing and rotation after reauthentication
- password-reset revocation of all existing sessions
- exact-origin, Fetch Metadata, custom-header CSRF controls
- parameterized PostgreSQL access
- S1 protected-content encryption and client-held recovery architecture

## Verification contract

During implementation, use focused tests while iterating. Do not repeatedly run the whole repository for every small edit.

Before SEC1 can be marked DONE, one coherent final local closure must include:

1. focused password structural-policy and server-side admission tests
2. A1 authentication/security tests
3. disposable PostgreSQL integration coverage for reauthentication throttling
4. bounded worker maintenance integration for expired registration-intent deletion
5. enforced production-mode browser/header evidence including OpenMLS WASM, WebSocket, service-worker, and media-connectivity smoke
6. `npm run health`
7. `npm audit --audit-level=high`
8. `git diff --check`
9. evidence recorded in `docs/testing/SEC1_SECURITY_HARDENING_EVIDENCE.md`
10. repository-wide documentation reconciliation

Physical Android testing is not required by default for SEC1. Add a focused device regression only if a remediation changes device-specific browser, cookie, PWA, or security-flow behavior that local real-browser testing cannot adequately prove.

## Completion rule

SEC1 is DONE only when every acceptance gate in `docs/ROADMAP_EPICS.md` is closed with committed evidence.

After SEC1 is DONE, V1 Hosted CI Verification becomes the next priority when GitHub Actions capacity is available.
