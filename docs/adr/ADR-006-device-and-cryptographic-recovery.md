# ADR-006: Device Identity and Cryptographic Recovery Separation

## Status

Accepted.

## Context

Email recovery is appropriate for restoring account access, but using email alone to restore historical encryption keys would weaken the E2EE model.

Devices also need revocable authentication and cryptographic authority.

## Decision

Treat devices as first-class security principals.

Each authorized device has:

- immutable device ID
- account ownership
- authentication session linkage where practical
- cryptographic public identity
- crypto protocol version
- revocation state

Separate:

- account authentication recovery
- historical cryptographic content recovery

Verified-email recovery can restore account access.

Historical protected-content recovery requires an existing trusted device, a high-entropy recovery secret protecting client-encrypted recovery material, or another reviewed cryptographic mechanism.

Email recovery alone must not automatically disclose historical E2EE plaintext.

## Consequences

Benefits:

- reduced impact of email compromise
- clear lost-device handling
- coherent device revocation
- safer multi-device E2EE model

Costs:

- recovery UX becomes more complex
- users can recover an account without immediately recovering encrypted history
- key backup and recovery require careful security design
