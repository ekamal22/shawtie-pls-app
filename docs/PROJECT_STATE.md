# Project State

## Status

Architecture Baseline 1.0 is accepted and frozen.

Foundation implementation is complete and product substrate implementation is underway. F0 Governance and Security Baseline, F1 Repository Foundation and Executable Guardrails, F2 Persistence and Worker Foundation, and A1 Accounts and Devices are complete with repeatable local evidence. The pure partnership domain state machine and centralized capability engine are implemented, all seven currently committed PostgreSQL migrations apply from zero against disposable PostgreSQL 16, the F2 durable runtime and completed A1 acceptance matrix pass locally, and the full repository health baseline remains green. Hosted GitHub Actions verification is tracked separately under V1 and does not block continued development.

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

The full local health run passed on 2026-09-20. The canonical clean-clone bootstrap command `npm ci` was then executed successfully from the committed lockfile, installed 180 packages, reported 0 vulnerabilities, and was followed by another complete passing `npm run health` run. Hosted GitHub Actions validation is tracked separately under V1 and is not a prerequisite for further implementation.

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
- clean PostgreSQL migration from zero across all six migrations
- migration rerun idempotency and checksum-drift rejection
- database invariant SQL against PostgreSQL 16
- critical constraint, index, foreign-key, and trigger creation
- occupied partnership-slot concurrency protection
- scheduled-action `FOR UPDATE SKIP LOCKED` claim concurrency
- deterministic two-account lock ordering

The current domain suite contains 32 tests and passes in local validation.

The threat model and data-classification baseline are complete and remain the active security foundation for implementation.

Architecture governance is complete. Structural changes now require the evidence-based process in `docs/architecture/ARCHITECTURE_GOVERNANCE.md`.

Roadmap epics and objective acceptance gates are now defined in `docs/ROADMAP_EPICS.md`.

Current epic status:

- F0 Governance and Security Baseline: DONE
- F1 Repository Foundation and Executable Guardrails: DONE based on committed lockfile bootstrap, full local health validation, dependency and circular checks, runtime-contract tests, and repository guardrails
- V1 Hosted CI Verification: BLOCKED while GitHub Actions capacity is unavailable; this is a separate non-blocking verification track and does not prevent F2 or feature development
- F2 Persistence and Worker Foundation: DONE. The database runtime, migration 0006, fencing-aware durable repositories, bounded worker consumers, transactional outbox runtime, lifecycle-event repository, deletion runtime, Docker-backed disposable PostgreSQL harness, and F2 integration matrix are implemented and locally verified. The F2 PostgreSQL suite passes 17/17 after applying all six migrations from zero, and the final full `npm run health` regression passes from the committed lockfile
- P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns: IN_PROGRESS because the pure domain layer is verified but persistence integration, API, worker, notification, deletion, and race gates remain
- X1 Post-stable Maturity: PLANNED after the first stable release and focused on operational evidence, cost measurement, and stabilization
- X2 Deferred Heavy Features: DEFERRED and optional; consensual call recording is moved here and requires post-stable demand, cost, privacy, legal, deletion, retention, and E2EE evidence before implementation
- A1 Accounts and Devices: DONE. All 20 acceptance gates are closed. The expanded disposable PostgreSQL suite passes 27/27 with all seven migrations applied from zero and database invariants green; `npm run test:a1:security` passes 16/16; the full `npm run health` regression passes with Domain 32/32, Contracts 4/4, API unit/security 8/8, and Worker 4/4; and `npm audit --audit-level=high` reports 0 vulnerabilities. The final acceptance run includes challenge expiry/exhaustion/resend/rate-limit coverage, ownership and registration races, logout and revoked-cookie rejection, absolute/idle session expiry and session-generation fencing, recent reauthentication, username API rules, device list/rename/revocation/current-device behavior, exact account-recovery deadline behavior, browser-security negative paths, raw-code/outbox exclusion, and raw device-handle storage exclusion. The final test-harness correction is commit `4019db2`; no production change was required for that failure.
- P1 Discovery and Partner Requests: IN_PROGRESS with runtime implementation committed through domain/contracts, migration 0008, repositories, API, worker expiry, client UI, and expanded tests at `355037d`; full local PostgreSQL/security/health validation is still pending. Do not mark P1 DONE until that evidence is green.
- P2 Partnership Formation and Relationship Date: IN_PROGRESS at the hardened design layer; runtime implementation is pending while P1 validation completes. The design has been revalidated against P1's committed `handleReciprocalCandidate` seam and now additionally fixes accepted-request expiry-action cancellation, processing-worker no-op races, accept/cancel/decline terminal races, legacy-safe migration 0009 linkage constraints, retention-scoped replay, and lost-response relationship-date retry semantics.
- all other pre-release implementation epics not listed above: PLANNED

The persistence schema foundation has repeatable disposable PostgreSQL evidence. Earlier schema verification covered migration rerun idempotency, checksum drift, catalog inspection, occupied-slot contention, scheduled-action claim contention, and deterministic account-lock ordering. F2 then applied all six migrations from zero and passed 17/17 runtime integration tests covering transaction policy, retries, PostgreSQL clocks, stale generations, durable payload versions, rollback, outbox atomicity and duplicate safety, claim fencing and reclaim, lifecycle privacy, deletion recovery, queue plans, and graceful worker shutdown. Product-specific API and lifecycle integration remain work for later epics.

Baseline CI is configured in `.github/workflows/ci.yml`, including SHA-pinned external Actions and repository-health checks. GitHub-hosted validation has not yet been executed and is tracked separately under V1. Current repository commits intentionally use `[skip ci]` while hosted Actions execution is being conserved.

## Progress reporting rule

Do not report an epic as complete from a partial layer.

For example, a passing domain state machine does not mean the persisted API and worker lifecycle epic is complete.

Epic completion is governed by the acceptance gates in `docs/ROADMAP_EPICS.md`.

## Next engineering work

A1 is complete. P1 runtime is committed and currently in validation; P2 remains the next dependent runtime epic.

1. finish P1 local security, disposable PostgreSQL, repository-health, and dependency-audit validation
2. fix only evidence-backed P1 defects without weakening the P1/P2 contract
3. once P1 is green, implement P2-A against the exact committed reciprocal coordinator seam
4. add migration 0009 without rewriting committed migration 0008
5. keep production `paired` mode disabled until the real P2 coordinator and full P1-with-P2 integration suite are green
6. keep P3 persistence/API/worker work coordinated with P1/P2 dependency boundaries
7. keep V1 Hosted CI Verification separate and blocked until GitHub Actions capacity returns

## Deferred heavy feature policy

Call recording is intentionally outside the first stable release and outside the initial post-stable maturity milestone. It is tracked under X2 Deferred Heavy Features and is not a required product milestone.

No implementation should begin until real production evidence shows sufficient user demand and acceptable storage, bandwidth, retention, deletion, backup-expiry, privacy, legal, and E2EE cost.

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

A1 documentation is reconciled against the completed acceptance evidence. All 20 gates are closed from committed implementation plus passing local database, API, worker, security, repository-health, and dependency-audit evidence. P1/P2 documentation has also been reconciled after the hardened transaction-contract review; current-state documents treat P1 as the active runtime epic and P2 as design-complete but implementation-pending.

Current-state claims belong here and in `ROADMAP_EPICS.md`. Product, architecture, security, and ADR documents should not be interpreted as proof that their described runtime behavior is already implemented.
