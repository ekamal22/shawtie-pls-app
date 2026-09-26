# ADR-004: E2EE, Encrypted Media, and Call Privacy

## Status

Accepted and refined for S1.

RFC 9420 MLS is the selected protocol family. OpenMLS compiled to WebAssembly is the implementation baseline, with the exact release, crypto provider, build flags, and dependency set frozen only after S1-A security review.

## Context

Shawtie pls handles private messages, media, letters, memories, relationship objects, and calls.

Stable release requires end-to-end protection of private content while allowing the server to route, order, synchronize, authorize, and delete data without reading protected plaintext.

Calls also create network privacy concerns because direct peer-to-peer WebRTC can expose peer network addresses.

## Decision

Use RFC 9420 Messaging Layer Security with the RFC 9750 application architecture for live partnership device membership and group key agreement.

Do not create a custom cryptographic protocol.

Each device has independent cryptographic identity material.

Long-lived protected Shawtie objects use fresh per-content-version encryption keys so durable recoverable history does not require retention of old MLS epoch secrets.

Current-device delivery uses MLS-protected key distribution.

Historical recovery uses client-controlled encrypted recovery material and per-account encrypted recovery capsules. The server never receives the Recovery Master Secret.

Account recovery and historical-key recovery remain separate. Verified-email recovery must not automatically disclose historical protected content.

Every partnership receives fresh cryptographic state. A later partnership between the same two accounts does not inherit old keys.

Protected media is encrypted on the client before upload. Object storage receives ciphertext and random object identifiers.

Use the existing WebRTC C1/C2 architecture for calls. Relay-only TURN remains the required call transport policy unless a later accepted ADR changes it.

The server may retain only operationally necessary metadata and must not receive protected plaintext after S1 activation.

## Consequences

Benefits:

- server/database compromise does not directly reveal protected content
- storage provider sees media ciphertext
- device membership and revocation use a reviewed group-security protocol
- old partnership state does not carry into new partnerships
- email-only account recovery does not automatically reveal encrypted history
- recovery does not require the server to hold plaintext recovery secrets

Costs and limitations:

- browser-origin compromise can still access decrypted application state
- key recovery and multi-device state are security-critical
- recoverable historical content cannot honestly claim unlimited forward secrecy
- encrypted attachment malware scanning is limited
- metadata is minimized but not eliminated
- OpenMLS/WASM and crypto-provider dependencies become part of the trusted computing base

## Stable-release gate

Stable release requires S1 closure evidence for:

- exact library/provider pin and security review
- device enrollment
- MLS group bootstrap and epoch transitions
- revocation and rekey
- encrypted M1/R1/M3 content
- cryptographic recovery
- plaintext retirement
- partnership termination
- raw database/object-store/log inspection
- browser tests
- physical Android tests
- final cryptographic review
