# Roadmap

## Principle

Build lifecycle correctness and security boundaries before storing valuable user content.

## Canonical epic tracking

Detailed implementation epics, dependencies, statuses, and acceptance gates are defined in:

`docs/ROADMAP_EPICS.md`

The phase list below remains the high-level sequence.

An epic is DONE only when every required acceptance gate is satisfied or explicitly documented as not applicable.

Do not infer completion percentages from partial layers.

## Phase 0: Architecture Foundation

- monorepo configuration
- TypeScript baseline
- linting and formatting
- CI: baseline workflow configured, hosted validation pending
- repository-health scanner: configured
- CODEOWNERS and SECURITY policy: configured
- PostgreSQL development environment: disposable Docker environment locally validated
- PostgreSQL schema and migrations: committed and locally validated twice from a blank PostgreSQL 16 database
- domain capability engine: implemented foundation
- database invariants: committed and passing against local disposable PostgreSQL 16
- transaction helpers: canonical account-lock SQL committed, application integration pending
- deterministic two-account locking helper: canonical SQL pattern committed, application helper pending
- durable worker
- transactional outbox: schema committed, runtime integration pending
- scheduled actions: schema and claim SQL committed, runtime integration pending
- scheduled-action generation tokens: domain behavior implemented, persistence pending
- lifecycle event ledger: schema and append-only update protection locally validated against PostgreSQL
- deletion manifest workflow: schema committed, retry integration pending
- runtime contract validation
- API versioning
- client compatibility versioning
- formal threat model: completed
- data classification and handling matrix: completed
- Architecture Baseline 1.0 freeze: completed
- architecture governance and ADR change control: completed
- documentation freshness model and repo-wide status audit: completed
- security headers and browser hardening
- synthetic testkit: initial domain fixtures implemented

## Phase 1: Accounts and Devices

- registration
- age validation
- verified email
- login
- sessions
- password recovery
- secure email change
- account deletion recovery
- device records
- device revocation
- device management UI
- cryptographic recovery boundary
- username rules
- profile rules

## Phase 2: Partnerships

- username discovery
- partner requests
- request rate rules
- reciprocal request auto-pairing
- database-enforced one-partnership occupancy
- manual relationship date
- breakup state machine: pure domain foundation implemented
- restoration
- account-deletion interaction state: pure domain foundation implemented
- one-month and three-month cooldowns: pure domain calculation implemented
- blocking
- lifecycle event ledger coverage

## Phase 3: Messaging

- conversations
- server sequence ordering
- text messages
- replies
- edits
- deletion tombstones
- reactions
- read receipts
- typing
- presence
- shared nicknames
- realtime reconnect
- offline chat outbox

## Phase 4: Media and Calling

- client-side media preparation
- private object storage
- signed media access
- voice messages
- voice calls
- video calls
- short-lived TURN credentials
- relay-first call privacy
- call history
- push notifications
- minimal push payloads

## Phase 5: Relationship Space

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
- separate relationship offline queue where supported

## Phase 6: E2EE

- reviewed protocol selection
- device identity
- partnership crypto epochs
- session establishment
- message encryption
- attachment encryption
- relationship-object encryption
- call-media review
- encrypted recovery material
- trusted-device enrollment
- device revocation behavior
- metadata minimization
- migration plan
- test vectors
- deletion and cryptographic erasure integration

## Phase 7: Public Readiness

- privacy documentation
- abuse controls
- production backup and deletion handling
- dependency and secret scanning
- deletion manifest operational checks
- security regression
- browser E2E
- physical Android acceptance
- call privacy acceptance
- final security review
- staged public launch

## Post-release

- consensual call recording
- recording export and deletion UX
- native clients if justified
- infrastructure extraction only when measured production needs justify it

Microservices and Redis are not roadmap goals by themselves.


## Completed foundation milestone

The first executable domain milestone is complete:

- centralized capability evaluation
- breakup and restoration state transitions
- account-deletion collision behavior
- calendar-month cooldown calculation
- stale breakup generation rejection
- message mutation capability rules
- 27 passing domain tests in local validation

The threat-model and data-classification milestone is also complete.

Architecture freeze and governance are complete. Architecture Baseline 1.0 is now the implementation baseline.

Roadmap epics and acceptance gates are complete as a project-health milestone.

Repository-wide documentation status has been reconciled with the current foundation implementation state.

Current canonical epic status:

- F0: DONE
- F1: IN_PROGRESS with baseline CI and repository health configured
- F2: IN_PROGRESS with local PostgreSQL migration, invariant, schema, and selected concurrency validation complete; worker and CI integration remain
- P3: IN_PROGRESS at the pure domain layer
- remaining implementation epics: PLANNED

The repository-health and baseline CI foundation is configured, but GitHub-hosted execution remains unverified.

The next foundation milestones are completing executable architecture guardrails, automating the locally proven PostgreSQL races, and integrating the durable worker and outbox.
