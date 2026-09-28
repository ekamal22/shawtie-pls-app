# SEC1 Pre-V1 Security Hardening

Status: DESIGN FROZEN, IMPLEMENTATION NOT STARTED

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

Registration validates the domain password policy before hashing. Password-recovery completion currently accepts the contract-level non-empty password and hashes it without applying `validatePasswordPolicy()`.

Required remediation:

- apply the same domain password policy to replacement passwords before hashing
- reject too-short, too-long, oversized, and common passwords through password recovery
- keep error behavior deterministic and privacy-safe
- add focused regression tests proving parity between registration and recovery

## Finding 2: password reauthentication throttling

Severity: Medium.

The normal login path has durable PostgreSQL-backed rate limiting. The authenticated `/api/v1/auth/reauthenticate` path verifies Argon2id credentials but does not currently apply an explicit durable rate limit.

Required remediation:

- add server-authoritative durable throttling for repeated password reauthentication failures
- cover both account/session abuse and network-level CPU abuse so trivial subject changes cannot bypass the control
- preserve generic authentication failures
- retain session-token rotation after successful reauthentication
- add contention and abuse regressions where appropriate

## Finding 3: stronger common-password screening

Severity: Low-Medium.

The current domain policy includes only a ten-entry `COMMON_PASSWORDS` set.

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

Successful registration clears the transient `registration_intents.password_hash` in the same transaction that creates the durable account credential. The accepted A1 design also requires expired abandoned intents to scrub the hash before or while deleting the intent, but the current runtime audit did not find that cleanup path.

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

The API registers `@fastify/helmet`, secure cookies are enforced in production, and the web Vite configuration sets a restrictive camera/microphone `Permissions-Policy`. The audit did not find repository evidence that the actual production web serving path enforces CSP and HSTS.

Required remediation:

- determine and commit the repository-controlled production serving adapter/configuration for the PWA
- do not treat Vite dev/preview headers as production evidence
- enforce CSP with script-src 'self' 'wasm-unsafe-eval' so OpenMLS WebAssembly remains usable without general JavaScript unsafe-eval
- remove the three currently known React inline-style sites so production style-src can remain 'self' without unsafe-inline
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
