# Security Model

## Canonical security references

This security model is implemented together with:

- `THREAT_MODEL.md`
- `DATA_CLASSIFICATION.md`
- `E2EE_ARCHITECTURE.md`
- `DEVICE_AND_RECOVERY.md`
- `../architecture/DELETION_ARCHITECTURE.md`

The threat model defines attackers and failure modes.

The data-classification matrix defines how each data class may be stored, logged, backed up, exposed, and deleted.

## Security objective

Shawtie pls stores highly private two-person communication and relationship data.

Security must protect confidentiality, integrity, authorization, lifecycle deletion, and partnership isolation.

## Primary trust boundaries

1. Browser and local device
2. Application origin
3. API
4. PostgreSQL
5. private object storage
6. durable worker
7. email and push providers
8. TURN infrastructure
9. E2EE key material

## Supply-chain and browser execution policy

Because Shawtie pls is a PWA, hostile JavaScript executing in the trusted application origin can access decrypted content.

Therefore:

- do not load third-party advertising scripts
- do not load third-party analytics scripts that can execute arbitrary code in the app origin
- do not load arbitrary remote JavaScript
- pin dependencies through the lockfile
- minimize runtime dependencies
- review high-risk dependency updates
- enforce strict Content Security Policy
- prohibit unsafe eval
- avoid unsafe inline script
- use controlled nonces only where inline execution is unavoidable
- prefer same-origin API deployment where practical
- use a controlled service-worker update policy
- enforce explicit client and crypto compatibility versions

Browser hardening is part of the E2EE security boundary.

## Authentication

Use opaque server-managed sessions.

Preferred browser session properties:

- HttpOnly
- Secure
- SameSite appropriate to the deployment topology
- server-side revocation
- rotation after sensitive changes
- bounded lifetime

Do not store long-lived bearer authentication tokens in localStorage.

A1 uses a server-managed opaque session token in a `__Host-` cookie in secure environments, with the raw token absent from PostgreSQL. Local HTTP development uses a different non-`__Host-` cookie name under an explicit loopback-only development flag because browsers require `__Host-` cookies to be Secure. State-changing browser requests use exact-origin or conservative Referer validation, Fetch Metadata rejection for cross-site requests, a required custom CSRF header, and SameSite Strict cookies as defense in depth. No state-changing GET route is permitted.

## Authorization

Every protected query must enforce membership at the data-access boundary.

Avoid:

```text
load resource
then check ownership later
```

Prefer queries whose predicates already include:

- current account
- partnership membership
- lifecycle eligibility
- resource partnership ID

Random IDs are defense in depth, not authorization.

## Browser security

E2EE does not protect against malicious JavaScript executing in the trusted application origin.

Required browser hardening includes:

- strict Content Security Policy
- no unsafe eval
- minimize or eliminate unsafe inline script
- strict Origin checking
- CSRF protection for state-changing HTTP requests
- secure cookie configuration
- output encoding
- schema validation
- dependency review
- Trusted Types where practical
- restrictive frame policy
- restrictive referrer policy
- narrow permissions policy

## Email verification codes

Verification codes are low-entropy secrets.

Store a keyed verifier such as an HMAC, not a raw code and not a plain unsalted hash. A1 persists a key version for every server-keyed verifier and uses domain-separated subkeys so session, device, verification-code, and rate-limit verifiers can be rotated without changing their data model.

A1 additionally stores a random challenge nonce and derives the short-lived delivery code only when needed by the durable email worker. The raw code is not stored in PostgreSQL or outbox JSON.

Enforce:

- short expiry
- attempt limit
- resend rate limit
- consume-once behavior
- replay rejection

## Sessions and sensitive changes

Verified email change requires recent strong reauthentication.

After successful email change:

- notify old email
- revoke other sessions
- rotate the current session token with generation fencing
- preserve only the current trusted flow as defined by implementation

Password reauthentication for a sensitive operation also rotates the current session token so a previously stolen token does not inherit the newly elevated reauthentication state.

Account deletion revokes all active sessions immediately.

Device revocation must revoke both authentication sessions and cryptographic authorization for that device.

## Recovery separation

Verified-email recovery restores account access only.

It must not automatically restore historical E2EE decryption keys.

Historical protected-content recovery requires an existing trusted device, a high-entropy cryptographic recovery secret, or another reviewed recovery mechanism.

See `DEVICE_AND_RECOVERY.md`.

## Media

Client encrypts protected media before upload once E2EE is active.

Object storage remains private.

Media retrieval requires authorized short-lived signed access even though stored objects are ciphertext.

Object keys must not include private filenames or relationship text.

## Logging

Never log:

- passwords
- verification codes
- raw session tokens
- private keys
- recovery secrets
- plaintext message bodies
- plaintext media
- plaintext relationship objects
- plaintext call recordings if the deferred post-stable feature is ever implemented

Security logs use bounded retention and minimal identifiers.

All logging must comply with the allowlist and prohibited-field rules in `DATA_CLASSIFICATION.md`.

## Durable worker

Worker jobs are untrusted inputs from the database in the sense that every handler must validate type and current authoritative state before mutating anything.

Jobs must be idempotent.

A stale breakup-finalization job must not dissolve a restored partnership.

## Deletion

Deletion is security-sensitive.

Final dissolution and permanent account deletion require coordinated removal across:

- relational data
- private object storage
- local client namespaces
- queued operations
- cryptographic keys
- push routing
- realtime authorization

Deletion jobs must be retryable and auditable without retaining deleted private content.

Use durable deletion manifests and target-level completion state. Authorization and cryptographic access are revoked before asynchronous cleanup is considered complete.

## Discovery and partner-request privacy

P1 discovery is authenticated and exact-match only.

It returns at most one safe profile projection and does not expose email, exact date of birth, partnership state, cooldown state, block state, session state, device state, or partnership history.

A target that has blocked the authenticated account is absent from that blocked account's normal search results.

Partner-request creation maps recipient-side occupancy, cooldown, block, deletion, and other safety ineligibility to a generic target-unavailable response.

P1 product rules and abuse rules are distinct:

- three successfully created requests per sender/recipient rolling calendar month is a product rule
- one-hour post-decline cooldown is a product rule
- discovery and request-creation security buckets are abuse controls
- cancellation and decline remain available even when discovery/create abuse buckets are exhausted

P1 reuses the PostgreSQL security-rate-limit primitive implemented and verified by A1.

Request-creation abuse buckets are consumed in a separate short transaction before the pair mutation. This ensures rejected new logical attempts may still count toward abuse throttling, while only successful request creation contributes to the three-request product limit.

Create requests use an idempotency key so a lost HTTP response can be replayed safely instead of generating a second logical send. The fingerprint binds recipient ID, normalized expected username, and canonical relationship date, so changing only the proposed date is a different logical request.

Active request pagination is snapshot-bound so concurrent new requests cannot shift an in-progress traversal. Pair-sensitive create, cancel, decline, P2 accept/formation, block, and invalidation paths lock both account rows in the same deterministic order. P2 relationship-date mutation also takes member-account locks before the partnership lock so account deletion cannot race a metadata edit into a view-only state.

## Abuse controls

Apply rate limits to:

- registration
- login
- verification-code send and submit
- username search
- partner requests
- message mutation
- media upload
- call signaling
- TURN credential issuance
- password recovery
- email change
- account recovery

## CI and repository security

Required controls before public stable release:

- dependency scanning
- secret scanning
- locked CI permissions
- protected main branch where practical
- reproducible lockfile installs
- security regression suite
- review of production environment variables
- no secrets committed to the repository
- synthetic public fixtures only


## P2 partnership-formation security boundary

P2 formation remains inside the modular-monolith PostgreSQL transaction. Explicit acceptance and reciprocal pairing derive both members from authoritative request rows, lock account rows in canonical order, recheck account status, occupancy, cooldown, block state, request state, and trusted server date, and rely on the occupied-slot unique index as the final double-partnership defense.

Accepted source requests retain the resulting partnership ID for bounded lost-response replay. Consumed pending expiry jobs are cancelled in the same transaction; an already-processing expiry worker re-reads the accepted terminal request and becomes a safe no-op.

Relationship-date mutation locks both member accounts before the partnership row, uses optimistic partnership metadata versioning, treats a same-date lost-response retry as a no-op before version-conflict rejection, and creates a durable notification only for a real committed change.

P2 account notifications contain routing metadata only. They do not store relationship dates, message or media content, email, date of birth, device data, secrets, or cryptographic material. The fresh partnership ID is an isolation namespace, not authentication authority or key material. Real E2EE epochs remain deferred to S1. This boundary is locally verified in the closed P2 security and integration suites at commit `fa2301d0`, including exact other-partner notification routing and the absence of fake cryptographic state.

## P3 partnership-lifecycle security boundary

The hardened P3 design is defined in `../architecture/P3_PARTNERSHIP_LIFECYCLE_DESIGN.md`. The runtime boundary described here is implemented and locally verified at all 22 P3 acceptance gates. Closure evidence includes lifecycle domain/contracts 28/28, P3 security 6/6, ten migrations from zero with database invariants green, disposable PostgreSQL/API/worker integration 39/39 with `P3_LOCAL_POSTGRES_PASS`, full repository health, and a zero-high-severity dependency audit.

P3 keeps lifecycle authority inside the modular-monolith PostgreSQL transaction. Pair-sensitive mutations lock member accounts in canonical order before the partnership and breakup process. Client requests never supply partner identity, deadlines, lifecycle generation, cooldown duration, or arbitrary block targets.

Breakup deadline work is fenced by breakup-process generation. Partnership metadata version is not a lifecycle fencing token. A stale day-seven finalizer must become harmless after deadline extension, restoration, cancellation, supersession, or a newer lifecycle generation.

Destructive partnership termination has one canonical kernel shared by normal breakup and permanent account-deletion paths. It terminates the partnership and releases occupied membership synchronously before asynchronous deletion targets run. Authorization failure after dissolution therefore does not depend on storage-provider cleanup completing successfully.

P3 reuses A1 account-deletion authority rather than creating a second account-deletion state machine. It reuses F2 deletion manifests and the existing serious-email outbox so provider calls remain outside authoritative transactions.

Former-partner blocking derives the target from a terminated historical partnership. The client cannot submit an arbitrary account ID. Block creation is private, sends no notification to the blocked account, and relies on P1/P2 enforcement to prevent discovery, requests, and future pairing.

P3 notifications, lifecycle events, deletion manifests, and serious-email parameters may contain identifiers, event type, status, generation, and authoritative deadlines where required. They must never contain message content, media content, relationship-object content, relationship start date, email address as event metadata, date of birth, device secrets, or cryptographic key material.

P3 does not provision E2EE epochs or keys. S1 remains the authority for reviewed cryptographic state.
