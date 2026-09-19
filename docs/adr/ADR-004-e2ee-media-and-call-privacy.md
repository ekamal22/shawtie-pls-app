# ADR-004: E2EE, Encrypted Media, and Call Privacy

## Status

Accepted as an architecture boundary. Exact protocol and library selection remains subject to dedicated security review.

## Context

Shawtie pls handles private messages, media, letters, memories, relationship objects, and calls.

Stable release requires end-to-end protection of private content while allowing the server to route and synchronize the service.

Calls also create network privacy concerns because direct peer-to-peer WebRTC can expose peer IP addresses.

## Decision

Use a reviewed E2EE protocol or construction. Do not create a custom cryptographic protocol.

Each device has separate cryptographic identity material.

Each partnership gets a new cryptographic context, even if the same two accounts pair again later.

Protected media is encrypted on the client before upload.

Private object storage receives ciphertext and random object identifiers.

Use WebRTC for calls.

Use TURN relay-first behavior where practical to reduce direct peer IP exposure.

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
