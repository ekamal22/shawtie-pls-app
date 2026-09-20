# Project State

## Status

Architecture Baseline 1.0 is accepted and frozen.

Foundation implementation is underway. The pure partnership domain state machine and centralized capability engine are implemented, baseline CI plus repository-health tooling are configured, and the initial PostgreSQL schema and migration system are committed.

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
- formal threat model
- repository-wide data classification and handling matrix
- architecture freeze and change-control governance
- architecture change classification and ADR workflow
- baseline CI workflow configuration
- local repository-health scanner
- CODEOWNERS ownership metadata
- public security-reporting policy
- initial PostgreSQL schema migrations
- migration checksum ledger and runner
- static migration-plan validation
- database invariant test suite
- deterministic account-lock SQL pattern
- scheduled-action `FOR UPDATE SKIP LOCKED` claim pattern

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

The threat model and data-classification baseline are complete and remain the active security foundation for implementation.

Architecture governance is complete. Structural changes now require the evidence-based process in `docs/architecture/ARCHITECTURE_GOVERNANCE.md`.

Roadmap epics and objective acceptance gates are now defined in `docs/ROADMAP_EPICS.md`.

Current epic status:

- F0 Governance and Security Baseline: DONE
- F1 Repository Foundation and Executable Guardrails: IN_PROGRESS because baseline CI and repository-health tooling are configured, but full workspace guardrails and GitHub-hosted validation remain incomplete
- F2 Persistence and Worker Foundation: IN_PROGRESS because schema, migrations, migration tooling, database invariants, and canonical lock/claim SQL are committed, but real PostgreSQL execution, race validation, worker integration, outbox integration, and deletion retry behavior remain unverified
- P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns: IN_PROGRESS because the pure domain layer is verified but persistence integration, API, worker, notification, deletion, and race gates remain
- all other implementation epics: PLANNED

The persistence schema foundation is implemented as SQL migrations but has not yet been executed against a real PostgreSQL instance. API integration and worker integration are not implemented yet.

Baseline CI is configured in `.github/workflows/ci.yml`, including SHA-pinned external Actions and repository-health checks, but GitHub-hosted validation has not yet been executed. Current repository commits intentionally use `[skip ci]` while hosted Actions execution is being conserved.

## Progress reporting rule

Do not report an epic as complete from a partial layer.

For example, a passing domain state machine does not mean the persisted API and worker lifecycle epic is complete.

Epic completion is governed by the acceptance gates in `docs/ROADMAP_EPICS.md`.

## Next engineering work

1. complete workspace configuration and executable architecture guardrails
2. execute the committed migrations against disposable PostgreSQL and fix any syntax or compatibility issues
3. run the committed database invariant suite
4. add PostgreSQL concurrency and race tests
5. add `apps/worker` and integrate scheduled-action claiming
6. integrate transactional outbox writes and delivery
7. integrate lifecycle event persistence
8. integrate deletion-manifest retries
9. implement account and device repositories
10. wire API routes to the domain capability engine

## Stable release blockers

Stable release remains blocked until:

- reviewed E2EE is implemented
- partnership isolation is verified
- deletion workflows are verified
- account and crypto recovery are safely separated
- browser security baseline is enforced
- voice and video privacy behavior is verified
- security and physical-device acceptance passes


## Documentation freshness

A repository-wide documentation audit has been completed against the current foundation state.

Current-state claims belong here and in `ROADMAP_EPICS.md`. Product, architecture, security, and ADR documents should not be interpreted as proof that their described runtime behavior is already implemented.
