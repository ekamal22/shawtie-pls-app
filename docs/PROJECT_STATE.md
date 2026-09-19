# Project State

## Status

Architecture baseline accepted.

Implementation remains in foundation design.

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

No architecture document alone proves runtime implementation.

Until source code and migrations exist and are tested, these documents describe intended architecture.

## Next engineering work

1. establish workspace and package configuration
2. add `apps/worker`
3. implement domain capability model
4. design PostgreSQL schema and migrations
5. implement database invariants
6. implement transactional outbox and scheduled actions
7. implement lifecycle event ledger and generation checks
8. implement deletion manifests
9. implement account and device foundations
10. build partnership state machine tests before higher-level product features

## Stable release blockers

Stable release remains blocked until:

- reviewed E2EE is implemented
- partnership isolation is verified
- deletion workflows are verified
- account and crypto recovery are safely separated
- browser security baseline is enforced
- voice and video privacy behavior is verified
- security and physical-device acceptance passes
