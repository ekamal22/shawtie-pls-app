# A1 Accounts and Devices Architecture and Implementation Design

## Status

IMPLEMENTED AND VERIFIED COMPLETE

Effective design date: 2026-09-21.

This document is the canonical implementation design for A1 Accounts and Devices.

It preserves Architecture Baseline 1.0 and uses the completed F2 persistence and worker substrate. It does not add a new persistent state system, trust boundary, lifecycle authority, or dependency direction, so no new ADR is required under the current architecture-governance rules.

Source code, migrations, and tests remain authoritative for implemented behavior. The A1 runtime described here is committed and verified across domain, contracts, migration 0007, database repositories, API security and account flows, durable workers, the expanded verification matrix, local PostgreSQL harness, runnable API, and the account/device web foundation. A1 is closed at 20/20 acceptance gates.

## Refinement review

The initial A1 design was reviewed again before implementation.

The refinement closes implementation ambiguities in:

- password Unicode normalization
- production versus local-development cookie names
- session-token rotation after reauthentication and sensitive identity changes
- HMAC key versioning and rotation
- registration-intent credential scrubbing
- email-challenge uniqueness and concurrent attempt handling
- trusted-proxy handling for network rate-limit keys
- deterministic database lock order
- durable security-email delivery metadata
- partnered account-deletion end-to-end correctness
- startup validation for security-critical configuration
- compatibility and rollback behavior during key rotation

No accepted product rule or Architecture Baseline 1.0 decision changes. No ADR is required.

## Implementation snapshot

Committed runtime evidence now includes:

- account domain rules and A1 boundary contracts
- migration `0007_accounts_devices_runtime.sql`
- account/auth database repositories and server-authoritative timing
- Argon2id password hashing and policy checks
- versioned HMAC session, device, challenge, and security-rate-limit verifiers
- opaque revocable sessions with fenced rotation
- production and local-development cookie policy
- exact-origin, Fetch Metadata, and custom-header CSRF checks
- PostgreSQL-backed durable security rate limiting
- registration, login, logout, password recovery, reauthentication, email change, username, DOB correction, account deletion/recovery, and device APIs
- durable security-email and verification-email worker handlers
- generation-guarded account-deletion finalization
- earlier-breakup-deadline precedence during account deletion
- account-auth deletion-manifest target cleanup
- A1 domain, contract, API security, API integration, worker unit, and worker integration tests
- `test:a1:local` disposable PostgreSQL 16 harness
- runnable Fastify API entrypoint with graceful shutdown
- mobile-first web account/device foundation

Validated on the completed A1 branch:

- committed `package-lock.json` is compatible with the current dependency set
- complete workspace TypeScript/build/lint/format/dependency health regression passes
- migration 0007 applies from zero as part of a seven-migration disposable run
- database invariants pass
- `npm run test:a1:local` passes 27/27 and reports `A1_LOCAL_POSTGRES_PASS`
- `npm run test:a1:security` passes 16/16
- `npm run health` passes with Domain 32/32, Contracts 4/4, API unit/security 8/8, and Worker 4/4
- `npm audit --audit-level=high` reports 0 vulnerabilities
- all 20 canonical A1 acceptance gates are closed

## Goals

A1 must provide the complete account and authentication substrate required by later partnership, messaging, relationship-space, calling, and E2EE work.

A1 must prove:

- server-authoritative 18+ registration eligibility
- unique verified email ownership
- secure password credential storage
- email verification with replay resistance
- opaque revocable browser sessions
- session fixation resistance
- browser CSRF defenses
- rate-limited authentication and recovery flows
- secure password recovery
- recent reauthentication for sensitive changes
- verified email change with old-email notification and other-session revocation
- server-enforced username and date-of-birth rules
- account deletion lockout and recovery
- explicit device records and device revocation
- strict separation between account recovery and future E2EE history recovery
- privacy-safe security event recording
- repeatable API, PostgreSQL, race, and security regression tests

A1 does not implement partner discovery, partner requests, partnership creation, messaging, realtime, media, production E2EE, or production email-provider selection.

## Existing product rules that remain authoritative

A1 preserves the PRD rules already accepted by the repository:

- users must be at least 18 years old
- age is calculated from trusted server date using calendar arithmetic
- registration requires username, display name, date of birth, email, and password
- email must be verified before registration completes
- one current verified email may belong to only one account
- username uniqueness is case-insensitive
- the registration username does not consume the later username-change allowance
- username changes are limited to once per calendar year after a successful change
- username changes are blocked during active and breakup-pending partnerships
- one self-service date-of-birth correction is allowed after registration
- an under-18 DOB correction is rejected without consuming the correction allowance
- password recovery uses the verified email
- account recovery and cryptographic history recovery remain separate
- verified email change requires recent strong reauthentication and new-email verification
- the old verified email is notified after a successful email change
- all other active sessions are revoked after a successful email change
- account deletion immediately removes account access
- account deletion has a seven-day recovery period
- device revocation revokes authentication access
- future cryptographic authorization must respect device revocation

## A1 implementation constants

These values are frozen for the first A1 implementation. Changing them later is an ordinary reviewed product or security change depending on the field.

### Username

The first implementation uses:

- length: 3 through 30 Unicode code points before ASCII validation
- Unicode normalization: NFKC
- canonical form: lowercase ASCII
- allowed canonical characters: a-z, 0-9, period, underscore
- first and last character: alphanumeric
- consecutive period or underscore separators: rejected
- reserved names: committed static denylist for system, support, security, API, staff, and product-owned identifiers
- no provider-specific or locale-specific username folding

Representative canonical pattern:

~~~text
[a-z0-9](?:[a-z0-9]|[._](?=[a-z0-9])){1,28}[a-z0-9]
~~~

The normalized form is used for uniqueness. The display form preserves the accepted user-facing casing.

### Display name

- length: 1 through 80 Unicode code points after trimming
- Unicode normalization: NFC
- control characters: rejected
- uniqueness: not required

### Email identity policy

The current schema already defines a lowercase comparison form. A1 makes the comparison policy explicit:

- trim surrounding ASCII whitespace
- preserve the submitted deliverable address separately as email_display
- lowercase the comparison form
- normalize the domain through IDNA ASCII processing before comparison
- do not remove periods from local parts
- do not strip plus-addressing tags
- do not apply Gmail-specific or provider-specific transformations
- maximum stored address length: 254 characters
- verification through actual email delivery remains the ownership proof

This intentionally favors one stable Shawtie identity comparison policy over provider-specific canonicalization.

### Password policy

The first A1 password policy is:

- minimum: 15 Unicode code points
- maximum: 128 Unicode code points
- maximum encoded size: 1024 UTF-8 bytes
- Unicode normalization before hashing: NFC
- no uppercase, lowercase, digit, or symbol composition requirement
- no silent truncation
- paste is allowed
- a committed common-password blocklist is checked before hashing
- periodic forced password rotation is not required
- compromised credentials may force a reset

Password hashes use Argon2id.

The minimum accepted hashing policy is:

~~~text
algorithm    Argon2id
version      19
memory       19456 KiB
iterations   2
parallelism  1
output       32 bytes
salt         at least 16 bytes
~~~

The implementation may raise these costs after local benchmarking, but must not reduce them below this baseline without a documented security review.

### Email verification codes

- format: 8 decimal digits
- expiry: 10 minutes
- maximum submit attempts: 5 per challenge
- resend floor: 60 seconds
- successful consumption: single use
- resend: supersedes the previous active challenge for the same subject and purpose

The raw code is never stored in PostgreSQL or routine logs.

### Sessions

Initial browser-session policy:

- opaque random session token: 32 random bytes, base64url encoded
- client storage: cookie only
- production cookie name: __Host-shawtie-session
- production Secure: always true
- production HttpOnly: true
- production SameSite: Strict
- production Path: /
- production Domain attribute: omitted
- local HTTP development cookie name: shawtie-session-dev
- the production __Host- cookie name is never emitted without Secure
- insecure development cookies are allowed only on loopback hosts with an explicit development-only configuration flag
- absolute server lifetime: 30 days
- idle server lifetime: 7 days
- last-seen write coalescing: no more than once per 5 minutes per active session
- logout and server expiry revoke the server-side session
- session tokens are never accepted from query parameters, URL fragments, localStorage, or sessionStorage

### Recent reauthentication

Sensitive operations require password reauthentication within the previous 10 minutes.

At minimum this applies to:

- verified email change
- account deletion request
- password change if a later password-change route is added
- other future high-risk credential changes

## External implementation basis

The design follows current security guidance without changing the repository's existing security model:

- OWASP Password Storage guidance prefers Argon2id and publishes the same 19 MiB, t=2, p=1 minimum used here
- OWASP and NIST password guidance supports long passwords and passphrases without composition rules
- OWASP Session Management recommends opaque unpredictable server-side session identifiers in Secure, HttpOnly cookies and warns against browser Web Storage for authentication tokens
- OWASP CSRF guidance supports custom request headers for API-driven sites, exact origin validation, Fetch Metadata checks, SameSite cookies, and no state-changing GET requests
- OWASP email identity guidance recommends a consistent normalization policy and warns against provider-specific transformations
- current Fastify 5 compatible package lines include @fastify/cookie 11.x and @fastify/helmet 13.x
- current researched password-hashing dependency is @node-rs/argon2 2.2.1, which provides Argon2id and cross-platform prebuilt binaries without node-gyp

Implementation must recheck package versions immediately before dependency installation and keep the lockfile exact.

## Runtime architecture

~~~text
React PWA
   |
   | HTTPS, same origin, secure cookies
   v
Fastify API
   |
   +-- boundary schemas in @shawtie/contracts
   +-- pure account rules in @shawtie/domain
   +-- account/auth services
   |
   v
@shawtie/db
   |
   +-- registration intents
   +-- password credentials
   +-- verified emails
   +-- email challenges
   +-- sessions
   +-- devices
   +-- security rate-limit buckets
   +-- security events
   +-- account deletion requests
   +-- F2 outbox
   +-- F2 scheduled actions
   |
   v
PostgreSQL

Durable worker
   |
   +-- auth email outbox handler
   +-- auth cleanup scheduled handler
   +-- account deletion finalizer
   |
   +--> provider-neutral email delivery port
~~~

The API owns authentication decisions and authoritative account transactions.

PostgreSQL owns durable identity, session, device, challenge, rate-limit, and account-deletion state.

The worker performs durable email delivery and scheduled cleanup/finalization.

No authentication correctness may depend on client clocks, in-memory process state, or an email provider callback.

## Dependency direction

A1 keeps the existing repository dependency rules.

Expected workspace dependencies:

~~~text
apps/api
  -> @shawtie/domain
  -> @shawtie/contracts
  -> @shawtie/db
  -> @shawtie/crypto only if an existing crypto helper is explicitly reused

apps/worker
  -> @shawtie/domain
  -> @shawtie/contracts
  -> @shawtie/db

packages/domain
  -> none

packages/contracts
  -> zod

packages/db
  -> pg
~~~

No auth-specific infrastructure is added to packages/domain.

## Planned runtime dependencies

A1 expects the API to add:

- @shawtie/domain
- @shawtie/contracts
- @shawtie/db
- @fastify/cookie
- @fastify/helmet
- @node-rs/argon2

A1 does not require Redis.

A1 does not make @fastify/rate-limit authoritative. Security-sensitive rate limits are PostgreSQL-backed in the generic `security_rate_limit_buckets` table so authentication and later abuse-sensitive product features such as P1 can share one durable primitive while using separate scope values.

A1 does not use JWT access tokens for browser authentication.

A1 does not use @fastify/session or stateless encrypted cookie sessions because the accepted architecture requires explicit server-side revocation.

## API source structure

Target structure:

~~~text
apps/api/src/
├── index.ts
├── application.ts
├── config.ts
├── plugins/
│   ├── cookies.ts
│   ├── security-headers.ts
│   ├── request-origin.ts
│   ├── authentication.ts
│   ├── csrf.ts
│   └── errors.ts
└── modules/
    └── accounts/
        ├── routes/
        │   ├── registration.ts
        │   ├── login.ts
        │   ├── recovery.ts
        │   ├── me.ts
        │   ├── email-change.ts
        │   ├── username.ts
        │   ├── date-of-birth.ts
        │   ├── deletion.ts
        │   └── devices.ts
        ├── services/
        │   ├── registration-service.ts
        │   ├── authentication-service.ts
        │   ├── recovery-service.ts
        │   ├── account-service.ts
        │   └── device-service.ts
        └── security/
            ├── password-hasher.ts
            ├── opaque-token.ts
            ├── email-code.ts
            ├── rate-limit.ts
            └── normalization.ts
~~~

Route handlers remain thin.

They:

1. validate the external boundary
2. establish request security
3. call one application service
4. map stable service results to the HTTP contract

They do not contain SQL, password hashing policy, or lifecycle logic.

## Domain package additions

Target domain structure:

~~~text
packages/domain/src/accounts/
├── types.ts
├── age.ts
├── username.ts
├── password-policy.ts
└── account-rules.ts
~~~

Pure domain responsibilities include:

- age eligibility on a supplied authoritative date
- username normalization-independent business eligibility
- username change timing
- DOB correction allowance
- account-status transitions that do not require infrastructure
- password length and blocklist eligibility without hashing
- stable denial codes

Email delivery, HMAC, password hashing, cookies, PostgreSQL, and Fastify remain outside packages/domain.

## Contracts package additions

Target contract structure:

~~~text
packages/contracts/src/accounts/
├── common.ts
├── registration.ts
├── authentication.ts
├── recovery.ts
├── profile.ts
├── email-change.ts
├── username.ts
├── date-of-birth.ts
├── deletion.ts
└── devices.ts
~~~

Every external request and response receives a Zod-backed runtime schema.

Contracts must never include:

- password hashes
- session token verifiers
- raw verification-code state
- exact internal rate-limit keys
- private security metadata
- crypto recovery secrets

## A1 migration

A1 uses one forward migration, expected to be:

~~~text
0007_accounts_devices_runtime.sql
~~~

Migrations 0001 through 0006 remain immutable.

### registration_intents

A registration intent stages account creation before verified email ownership is proven.

Representative fields:

~~~text
id
username_normalized
username_display
display_name
date_of_birth
email_normalized
email_display
password_hash
expires_at
completed_at
created_at
~~~

Rules:

- intent expiry: 24 hours
- password is stored only as an Argon2id hash
- password_hash is nullable after terminal processing
- successful completion clears password_hash in the same transaction that creates account_password_credentials
- cleanup scrubs password_hash from expired abandoned intents before or while deleting them
- an intent does not reserve username or email ownership permanently
- username and email uniqueness are rechecked in the completion transaction
- expired or completed intents cannot complete
- cleanup may be asynchronous because expiry checks are authoritative at use time

### account_password_credentials

Representative fields:

~~~text
account_id
password_hash
password_version
changed_at
created_at
~~~

The PHC encoded hash stores algorithm parameters and random salt.

No plaintext password, password hint, reversible password encryption, or previous password is stored.

### account_emails additions

Add an email_display value so delivery and UI can preserve the user-submitted representation while email_normalized remains the comparison key.

Provider-specific dot or plus rewriting is prohibited.

### email_verifications additions

The existing table becomes the canonical email challenge table.

Add fields needed for durable A1 challenges:

~~~text
registration_intent_id
challenge_nonce
max_attempts
superseded_at
verifier_key_version
last_attempt_at
~~~

Extend allowed purposes with:

~~~text
account_recovery
~~~

Subject rules:

- registration challenges bind to one registration intent
- email-change, password-recovery, and account-recovery challenges bind to one account
- one challenge may never bind to both account and registration intent
- partial unique indexes permit at most one unsuperseded, unconsumed challenge for each subject and purpose
- creating a replacement challenge locks and supersedes the previous active challenge before inserting the replacement
- challenge submission increments attempt_count atomically under a row lock
- the fifth failed attempt exhausts the challenge in the same transaction
- the verifier is keyed
- consumed, superseded, expired, or attempt-exhausted challenges fail closed
- successful consumption clears verifier and challenge nonce after any required durable email work has been recorded

### account_sessions additions

Representative additions:

~~~text
token_key_version
token_generation
idle_expires_at
reauthenticated_at
rotated_at
last_seen_at
~~~

Add a unique index on token_verifier.

token_generation begins at 1 and increases on every token rotation.

Sensitive rotation operations use the observed token_generation as a fencing value so two concurrent rotations cannot both succeed.

Session validity requires all of:

- account status is active
- session revoked_at is null
- PostgreSQL current time is before expires_at
- PostgreSQL current time is before idle_expires_at
- linked device is not revoked when device_id is present

### account_devices additions

Add an opaque device-handle verifier:

~~~text
handle_verifier
handle_key_version
updated_at
~~~

Add a unique partial index on handle_verifier where the verifier is present.

A successful password login rotates the device handle to the active key version. A revoked device row is never silently un-revoked.

The device handle is identification convenience, not an authentication factor.

Possession of a device handle alone never grants account access or E2EE history access.

### security_rate_limit_buckets

A1 uses PostgreSQL-backed security rate limits.

Representative fields:

~~~text
scope
key_hash
window_started_at
attempt_count
blocked_until
last_outcome
updated_at
~~~

Primary key:

~~~text
(scope, key_hash)
~~~

The key is an HMAC of the normalized security subject, network prefix, or both.

Raw passwords, codes, session tokens, full IP addresses, and recovery secrets are never rate-limit keys.

Rate-limit updates lock their bucket rows and update atomically.

When one request touches multiple buckets, lock order is deterministic by scope and key hash.

### security_events hardening

A1 treats security_events as an append-only security ledger while retained.

Add update rejection equivalent to the existing lifecycle-event protection.

A1 repositories expose typed event names and allowlisted scalar metadata only.

## Authentication key ring and verifier rotation

A1 uses versioned server-side HMAC keys for opaque verifiers.

The database stores key version identifiers, never the key material.

One active root HMAC key version is configured at a time. Runtime subkeys are derived with HKDF using fixed domain-separation labels for:

~~~text
session-verifier
device-handle-verifier
email-code-derivation
email-code-verifier
rate-limit-key
~~~

Requirements:

- every configured root key contains at least 256 bits of random key material
- new rows always use the active key version
- reads use the key version recorded on the row
- unknown key versions fail closed
- key material never appears in logs, database rows, outbox payloads, or API responses
- local tests use synthetic test keys only
- production startup fails if required key material is missing, duplicated, malformed, or shorter than policy

Normal rotation sequence:

1. deploy readers with old and new key versions
2. mark the new version active for new writes
3. lazily rotate session and device verifiers when the raw token or handle is legitimately presented
4. allow old email challenges to expire
5. retain old session-verifier keys for at least the maximum remaining session lifetime unless intentionally forcing logout
6. retain old rate-limit keys for at least the longest configured rate-limit window
7. remove an old key only after no still-valid security object requires it

Emergency compromise response may retire a key immediately and intentionally invalidate affected sessions or handles.

Device handles are not authentication factors, so loss of an old handle key may require a new password-authenticated device record but must not bypass authentication.

A1 does not require a password pepper in the first implementation. Adding a pepper later requires a separate operational key-management review.

## Password hashing

A1 uses @node-rs/argon2 with explicit Argon2id policy.

The password service owns:

~~~text
normalizePassword()
validatePasswordPolicy()
hashPassword()
verifyPassword()
needsPasswordRehash()
~~~

On successful login, a hash below the current accepted policy may be upgraded transactionally after verification.

On a missing account, login performs one dummy Argon2id verification against a fixed valid dummy hash before returning the generic authentication error. This reduces account enumeration through obvious password-hash timing differences.

Password values never enter:

- logs
- security events
- outbox payloads
- database error messages
- idempotency response bodies

## Security-critical runtime configuration

The API validates security configuration before accepting traffic.

Production startup fails when:

- the application origin is missing or not HTTPS
- the production session-cookie name lacks the __Host- prefix
- production cookies are configured without Secure
- a Domain attribute is configured for __Host- cookies
- required HMAC keys are missing or invalid
- database configuration is missing
- trusted-proxy configuration uses trust-all or hop-count-only semantics
- an explicitly configured production proxy address or CIDR cannot be parsed

Fastify trustProxy remains false by default.

If deployed behind a reverse proxy, production must use an explicit proxy IP or CIDR allowlist or a custom address-validation function. Forwarded headers are never trusted merely because they exist.

request.ip is used only after trusted-proxy resolution and validation. It is not an authorization factor.

For rate limiting, A1 derives privacy-preserving network keys from:

- IPv4 /24 prefixes
- IPv6 /64 prefixes

before HMACing them with the rate-limit subkey.

Identifier and network buckets are both used so shared networks do not become the only authentication throttle.

## Opaque session tokens

A1 generates session tokens with Node cryptographic randomness.

The client receives the raw token only in the session cookie.

PostgreSQL stores:

~~~text
HMAC(versioned_session_subkey, "session" || raw_session_token)
~~~

and never stores the raw session token.

Verification uses constant-time comparison where application comparison occurs.

The account session row is the server authority for revocation and expiry.

Authentication middleware must load:

- session
- account
- device when linked

in one bounded database operation and reject any revoked or expired component.

## Device handle

A second opaque cookie may identify a previously seen device.

Production:

~~~text
__Host-shawtie-device
~~~

Local HTTP development:

~~~text
shawtie-device-dev
~~~

Properties:

- the production cookie is always Secure
- HttpOnly
- SameSite Strict
- Path /
- no Domain
- local insecure form is permitted only on loopback with the explicit development flag
- long-lived compared with an auth session
- not sufficient for authentication

The database stores only a keyed verifier.

On successful password authentication:

- matching active device handle for that account reuses the device row
- the handle verifier is rotated to the active key version and a replacement handle cookie is issued after commit
- missing, invalid, foreign, or revoked handle creates a new device row
- a revoked device may later become a new device only after a new successful login
- the old revoked row stays revoked
- no previous cryptographic authorization is silently restored

## Browser CSRF and request-origin policy

Initial production topology is same-origin PWA plus API.

A1 does not enable wildcard credentialed CORS.

Every state-changing browser route requires:

- non-GET method
- exact configured application Origin when Origin is present
- conservative Referer fallback only when Origin is absent
- fail closed when neither Origin nor an acceptable Referer is present on a browser state-changing request
- rejection of Sec-Fetch-Site cross-site
- same-site treated as untrusted for state-changing operations unless deployment explicitly proves sibling subdomains are trusted
- a custom header such as X-Shawtie-CSRF: 1
- JSON content type for JSON mutation endpoints

The custom header is not a secret. Its value is useful because hostile cross-origin HTML forms cannot set it, and hostile cross-origin JavaScript cannot send it with credentials unless the server authorizes the preflight.

Session SameSite Strict remains defense in depth rather than the only CSRF control.

No GET, HEAD, or OPTIONS route may mutate server state.

## Canonical database lock order

A1 transactions use a documented lock rank so independent account features do not introduce deadlocks.

For authenticated account mutations, acquire locks in this order:

~~~text
1. account rows, immutable UUID order when more than one
2. partnership row when the operation touches partnership state
3. session rows
4. device rows
5. email or challenge rows
6. idempotency or rate-limit rows in deterministic key order
~~~

Registration has no existing account row and uses:

~~~text
1. registration intent
2. registration email challenge
3. final unique inserts
~~~

Challenge-only unauthenticated flows lock their challenge before mutation and do not later acquire an account lock. Account-bound challenge completion loads and locks the account first, then locks the challenge.

No transaction may acquire these ranks in reverse order.

Database unique constraints remain the final arbiter for username, email, token-verifier, and active-challenge races.

## Server-authoritative dates and times

A1 uses PostgreSQL time for all authoritative account decisions.

Calendar-date rules use UTC server date derived from PostgreSQL transaction time.

Examples:

- age eligibility
- DOB correction eligibility

Timestamp rules use PostgreSQL transaction time.

Examples:

- username one-year eligibility
- verification expiry
- recent reauthentication
- session expiry
- rate-limit windows
- account deletion recovery deadline

The database connection policy must use UTC semantics consistently for calendar arithmetic.

Client timestamps are presentation only.

## Email challenge design

A1 must support durable email delivery without storing the raw short code.

For every challenge:

1. generate a random challenge nonce
2. store the nonce
3. derive the 8-digit code from HMAC over domain-separated challenge data
4. store a separate keyed verifier of the derived code
5. enqueue an F2 outbox event containing only the challenge ID and template type
6. worker reloads the active challenge
7. worker derives the same code from the nonce and server secret
8. worker sends the code through the email delivery port

Conceptually:

~~~text
code_material =
  HMAC(
    auth_secret,
    "email-code" || challenge_id || purpose || nonce
  )

code = unbiased_decimal_8_digit_mapping(code_material)

verifier =
  HMAC(
    auth_secret,
    "email-verifier" || challenge_id || submitted_or_derived_code
  )
~~~

Domain-separation labels are mandatory.

A database-only compromise therefore does not directly reveal active verification codes.

The worker must not send a challenge that is already:

- expired
- consumed
- superseded
- attempt-exhausted

## Durable security-email records

Verification challenges are authoritative enough to reconstruct their own verification emails, but other security notifications need a durable destination snapshot.

Migration 0007 therefore adds a security_email_deliveries table.

Representative fields:

~~~text
id
account_id nullable
destination_email
template
parameters_json
created_at
delivered_at nullable
expires_at
~~~

Rules:

- parameters_json uses a template-specific allowlist of scalar values
- password, session token, device handle, recovery secret, partnership content, and private-message content are forbidden
- outbox payloads carry securityEmailDeliveryId rather than copying destination email or template parameters
- the worker loads the delivery row immediately before provider delivery
- the destination is a snapshot because old-email notifications must still reach the old address after current-email ownership changes
- delivery records remain until the associated outbox event is terminal plus the documented short security-email retention window
- delivery records are not used as an account audit ledger; security_events owns audit evidence

Verification-code email may reference the challenge directly because the worker can safely derive the still-valid code from challenge state.

## Email provider boundary

A1 defines a provider-neutral port:

~~~text
EmailDeliveryPort.sendSecurityEmail({
  deliveryId,
  destination,
  template,
  parameters
})
~~~

A1 integration tests use an in-memory fake.

Production provider selection and provider credentials remain deployment work and must not change the account-domain contract.

Email providers receive only:

- destination email
- minimal account-security template content
- verification code when required for delivery

They never receive:

- password
- session token
- partnership content
- E2EE recovery secret
- private message content

If the provider supports idempotency, the outbox event ID is the provider idempotency key.

At-least-once delivery means a user may receive the same still-valid code more than once after a provider-success/worker-crash race. The code remains identical and single-use.

## Authoritative rate limits

A1 rate limits are configuration constants, not client policy.

Initial defaults:

### Registration

- 5 registration starts per network key per hour
- 3 starts per email key per hour
- 3 starts per username key per hour

### Email challenge send or resend

- minimum 60 seconds between sends for the same subject and purpose
- maximum 5 sends per subject and purpose per hour
- maximum 20 sends per network key per hour across auth purposes

### Email challenge submit

- maximum 5 attempts on one challenge
- maximum 20 failed challenge submissions per network key per hour

### Login

- maximum 10 failed attempts per identifier key per 15 minutes before temporary throttling
- maximum 50 failed attempts per network key per 15 minutes
- successful authentication resets or relaxes identifier-specific failure pressure but does not erase security events

### Password and account recovery request

- maximum 5 starts per identifier key per hour
- maximum 20 starts per network key per hour
- response remains generic whether the account exists or not

Exact thresholds are configuration values with these defaults.

Rate limiting must not reveal account existence.

## API namespace

All A1 routes live under:

~~~text
/api/v1
~~~

## Unauthenticated routes

### Registration

~~~text
POST /api/v1/auth/registration/start
POST /api/v1/auth/registration/verify
POST /api/v1/auth/registration/resend
~~~

Registration start accepts:

~~~text
username
displayName
dateOfBirth
email
password
~~~

It returns an opaque registrationIntentId and challenge timing metadata.

Registration verification accepts:

~~~text
registrationIntentId
code
deviceName optional
~~~

Successful verification creates the account, verified email, password credential, initial device, and initial session in one authoritative transaction and then sets a fresh session cookie.

The account and email are not considered active before this transaction commits.

### Login

~~~text
POST /api/v1/auth/login
~~~

Input:

~~~text
identifier
password
deviceName optional
~~~

Identifier may be exact username or verified email.

Failure response is generic.

Successful login always creates a fresh session token.

No pre-authentication session token is promoted into an authenticated session.

### Password recovery

~~~text
POST /api/v1/auth/password-recovery/start
POST /api/v1/auth/password-recovery/complete
~~~

Start always returns the same HTTP status and response shape whether or not the identifier exists.

The server follows the same cheap normalization, rate-limit, and challenge-preparation shape for existent and non-existent identifiers. It does not use branch-specific password hashing or synchronous provider calls. The email provider runs asynchronously through the outbox, so provider latency cannot become an account-enumeration side channel.

Complete accepts:

~~~text
identifier
code
newPassword
~~~

Success:

- consumes the challenge
- writes a new Argon2id password hash
- revokes all active sessions
- records a security event
- sends a security notification
- does not automatically create a new authenticated session

The user signs in again after reset.

### Account deletion recovery

~~~text
POST /api/v1/auth/account-recovery/start
POST /api/v1/auth/account-recovery/complete
~~~

This flow is only meaningful for deletion-pending accounts but its start response remains generic.

Completion requires the active deletion-recovery challenge and occurs before recover_until.

Successful account recovery:

- marks the deletion request recovered
- restores account status to active
- cancels or invalidates the scheduled account-deletion finalizer
- restores the existing partnership overlay exactly through the accepted domain rules where applicable
- does not automatically create an authenticated session
- requires the user to authenticate normally after recovery
- allows the separate password-recovery flow if the password is no longer known
- does not restore or copy historical E2EE keys by email alone

## Authenticated routes

### Session

~~~text
GET  /api/v1/auth/session
POST /api/v1/auth/logout
POST /api/v1/auth/reauthenticate
~~~

Reauthentication verifies the current password and atomically rotates the current session token.

The transaction:

1. locks the current session
2. verifies that the request authenticated with the current token generation
3. writes a new token verifier using the active HMAC key version
4. increments token_generation
5. sets reauthenticated_at
6. records the security event
7. commits
8. emits the replacement cookie only after commit

The previous token becomes invalid immediately.

Concurrent rotations use compare-and-swap semantics on token_generation. A stale concurrent rotation fails rather than invalidating a newer token returned by another request.

### Account profile

~~~text
GET   /api/v1/me
PATCH /api/v1/me/profile
~~~

A1 profile mutation initially supports displayName.

Avatar upload remains a later media concern.

### Verified email change

~~~text
POST /api/v1/me/email-change/start
POST /api/v1/me/email-change/complete
POST /api/v1/me/email-change/resend
~~~

Start requires recent reauthentication.

Completion transaction:

1. locks the account
2. locks the email challenge
3. re-checks account status and capability
4. verifies the challenge
5. re-checks new-email uniqueness
6. releases the old current email
7. promotes the new verified current email
8. consumes the challenge
9. revokes every other active session
10. rotates the current session token using token_generation fencing
11. records a security event
12. creates the durable old-email security delivery record
13. writes an outbox event referencing that delivery ID
14. commits

No provider call occurs inside the transaction.

### Username change

~~~text
POST /api/v1/me/username
~~~

Transaction:

1. lock account row
2. load PostgreSQL transaction time
3. confirm account status active
4. load current partnership occupancy and lifecycle
5. evaluate change_username through the domain capability engine
6. normalize and validate the new username
7. update accounts username fields
8. set next_username_change_eligible_at to one calendar year from the successful change
9. insert username_change_history
10. record security event
11. commit

The unique database index remains the final race arbiter.

The old username is released by the successful update.

### Date-of-birth correction

~~~text
POST /api/v1/me/date-of-birth-correction
~~~

Transaction:

1. lock account row
2. reject if date_of_birth_corrected_at already exists
3. calculate age using PostgreSQL UTC current date
4. reject under-18 correction without changing any row
5. update date_of_birth
6. set date_of_birth_corrected_at
7. record security event
8. commit

A rejected correction does not consume the allowance.

### Account deletion request

~~~text
POST /api/v1/me/account-deletion
~~~

Requires recent reauthentication.

Transaction:

1. lock account
2. load current partnership state if any
3. reject if already deletion pending
4. use PostgreSQL transaction time
5. apply the existing account-deletion domain transition where partnership state exists
6. set account status to deletion_pending
7. create account_deletion_requests with exact seven-day recover_until
8. revoke all active sessions
9. create the generation-guarded scheduled finalizer
10. create minimal security/lifecycle events
11. create required notification outbox events
12. commit

After commit:

- clear session cookie
- return account-locked state
- no further authenticated account mutation is accepted

A1 owns the account-level deletion request, immediate authorization revocation, recovery flow, and scheduling substrate.

The existing partnership state-machine rules remain authoritative for partnership-specific deletion effects. At A1 closure, implementing the minimum persistence adapter advanced only P3 deletion evidence and did not complete the broader lifecycle epic. P3 is now independently DONE and verified end to end.

### Devices

~~~text
GET    /api/v1/me/devices
PATCH  /api/v1/me/devices/:deviceId
DELETE /api/v1/me/devices/:deviceId
~~~

List response contains only safe device metadata:

- device ID
- display name
- createdAt
- lastSeenAt
- revokedAt
- isCurrent
- activeSessionCount

It does not expose:

- session token
- token verifier
- device handle
- crypto private keys
- recovery material
- IP history

Device revoke transaction:

1. lock account and device
2. confirm ownership
3. set revoked_at
4. revoke every active session for that device
5. record security event
6. commit

If the current device is revoked, the API clears the session cookie after commit.

Future S1 code must also treat revoked_at as cryptographic authorization denial.

## Session lookup and touch policy

Authentication middleware performs one bounded authoritative lookup.

Session lookup uses the HMAC verifier of the cookie token.

The middleware rejects:

- unknown token
- revoked session
- absolute expiry
- idle expiry
- deleted or deletion-pending account
- revoked linked device

last_seen_at and idle_expires_at are updated only when the coalescing interval has elapsed.

This avoids a database write on every request while preserving bounded idle expiry.

## Security event model

A1 event names are typed and finite.

Expected events include:

~~~text
registration_completed
login_succeeded
login_failed
logout
password_recovery_started
password_reset_completed
reauthentication_succeeded
reauthentication_failed
email_change_started
email_changed
username_changed
date_of_birth_corrected
account_deletion_requested
account_recovered
device_created
device_renamed
device_revoked
session_revoked
rate_limit_triggered
~~~

Allowed metadata is scalar and non-secret.

Never include:

- password
- raw email verification code
- raw session token
- device handle
- password hash
- recovery secret
- private message content
- partnership content

## Registration transaction

Registration completion is authoritative and race-safe.

Transaction order:

1. lock registration intent
2. lock email challenge
3. load PostgreSQL business time and UTC date
4. verify challenge state and code
5. re-run age eligibility
6. re-run username policy
7. check username availability
8. check current verified email availability
9. create account
10. create profile
11. create password credential
12. create current verified email
13. create or bind account device
14. create fresh authenticated session
15. consume challenge
16. mark registration intent completed
17. append security event
18. commit

Unique indexes remain final protection for username and email races.

If another transaction wins either unique value, registration completion fails without a partial account.

## Login flow

Login:

1. normalize identifier
2. apply authoritative rate limits
3. load account and password credential if they exist
4. perform real or dummy Argon2id verification
5. reject non-active account except through the dedicated account-recovery flow
6. create or reuse safe device record after password success
7. create a fresh opaque session
8. record success security event
9. return generic failure or authenticated session response

Login responses must not distinguish:

- unknown username
- unknown email
- wrong password
- deleted account

Deletion-pending accounts receive the same ordinary login failure and are directed to the explicit recovery flow only after a recovery start is requested.

## Email change capability

The API continues using the central capability engine.

Email change is allowed:

- while unpartnered and active
- while partnership is active
- during breakup_pending

Email change is denied when account status is deletion_pending or deleted.

The server reloads authoritative state before the mutation. Client capability snapshots are never authoritative.

## Username change capability

Username change remains prohibited while the account occupies an active or breakup-pending partnership.

The API uses the central capability engine and database lock order rather than duplicating this rule in route code.

The refined P2 partnership-formation design locks accounts in the same deterministic account-row order, so username-change and partnership-formation races cannot bypass the restriction.

## Account deletion and P3 boundary

A1 and P3 share one accepted account-deletion domain model.

A1 owns:

- account status lockout
- session revocation
- deletion request record
- recovery email challenge
- recovery authentication
- generation-guarded finalizer scheduling
- account-level security events
- unpartnered permanent account cleanup
- device/auth cleanup

A1 must also implement the complete partnership interaction required by the account-deletion path before that route is considered enabled for partnered accounts:

- active-partnership deletion overlay
- recovery back to the exact pre-deletion partnership state
- breakup/deletion deadline precedence
- remaining-partner view-only behavior
- permanent partnership dissolution when the deletion deadline controls
- remaining-partner one-month cooldown
- shared partnership deletion manifest creation and required notices

These behaviors use the already accepted P3 domain state machine and F2 persistence primitives.

At A1 closure, these account-deletion-specific behaviors could close only individual P3 gates while breakup, restoration, and lifecycle API work remained independently measured. That sequencing is now complete: P3 is DONE at 22/22 gates with the full lifecycle surface locally verified.

No duplicated alternate account-deletion rule is allowed.

## Account recovery versus crypto recovery

A1 account recovery proves control of the verified email and restores account authentication state.

It does not:

- copy device private keys
- mark a new device cryptographically trusted
- decrypt account_recovery_material
- restore partnership crypto epochs
- reveal historical protected content

If recovery happens on a device that still independently possesses valid historical cryptographic state, S1 may later define how that trusted device participates in history recovery.

Email recovery alone never manufactures that cryptographic trust.

## Key rotation, deployment, and rollback compatibility

A1 deployments must support rolling replacement of HMAC keys and password-hash policy without making durable rows unreadable.

Rules:

- key version is persisted beside every verifier that needs a server key
- writers emit only the configured active version
- readers may accept a bounded configured set of older versions
- unknown versions fail closed
- removing a key is an operationally destructive action and must be reviewed against the maximum valid lifetime of rows using it
- password-hash upgrades happen only after successful password verification
- deployment rollback must retain every key and password algorithm needed by rows written by the newer deployment
- migration 0007 is forward-only and must not be edited after application
- API code must tolerate nullable A1 fields on pre-A1 rows where the migration intentionally permits them

A staged key-rotation test must prove:

1. old-key session accepted while old key is configured
2. successful sensitive rotation rewrites the verifier under the new key
3. old raw token fails after rotation
4. new token succeeds
5. unknown recorded key version fails closed
6. old key can be removed only after no still-valid object requires it

## Error model

A1 contracts expose stable non-secret error codes.

Representative codes:

~~~text
VALIDATION_FAILED
AUTH_REQUIRED
AUTH_INVALID
ACCOUNT_LOCKED
RATE_LIMITED
CSRF_REJECTED
REAUTH_REQUIRED
USERNAME_UNAVAILABLE
USERNAME_CHANGE_NOT_ALLOWED
AGE_INELIGIBLE
DOB_CORRECTION_ALREADY_USED
EMAIL_UNAVAILABLE
EMAIL_CHALLENGE_INVALID
EMAIL_CHALLENGE_EXPIRED
DEVICE_NOT_FOUND
DEVICE_REVOKED
CONFLICT
~~~

Unauthenticated login and recovery initiation use generic responses where revealing the specific condition would enable enumeration.

Database SQLSTATEs are normalized before crossing the service boundary.

## Idempotency

A1 uses explicit idempotency where duplicate browser submits can produce costly or security-sensitive effects.

At minimum:

- registration verification
- email-change completion
- password-recovery completion
- account-recovery completion
- account-deletion request

Authenticated operations use the existing idempotency-record infrastructure where appropriate.

Unauthenticated flows use challenge or registration-intent state as the natural single-use idempotency boundary.

## Cleanup

Correctness never depends on immediate cleanup.

Expired state is rejected authoritatively at use time.

A scheduled auth cleanup job may remove:

- expired registration intents
- consumed or superseded old email challenges
- expired revoked sessions after retention
- stale rate-limit buckets

Cleanup uses bounded retention and must not delete security evidence earlier than the documented security-event retention policy.

## Test architecture

A1 requires four layers.

### Pure domain tests

Add deterministic tests for:

- exact 18th birthday boundary
- leap-day birthday behavior
- username normalization and reserved names
- one-calendar-year username change eligibility
- one-time DOB correction
- rejected under-18 DOB correction preserving allowance
- password length and common-password policy

### Database integration tests

Use disposable PostgreSQL 16.

Cover:

- migration 0007 from zero
- unique username race
- verified email ownership race
- registration completion race
- email-change uniqueness race
- session token verifier uniqueness
- session expiry and revocation
- device revocation and session fan-out
- rate-limit bucket contention
- challenge consume-once behavior
- challenge replay rejection
- deletion request uniqueness
- account recovery before deadline
- recovery rejection at exact deadline
- deterministic account locking when username or deletion operations overlap partnership reads

### API integration tests

Create a Fastify application against disposable PostgreSQL and fake email delivery.

Cover:

- under-18 registration rejected using server date
- client clock field or header cannot affect age
- registration email code send, verify, expiry, attempts, resend, replay
- registration race on email and username
- successful login
- generic failed login
- logout and revoked-cookie rejection
- session fixation regression
- absolute and idle expiry
- password recovery generic start
- password reset and all-session revocation
- email change recent-reauth requirement
- new email verification
- old-email notification
- other-session revocation
- username one-year enforcement
- username blocked in active and breakup-pending partnership
- old username release
- DOB correction one-time rule
- rejected under-18 correction preserving allowance
- account deletion immediate lockout
- account recovery before seven-day deadline
- device list
- device revoke
- current-device revoke
- account recovery does not mutate crypto-recovery material

### Security regression tests

Permanent regressions for:

- production __Host- cookie attributes
- local HTTP development cookie uses a separate non-__Host- name
- production startup rejects insecure cookie configuration
- trustProxy defaults false
- untrusted X-Forwarded-For cannot choose the network rate-limit key
- configured proxy CIDR resolution works
- HMAC key rotation and unknown-key fail-closed behavior
- concurrent session rotation fencing
- old session token rejection after reauthentication
- device-handle rotation after password login
- only one active challenge per subject and purpose
- concurrent fifth challenge attempt cannot exceed max_attempts
- registration-intent password hash is cleared after successful completion
- durable old-email notification references a security-email delivery row instead of copying PII into outbox JSON
- credential enumeration response shape
- verification-code replay
- verification attempt exhaustion
- rate-limit concurrency bypass
- raw code absent from database and outbox payload
- raw password absent from logs and events
- raw session token absent from database
- session fixation
- session cookie flags
- cross-site mutation rejection
- missing custom CSRF header rejection
- state-changing GET absence
- email-change session revocation
- deletion-pending authentication denial
- revoked-device authentication denial
- account recovery does not grant crypto history

## Test email adapter

The test adapter records:

- delivery ID
- destination
- template identifier
- rendered verification code when applicable

It exists only in test code.

Tests use it to retrieve the delivered code without reading a raw code from PostgreSQL.

Production runtime must never expose a code-retrieval endpoint.

## A1 implementation sequence

### A1-A Domain, contracts, and migration

1. add account domain types and denial codes
2. add server-date age helper
3. freeze username and password policy constants
4. add A1 request/response schemas
5. add migration 0007 with schema-shape constraints, active-challenge uniqueness, session-generation fencing, device-handle uniqueness, security-email deliveries, and append-only security events
6. extend database invariant suite
7. add A1 database repositories
8. add typed security-event repository
9. add PostgreSQL rate-limit repository with deterministic multi-bucket locking
10. add email challenge repository with atomic attempt accounting
11. add security-email delivery repository
12. add key-version-aware verifier helpers

Exit gate:

- migration plan passes
- clean disposable migration passes
- domain and contract tests pass

### A1-B Authentication security kernel

1. add @node-rs/argon2
2. add @fastify/cookie
3. add @fastify/helmet
4. implement password hashing service
5. implement HMAC domain-separated token/verifier helpers
6. implement opaque session service
7. implement device-handle service
8. implement session authentication plugin
9. implement fenced session-token rotation
10. implement production/dev cookie policy and startup validation
11. implement explicit trusted-proxy configuration
12. implement exact-origin and Fetch Metadata checks
13. implement custom-header CSRF gate
14. implement security-safe error mapper
15. implement PostgreSQL rate limits
16. implement HMAC key-ring rotation support

Exit gate:

- cookie and CSRF regressions pass
- session revocation and fixation tests pass
- no secret appears in logs, events, or DB fixtures

### A1-C Registration and login

1. registration start
2. verification challenge creation
3. durable verification email outbox
4. provider-neutral email port
5. fake test email adapter
6. resend flow
7. registration completion transaction
8. login flow with real or dummy Argon2 verification
9. initial device creation/reuse
10. fresh session issuance
11. logout
12. session introspection

Exit gate:

- registration, verification, replay, rate-limit, age, login, logout, and race tests pass

### A1-D Recovery and sensitive account changes

1. password recovery start
2. password recovery completion
3. session revocation after reset
4. recent password reauthentication
5. email-change start
6. email-change verification
7. email-change completion transaction
8. old-email security notice
9. other-session revocation
10. profile display-name update
11. username change
12. date-of-birth correction

Exit gate:

- recovery, email-change, username, DOB, and security regression tests pass

### A1-E Account deletion and devices

1. deletion request transaction
2. immediate session revocation
3. account recovery start
4. account recovery completion
5. scheduled deletion-finalization substrate
6. complete account-deletion-specific partnership persistence path required by the accepted P3 state model
7. partnered recovery and finalization race coverage
8. device list
9. device rename
10. device revoke
11. current-device logout
12. crypto-recovery separation regression

Exit gate:

- deletion lockout/recovery and device acceptance gates pass

### A1-F Integration closure

1. disposable PostgreSQL A1 integration command
2. complete API integration suite
3. auth race suite
4. security regression suite
5. npm audit review for new dependencies
6. full npm run health
7. update repository-wide current-state docs
8. mark only verified A1 gates complete

## Committed local verification commands

Committed commands:

~~~text
npm run test:accounts
npm run test:a1:postgres
npm run test:a1:api
npm run test:a1:security
npm run test:a1:local
~~~

The committed `npm run test:a1:local` command follows the F2 disposable-database pattern: it starts PostgreSQL 16 on a dynamic local port, runs the A1 migration/invariant/build/integration path, and cleans up automatically. On the completed A1 branch it passes 27/27 with `A1_LOCAL_POSTGRES_PASS`; the dedicated A1 security suite passes 16/16; the full repository health regression passes; and the dependency audit reports 0 vulnerabilities.

## Acceptance mapping

The existing ROADMAP_EPICS A1 gates remain canonical.

Implementation evidence must specifically prove:

- under-18 registration rejection from server time
- client clock cannot bypass age
- verification expiry, rate limit, and replay protection
- verified-email uniqueness
- login/logout with revocable sessions
- password recovery
- email change reauthentication, verification, old-email notification, and other-session revocation
- one-year username rule
- partnership-state username restriction
- immediate old-username release
- one-time DOB correction
- rejected under-18 correction preserving allowance
- immediate account-deletion access removal
- recovery before exact seven-day deadline
- device/session association
- device revocation
- account recovery and E2EE recovery separation
- complete integration and security suite success

## Review invariants

Reject an A1 implementation change if it does any of the following:

1. trusts client time for age, username cooldown, session expiry, challenge expiry, or deletion recovery
2. stores plaintext passwords or reversible password credentials
3. stores raw email verification codes in PostgreSQL, outbox JSON, logs, or security events
4. stores raw session tokens in PostgreSQL or browser Web Storage
5. uses JWTs or stateless cookie sessions to bypass server-side revocation
6. allows state-changing GET routes
7. enables wildcard credentialed CORS
8. relies only on SameSite for CSRF protection
9. exposes whether a recovery identifier belongs to an account
10. checks username or email uniqueness only in application code without database enforcement
11. permits an expired, consumed, superseded, or attempt-exhausted challenge
12. changes email without recent reauthentication and new-email verification
13. leaves other sessions active after successful email change
14. consumes the DOB correction allowance on a rejected under-18 correction
15. permits username change while active or breakup_pending
16. restores account access while status remains deletion_pending
17. treats a device handle as an authentication factor
18. treats email account recovery as historical E2EE key recovery
19. places provider calls inside authoritative database transactions
20. makes rate-limit correctness depend only on one API process memory
21. logs raw passwords, codes, session tokens, recovery secrets, or device handles
22. duplicates account-deletion product rules instead of using the accepted domain model
23. emits a production __Host- cookie without Secure or with a Domain attribute
24. trusts arbitrary X-Forwarded-* headers or enables trustProxy=true in production
25. rotates a session token without fencing concurrent rotation
26. removes an HMAC key while still-valid rows require that version without intentionally accepting the resulting logout or handle reset
27. allows more than one active challenge for the same subject and purpose
28. copies old-email notification destinations or parameters into general outbox JSON when a security-email delivery row should own them
29. enables partnered account deletion before the complete partnered deletion and recovery path is correct

## Deliberately deferred from A1

The following are intentionally outside A1 unless a concrete implementation blocker appears:

- passkeys
- MFA or TOTP
- SMS recovery
- CAPTCHA provider integration
- third-party breach-password API calls at request time
- risk-scoring vendors
- IP reputation vendors
- geolocation-based authentication policy
- trusted-device approval for E2EE keys
- production email-provider selection
- administrative account-recovery tooling
- user-visible session history beyond the device-management foundation

The architecture leaves room for these features without making A1 depend on them.

## Completion rule

A1 is DONE because every A1 acceptance gate in `docs/ROADMAP_EPICS.md` is satisfied with committed source, migrations, repeatable local database/API/security evidence, a committed lockfile, a green full repository health regression, and a clean high-severity dependency audit.

Future changes to this surface must preserve the completed acceptance evidence.

Hosted GitHub Actions verification remains separate under V1.
