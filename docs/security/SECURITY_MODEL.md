# Security Model

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

Store a keyed verifier such as an HMAC, not a raw code and not a plain unsalted hash.

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
- preserve only the current trusted flow as defined by implementation

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
- plaintext call recordings

Security logs use bounded retention and minimal identifiers.

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
