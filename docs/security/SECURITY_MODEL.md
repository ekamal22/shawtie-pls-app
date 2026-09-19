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
