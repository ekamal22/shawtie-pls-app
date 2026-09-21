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

P1 detects reciprocal requests but does not create partnerships. P2 owns explicit acceptance and transactional partnership formation.

# P2: Partnership Formation and Relationship Date

Status: IN_PROGRESS

## Design status

The refined architecture and implementation sequence are defined in:

`docs/architecture/P2_PARTNERSHIP_FORMATION_DESIGN.md`

P2 hardened design is complete and the full milestone source is implemented on `feat/p2-partnership-formation`. P2 remains IN_PROGRESS only because local closure verification has not yet been recorded.

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
- competing-accept, accept-versus-reciprocal, metadata-version, and account-deletion race coverage is committed
- P2 security regressions are committed
- P1 local verification is wired to real `paired` mode
- full repository health and dependency-audit execution remain pending
- repo-wide documentation now distinguishes implemented source from verified closure

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

- [ ] normal one-way request requires recipient acceptance
- [ ] reciprocal pending requests create a partnership automatically
- [ ] partnership formation is transactional
- [ ] database invariant prevents simultaneous second partnership
- [ ] incompatible pending incoming and outgoing requests are invalidated
- [ ] relationship start date is manually entered
- [ ] future relationship start date is rejected
- [ ] either partner can update allowed relationship date
- [ ] partner receives relationship-date change notification
- [ ] new partnership creates a fresh local and cryptographic namespace
- [ ] concurrency tests prove one-partner occupancy

# P3: Partnership Lifecycle, Breakup, Deletion, and Cooldowns

Status: IN_PROGRESS

## Current verified progress

Pure domain foundation is implemented and locally validated for:

- breakup initiation
- one-hour initiator cancellation
- restoration intent
- day-ten extension
- mutual restoration
- stale-generation breakup finalization
- three-calendar-month breakup cooldown
- account-deletion recovery overlay
- recovery without resetting existing breakup
- breakup deadline precedence
- one-calendar-month cooldown after permanent partner-account deletion
- relevant capability rules

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

- [x] pure domain state transitions are implemented
- [x] pure capability rules are implemented
- [x] domain boundary tests pass
- [ ] breakup initiation persists atomically
- [ ] one-hour cancellation persists and invalidates stale scheduled work
- [ ] first restore intent extends the deadline exactly once
- [ ] restoration intent cannot be withdrawn
- [ ] second restore intent restores the same partnership
- [ ] worker finalizes at day 7 when neither restores
- [ ] worker finalizes at day 10 when only one restores
- [ ] stale finalizer cannot dissolve a restored or newer state
- [ ] account deletion during breakup preserves original breakup deadline
- [ ] account recovery does not reset an existing breakup deadline
- [ ] earlier breakup deadline wins over later account-deletion deadline
- [ ] final breakup dissolution starts exact three-calendar-month cooldown
- [ ] permanent account deletion from active partnership starts exact one-calendar-month cooldown for remaining partner
- [ ] final dissolution revokes realtime and mutation authorization before cleanup completes
- [ ] deletion manifest is created for destructive cleanup
- [ ] former-partner blocking is available only after final dissolution
- [ ] blocking prevents discovery, requests, and re-pairing
- [ ] minimal serious-event email notifications are emitted
- [ ] API, database, worker, race, and security tests pass

# M1: Messaging Core

Status: PLANNED

## Scope

- conversation creation
- text messaging
- replies
- stable IDs
- server sequence
- idempotency
- edits
- deletion tombstones
- reactions
- read receipts
- typing indicators
- presence
- shared nicknames

## Acceptance gates

- [ ] one primary conversation exists per active partnership
- [ ] message sends are idempotent
- [ ] server sequence provides deterministic ordering
- [ ] replies reference valid partnership messages
- [ ] edits are allowed only within the 30-minute window
- [ ] edited indicator is visible
- [ ] deletion removes message content for both and preserves tombstone
- [ ] default reactions are available
- [ ] add-emoji reaction path works
- [ ] read receipts are always on
- [ ] typing indicators are always on
- [ ] online status and last seen follow product rules
- [ ] nicknames are shared and visible to both partners
- [ ] breakup_pending preserves new messages and replies
- [ ] pre-breakup messages cannot be edited, deleted, or reacted to during breakup_pending
- [ ] nickname changes remain allowed during breakup_pending
- [ ] cross-partnership message access tests fail closed
- [ ] API and security regression tests pass

# M2: Realtime and Offline Reliability

Status: PLANNED

## Scope

- authenticated WebSocket
- server-derived channel membership
- reconnect
- canonical resynchronization
- IndexedDB namespace partitioning
- offline chat queue
- relationship queue
- optimistic concurrency
- client compatibility behavior

## Acceptance gates

- [ ] client cannot subscribe to arbitrary partnership channels
- [ ] missed events are recovered through canonical resynchronization
- [ ] duplicate realtime delivery is safe
- [ ] conversation sequence gaps are repaired
- [ ] offline message retry is idempotent
- [ ] queued mutation is rejected when lifecycle changed while offline
- [ ] local data is partitioned by account, partnership, conversation, and crypto epoch
- [ ] final dissolution purges old partnership local namespace
- [ ] future partnership cannot render old cached partnership data
- [ ] unsupported critical client or realtime version fails closed
- [ ] service-worker update cannot create unsafe client/API compatibility
- [ ] reconnect and offline browser tests pass

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

Status: PLANNED

## Scope

- Relationship Home
- Our Story
- Remember This
- Firsts
- Places We Became Us
- For You
- Voice Letters
- Future Us
- Love
- Someday
- This Day in Us
- Our Year
- Anniversary Experience
- Surprise Mode
- Until We're Together Again
- Proposal Mode
- relationship signals

## Acceptance gates

- [ ] all first-stable relationship features defined by the PRD have implemented data models
- [ ] relationship items are partnership-scoped
- [ ] shared mutable items use version checks where required
- [ ] breakup_pending makes relationship objects view-only
- [ ] scheduled For You and Future Us content still releases during breakup_pending
- [ ] restored partnership returns relationship objects to writable state
- [ ] final dissolution deletes relationship-space data
- [ ] no feature introduces public-social ranking, follower, advertising, or streak mechanics
- [ ] location memories require explicit user-created location data and no passive background tracking
- [ ] relationship-signal actions are explicit and do not infer emotion
- [ ] relationship-space cross-partnership security tests pass

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
