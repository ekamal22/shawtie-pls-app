# ADR-004: E2EE, Encrypted Media, and Call Privacy

## Status

Accepted as an architecture boundary. Exact protocol and library selection remains subject to dedicated security review.

ADR-012 amends only the pre-S1 M3 development path: it permits ciphertext-only object storage with server-recoverable wrapped development media keys while M3 precedes S1. That bridge is explicitly not E2EE and does not weaken this ADR's stable-release gate. S1 must replace it through fresh client re-encryption or wipe before stable release.

## Context

Shawtie pls handles private messages, media, letters, memories, relationship objects, and calls.

Stable release requires end-to-end protection of private content while allowing the server to route and synchronize the service.

Calls also create network privacy concerns because direct peer-to-peer WebRTC can expose peer IP addresses.

## Decision

Use a reviewed E2EE protocol or construction. Do not create a custom cryptographic protocol.

Each device has separate cryptographic identity material.

Account recovery and historical key recovery are separate. Verified-email recovery must not automatically disclose historical E2EE content.

Partnership cryptographic state uses explicit epochs for reviewed rotation, device revocation, and protocol migration.

Each partnership gets a new cryptographic context, even if the same two accounts pair again later.

Protected media is encrypted on the client before upload.

Private object storage receives ciphertext and random object identifiers.

Use WebRTC for calls.

Use TURN relay-first behavior where practical to reduce direct peer IP exposure.

TURN credentials are short-lived and issued by the authenticated API only after call authorization. Permanent TURN credentials must never be embedded in the PWA.

TURN should support restrictive-network fallbacks, including TCP and TLS on port 443 where supported.

The server may retain only operationally necessary metadata and must not receive plaintext protected content.

## Consequences

Benefits:

- server compromise does not directly reveal protected content
- past partnership keys do not carry into future partnerships
- storage provider sees ciphertext
- relay-first calls reduce peer IP exposure

Costs:

- encrypted attachment malware scanning is limited
- key recovery and multi-device design become security-critical
- TURN relay bandwidth can become a meaningful operating cost
- metadata is minimized but not eliminated

## Stable-release gate

Stable release requires documented protocol selection, key management, attachment encryption, device enrollment, recovery, partnership termination, and security testing.
