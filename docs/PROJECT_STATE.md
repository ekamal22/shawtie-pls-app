# Project State

## Status

Architecture baseline accepted.

Foundation implementation has started with the pure partnership domain state machine and centralized capability engine.

## Product definition

The product rules are defined in:

`docs/product/PRD.md`

The partnership lifecycle, breakup recovery rules, account deletion rules, messaging behavior, calls, relationship-space requirements, cooldowns, profile rules, and stable-release E2EE requirement are documented.

## Architecture status

Accepted architecture decisions include:

- modular monolith
- separate durable worker
- PostgreSQL source of truth
- database-enforced partnership occupancy
- transactional outbox
- durable scheduled actions
- centralized capability engine
- append-only lifecycle event ledger for sensitive transitions
- generation tokens for scheduled lifecycle jobs
- deletion manifest workflow
- explicit device model
- account recovery separated from cryptographic recovery
- per-partnership cryptographic context with crypto epochs
- strict PWA browser hardening
- WebSockets for realtime synchronization
- IndexedDB partnership isolation
- WebRTC voice and video
- relay-first TURN privacy
- short-lived TURN credentials
- no Redis in the initial architecture
- reviewed E2EE before stable release

## Implementation state

Implemented and locally validated:

- pure partnership domain types
- trusted-time calendar helpers
- breakup initiation
- one-hour initiator cancellation boundary
- irreversible restore intent
- one-time day-ten extension
- mutual restoration
- generation-guarded breakup finalization
- three-calendar-month breakup cooldown
- account-deletion recovery overlay
- account recovery without resetting an existing breakup
- breakup deadline precedence over a later deletion deadline
- one-calendar-month cooldown after permanent partner-account deletion
- centralized capability evaluation
- pre-breakup message mutation restrictions
- breakup-period nickname and email capabilities
- account-deletion view-only capability behavior
- former-partner blocking capability
- partnership cooldown capability

The current domain suite contains 27 tests and passes in local validation.

Database persistence, API integration, worker integration, and CI validation are not implemented yet.

## Next engineering work

1. establish full workspace configuration and executable architecture guardrails
2. add `apps/worker`
3. design PostgreSQL schema and migrations
4. implement database invariants
5. implement transactional outbox and scheduled actions
6. implement lifecycle event ledger persistence
7. implement deletion manifests
8. implement account and device foundations
9. wire API routes to the domain capability engine
10. add PostgreSQL race and invariant tests

## Stable release blockers

Stable release remains blocked until:

- reviewed E2EE is implemented
- partnership isolation is verified
- deletion workflows are verified
- account and crypto recovery are safely separated
- browser security baseline is enforced
- voice and video privacy behavior is verified
- security and physical-device acceptance passes
