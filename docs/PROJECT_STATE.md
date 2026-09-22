# Project State

## Status

Architecture Baseline 1.0 is accepted and frozen.

Foundation implementation is complete and product substrate implementation is underway. F0 Governance and Security Baseline, F1 Repository Foundation and Executable Guardrails, F2 Persistence and Worker Foundation, A1 Accounts and Devices, P1 Discovery and Partner Requests, P2 Partnership Formation and Relationship Date, and P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns are complete with repeatable local evidence. All ten committed PostgreSQL migrations apply from zero against disposable PostgreSQL 16, database invariants pass, the P3 lifecycle domain/contracts suite passes 28/28, P3 security passes 6/6, and the disposable PostgreSQL/API/worker integration matrix passes 39/39. Full repository health and the high-severity dependency audit are green. Hosted GitHub Actions verification is tracked separately under V1 and does not block continued development.

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

The current domain suite contains 38 tests and passes in local validation.

The threat model and data-classification baseline are complete and remain the active security foundation for implementation.

Architecture governance is complete. Structural changes now require the evidence-based process in `docs/architecture/ARCHITECTURE_GOVERNANCE.md`.

Roadmap epics and objective acceptance gates are now defined in `docs/ROADMAP_EPICS.md`.

Current epic status:

- F0 Governance and Security Baseline: DONE
- F1 Repository Foundation and Executable Guardrails: DONE based on committed lockfile bootstrap, full local health validation, dependency and circular checks, runtime-contract tests, and repository guardrails
- V1 Hosted CI Verification: BLOCKED while GitHub Actions capacity is unavailable; this is a separate non-blocking verification track and does not prevent F2 or feature development
- F2 Persistence and Worker Foundation: DONE. The database runtime, migration 0006, fencing-aware durable repositories, bounded worker consumers, transactional outbox runtime, lifecycle-event repository, deletion runtime, Docker-backed disposable PostgreSQL harness, and F2 integration matrix are implemented and locally verified. The F2 PostgreSQL suite passes 17/17 after applying all six migrations from zero, and the final full `npm run health` regression passes from the committed lockfile
- P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns: DONE on `feat/p3-partnership-lifecycle`. All 22 acceptance gates are closed. The lifecycle domain/contracts suite passes 28/28, P3 security passes 6/6, all ten migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker matrix passes 39/39 with `P3_LOCAL_POSTGRES_PASS`. Executed evidence covers exact cancellation/restoration boundaries, generation fencing, canonical dissolution, account-deletion precedence and recovery, exact cooldowns, synchronous authorization revocation, deletion manifests, former-partner blocking and privacy, serious notices, race persistence, and A1/P1/P2 regressions. Full repository health passes with Domain 48/48, Contracts 17/17, API unit/security 22/22, Worker 4/4, and all static/build checks green. `npm audit --audit-level=high` reports 0 vulnerabilities.
- X1 Post-stable Maturity: PLANNED after the first stable release and focused on operational evidence, cost measurement, and stabilization
- X2 Deferred Heavy Features: DEFERRED and optional; consensual call recording is moved here and requires post-stable demand, cost, privacy, legal, deletion, retention, and E2EE evidence before implementation
- A1 Accounts and Devices: DONE. All 20 acceptance gates are closed. The expanded disposable PostgreSQL suite passes 27/27 with all seven migrations applied from zero and database invariants green; `npm run test:a1:security` passes 16/16; the full `npm run health` regression passes with Domain 32/32, Contracts 4/4, API unit/security 8/8, and Worker 4/4; and `npm audit --audit-level=high` reports 0 vulnerabilities. The final acceptance run includes challenge expiry/exhaustion/resend/rate-limit coverage, ownership and registration races, logout and revoked-cookie rejection, absolute/idle session expiry and session-generation fencing, recent reauthentication, username API rules, device list/rename/revocation/current-device behavior, exact account-recovery deadline behavior, browser-security negative paths, raw-code/outbox exclusion, and raw device-handle storage exclusion. The final test-harness correction is commit `4019db2`; no production change was required for that failure.
- P1 Discovery and Partner Requests: DONE. All 14 acceptance gates are closed. Migration 0008 applies as part of an eight-migration clean run with database invariants green; `npm run test:p1:local` passes the disposable PostgreSQL/API/worker matrix 16/16 with `P1_LOCAL_POSTGRES_PASS`; the final full `npm run health` regression passes with Domain 38/38, Contracts 8/8, API unit/security 11/11, and Worker 4/4; Prettier, ESLint, dependency checks, typecheck, and production builds are green; and `npm audit --audit-level=high` reports 0 vulnerabilities.
- P2 Partnership Formation and Relationship Date: DONE. All 11 acceptance gates are closed. The P2 domain/contracts suite passes 14/14, the P2 security suite passes 5/5, all nine migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker matrix passes 27/27 with `P2_LOCAL_POSTGRES_PASS`. The matrix proves explicit and reciprocal formation, accepted-request replay linkage, deterministic locking, incompatible-request invalidation, expiry-action handling, one-partner occupancy races, relationship-date version and generation separation, other-partner notification isolation, notification snapshot pagination, and P1 behavior in real `paired` mode. The standalone historical `test:p1:local` harness remains request-only. Full repository health and `npm audit --audit-level=high` are green. Migration 0008 remains byte-for-byte unchanged at SHA-256 `94e2d22ceff3b73fc990fc07810cabedea097d7440a571c54c00ec185bebd18e`.
- M1 Messaging Core: IN_PROGRESS on `feat/m1-messaging-core`. Its refined architecture and API design are complete on the parallel branch; runtime implementation and acceptance evidence remain pending. M1 owns migrations 0011 and 0012.
- R1 Relationship Space: IN_PROGRESS and `R1 ISOLATED GREEN` on `feat/r1-relationship-space` at verification checkpoint `0b863c5`. Architecture/API design and source implementation are complete. Executed isolated evidence includes relationship domain/contracts 16/16, R1 security 13/13, disposable PostgreSQL migrations and invariants PASS with explicit reservations for M1-owned 0011/0012, the API/worker integration matrix 68/68 with `R1_LOCAL_POSTGRES_PASS`, P1/P2/P3 security regressions green, typecheck/build/lint/dependency checks green, and `npm audit --audit-level=high` at 0 vulnerabilities. `format:check` still reports style drift in 15 R1 files. R1 is not DONE: the strict canonical migration chain and full repository health remain integration-pending until the real M1 migrations 0011/0012 are available.
- all other pre-release implementation epics not listed above: PLANNED


## Repository branch state

Milestone history is preserved with durable branch refs at genuine closure commits:

- `milestone/f0-governance-security` -> `34682c2`
- `milestone/f1-repository-foundation` -> `ddf368d`
- `milestone/f2-persistence-worker` -> `e3ce811`
- `milestone/a1-accounts-devices` -> `a876406`
- `milestone/p1-discovery-requests` -> `69cb238`
- `feat/p2-partnership-formation` -> `04b5229`
- `feat/p3-partnership-lifecycle` -> completed P3 development and closure history
- `main` contains verified P3 code baseline `9820801`; later documentation-only commits may advance the branch without changing that runtime evidence

P3 was fast-forward merged to `main` after all 22 acceptance gates closed. The completed `feat/p3-partnership-lifecycle` branch is preserved as milestone history. Dependent work must branch from the latest `main` containing the verified P3 baseline.

The legacy `feat/m1-executable-foundation` branch records the earlier executable-foundation development line. It is not the future M1 Messaging Core branch and must not be reused for messaging work.

From P2 onward, each milestone uses its own branch created from the latest verified `main`, closes its acceptance gates and documentation on that branch, then merges to `main` before the next dependent milestone branch is created.

The persistence schema foundation has repeatable disposable PostgreSQL evidence. Earlier schema verification covered migration rerun idempotency, checksum drift, catalog inspection, occupied-slot contention, scheduled-action claim contention, and deterministic account-lock ordering. F2 then applied all six migrations from zero and passed 17/17 runtime integration tests covering transaction policy, retries, PostgreSQL clocks, stale generations, durable payload versions, rollback, outbox atomicity and duplicate safety, claim fencing and reclaim, lifecycle privacy, deletion recovery, queue plans, and graceful worker shutdown. Product-specific API and lifecycle integration remain work for later epics.

Baseline CI is configured in `.github/workflows/ci.yml`, including SHA-pinned external Actions and repository-health checks. GitHub-hosted validation has not yet been executed and is tracked separately under V1. Current repository commits intentionally use `[skip ci]` while hosted Actions execution is being conserved.

## Progress reporting rule

Do not report an epic as complete from a partial layer.

For example, a passing domain state machine does not mean the persisted API and worker lifecycle epic is complete.

Epic completion is governed by the acceptance gates in `docs/ROADMAP_EPICS.md`.

## Next engineering work

A1, P1, P2, and P3 are complete and merged into the verified mainline.

M1 and R1 remain separate parallel branches. M1 runtime work continues independently. R1 source implementation is isolated-green and now awaits integration with the real M1 migrations plus final repository-health closure.

1. continue M1 only in `feat/m1-messaging-core` with ownership of migrations 0011 and 0012
2. preserve the executed R1 isolated evidence on `feat/r1-relationship-space` and keep R1 ownership of migrations 0013 and 0014
3. keep shared-file edits minimal, append-oriented, and easy to reconcile
4. do not merge or cherry-pick M1 runtime into R1 merely to satisfy migration numbering
5. preserve P3 lifecycle, capability, authorization-revocation, cooldown, blocking, notification, and deletion boundaries
6. close R1 only after canonical 0001 through 0014 PostgreSQL evidence exists with verified M1 migrations available from the approved integration baseline
7. begin M2 only after verified M1 returns to main
8. keep V1 hosted verification separate until GitHub Actions capacity returns

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

A1, P1, P2, and P3 documentation are reconciled against completed acceptance evidence. A1 is closed at 20/20 gates, P1 at 14/14 gates, P2 at 11/11 gates, and P3 at 22/22 gates. P3 closure is supported by the green lifecycle domain/contracts, security, ten-migration PostgreSQL, database-invariant, API/worker/race, full health, and dependency-audit runs recorded above.

Current-state claims belong here and in `ROADMAP_EPICS.md`. Product, architecture, security, and ADR documents should not be interpreted as proof that their described runtime behavior is already implemented.
