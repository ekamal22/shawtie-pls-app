# Roadmap Epics and Acceptance Gates

## Purpose

This document converts the product roadmap into implementation epics with objective completion gates.

The goal is to make project progress measurable without relying on subjective percentages.

## Status model

Every epic uses one of these statuses:

- PLANNED
- IN_PROGRESS
- BLOCKED
- DONE

An epic may be marked DONE only when every required acceptance gate is satisfied or explicitly marked not applicable with a documented reason.

Partial implementation does not make an epic DONE.

## Evidence rule

A DONE claim must point to repository evidence such as:

- merged source code
- migrations
- passing tests
- CI results
- security regressions
- browser or physical-device evidence where required
- updated architecture, security, testing, or product documentation

PROJECT_STATE is the source for verified current implementation status.

This document defines the work and the gates.

## Dependency order

The default implementation order is:

```text
F0 Governance and Security Baseline
        |
        v
F1 Repository Foundation
        |
        +-----------------------> V1 Hosted CI Verification
        |                          (non-blocking for development)
        v
F2 Persistence and Worker Foundation
        |
        +------------------+
        |                  |
        v                  v
A1 Accounts and Devices   P1 Discovery and Partner Requests
        |                  |
        +--------+---------+
                 v
        P2 Partnership Formation
                 |
                 v
        P3 Partnership Lifecycle
                 |
        +--------+---------+
        |                  |
        v                  v
M1 Messaging Core      R1 Relationship Space
        |
        v
M2 Realtime and Offline
        |
    +---+---+
    |       |
    v       v
M3 Media  C1 Calling
    |       |
    +---+---+
        v
S1 E2EE and Crypto Recovery
        |
        v
R2 Public Readiness
        |
        v
STABLE RELEASE
        |
        v
X1 Post-stable Maturity
        |
        v
X2 Deferred Heavy Features
```

Some work may overlap when dependencies are already satisfied, but gates must still be met.

# F0: Governance and Security Baseline

Status: DONE

## Scope

- product requirements baseline
- architecture baseline
- architecture governance
- threat model
- data classification
- initial partnership state-machine tests
- initial capability tests

## Acceptance gates

- [x] PRD defines core product behavior
- [x] Architecture Baseline 1.0 is frozen
- [x] architecture governance process is documented
- [x] threat model exists
- [x] data-classification matrix exists
- [x] contribution workflow references governance
- [x] partnership state-machine domain tests exist
- [x] capability domain tests exist
- [x] current domain baseline has passing local validation
- [x] no completed item is represented as runtime implementation unless code or tests exist
- [x] documentation freshness model distinguishes intended design from verified runtime status

## Evidence

- `docs/product/PRD.md`
- `docs/architecture/ARCHITECTURE_BASELINE.md`
- `docs/architecture/ARCHITECTURE_GOVERNANCE.md`
- `docs/security/THREAT_MODEL.md`
- `docs/security/DATA_CLASSIFICATION.md`
- `packages/domain/tests`

# F1: Repository Foundation and Executable Guardrails

Status: DONE

## Current verified progress

Configured repository evidence now includes:

- baseline GitHub Actions workflow
- local repository-health command
- baseline secret-pattern and forbidden-file scanning
- executable `packages/domain` infrastructure-import boundary
- workflow policy checks
- SHA-pinned external GitHub Actions
- CODEOWNERS
- SECURITY.md
- local domain test command
- npm workspace configuration for apps and packages
- strict shared TypeScript configuration and package path aliases
- web, API, and durable-worker executable scaffolds
- ESLint and Prettier configuration
- workspace dependency-direction and circular-dependency scanner
- Zod-based external-boundary validation foundation and contract tests
- root build, typecheck, lint, format-check, dependency-check, test, and health commands

Dependency installation completed locally with 0 reported npm audit vulnerabilities. A complete `npm run health` pass on 2026-09-20 verified repository health, static migration-plan validation, all workspace typechecks, all workspace builds, lint, Prettier formatting, workspace dependency-direction and circular-dependency checks, 27 domain tests, and 2 runtime-contract tests. `package-lock.json` is committed. The canonical clean-clone bootstrap command `npm ci` was then executed successfully from the committed lockfile, installed 180 packages, reported 0 vulnerabilities, and was followed by another complete passing `npm run health` run. Current fixtures are synthetic-only.

Hosted GitHub Actions execution is tracked separately under V1 and is not an F1 completion gate.

## Scope

- workspace configuration
- TypeScript configuration
- linting
- formatting
- import boundaries
- dependency-direction enforcement
- runtime contract-validation foundation
- shared build and test commands
- CI foundation
- repository health checks

## Acceptance gates

- [x] clean clone installs with the documented package-manager command
- [x] root build command succeeds
- [x] root typecheck command succeeds
- [x] root lint command succeeds
- [x] root test command succeeds
- [x] formatting check succeeds
- [x] `packages/domain` is mechanically prevented from importing React, Fastify, database clients, provider SDKs, or `apps/*`
- [x] circular dependency checking is active for defined package boundaries
- [x] external input validation convention is implemented
- [x] CI workflow is configured to run the required baseline checks on pull requests
- [x] baseline secret-pattern and forbidden-secret-file scanning is enabled in repository tooling
- [x] dependency scanning is active against a committed lockfile
- [x] documentation contains one canonical bootstrap command
- [x] no real private data or production secret is present in fixtures
- [x] CI workflow uses explicit read-only permissions, a timeout, and SHA-pinned external actions
- [x] CODEOWNERS and SECURITY.md are present

# V1: Hosted CI Verification

Status: BLOCKED

## Purpose

Verify the already-configured baseline CI workflow on GitHub-hosted infrastructure once Actions capacity is available again.

V1 is intentionally separate from F1 and is not a prerequisite for F2, accounts, partnerships, messaging, relationship-space, media, calling, or other implementation work. It must be completed before R2 Public Readiness can be marked DONE.

## Current blocker

GitHub Actions capacity is unavailable through the remainder of September 2026, so hosted verification is deferred without blocking development.

## Scope

- execute Baseline CI on GitHub-hosted Ubuntu
- verify the workflow trigger and permissions behavior
- verify clean lockfile installation under the hosted runner
- verify the full repository baseline under the hosted runner
- verify dependency audit under the hosted runner
- record hosted-run evidence in project state

## Acceptance gates

- [ ] at least one GitHub-hosted Baseline CI run completes successfully
- [ ] hosted `npm ci` succeeds from the committed lockfile
- [ ] hosted `npm run ci:baseline` succeeds
- [ ] hosted `npm audit --audit-level=high` succeeds
- [ ] workflow permissions, pinned actions, timeout, and trigger behavior are confirmed in a real run
- [ ] successful run evidence is recorded in `docs/PROJECT_STATE.md`

# F2: Persistence and Worker Foundation

Status: DONE

## Design status

The implementation architecture and execution sequence are defined in:

`docs/architecture/F2_PERSISTENCE_WORKER_DESIGN.md`

The design preserves Architecture Baseline 1.0. The persistence kernel, durable worker, transactional outbox, lifecycle-event persistence, deletion runtime, disposable PostgreSQL harness, and F2 verification matrix are implemented and locally verified.

## Current verified progress

Committed repository artifacts and local PostgreSQL evidence now include:

- six ordered PostgreSQL migrations
- migration checksum ledger and forward migration runner
- static migration-plan validation
- identity, partnership, lifecycle, durable-operation, messaging, relationship, media, and call schema foundations
- partial unique constraint for one occupied partnership slot per account
- partial unique constraint for current verified email ownership
- database-level idempotency uniqueness
- exact breakup timing checks
- relational membership hardening
- append-only lifecycle event update protection
- scheduled-action and outbox deduplication
- deletion manifest and target schema
- deterministic account-lock SQL pattern
- scheduled-action `FOR UPDATE SKIP LOCKED` claim SQL
- invariant test SQL
- repeatable migration-from-zero evidence against disposable PostgreSQL 16, including all six migrations in the completed F2 run
- migration checksum ledger and earlier rerun idempotency evidence, plus committed checksum validation for all six migrations
- passing invariant SQL for verified-email ownership, occupied partnership slots, idempotency, request and breakup checks, append-only lifecycle events, device ownership, member limits, and scheduled-action deduplication
- catalog verification of critical indexes, foreign keys, checks, and triggers
- successful occupied-slot, scheduled-action claim, and deterministic account-lock concurrency exercises

The current database foundation has local PostgreSQL execution evidence.

The F2 runtime includes `0006_durable_runtime_reliability.sql`, PostgreSQL runtime repositories, claim fencing and leases, direct expired-claim reclaim, worker consumers, outbox delivery infrastructure, lifecycle-ledger persistence, deletion retry/resume infrastructure, and committed PostgreSQL integration tests. The Docker-backed local F2 run applied all six migrations from zero, passed database invariants, and passed 17/17 integration tests. A final `npm run health` also passed with repository health, migration-plan checks, all workspace typechecks and builds, lint, formatting, dependency checks, 27 domain tests, 2 contract tests, and 3 worker unit tests.

## Implementation sequence

### F2-A Persistence kernel and race automation

- PostgreSQL connection pool with required pool error handling
- transaction-scoped query executor
- `READ COMMITTED` policy with bounded whole-transaction retry
- PostgreSQL business-time and lease-time helpers
- defensive statement, lock, idle-transaction, connection, and query timeout policy
- SQLSTATE normalization
- durable-work reliability migration with fencing tokens and payload versions
- deterministic account-lock repository
- reusable disposable-database testkit
- automated occupied-partnership contention test
- automated scheduled-action `SKIP LOCKED` and expired-claim reclaim test
- automated deterministic two-account lock-order test
- queue query-plan verification against realistic synthetic data

### F2-B Durable worker runtime

- runtime configuration
- unique worker identity
- bounded polling and concurrency
- polling correctness path verified; optional `LISTEN/NOTIFY` remains a non-required future latency optimization
- scheduled-action claim and execution
- direct expired-claim reclaim
- claim-version fencing
- controlled lease renewal for long-running handlers
- retry classification and backoff
- durable payload-version dispatch
- expected-generation protection
- graceful shutdown
- multi-worker tests

### F2-C Transactional outbox

- outbox insert in authoritative transactions
- versioned durable payload contract
- worker claim and direct expired-claim reclaim
- handler registry
- fenced delivery acknowledgement
- controlled lease renewal where justified
- retry and permanent-failure handling
- duplicate-delivery safety
- unsupported-payload fail-closed behavior
- commit and rollback atomicity tests

### F2-D Lifecycle event persistence

- append-only runtime repository
- typed allowlisted metadata
- transaction integration
- append-only regression
- private-content exclusion regression

### F2-E Deletion manifest runtime

- manifest and target creation
- target claiming and lease recovery
- idempotent target handlers
- retry and permanent-failure handling
- manifest completion
- partial-failure restart and resume
- authorization-remains-revoked regression

### F2-F Integration verification

- transaction rollback and commit tests
- worker crash and direct expired-lease reclaim
- stale claim-version acknowledgement rejection
- lease renewal ownership checks
- stale-generation rejection
- unsupported durable payload version fails closed
- transaction timeout and whole-transaction retry behavior
- pool error handling
- queue query-plan verification
- outbox atomicity and duplicate delivery
- lifecycle-event privacy
- deletion resume after restart
- graceful shutdown
- full repository health regression

Hosted execution remains a separate V1 concern and is not an F2 local completion requirement.

## Scope

- PostgreSQL development environment
- migration system
- database schema foundation
- database constraints
- database runtime connection and transaction mechanics
- deterministic multi-account locking
- durable worker
- transactional outbox
- scheduled actions
- claim leases and crash recovery
- generation guards
- lifecycle ledger persistence
- deletion manifests
- idempotency persistence
- reusable PostgreSQL integration and race-test infrastructure

## Acceptance gates

- [x] migrations create a clean database from zero
- [x] rollback or forward-recovery policy is documented
- [x] one occupied partnership slot per account is enforced by PostgreSQL
- [x] current verified email uniqueness is enforced by PostgreSQL
- [x] idempotency uniqueness is enforced at the database level
- [x] deterministic two-account locking helper exists
- [x] concurrent partnership creation cannot create two occupied partnerships
- [x] PostgreSQL invariant and selected race tests pass locally
- [x] database runtime uses one checked-out connection for each authoritative transaction
- [x] normal authoritative transactions use the documented `READ COMMITTED` policy
- [x] retryable PostgreSQL transaction failures restart the whole transaction through one bounded retry policy
- [x] authoritative business time uses PostgreSQL transaction time and lease logic uses an advancing PostgreSQL clock
- [x] defensive database and Node-side timeout policy is implemented and tested
- [x] PostgreSQL pool idle-client errors are handled and checked-out clients are always released
- [x] durable-work reliability migration is implemented and validated from zero
- [x] occupied-slot, scheduled-claim, and deterministic-lock races are committed as repeatable automated tests
- [x] worker claims scheduled work safely across multiple worker instances
- [x] claimed scheduled, outbox, and deletion work can be reclaimed directly by normal claim queries after worker crash or lease expiry
- [x] durable claims use monotonically increasing fencing tokens and stale acknowledgements are rejected
- [x] approved long-running handlers renew leases only while worker identity and claim version still match
- [x] polling remains sufficient for correctness if optional wake-up notifications are missed
- [x] scheduled-action and outbox payloads are explicitly versioned and unknown versions fail closed
- [x] worker concurrency is bounded and graceful shutdown stops new claims before exit
- [x] lifecycle-sensitive jobs reject stale generations inside the same transaction as the authoritative mutation
- [x] outbox write occurs in the same transaction as authoritative state mutation
- [x] outbox delivery is treated as at-least-once and duplicate delivery is safe
- [x] external provider calls do not occur inside authoritative database transactions
- [x] lifecycle events are append-only and contain only allowlisted non-content metadata
- [x] deletion authorization remains revoked while physical cleanup retries
- [x] deletion manifests resume after partial failure or process restart
- [x] due and expired-work queue queries use intended indexes on realistically sized synthetic data
- [x] complete F2 local integration and failure-recovery suite passes
- [x] full repository health regression remains green

F2 local completion does not close V1 Hosted CI Verification. V1 remains a separate prerequisite for R2 Public Readiness.

# A1: Accounts and Devices

Status: DONE

## Implementation status

A1 is complete at 20/20 acceptance gates. The committed runtime builds on the verified F2 transaction, outbox, worker, scheduled-action, deletion, and PostgreSQL substrate and includes A1-A through A1-F, the account/device web foundation, and the runnable API entrypoint.

Final local closure evidence:

- seven migrations apply from zero and database invariants pass
- expanded disposable PostgreSQL A1 acceptance suite: 27/27 PASS
- A1 security suite: 16/16 PASS
- full repository health: PASS
- dependency audit at high severity: 0 vulnerabilities
- final device-suite failure was confirmed as a test-harness defect and corrected without a production-code change

## Implementation sequence

### A1-A Domain, contracts, migration, and repositories

- account domain rules and stable denial codes
- boundary schemas
- migration 0007
- password credential persistence
- registration intents
- email challenges
- sessions and devices
- PostgreSQL-backed security rate limits
- typed security events

### A1-B Authentication security kernel

- Argon2id password service
- opaque revocable session cookies
- device-handle identification
- authentication middleware
- exact-origin and Fetch Metadata checks
- custom-header CSRF protection
- generic auth failures
- deterministic durable rate limiting

### A1-C Registration and login

- registration start
- verification email outbox
- verification resend and replay protection
- transactional registration completion
- login
- logout
- session introspection
- initial device binding

### A1-D Recovery and sensitive changes

- password recovery
- recent reauthentication
- verified email change
- old-email notification
- other-session revocation
- profile display name
- username change
- DOB correction

### A1-E Account deletion and devices

- deletion request and immediate account lockout
- seven-day account recovery
- scheduled finalization substrate
- device list and rename
- device revocation
- crypto-recovery separation

### A1-F Integration closure

- disposable PostgreSQL tests
- Fastify API integration tests
- authentication race tests
- security regressions
- new-dependency audit
- full repository health regression
- repo-wide documentation closure

## Scope

- registration
- age eligibility
- verified email
- authentication
- sessions
- password recovery
- verified email change
- username rules
- date-of-birth correction
- profile settings
- account deletion request and recovery
- device records
- device revocation
- device-management UI foundation
- account recovery versus crypto recovery boundary

## Acceptance gates

- [x] under-18 registration is rejected by server time
- [x] client clock changes cannot bypass age eligibility
- [x] email verification codes expire, rate-limit, and reject replay
- [x] one verified email cannot own two active accounts
- [x] login and logout work with revocable server sessions
- [x] password recovery works through verified email
- [x] email change requires reauthentication and new-email verification
- [x] old email is notified after successful email change
- [x] other sessions are revoked after successful email change
- [x] one-year username change rule is server-enforced
- [x] username change is blocked while active or breakup_pending
- [x] old username is released after a successful change
- [x] one-time DOB correction is server-enforced
- [x] rejected under-18 DOB correction does not consume the correction allowance
- [x] account deletion immediately removes account access
- [x] account recovery works before the seven-day deadline
- [x] device records exist and sessions can be associated with devices where applicable
- [x] device revocation revokes authentication access
- [x] account recovery does not imply historical E2EE key recovery
- [x] integration and security tests pass against the complete canonical A1 verification matrix


## Acceptance reconciliation evidence

Reconciled: 2026-09-21.

Final A1 evidence:

- acceptance gates: 20/20
- migration plan: 7/7
- disposable migration run: 7/7
- database invariants: PASS
- A1 local integration/acceptance suite: 27/27 PASS with `A1_LOCAL_POSTGRES_PASS`
- A1 security suite: 16/16 PASS
- full repository health: PASS
- Domain 32/32, Contracts 4/4, API unit/security 8/8, Worker 4/4
- `npm audit --audit-level=high`: 0 vulnerabilities
- final account-deletion/breakup precedence production SQL fix: `ceb3d93`
- final device acceptance test-harness correction: `4019db2`

The expanded committed evidence now directly covers the previously open challenge expiry/attempt/rate-limit cases, ownership and registration races, logout/revoked-cookie rejection, absolute/idle session expiry and fencing, username API acceptance, device list/rename/revocation/current-device behavior, browser-security negative paths, raw-code/outbox exclusion, and raw device-handle exclusion.

# P1: Discovery and Partner Requests

Status: DONE

## Verified implementation

The hardened architecture, implementation, and closure record are defined in:

\`docs/architecture/P1_DISCOVERY_REQUESTS_DESIGN.md\`

P1 preserves Architecture Baseline 1.0 and builds on F2 plus the refined A1 account/session/security substrate.

The hardened refinement adds create idempotency bound to recipient identity plus canonical relationshipStartDate, separate abuse-rate-limit transactions, pair locking for cancel/decline, snapshot-bound cursor pagination, UTC calendar cutoffs, cross-epic invalidation hooks, migration backfill/new-write enforcement rules, attempt retention, fail-closed production gating until P2 formation is wired, and the manually entered relationship-date handoff required for reciprocal formation.

P1 runtime implementation and local verification are complete. Migration 0008 applies in the clean eight-migration run, the disposable P1 PostgreSQL/API/worker suite passes 16/16, full repository health is green, and the high-severity dependency audit reports 0 vulnerabilities.

## Implementation sequence

### P1-A Domain, contracts, migration, repositories

- request domain rules and exact time boundaries
- discovery, cursor, and mutation contracts including required request `relationshipStartDate`
- migration 0008 including legacy-compatible relationship-date persistence
- forward-safe request terminal-shape backfill
- discovery repository
- partner-request repository
- append-only request-attempt hardening
- cross-epic invalidation helpers
- create-request idempotency integration
- F2 scheduled expiry integration

### P1-B Discovery

- authenticated exact username lookup
- safe public projection
- trusted-server age projection
- self suppression
- blocker-hidden behavior
- durable discovery abuse limits

### P1-C Request creation

- stable account target plus expected username
- required manually entered `relationshipStartDate`
- required idempotency key
- separate committed security-rate-limit preflight
- deterministic two-account locking
- sender and recipient eligibility
- either-direction block enforcement
- duplicate rejection
- exact one-hour decline cooldown
- rolling one-month limit
- seven-day request insert
- reciprocal-request detection with triggering request identity and relationship date
- same-transaction P2 coordinator handoff
- fail-closed production feature mode

### P1-D Cancel, decline, expiry

- pair-locked outgoing cancel
- pair-locked incoming decline
- exact scheduled expiry
- lazy logical expiry
- cursor-paginated active request lists
- A1/P2/P3 invalidation integration

### P1-E Client and abuse closure

- exact search UI
- request send UI with required relationship date
- incoming/outgoing request UI showing the proposed date to participants
- cancel and decline controls
- generic recipient-unavailable behavior
- security and abuse regressions

### P1-F Integration closure

- PostgreSQL suite
- API suite
- race suite
- security suite
- full repository health
- repo-wide documentation closure

## Scope

- username search
- safe public-profile projection
- partner request creation
- cancellation
- decline
- expiry
- rolling one-month request limit
- one-hour post-decline cooldown
- multiple incoming requests
- reciprocal request auto-pair trigger
- manually entered request relationship date for P2 formation
- abuse controls

## Acceptance gates

- [x] username search exposes only allowed public fields
- [x] exact DOB and email are never returned
- [x] pending requests expire exactly seven days after creation
- [x] sender can cancel before acceptance
- [x] decline does not create a block
- [x] same sender cannot exceed three requests to one recipient in a rolling month
- [x] one-hour post-decline cooldown is enforced
- [x] multiple incoming requests may coexist
- [x] self-request is rejected
- [x] duplicate same-direction pending request is rejected
- [x] active block prevents discovery and requests as defined by product rules
- [x] direct API calls cannot bypass request eligibility
- [x] request race tests pass
- [x] abuse-rate-limit tests pass

P1 owns reciprocal-request detection but not partnership persistence. In `paired` mode it synchronously invokes the P2 coordinator inside the same request-creation transaction; P2 owns explicit acceptance and all authoritative partnership formation writes.

# P2: Partnership Formation and Relationship Date

Status: DONE

## Design status

The refined architecture and implementation sequence are defined in:

`docs/architecture/P2_PARTNERSHIP_FORMATION_DESIGN.md`

P2 hardened design and runtime implementation are complete on `feat/p2-partnership-formation` at closure commit `fa2301d0`. Local closure is verified by P2 domain/contracts 14/14, P2 security 5/5, all nine migrations from zero, passing database invariants, the disposable PostgreSQL/API/worker integration matrix 27/27 with `P2_LOCAL_POSTGRES_PASS`, full repository health with Domain 45/45, Contracts 15/15, API unit/security 16/16, Worker 4/4 plus all static/build checks, and a zero-high-severity dependency audit. The final test-quality review strengthened persisted-state evidence for the formation lifecycle event, unchanged lifecycle generation after metadata edits, and exact other-partner notification routing without requiring semantic production-code changes.

The design now consumes the committed P1 relationship-date request substrate and exact `handleReciprocalCandidate(executor, candidate, now)` seam. Explicit acceptance uses the accepted request's date; reciprocal auto-pairing uses the triggering second request's date. Formation stays inside one PostgreSQL transaction under the same deterministic pair locks held by P1.

P2 uses the fresh immutable partnership ID itself as the local and future cryptographic namespace root, adds no redundant security-context identifier, and deliberately does not invent cryptographic keys or epochs before S1 protocol review.

## Implemented source sequence

### P2-A Domain, contracts, and P1 handoff refinement

- relationship-date trusted-server validation
- formation types and stable denial codes
- `change_relationship_start_date` capability
- consume the committed P1 create/list relationship-date contract
- implement a thin adapter over the committed reciprocal candidate seam
- P2 accept/current/date/notification contracts

### P2-B Migration and repositories

- consume committed P1 migration 0008 without rewriting it
- migration 0009 partnership-formation runtime
- fresh partnership-ID namespace with no redundant security-context column
- accepted request to partnership linkage
- legacy-safe `NOT VALID` accepted-linkage constraints
- minimal durable account notifications
- formation, partnership, and notification repositories
- invariant and index coverage

### P2-C Explicit formation

- recipient accept endpoint
- deterministic pair locking and full eligibility recheck
- partnership and two-member creation
- request acceptance linkage
- cancellation of still-pending P1 request-expiry jobs
- incompatible request invalidation
- formation lifecycle evidence
- durable formation notifications
- retention-scoped lost-response replay

### P2-D Reciprocal integration

- transaction-scoped P2 coordinator injected into P1
- reciprocal auto-pair before the P1 create transaction commits
- both reciprocal requests accepted to one partnership
- paired response persisted in P1 idempotency record
- explicit-accept versus reciprocal race coverage
- expiry-worker versus formation race coverage
- production `paired` mode enabled only with coordinator registered

### P2-E Relationship metadata and notification closure

- current partnership read model
- account-lock-serialized relationship date update using `expectedMetadataVersion`
- future-date rejection
- same-date lost-response retry is a no-op even if the submitted expectedMetadataVersion is now stale
- durable other-partner notification
- minimal notification list/read API
- request/accept/current-partnership client flows

### P2-F Integration closure

- disposable PostgreSQL 16 harness is committed as `npm run test:p2:local`
- API and reciprocal/explicit formation integration coverage is committed
- competing-accept, accept-versus-reciprocal, accept-versus-cancel/decline, already-processing-expiry, metadata-version, and account-deletion race coverage is committed
- P2 security regressions are committed
- the P2 closure suite reruns the P1 integration surface with the real coordinator in `paired` mode, while the standalone verified `test:p1:local` harness remains request-only
- full repository health and the high-severity dependency audit pass
- repo-wide documentation records verified local closure while keeping hosted CI separate under V1

## Scope

- explicit acceptance
- reciprocal request auto-pairing
- one-partner occupancy
- incompatible request invalidation
- manually entered relationship start date
- relationship date updates
- durable relationship-date notification
- fresh partnership-ID namespace

## Acceptance gates

- [x] normal one-way request requires recipient acceptance
- [x] reciprocal pending requests create a partnership automatically
- [x] partnership formation is transactional
- [x] database invariant prevents simultaneous second partnership
- [x] incompatible pending incoming and outgoing requests are invalidated
- [x] relationship start date is manually entered
- [x] future relationship start date is rejected
- [x] either partner can update allowed relationship date
- [x] partner receives relationship-date change notification
- [x] new partnership creates a fresh local and future cryptographic namespace
- [x] concurrency tests prove one-partner occupancy

# P3: Partnership Lifecycle, Breakup, Deletion, and Cooldowns

Status: DONE

## Design status

The hardened P3 runtime architecture and implementation sequence are defined in:

`docs/architecture/P3_PARTNERSHIP_LIFECYCLE_DESIGN.md`

P3 was implemented and verified on:

`feat/p3-partnership-lifecycle`

created from verified `main @ 04b5229`. Executed closure evidence was recorded at `36bfb6b`, final repo-wide closure documentation at `9820801`, and the verified branch was fast-forward merged to `main @ 9820801`.

The pre-implementation refinement preserves the verified P2 boundaries and reuses F2 durable workers plus A1 account-deletion authority. It introduces one canonical partnership-dissolution kernel shared by normal breakup and permanent account-deletion paths, breakup-process generation fencing, synchronous authorization revocation before asynchronous cleanup, explicit cooldown hygiene, and server-derived former-partner blocking.

## Current implementation progress

P3-A through P3-H source implementation is committed, verified, and merged into main.

Implemented repository surface includes:

- refined one-hour cancellation and restoration boundary rules
- explicit breakup-initiation capability and lifecycle denial vocabulary
- lifecycle contracts and expanded current-partnership projection
- migration 0010 with cancellation/supersession markers, cooldown/block hardening, indexes, and one-partnership-manifest uniqueness
- lifecycle repositories, idempotency, former history, cooldown hygiene, and block persistence
- breakup initiation, unilateral cancellation, restore intent, one-time day-ten extension, mutual restoration, and replay-safe lifecycle mutations
- generation-fenced breakup finalizer and deadline reminder
- one canonical dissolution kernel shared by breakup and permanent account deletion
- synchronous membership release before asynchronous destructive cleanup
- exact three-calendar-month breakup cooldown and one-calendar-month permanent-partner-deletion cooldown
- A1 account-deletion/recovery lifecycle integration
- former-partner history, block/unblock, discovery/request invalidation, and re-pair prevention
- durable lifecycle notifications and serious-event email orchestration
- partnership relational and crypto-state deletion targets
- browser breakup, restore, view-only deletion, lifecycle-notification, and former-block flows
- API, worker, race, security, migration, and regression verification suites
- disposable `test:p3:local` PostgreSQL harness

Local closure is verified by lifecycle domain/contracts 28/28, P3 security 6/6, all ten migrations from zero, passing database invariants, and the disposable PostgreSQL/API/worker integration matrix 39/39 with `P3_LOCAL_POSTGRES_PASS`. Full repository health passes with Domain 48/48, Contracts 17/17, API unit/security 22/22, Worker 4/4, and all static/build checks green. The high-severity dependency audit reports 0 vulnerabilities.

## Implemented sequence

### P3-A Domain and contracts

Implemented.

### P3-B Migration 0010 and repositories

Implemented.

### P3-C Breakup API and lifecycle read model

Implemented.

### P3-D Deadline worker and reminders

Implemented.

### P3-E Canonical dissolution and A1 integration

Implemented.

### P3-F Cooldowns and former-partner blocking

Implemented.

### P3-G Browser lifecycle UI

Implemented.

### P3-H Integration closure harness

Implemented and verified by the complete local matrix, repository health, and dependency audit.

## Scope

- persisted breakup process
- restoration workflow
- notifications
- deadline worker integration
- account-deletion collision behavior
- final dissolution
- deletion-manifest trigger
- cooldown persistence
- blocking

## Acceptance gates

- [x] refined pure domain state transitions are implemented
- [x] refined pure capability rules are implemented
- [x] refined domain boundary tests pass
- [x] breakup initiation persists atomically
- [x] one-hour cancellation persists and invalidates stale scheduled work
- [x] first restore intent extends the deadline exactly once
- [x] restoration intent cannot be withdrawn
- [x] second restore intent restores the same partnership
- [x] worker finalizes at day 7 when neither restores
- [x] worker finalizes at day 10 when only one restores
- [x] stale finalizer cannot dissolve a restored or newer state
- [x] account deletion during breakup preserves original breakup deadline
- [x] account recovery does not reset an existing breakup deadline
- [x] earlier breakup deadline wins over later account-deletion deadline
- [x] final breakup dissolution starts exact three-calendar-month cooldown
- [x] permanent account deletion from active partnership starts exact one-calendar-month cooldown for remaining partner
- [x] final dissolution revokes realtime and mutation authorization before cleanup completes
- [x] deletion manifest is created for destructive cleanup
- [x] former-partner blocking is available only after final dissolution
- [x] blocking prevents discovery, requests, and re-pairing
- [x] minimal serious-event email notifications are emitted
- [x] API, database, worker, race, and security tests pass

# M1: Messaging Core

Status: DONE; combined integration validated and merged to `main @ d7d95a6`

Verified closure commit:

`aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`

Branch:

`feat/m1-messaging-core`

Design:

`docs/architecture/M1_MESSAGING_CORE_DESIGN.md`

API contract:

`docs/api/M1_MESSAGING_API.md`

Migration ownership:

- `0011_messaging_core_runtime.sql`
- `0012_messaging_interaction_runtime.sql`

R1 reserves migrations 0013 and 0014. M1 does not change that reservation or R1 scope.

The integrated source uses M1 head `b29b095` and R1 head `9bc9ba4` on `integration/m1-r1`. Source integration is anchored at `01fa182`; exhaustive combined technical validation is anchored at `5db7a94183bca153d142389d7188e3887653a9ec`. Canonical migrations 0001 through 0014 run with `reserved=0`, and R1 is DONE.

## Scope

- one primary conversation per current partnership
- text messaging
- replies with stable tombstone-safe reply context
- stable IDs
- deterministic server message sequence
- separate durable mutation change sequence
- idempotent sends and mutations
- 30-minute edits with optimistic content-version checks
- deletion tombstones
- reactions
- delivery and read receipts
- typing indicators
- online and last-seen state
- shared nicknames
- content-free durable invalidation metadata for later M2 transport
- exact P3 breakup and account-deletion integration
- cross-partnership isolation

M1 intentionally keeps HTTP and PostgreSQL authoritative. WebSocket delivery, IndexedDB offline queues, reconnect orchestration, and physical-device lifecycle acceptance belong to M2.

## Refined architecture decisions

- a primary conversation is created transactionally with future partnership formation and backfilled for current partnerships
- `server_sequence` orders message creation only
- a separate `change_sequence` orders every durable send/edit/delete/reaction mutation
- content-free `conversation_changes` rows make old-message edits, deletes, and reactions recoverable by polling and later M2 reconnect
- M1 emits versioned content-free outbox invalidations in the same mutation transaction; delivery remains non-authoritative
- send idempotency uses the existing sender/conversation uniqueness plus a versioned keyed request fingerprint
- ordinary unkeyed hashes of private message text are not accepted as durable mismatch verifiers
- sender device identity comes only from the authenticated session
- breakup initiation snapshots the last committed message sequence as `message_freeze_sequence`
- pre-breakup freeze uses sequence cutoff first and timestamp fallback only for legacy breakup rows
- pre-S1 development plaintext exists only for current message/reaction content in explicitly named plaintext fields
- M1 does not persist plaintext edit history
- edits require `expectedContentVersion` and stale concurrent edits fail with `VERSION_CONFLICT`
- read and delivery state use monotonic conversation-member high-water marks
- typing is short-lived transient state with server-owned TTL, refresh bounds, and rate limits
- presence stores only the current snapshot, but disclosure is bounded to activity at or after the current partnership's activation
- nickname metadata is partnership-scoped, versioned, and classified as protected partnership content for the later S1 decision
- interaction/page/idempotency limits live in one centralized server-owned configuration surface
- final dissolution synchronously removes authorization and module-owned messaging cleanup composes with the verified P3 deletion kernel
- no M1 operational metadata, change row, outbox event, or idempotency response may duplicate private message content

## Current implementation state

M1-A through M1-H are implemented and locally verified on `feat/m1-messaging-core`, including migrations 0011/0012, repositories, lifecycle integration, HTTP APIs, browser chat, content-free pre-M2 outbox invalidation handling, and the local PostgreSQL closure harness.

On 2026-09-22, the closure harness applied migrations 0001 through 0012 from zero, passed database invariants, and passed 64/64 PostgreSQL/API/worker tests. M1 security passed 17/17, full repository health passed with Domain 51/51, Contracts 22/22, API unit/security 31/31, and Worker 4/4, `git diff --check` passed, and the high-severity dependency audit reported 0 vulnerabilities. This executed evidence closes all 18 M1 gates at `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`. Hosted GitHub Actions verification remains separate under V1.

## Implementation sequence

### M1-A Domain refinement and contracts

- sequence-based breakup message freeze
- legacy timestamp fallback
- messaging-specific capability helpers over the existing P3 lifecycle boundary
- message/reaction/nickname contracts
- server-sequence history contracts
- durable change-feed contracts
- receipt, presence, and typing contracts
- keyed private-request fingerprint contract
- centralized interaction limits

### M1-B Migrations and repositories

- migration 0011 messaging core runtime
- migration 0012 messaging interaction runtime
- primary conversation provisioning
- server sequence plus durable change sequence
- content-free conversation change ledger
- message sequencing/idempotency repositories
- optimistic current-content edits without plaintext version history
- tombstones
- reactions
- receipts
- nicknames
- presence
- typing
- module-owned messaging cleanup
- deletion integration

### M1-C Core read and send API

- current conversation projection with latest server and change sequences
- bounded server-sequence history pagination
- bounded durable change-feed polling
- send and reply
- stable tombstone-safe reply context
- retry replay
- keyed request-fingerprint mismatch denial
- receipt acknowledgement
- content-free versioned outbox invalidation

### M1-D Message mutation API

- edit with `expectedContentVersion`
- delete
- reactions
- exact 30-minute boundary
- breakup sequence freeze
- durable change/outbox invalidation for every committed mutation

### M1-E Shared chat interaction

- nicknames
- presence
- typing
- compact interaction state
- activation-bounded presence disclosure
- centralized write-rate and TTL controls

### M1-F Browser core

- chat history
- durable mutation polling
- composer
- replies
- edit/delete
- reactions
- delivery/read state
- typing/presence
- nickname UI
- stale-edit conflict handling
- lifecycle-aware controls

### M1-G Lifecycle, synchronization, deletion, race, and security hardening

- concurrent sends
- concurrent mutation change-sequence allocation
- send versus breakup
- send versus account deletion
- mutation versus breakup
- edit versus edit
- edit versus delete
- reaction versus delete
- final dissolution races
- old-message mutation recovery through change cursor
- module-owned deletion proof
- cross-partnership denial
- pre-partnership presence privacy
- private-content non-duplication guards
- keyed-fingerprint security guards
- content-free change/outbox proof

### M1-H Closure harness and documentation

- `test:messaging-core`
- `test:m1:security`
- `test:m1:postgres`
- `test:m1:local`
- full health
- dependency audit
- repo-wide documentation closure from executed evidence

## Acceptance gates

- [x] one primary conversation exists per active partnership
- [x] message sends are idempotent
- [x] server sequence provides deterministic ordering
- [x] replies reference valid partnership messages
- [x] edits are allowed only within the 30-minute window
- [x] edited indicator is visible
- [x] deletion removes message content for both and preserves tombstone
- [x] default reactions are available
- [x] add-emoji reaction path works
- [x] read receipts are always on
- [x] typing indicators are always on
- [x] online status and last seen follow product rules
- [x] nicknames are shared and visible to both partners
- [x] breakup_pending preserves new messages and replies
- [x] pre-breakup messages cannot be edited, deleted, or reacted to during breakup_pending
- [x] nickname changes remain allowed during breakup_pending
- [x] cross-partnership message access tests fail closed
- [x] API and security regression tests pass, including durable mutation synchronization, stale-edit conflict, keyed-fingerprint, presence-privacy, bounded-interaction, deletion-composition, and content-free invalidation evidence

M1 is DONE at 18/18 acceptance gates, has passed combined integration validation, and is merged to `main @ d7d95a6`.

# M2: Realtime and Offline Reliability

Status: IN_PROGRESS

Branch:

`feat/m2-realtime-offline`

Base:

`main @ 9f4237e90c4d289f8b316e5d8dd2bba41609c95d`

Architecture:

`docs/architecture/M2_REALTIME_OFFLINE_DESIGN.md`

Realtime protocol:

`docs/api/M2_REALTIME_PROTOCOL.md`

Design state:

Refined architecture, protocol, failure behavior, local schema, offline queue policy, implementation slices, and closure evidence are defined. Runtime implementation has not started.

## Scope

- authenticated WebSocket using the existing server session
- exact trusted-Origin upgrade enforcement
- server-derived account/partnership/conversation realtime scope
- content-free versioned invalidations
- F2 outbox to PostgreSQL NOTIFY low-latency fanout
- canonical HTTP resynchronization
- separate `server_sequence` and `change_sequence` repair
- IndexedDB local schema version 1
- account/partnership/conversation/content-context namespace isolation
- typed offline chat queue
- typed safe-whitelist R1 queue
- lifecycle-aware replay
- service-worker app-shell/static caching only
- update compatibility
- browser automation
- physical Android closure

M2 does not own media transport, call signaling, E2EE, or cryptographic recovery.

M2 is expected to require no PostgreSQL migration. Migration 0015 is not reserved merely for M2.

## Implementation sequence

### M2-A Protocol, contracts, and compatibility

- protocol version 1
- strict client/server frame unions
- internal NOTIFY envelope schema
- frame size ceilings
- local schema v1 types
- unknown critical versions fail closed

### M2-B Authenticated WebSocket and scope

- Fastify WebSocket endpoint
- exact Origin
- session authentication
- protocol negotiation
- connection hub
- server-derived scope
- liveness
- bounded backpressure
- session/scope revalidation
- graceful shutdown

### M2-C Durable invalidation publisher

- RealtimePublisher port
- PostgreSQL NOTIFY publisher
- dedicated API LISTEN connection
- M1 outbox invalidation delivery
- content-free receipt/nickname/partnership/R1/account-security invalidations
- explicit handler ownership

### M2-D Client realtime and canonical sync

- realtime client state machine
- single-flight SyncCoordinator
- message change repair
- history-gap repair
- R1 invalidation/refetch
- duplicate/out-of-order coalescing
- foreground/network reconnect
- polling fallback

### M2-E IndexedDB namespace and cache

- per-account local database
- namespaceMeta
- conversationSync
- messages
- relationshipItems
- relationshipMeta
- chatOutbox
- relationshipOutbox
- atomic data+cursor commits
- bounded cache
- purge boundary

### M2-F Offline chat queue

- message send/edit/delete/reaction
- stable idempotency
- expected content version
- retry classification
- pending UI state
- no fake server sequence
- receipt high-water state

### M2-G Offline R1 queue

- separate typed queue
- safe operation whitelist
- expectedVersion
- conflict UX
- lifecycle preflight
- no offline release/open/reveal/schedule transition

### M2-H Service worker and compatibility

- app-shell/static cache only
- never cache private API
- controlled waiting-worker activation
- replay pause during update
- IndexedDB compatibility
- update-required mode

### M2-I Integration, security, and physical device

- security suite
- PostgreSQL/API/worker integration
- real browser offline suite
- multi-tab safety
- physical Android foreground/background/network tests
- full health
- audit

## Acceptance gates

- [ ] WebSocket authenticates with the existing server-managed session and exact trusted Origin
- [ ] client cannot subscribe to arbitrary account, partnership, conversation, message, or R1 scopes
- [ ] unsupported critical realtime protocol versions fail closed
- [ ] internal NOTIFY and browser realtime frames contain no protected content
- [ ] realtime frame size and rate limits are enforced
- [ ] stale or revoked sessions cannot retain realtime authorization
- [ ] duplicate realtime delivery is safe
- [ ] out-of-order realtime delivery is safe
- [ ] missed realtime delivery is repaired through canonical HTTP state
- [ ] `change_sequence` repairs sends, edits, deletes, and reactions without being replaced by `server_sequence`
- [ ] `server_sequence` repairs required history gaps without becoming mutation synchronization order
- [ ] local cursor advancement is atomic with corresponding canonical projection persistence
- [ ] PostgreSQL NOTIFY loss or listener restart does not break correctness
- [ ] offline message send survives reload and replays with the same idempotency key
- [ ] queued edits preserve `expectedContentVersion` and cannot extend the 30-minute edit window
- [ ] queued mutation is blocked or rejected when authoritative lifecycle changed while offline
- [ ] R1 offline replay is limited to an explicit safe operation whitelist
- [ ] recipient-open, creator-reveal, and scheduled-release transitions remain online and server-authoritative
- [ ] IndexedDB is partitioned by account, partnership, conversation, and explicit content context
- [ ] pre-S1 local persistence does not invent fake encryption or crypto epochs
- [ ] explicit logout, account switch, or observed revocation cannot expose previous account local plaintext
- [ ] final dissolution removes old partnership UI state before replay and purges the old local namespace
- [ ] a future partnership cannot render or replay previous-partnership cache or queue entries
- [ ] service worker never caches private/no-store API responses
- [ ] incompatible service-worker/client/local-schema state fails closed before mutation replay
- [ ] multi-tab duplicate realtime delivery and duplicate offline replay remain correctness-safe
- [ ] reconnect, offline, service-worker, and IndexedDB browser automation passes
- [ ] full `npm run health` and high-severity dependency audit pass
- [ ] physical Android M2 acceptance passes

# M3: Media and Voice Messages

Status: PLANNED

## Scope

- image upload
- video upload
- general file upload
- voice-message recording
- client-side media processing
- private object storage
- signed access
- attachment authorization
- encrypted-media boundary

## Acceptance gates

- [ ] configured attachment limits are enforced
- [ ] client-side image processing follows product limits
- [ ] object keys are opaque and do not contain private filenames
- [ ] storage objects are private
- [ ] signed access is short-lived and partnership-authorized
- [ ] attachment IDs cannot cross partnership boundaries
- [ ] unauthorized object retrieval fails
- [ ] encrypted-media path is compatible with stable-release E2EE
- [ ] media is included in deletion manifests
- [ ] final dissolution removes media access immediately
- [ ] storage cleanup retries safely
- [ ] physical Android media and voice-message flows pass

# C1: Voice and Video Calling

Status: PLANNED

## Scope

- call signaling
- voice calls
- video calls
- accept
- reject
- cancel
- missed state
- call history
- TURN credential issuance
- relay-first privacy
- breakup call consent

## Acceptance gates

- [ ] calls require authenticated partnership authorization
- [ ] calls never auto-answer
- [ ] breakup_pending calls require explicit acceptance for every call
- [ ] short-lived TURN credentials are issued only after authorization
- [ ] permanent TURN credentials are not embedded in the client
- [ ] expired TURN credentials fail
- [ ] relay-first behavior is verified where supported
- [ ] TURN/TCP or TURN/TLS fallback is tested where supported
- [ ] call history is partnership-scoped
- [ ] call history is deleted at final dissolution
- [ ] account-deletion view-only state disables calling
- [ ] call interruption and reconnect behavior is safe
- [ ] physical-device voice and video tests pass

# R1: Relationship Space

Status: DONE

Branch:

`feat/r1-relationship-space`

Architecture:

`docs/architecture/R1_RELATIONSHIP_SPACE_DESIGN.md`

API contract:

`docs/api/R1_RELATIONSHIP_SPACE_API.md`

Migration ownership:

- `0013_relationship_space_runtime.sql`
- `0014_relationship_space_interaction_runtime.sql`

Migration ownership boundary:

- M1 owns 0011 and 0012
- R1 owns 0013 and 0014
- R1 must not create, rename, or modify M1 migration numbers

Architecture/design and R1 source implementation are complete on `feat/r1-relationship-space` at source head `9bc9ba4`. M1 runtime closure remains anchored at `aa40a2c` with source head `b29b095`. The sources are integrated at `01fa182` and exhaustively validated together at `5db7a94183bca153d142389d7188e3887653a9ec`, so R1 is DONE.

## Current implemented progress

Completed source implementation includes:

- R1 domain policies, capability refinements, date and release predicates
- explicit Zod contracts for every R1 kind and mutation
- migrations 0013 and 0014 plus database invariants
- relationship-space repositories and durable release scheduling
- private API home/list/detail/create/update/delete/release/experience routes
- keyed idempotency receipts and partnership-bound keyed cursors
- optimistic version checks and race-safe shared curation handling
- account-deletion pause/recovery wake and P3 dissolution cancellation hooks
- responsive browser Relationship Space with lifecycle view-only modes
- Our Story, Someday, reunion planning, signals, derived experiences, saved curations, Surprise and Proposal rendering
- day/month/year/unknown occurrence entry and schedule rescheduling
- resolver-gated message/media/Voice Letter references
- R1 security, API integration, worker integration, and local PostgreSQL harnesses

Historical isolated R1 branch validation used reservations for M1-owned 0011/0012 rather than copying M1 SQL. The integrated `test:r1:local` harness now uses the real M1 migrations and no reservation.

The source implementation above is complete. Historical isolated evidence was green at 68/68. Final integrated evidence is now also green: real migrations 0001 through 0014 apply with `reserved=0`, database invariants pass, R1 security passes 13/13, the combined PostgreSQL/API/worker matrix passes 69/69 with `R1_LOCAL_POSTGRES_PASS`, the positive same-partnership M1 message-reference seam passes without copying message plaintext, full repository health passes with Domain 60/60, Contracts 29/29, API unit/security 44/44, and Worker 4/4, and the high-severity audit reports 0 vulnerabilities.

## Scope

- Relationship Home
- Our Story
- Remember This
- Firsts
- Places We Became Us
- For You
- Voice Letter attachment model
- Future Us
- Love
- Someday
- This Day in Us
- Our Year
- Anniversary Experience
- Surprise Mode
- Until We're Together Again
- Proposal Mode
- explicit relationship signals
- P3 lifecycle integration
- scheduled-release durability
- mutation idempotency
- deletion and future-partnership isolation
- responsive relationship-space browser surface

R1 does not own M1 messaging persistence, M2 realtime/offline queues, M3 media transport, or S1 E2EE.

## Refined architecture decisions

- immutable partnership ID is the relationship-space namespace authority
- existing `relationship_items` remains the aggregate root
- protected preview and protected main payloads are separated for release-gated items
- pre-S1 preview/main plaintext uses explicitly named development fields and never ciphertext fields
- S1 later encrypts preview and main separately so the server can expose preview while withholding sealed content
- normalized year/month/day components preserve occurrence precision without inventing dates
- historical occurrence dates cannot be in the future under trusted PostgreSQL UTC date
- February 29 anniversaries use February 28 in non-leap years
- authored content is creator-owned by default; only explicitly shared state such as Someday, reunion, and saved curation is pair-mutable
- every state-changing R1 endpoint uses Idempotency-Key
- private request fingerprints are domain-separated server-keyed HMACs, never raw unkeyed hashes of relationship content
- Our Story uses explicit membership plus one precision-aware deterministic ordering rule
- Remember This creates an independent client-supplied R1 snapshot and never makes the server copy M1 plaintext
- message references are accepted only when an M1 resolver is registered
- Voice Letter is a media reference role, not a standalone relationship item
- media/voice references are accepted only when an M3 resolver is registered
- Places coordinates remain protected content and never enter routine logs or analytics
- For You and Future Us support immediate, scheduled, and recipient-open release
- Surprise and Proposal support immediate or creator-reveal release
- Surprise/Proposal private sequence content stays inside the protected container payload instead of generic linked child items
- scheduled actions use item release-generation fencing and content-free durable payloads
- breakup permits only the explicit preconfigured scheduled-release exception
- account-deletion view-only pauses all unreleased delivery transitions
- account recovery preserves original unlock time/generation and wakes due paused work safely
- destructive lifecycle deadline wins over release at exact equality and when finalization is late
- final dissolution remains P3-owned
- curation target deletion updates surviving curation owner versions explicitly instead of silently cascading
- cross-partnership IDs, links, references, cursors, and replays fail closed
- browser capability state remains advisory

## Implementation sequence

### R1-A Domain model and contracts

- stable item kinds and feature policy matrix
- preview/main content roles
- normalized occurrence precision
- release modes and release generation
- creator versus shared-state permissions
- mutation idempotency contracts
- privacy-safe cursor contracts
- capability refinements
- derived experience date rules

### R1-B Migrations 0013 and 0014 plus repositories

- relationship-item root refinement
- explicit pre-S1 preview/main plaintext fields
- encrypted-preview compatibility field
- normalized occurrence components
- feature state tables
- same-partnership curation/prepared-content links
- loose external references
- Our Story membership
- relationship-event hardening
- indexes and invariants
- explicit incoming-link cleanup/versioning
- deletion-safe foreign-key behavior

### R1-C Relationship Home and core CRUD API

- private aggregate home read model
- list/detail/create/update/delete
- all-mutation lost-response idempotency
- expectedVersion conflict handling
- creator/shared-state authorization
- lifecycle authorization
- privacy-safe not-found behavior
- no-store response policy
- defensive payload/reference/link bounds

### R1-D Delivery and release state

- For You
- Future Us
- Surprise
- Proposal
- immediate
- scheduled
- recipient-open
- creator-reveal
- preview versus sealed projection
- release-generation fencing
- durable scheduled worker
- account-deletion pause/recovery wake
- destructive-deadline precedence
- stale/cancel/supersession handling

### R1-E Structured relationship features

- Our Story
- Remember This
- Firsts
- Places We Became Us
- Love
- Someday
- explicit relationship signals
- reunion date
- M1/M3 reference-resolver integration points

### R1-F Derived and curated experiences

- precision-aware timeline order
- This Day in Us
- Our Year
- Anniversary Experience
- February 29 behavior
- Surprise rendering
- Until We're Together Again
- Proposal rendering
- deterministic eligibility only

### R1-G Browser Relationship Space

- dedicated responsive Relationship Space
- home and feature navigation
- creator-owned and pair-shared mutation controls
- preview/sealed release UI
- recipient-open and creator-reveal flows
- lifecycle view-only modes
- account-deletion paused-state rendering
- schedule rendering
- derived experience rendering
- namespace reset after partnership change or termination

### R1-H Lifecycle, race, deletion, and security hardening

- all mutation lost-response replays
- idempotency key reuse with different private payload
- concurrent shared-state edits
- update versus delete
- linked target delete versus curation update
- release versus content edit
- release versus schedule edit
- release versus breakup
- release versus account deletion
- recovery wake versus breakup deadline
- release versus restoration
- release versus final dissolution
- late finalizer at destructive deadline
- create/update/delete versus breakup
- mutation versus final dissolution
- account recovery preserving identity and versions
- guessed foreign item IDs
- cross-partnership link/reference attempts
- resolver-unavailable behavior
- duplicate scheduled-action claims
- deletion target crash/reclaim
- preview/sealed premature-disclosure tests
- protected plaintext/hash non-duplication
- location-coordinate log exclusion

### R1-I Closure harness and documentation

Planned command surface:

```text
npm run test:relationship-space
npm run test:r1:security
npm run test:r1:postgres
npm run test:r1:local
npm run health
npm audit --audit-level=high
```

The integrated command surface has executed successfully through `test:r1:local`, strict canonical migrations, and full `health`. The integrated harness uses the real M1 migration chain and no reservations.

## Acceptance gates

- [x] migrations 0001 through 0014 apply from zero in canonical order after verified M1 migrations are available
- [x] migrations 0001 through 0010 remain unchanged
- [x] R1 does not create or modify migrations 0011 or 0012
- [x] relationship-item database invariants include composite same-partnership keys and immutable identity
- [x] every R1 kind/contentSchemaVersion has explicit contract coverage
- [x] development preview/main plaintext is never mislabeled as ciphertext
- [x] intended recipient cannot receive sealed main content before release
- [x] no R1 plaintext or raw private request hash appears in logs, events, queues, notifications, traces, analytics, or idempotency response bodies
- [x] Relationship Home is partnership-scoped, bounded, deterministic, and private/no-store
- [x] every state-changing endpoint has exact lost-response idempotency
- [x] same idempotency key with different private request fails deterministically
- [x] expectedVersion conflicts never silently overwrite current state
- [x] creator-owned content cannot be edited/deleted by the other partner
- [x] pair-mutable state follows the documented policy matrix
- [x] foreign, deleted, unreleased-hidden, and random item IDs fail with privacy-safe behavior
- [x] Our Story preserves precision and uses one deterministic mixed-precision order
- [x] future historical occurrence dates are rejected using trusted UTC date
- [x] February 29 anniversary behavior is deterministic
- [x] Remember This survives source disappearance without server-side copying M1 plaintext
- [x] message references require the registered M1 resolver; invalid or foreign messages fail closed
- [x] media and Voice Letter references are rejected until an M3 resolver is registered
- [x] Voice Letter visibility is inherited from its containing relationship object
- [x] Places coordinates are explicit only and never collected in background
- [x] For You/Future Us scheduled release uses durable generation-fenced work
- [x] recipient-open exposes preview but not main content until explicit open
- [x] Surprise/Proposal creator-reveal keeps main sequence unavailable before reveal
- [x] unknown content schema versions and durable payload versions fail closed
- [x] duplicate scheduled claims cannot release twice
- [x] breakup makes normal R1 mutations view-only while preconfigured scheduled release may continue strictly before destructive deadline
- [x] account-deletion overlay pauses all unreleased delivery transitions
- [x] account recovery wakes due paused work without changing unlock time or release generation
- [x] destructive deadline wins over release at exact equality and when finalization is late
- [x] restoration preserves item IDs, versions, curation, and schedule identity
- [x] final dissolution synchronously ends R1 authorization and replay access
- [x] final dissolution deletes every R1 authoritative row through P3 deletion architecture
- [x] user item deletion leaves no protected R1 content in supporting/history tables
- [x] deleting a linked target explicitly updates surviving curation owner versions
- [x] stale work for deleted/dissolved objects becomes safe stale/no-op
- [x] deletion crash/reclaim remains retry-safe and fenced
- [x] future partnership cannot access old R1 data
- [x] relationship signals are explicit user actions only
- [x] no feature computes relationship quality, emotion, compatibility, breakup risk, responsiveness, or engagement score
- [x] This Day in Us uses exact eligible day precision only
- [x] Our Year and Anniversary are deterministic and unranked by engagement
- [x] Surprise/Proposal sequence content cannot leak through generic item-link traversal
- [x] reunion target date is manual, trusted-date validated, and has no location surveillance
- [x] browser lifecycle modes match authoritative server capability
- [x] R1 browser builds successfully without physical Redmi acceptance
- [x] P1, P2, and P3 regressions remain green
- [x] full `npm run health` passes
- [x] `npm audit --audit-level=high` passes


Integrated closure evidence: `integration/m1-r1 @ 5db7a94183bca153d142389d7188e3887653a9ec` passed the exhaustive 40-gate local validation sweep, including canonical 0001 through 0014 migrations with no reservations, R1 69/69, M1 64/64, full health, audit, whitespace, clean worktree, and SHA parity.

# S1: E2EE and Cryptographic Recovery

Status: PLANNED

## Scope

- reviewed protocol selection
- device cryptographic identity
- partnership cryptographic roots
- crypto epochs
- message encryption
- relationship-object encryption
- attachment encryption
- device enrollment
- device revocation
- encrypted recovery material
- recovery secret
- metadata minimization
- protocol versioning
- lifecycle cryptographic deletion

## Acceptance gates

- [ ] exact protocol and maintained implementation are documented and reviewed
- [ ] no custom cryptographic protocol is introduced
- [ ] every device has independent cryptographic identity
- [ ] every new partnership starts with new cryptographic root state
- [ ] crypto epoch transition is defined and tested
- [ ] server cannot read protected message plaintext
- [ ] server cannot read protected relationship-object plaintext
- [ ] media is encrypted before upload
- [ ] database and object-storage inspection shows ciphertext for protected content
- [ ] email-only account recovery cannot decrypt historical E2EE data
- [ ] trusted-device or recovery-secret restoration is tested
- [ ] server never possesses the plaintext recovery secret
- [ ] revoked device stops receiving future protected content
- [ ] future partnership cannot decrypt previous partnership data
- [ ] deletion integrates cryptographic erasure and physical cleanup
- [ ] official or reviewed protocol test vectors pass where available
- [ ] threat model and data classification are updated for the selected protocol
- [ ] stable-release cryptographic review passes

# R2: Public Readiness

Status: PLANNED

## Scope

- CI completion
- security scanning
- privacy documentation
- abuse reporting
- backup and restore
- deletion verification
- operational observability
- provider configuration
- release process
- browser acceptance
- physical-device acceptance
- security review
- staged launch

## Acceptance gates

- [ ] V1 Hosted CI Verification is DONE
- [ ] all stable-release PRD gates are satisfied
- [ ] required CI checks are green
- [ ] no unresolved critical or high security finding blocks release
- [ ] dependency and secret scanning are green
- [ ] privacy documentation matches actual implementation
- [ ] threat model matches actual deployed architecture
- [ ] data-classification matrix matches actual storage and providers
- [ ] deletion manifest failure and resume behavior is tested
- [ ] backup restore cannot resurrect deleted user-facing access
- [ ] monitoring covers critical API, worker, outbox, deletion, media, realtime, call, and email failure classes
- [ ] release and migration runbook is tested
- [ ] supported browser E2E suite passes
- [ ] physical Android acceptance passes
- [ ] voice and video privacy acceptance passes
- [ ] E2EE release review passes
- [ ] staged launch rollback path is documented and tested

# X1: Post-stable Maturity

Status: PLANNED

## Purpose

Stabilize the released product and gather real operational evidence before adding storage-heavy or infrastructure-heavy features.

X1 begins only after R2 Public Readiness is DONE and the first stable release is live.

## Scope

- production reliability and incident follow-up
- real storage and bandwidth measurement
- media growth and deletion-cost measurement
- worker and deletion-manifest operational evidence
- calling quality and failure-rate evidence
- retention and backup cost evidence
- user demand evidence for expensive optional features
- targeted performance and cost optimization
- native clients only if justified by real product evidence
- infrastructure extraction only when measured production needs justify it

Call recording is explicitly excluded from X1.

## Acceptance gates

- [ ] stable release has meaningful operational evidence
- [ ] storage and bandwidth baselines are measured
- [ ] media deletion and backup-expiry behavior is proven operationally
- [ ] calling reliability and usage are measured
- [ ] major post-release reliability defects are addressed or explicitly accepted
- [ ] cost drivers are documented well enough to evaluate storage-heavy features

# X2: Deferred Heavy Features

Status: DEFERRED

## Purpose

Hold optional features with disproportionate storage, bandwidth, privacy, legal, deletion, cryptographic, or infrastructure cost until post-stable evidence justifies them.

X2 is not required for stable release and does not begin automatically when X1 starts.

## Initial candidate

- consensual call recording

Call recording should be implemented only if post-stable usage evidence and economics justify it.

Before implementation begins, choose and document the storage model. Options may include encrypted cloud storage with quotas, paid storage, local-device-only recording, short-retention export workflows, audio-only recording, or deciding not to ship recording.

## Entry gates for call recording

- [ ] X1 Post-stable Maturity has enough production evidence to evaluate the feature
- [ ] user demand justifies the feature
- [ ] projected storage and bandwidth cost is acceptable
- [ ] recording retention and quota model is defined
- [ ] deletion and backup-expiry cost is acceptable
- [ ] recording architecture is compatible with the reviewed E2EE model
- [ ] privacy and legal feasibility is confirmed before implementation

## Acceptance gates for call recording

- [ ] explicit consent from both participants is required for every recording session
- [ ] previous consent cannot be reused automatically
- [ ] recording indicator is visible
- [ ] recording is E2EE-compatible
- [ ] both partners can access authorized recording
- [ ] recording follows partnership-scoped deletion
- [ ] final dissolution deletes recording
- [ ] permanent account deletion removes recording with partnership data
- [ ] export behavior is defined
- [ ] retention behavior is defined
- [ ] privacy and legal review is complete
- [ ] threat model and data classification are updated
- [ ] dedicated security tests pass

## Progress reporting rules

When reporting progress:

- do not use unsupported percentage estimates
- distinguish domain-only implementation from persistence, API, worker, UI, and device completion
- mark an epic DONE only after every required gate is complete
- identify blockers explicitly
- cite concrete repository evidence where possible
- update PROJECT_STATE only with verified implementation
- update this document when gates materially change

## Epic completion checklist

Before changing any epic to DONE:

1. verify every required gate
2. run relevant automated tests
3. run required browser or physical-device tests
4. verify migrations where applicable
5. verify security regressions
6. update documentation
7. update PROJECT_STATE
8. update ROADMAP
9. record any architecture deviation through governance
10. confirm no known blocker contradicts DONE status
