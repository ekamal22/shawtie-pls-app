# Security Policy

## Project status

Shawtie pls is under active pre-release development.

The `main` branch is the current development line. No release should be treated as suitable for sensitive private communication until the stable-release security gates in the PRD are satisfied.

## Reporting a vulnerability

Do not disclose a vulnerability through a public issue, discussion, pull request, or commit.

Prefer GitHub private vulnerability reporting from the repository Security area when that option is available.

If private vulnerability reporting is not available, request a private contact path without including exploit details or sensitive evidence in a public message.

A useful private report should include:

- affected component
- security impact
- reproduction steps
- prerequisites
- proof of concept where safe
- suggested mitigation if known

Do not include real user private data in a vulnerability report.

## High-priority security areas

Reports involving these areas should be treated as high priority:

- cross-partnership authorization
- account takeover
- authentication or session bypass
- one-partner invariant bypass
- breakup or deletion lifecycle bypass
- E2EE key exposure
- device-revocation bypass
- account-recovery and cryptographic-recovery confusion
- private media exposure
- deletion failure that restores user-facing access
- secret exposure
- trusted-origin XSS
- TURN credential abuse

## Security architecture

Canonical security documents include:

- `docs/security/SECURITY_MODEL.md`
- `docs/security/THREAT_MODEL.md`
- `docs/security/DATA_CLASSIFICATION.md`
- `docs/security/E2EE_ARCHITECTURE.md`
- `docs/security/DEVICE_AND_RECOVERY.md`
- `docs/architecture/DELETION_ARCHITECTURE.md`

## Public repository rule

Never commit production secrets, private keys, recovery secrets, real private messages, real relationship data, production database exports, or private user media.
