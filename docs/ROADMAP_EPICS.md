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
X1 Post-release Features
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

Status: IN_PROGRESS

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

GitHub-hosted CI execution is still pending, so hosted CI gates remain incomplete.

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

- [ ] clean clone installs with the documented package-manager command
- [ ] root build command succeeds
- [ ] root typecheck command succeeds
- [ ] root lint command succeeds
- [x] root test command succeeds
- [ ] formatting check succeeds
- [x] `packages/domain` is mechanically prevented from importing React, Fastify, database clients, provider SDKs, or `apps/*`
- [ ] circular dependency checking is active for defined package boundaries
- [ ] external input validation convention is implemented
- [ ] CI runs the required baseline checks on pull requests and has at least one verified hosted run
- [x] baseline secret-pattern and forbidden-secret-file scanning is enabled in repository tooling
- [ ] dependency scanning is active against a committed lockfile
- [ ] documentation contains one canonical bootstrap command
- [ ] no real private data or production secret is present in fixtures
- [x] CI workflow uses explicit read-only permissions, a timeout, and SHA-pinned external actions
- [x] CODEOWNERS and SECURITY.md are present

# F2: Persistence and Worker Foundation

Status: PLANNED

## Scope

- PostgreSQL development environment
- migration system
- database schema foundation
- database constraints
- deterministic multi-account locking
- durable worker
- transactional outbox
- scheduled actions
- generation guards
- lifecycle ledger persistence
- deletion manifests
- idempotency persistence

## Acceptance gates

- [ ] migrations create a clean database from zero
- [ ] migrations are repeatably testable in CI
- [ ] rollback or forward-recovery policy is documented
- [ ] one occupied partnership slot per account is enforced by PostgreSQL
- [ ] current verified email uniqueness is enforced by PostgreSQL
- [ ] idempotency uniqueness is enforced at the database level
- [ ] deterministic two-account locking helper exists
- [ ] concurrent partnership creation cannot create two occupied partnerships
- [ ] worker claims scheduled work safely across multiple worker instances
- [ ] lifecycle-sensitive jobs reject stale generations
- [ ] outbox write occurs in the same transaction as authoritative state mutation
- [ ] duplicate outbox delivery is safe
- [ ] lifecycle events are append-only and contain no private content
- [ ] deletion manifests resume after partial failure
- [ ] PostgreSQL invariant and race tests pass

# A1: Accounts and Devices

Status: PLANNED

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

- [ ] under-18 registration is rejected by server time
- [ ] client clock changes cannot bypass age eligibility
- [ ] email verification codes expire, rate-limit, and reject replay
- [ ] one verified email cannot own two active accounts
- [ ] login and logout work with revocable server sessions
- [ ] password recovery works through verified email
- [ ] email change requires reauthentication and new-email verification
- [ ] old email is notified after successful email change
- [ ] other sessions are revoked after successful email change
- [ ] one-year username change rule is server-enforced
- [ ] username change is blocked while active or breakup_pending
- [ ] old username is released after a successful change
- [ ] one-time DOB correction is server-enforced
- [ ] rejected under-18 DOB correction does not consume the correction allowance
- [ ] account deletion immediately removes account access
- [ ] account recovery works before the seven-day deadline
- [ ] device records exist and sessions can be associated with devices where applicable
- [ ] device revocation revokes authentication access
- [ ] account recovery does not imply historical E2EE key recovery
- [ ] integration and security tests pass

# P1: Discovery and Partner Requests

Status: PLANNED

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
- abuse controls

## Acceptance gates

- [ ] username search exposes only allowed public fields
- [ ] exact DOB and email are never returned
- [ ] pending requests expire exactly seven days after creation
- [ ] sender can cancel before acceptance
- [ ] decline does not create a block
- [ ] same sender cannot exceed three requests to one recipient in a rolling month
- [ ] one-hour post-decline cooldown is enforced
- [ ] multiple incoming requests may coexist
- [ ] self-request is rejected
- [ ] duplicate same-direction pending request is rejected
- [ ] active block prevents discovery and requests as defined by product rules
- [ ] direct API calls cannot bypass request eligibility
- [ ] request race tests pass
- [ ] abuse-rate-limit tests pass

# P2: Partnership Formation and Relationship Date

Status: PLANNED

## Scope

- explicit acceptance
- reciprocal request auto-pairing
- one-partner occupancy
- incompatible request invalidation
- relationship start date
- partnership security context creation

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

# X1: Post-release Features

Status: PLANNED

## Scope

Only post-release work approved after the stable release baseline.

Initial known candidate:

- consensual call recording

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
