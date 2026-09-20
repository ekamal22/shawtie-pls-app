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

P1 reuses the PostgreSQL security-rate-limit primitive planned by A1.

Request-creation abuse buckets are consumed in a separate short transaction before the pair mutation. This ensures rejected new logical attempts may still count toward abuse throttling, while only successful request creation contributes to the three-request product limit.

Create requests use an idempotency key so a lost HTTP response can be replayed safely instead of generating a second logical send.

Pair-sensitive create, cancel, decline, future accept, block, and invalidation paths lock both account rows in the same deterministic order.

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
