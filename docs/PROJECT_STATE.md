# Project State

## Status

Architecture Baseline 1.0 is accepted and frozen.

Foundation implementation is underway. The pure partnership domain state machine and centralized capability engine are implemented, the initial PostgreSQL schema and migration system have passed local disposable-database validation, and the F1 executable repository foundation now has a complete passing local health run. Hosted GitHub Actions validation remains pending.

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

M1 repository foundation implemented and locally validated:

- npm workspace layout for `apps/*` and `packages/*`
- strict shared TypeScript configuration and package path aliases
- executable scaffolds for `apps/web`, `apps/api`, and `apps/worker`
- package scaffolds for contracts, crypto, database, UI, and testkit boundaries
- ESLint and Prettier configuration with cross-platform line-ending handling
- workspace dependency-direction and circular-dependency scanner
- Zod-based runtime boundary-validation convention with two passing contract tests
- root build, typecheck, lint, formatting, dependency-check, test, and health commands
- committed `package-lock.json`
- local dependency installation with 0 reported npm audit vulnerabilities
- full `npm run health` pass covering repository health, migration-plan validation, all workspace typechecks, all workspace builds, lint, formatting, dependency/cycle checks, 27 domain tests, and 2 contract tests

The full local health run passed on 2026-09-20. The canonical clean-clone bootstrap command is now documented as `npm ci`, but a separate clean-install validation from the committed lockfile is still pending. GitHub-hosted CI validation is also still pending.

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
- clean PostgreSQL migration from zero across all five migrations
- migration rerun idempotency and checksum-drift rejection
- database invariant SQL against PostgreSQL 16
- critical constraint, index, foreign-key, and trigger creation
- occupied partnership-slot concurrency protection
- scheduled-action `FOR UPDATE SKIP LOCKED` claim concurrency
- deterministic two-account lock ordering

The current domain suite contains 27 tests and passes in local validation.

The threat model and data-classification baseline are complete and remain the active security foundation for implementation.

Architecture governance is complete. Structural changes now require the evidence-based process in `docs/architecture/ARCHITECTURE_GOVERNANCE.md`.

Roadmap epics and objective acceptance gates are now defined in `docs/ROADMAP_EPICS.md`.

Current epic status:

- F0 Governance and Security Baseline: DONE
- F1 Repository Foundation and Executable Guardrails: IN_PROGRESS because the full local health baseline now passes and the lockfile is committed, while clean `npm ci` bootstrap validation and GitHub-hosted validation remain incomplete
- F2 Persistence and Worker Foundation: IN_PROGRESS because schema, migrations, database invariants, and the canonical lock/claim SQL have passed local PostgreSQL validation, but committed race automation, worker integration, outbox integration, deletion retry behavior, and PostgreSQL CI remain incomplete
- P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns: IN_PROGRESS because the pure domain layer is verified but persistence integration, API, worker, notification, deletion, and race gates remain
- all other implementation epics: PLANNED

The persistence schema foundation has been executed twice from a blank disposable PostgreSQL 16 database. The invariant suite, migration ledger, second-run skipping, selected schema inspection, occupied-slot race, scheduled-action claim race, and deterministic account-lock ordering passed locally. API integration and worker integration are not implemented yet.

Baseline CI is configured in `.github/workflows/ci.yml`, including SHA-pinned external Actions and repository-health checks, but GitHub-hosted validation has not yet been executed. Current repository commits intentionally use `[skip ci]` while hosted Actions execution is being conserved.

## Progress reporting rule

Do not report an epic as complete from a partial layer.

For example, a passing domain state machine does not mean the persisted API and worker lifecycle epic is complete.

Epic completion is governed by the acceptance gates in `docs/ROADMAP_EPICS.md`.

## Next engineering work

1. validate the canonical `npm ci` clean bootstrap from the committed lockfile, then perform one intentional hosted Baseline CI run when Actions capacity is available
2. turn the locally exercised PostgreSQL race scenarios into repeatable automated tests
3. add PostgreSQL migration and invariant execution to CI when hosted capacity is available
4. integrate scheduled-action claiming into the scaffolded `apps/worker`
5. integrate transactional outbox writes and delivery
6. integrate lifecycle event persistence
7. integrate deletion-manifest retries
8. implement account and device repositories
9. wire API routes to the domain capability engine

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

A repository-wide documentation audit has been completed against the current foundation state and was rerun after local PostgreSQL verification. Stale PostgreSQL-status claims in the root README, database package README, PRD, and data-model documentation were reconciled with the verified local evidence.

Current-state claims belong here and in `ROADMAP_EPICS.md`. Product, architecture, security, and ADR documents should not be interpreted as proof that their described runtime behavior is already implemented.
