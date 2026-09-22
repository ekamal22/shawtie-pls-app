# ADR-012: Pre-S1 Encrypted Media Development Bridge

## Status

Accepted.

This ADR is accepted only for pre-S1 development and acceptance work.

It does not satisfy the stable-release E2EE gate and does not supersede ADR-004.

## Context

M3 Media and Voice Messages is intentionally scheduled before S1 E2EE and Cryptographic Recovery.

The existing architecture already requires:

- private object storage
- client-side encryption before media upload
- no plaintext media at the object-storage provider
- reviewed E2EE before stable release
- no improvised stable cryptographic protocol

The repository currently has no selected S1 key-distribution protocol and `packages/crypto` explicitly records that the reviewed protocol has not been selected.

M3 nevertheless needs a testable binary storage path before S1 in order to implement media authorization, upload retry, message/R1 references, deletion, offline behavior, and physical-device flows.

## Problem

Uploading plaintext media until S1 would violate the frozen encrypted-object-storage boundary.

Pulling the complete S1 device and partnership key protocol into M3 would collapse milestone responsibilities and allow an unreviewed cryptographic architecture to become de facto permanent.

M3 therefore needs a temporary development bridge that:

- keeps media plaintext out of object storage
- keeps media bytes out of the API
- uses standard reviewed cryptographic primitives
- clearly admits that the server can recover the media key
- cannot be mistaken for end-to-end encryption
- has an explicit removal condition

## Evidence

The contradiction is structural:

1. M3 precedes S1 in the accepted roadmap.
2. ADR-004 requires client-side encrypted media before upload.
3. S1 owns reviewed end-to-end key distribution and recovery.
4. M3 must still be executable and testable before S1.

A temporary bridge is therefore required unless the roadmap is changed to move S1 ahead of M3.

The product rules do not require that change.

## Decision

M3 pre-S1 media uses client-side object encryption plus server-recoverable development key escrow.

### Object encryption

For every media asset the browser:

1. generates a fresh random 32-byte media key
2. writes the versioned M3 media container with libsodium secretstream XChaCha20-Poly1305
3. uploads only ciphertext to private object storage

The object stream authenticates its sequence and final frame.

The application binds the stream to media ID, partnership ID, media class, and object-format version as authenticated context.

### Development key escrow

The browser submits the per-media key only to the authenticated API over the existing TLS channel as a sensitive no-log field during media reservation.

The API immediately wraps that key under a versioned M3 development key-encryption key.

The database stores only:

- media ID
- wrapping key version
- random wrapping nonce
- authenticated wrapped media key

The development wrapping key is a deployment secret and is never stored in PostgreSQL or shipped to the browser.

The wrapping primitive is XChaCha20-Poly1305 with a random nonce from the selected maintained crypto library.

On an authorized pre-S1 media read, the API may unwrap the key and return it to the authenticated client over TLS only after the complete media-reference authorization decision succeeds.

### Trust statement

This mode is not E2EE.

The API can recover the media key and therefore can technically decrypt the object if it also retrieves the ciphertext.

The implementation must not claim otherwise.

The value of the bridge is narrower:

- provider storage never receives plaintext
- media bytes never transit the API
- storage/retry/deletion/reference architecture can be implemented before S1
- the stable E2EE protocol remains a separate reviewed milestone

### Stable release guard

A stable release is prohibited while any of the following are true:

- development media escrow is enabled for new writes
- a retained media row depends on a server-recoverable development key
- the API exposes development media-key delivery
- pre-S1 media has not been migrated or wiped

R2 must verify this gate.

## Media migration under S1

S1 must choose one of two paths for every retained pre-S1 media object.

### Client re-encryption

An authorized client:

1. obtains the old media through the development bridge
2. decrypts locally
3. generates fresh S1 media key material that is never disclosed to the server
4. re-encrypts the media under the reviewed S1 format
5. uploads replacement ciphertext
6. commits the S1 descriptor/key relationship
7. deletes the old provider object
8. deletes the development key envelope

Merely wrapping the old development media key inside S1 is insufficient because the server previously possessed that key.

### Secure wipe

If safe client migration cannot be guaranteed, delete the pre-S1 media and its development key envelope.

The product must not silently grandfather server-known keys as E2EE.

## Alternatives considered

### Upload plaintext before S1

Rejected.

It violates the accepted encrypted-media storage boundary and exposes highly sensitive content to the provider.

### Move full S1 before M3

Rejected for the current roadmap.

S1 depends on sufficiently stable message, media, and calling semantics. Pulling it forward would mix cryptographic protocol selection with binary storage and mobile UX construction.

### Invent a permanent M3 key protocol

Rejected.

M3 must not become an unreviewed E2EE protocol.

### Store a global media key in the PWA

Rejected.

A static browser key is not partnership isolation, is trivially recoverable from public client code, and provides no meaningful confidentiality.

### Server-side encryption only

Rejected.

Provider-managed or API-side encryption would require plaintext media to reach the provider or API and does not preserve the existing client-encryption boundary.

## Consequences

Benefits:

- object storage remains ciphertext-only
- media bytes bypass the API
- M3 can be implemented before S1
- each object has an independent media key
- S1 can preserve the outer media/reference/deletion model while replacing key distribution
- the temporary trust expansion is explicit and testable

Costs:

- server compromise can recover pre-S1 media keys
- pre-S1 media is not E2EE
- S1 requires real client re-encryption or wipe
- one additional secret key ring must be managed temporarily
- browser crypto dependency and format compatibility require testing

## Security and privacy impact

The development media key is HIGHLY_SENSITIVE.

Rules:

- never log it
- never place it in analytics
- never place it in realtime frames
- never place it in outbox or scheduled-action payloads
- never persist it plaintext server-side
- scrub it from errors
- keep unwrapped key lifetime in server memory minimal
- zero/wipe buffers where the runtime/library allows practical explicit cleanup
- rotate the server wrapping key by version rather than overwriting old key meaning
- retain an old wrapping key only while media envelopes still require it

The provider receives ciphertext and opaque object keys only.

## Data-classification impact

Add an explicit data class row for:

- M3 development wrapped media key envelope: HIGHLY_SENSITIVE
- M3 development wrapping key: SECRET
- ephemeral signed media URL: SECRET-like bearer capability for its short lifetime

Existing media plaintext and ciphertext classifications remain unchanged.

## Migration impact

M3 migration 0015 adds the temporary development key-envelope table.

S1 must remove or empty it through a forward migration after successful migration/wipe.

No prior migration is rewritten.

## Compatibility impact

M3 introduces:

- media object format v1
- media descriptor schema v1
- browser local schema version increment
- M3 development key-delivery mode

Unknown versions fail closed.

S1 must define how old M3 objects are detected and migrated.

## Testing impact

Required tests include:

- object provider never receives plaintext fixture bytes
- wrong media key fails
- wrong authenticated media/partnership context fails
- truncated stream fails
- reordered/mutated frame fails
- database never stores raw media key
- request/error/logger scans exclude raw key
- access key is returned only after authorized parent visibility
- unreleased R1 Voice Letter cannot obtain its key as recipient
- final dissolution stops key/read-grant issuance
- stable-release guard fails while development escrow exists
- S1 migration test must prove old key is not reused as the final E2EE media key

## Rollout plan

1. implement the object container and development bridge only on the M3 branch
2. gate usage behind explicit configuration
3. use synthetic media fixtures only
4. close M3 functional and security tests
5. keep stable-release status blocked
6. implement S1 reviewed protocol
7. migrate or wipe every pre-S1 asset
8. disable development escrow writes
9. remove development key delivery
10. close S1 and R2 evidence

## Rollback or recovery plan

Before S1, rollback may leave encrypted provider objects and wrapped media keys.

The durable M3 deletion path remains capable of deleting those objects.

If the wrapping key is lost, affected pre-S1 media becomes unrecoverable and must be deleted.

Do not add a plaintext recovery bypass.

## Documents amended

This ADR refines pre-S1 behavior under:

- ADR-004 E2EE, Encrypted Media, and Call Privacy
- `docs/security/E2EE_ARCHITECTURE.md`
- `docs/security/DATA_CLASSIFICATION.md`
- `docs/architecture/ARCHITECTURE_BASELINE.md`
- `docs/architecture/M3_MEDIA_VOICE_DESIGN.md`

The stable-release requirements of ADR-004 remain authoritative.
