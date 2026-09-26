# ADR-006: Device Identity and Cryptographic Recovery Separation

## Status

Accepted and refined for S1.

## Context

Email recovery is appropriate for restoring account access, but email alone must not restore historical encryption keys.

Devices also need independent, revocable cryptographic authority.

S1 additionally needs years of recoverable content without requiring the server to retain plaintext keys or old MLS epoch secrets.

## Decision

Treat devices as first-class security principals.

Each authorized crypto-capable device has independent:

- device identity
- MLS credential/signing material
- content-signing material
- local MLS state
- revocation state

Separate:

- account authentication recovery
- device cryptographic trust
- historical protected-content recovery

Verified-email recovery can restore account access but does not establish cryptographic trust.

S1 uses a high-entropy client-held Recovery Master Secret to protect an encrypted account recovery bundle.

The Recovery Master Secret is never uploaded, logged, or derived from email/password credentials.

Each protected content key receives per-account encrypted recovery capsules using RFC 9180 HPKE or the reviewed HPKE profile pinned in S1-A.

An existing trusted device may also authorize a new independent device and transfer recovery capability through an end-to-end protected enrollment flow.

Device identity private keys are never copied from the server or shared as the identity of a second device.

## Consequences

Benefits:

- reduced impact of email compromise
- independent revocation for every device
- recoverable long-lived history without server plaintext keys
- clear lost-device handling
- explicit separation between account access and protected-content access

Costs and limitations:

- recovery UX is more complex
- a recovered account may temporarily have unavailable encrypted history
- compromise of the Recovery Master Secret plus retained ciphertext/capsules can expose recoverable history
- recovery, group reset, and device enrollment require dedicated race and physical-device testing
