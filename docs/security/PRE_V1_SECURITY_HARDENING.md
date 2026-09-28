# SEC1 Pre-V1 Security Hardening

Status: PLANNED

Priority: highest remaining pre-release priority.

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

- replace or augment the tiny set with a maintainable common/compromised-password screening strategy suitable for this product
- avoid sending plaintext passwords to an external provider as part of routine validation
- preserve the product's no-composition-rule approach
- add deterministic tests for rejected common passwords and accepted strong passphrases

The implementation choice may be a reviewed bundled list or another privacy-preserving strategy. If it materially changes architecture or introduces an external dependency, document the decision before implementation.

## Finding 4: expired registration-intent password-hash cleanup

Severity: Low-Medium.

Successful registration clears the transient `registration_intents.password_hash` in the same transaction that creates the durable account credential. The accepted A1 design also requires expired abandoned intents to scrub the hash before or while deleting the intent, but the current runtime audit did not find that cleanup path.

Required remediation:

- implement bounded cleanup for expired abandoned registration intents
- scrub the Argon2id hash before or atomically with deletion
- prove completed intents still clear the transient hash immediately
- prove expired abandoned intents cannot retain password hashes indefinitely

## Finding 5: production browser CSP and HSTS evidence

Severity: Conditional Medium.

The API registers `@fastify/helmet`, secure cookies are enforced in production, and the web Vite configuration sets a restrictive camera/microphone `Permissions-Policy`. The audit did not find repository evidence that the actual production web serving path enforces CSP and HSTS.

Required remediation:

- determine the real public serving layer for the PWA
- enforce strict CSP and HSTS there if they are not already provided
- if the deployment edge already injects them, record live response evidence rather than duplicating policy blindly
- keep required WebRTC, service-worker, media, API, and self-hosted asset behavior working without unsafe script policy expansion
- add automated header regression coverage where the repository controls the serving layer

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

1. focused domain/contracts tests for password policy
2. A1 authentication/security tests
3. disposable PostgreSQL integration coverage for reauthentication throttling and registration-intent cleanup
4. production-web header evidence or an automated equivalent for CSP/HSTS
5. `npm run health`
6. `npm audit --audit-level=high`
7. `git diff --check`
8. evidence recorded in `docs/testing/SEC1_SECURITY_HARDENING_EVIDENCE.md`
9. repository-wide documentation reconciliation

Physical Android testing is not required by default for SEC1. Add a focused device regression only if a remediation changes device-specific browser, cookie, PWA, or security-flow behavior that local real-browser testing cannot adequately prove.

## Completion rule

SEC1 is DONE only when every acceptance gate in `docs/ROADMAP_EPICS.md` is closed with committed evidence.

After SEC1 is DONE, V1 Hosted CI Verification becomes the next priority when GitHub Actions capacity is available.
