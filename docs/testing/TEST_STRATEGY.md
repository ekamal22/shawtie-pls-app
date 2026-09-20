# Test Strategy

## Purpose

Testing must prove product invariants, not only happy-path UI behavior.

## Current executable domain baseline

The first domain test milestone is implemented under `packages/domain/tests`.

Current local validation:

- 27 tests
- 27 passing
- 0 failing

Covered behavior includes:

- exact breakup deadlines
- exact one-hour initiator cancellation boundary
- restoration intent immutability
- single day-ten extension
- mutual restoration
- stale generation rejection
- exact calendar-month cooldown arithmetic
- account-deletion recovery overlay
- account recovery preserving an existing breakup
- breakup deadline precedence
- one-month cooldown after permanent partner-account deletion
- active, breakup, deletion, terminated, and cooldown capability states
- pre-breakup message mutation restrictions
- breakup-period nickname behavior
- email-change availability during breakup
- account-deletion view-only behavior

This is the pure domain baseline. The initial database invariant suite has separate local PostgreSQL evidence; API, worker, browser, and full integration tests remain pending.

## CI baseline

The baseline CI and repository-health policy is defined in `CI_AND_REPOSITORY_HEALTH.md`.

The current hosted workflow is configured but not yet validated by a successful GitHub Actions run.

Local repository health and domain tests remain usable without hosted Actions.

## Test layers

### Unit

Pure domain rules in `packages/domain`.

Use deterministic clocks.

High-value unit coverage includes:

- age eligibility
- username cooldown
- partner-request rate rules
- partner-request expiry
- reciprocal request pairing
- breakup deadlines
- one-hour cancellation
- irreversible restoration intent
- three-day extension
- cooldown calculation
- account deletion collision rules
- message edit window
- capability matrix across lifecycle states
- stable capability denial codes

### Database invariant tests

The initial invariant SQL suite is committed at `packages/db/tests/invariants.sql`.

It currently covers current verified-email uniqueness, one occupied partnership slot, idempotency uniqueness, self-request rejection, breakup deadline shape, lifecycle-event append-only behavior, device ownership, maximum two partnership members, and scheduled-action deduplication.

The suite passed locally on 2026-09-20 against a disposable PostgreSQL 16.15 database after a clean migration from zero. The same migration and invariant sequence also passed after destroying and recreating the test container.

Separate two-session exercises passed for occupied partnership-slot contention, scheduled-action `SKIP LOCKED` claiming, and deterministic account lock ordering. Those race exercises are not yet committed as automated regression tests.

F2 promotes those manual exercises into a reusable disposable-database harness under `packages/testkit` and adds runtime failure tests for claim leases, claim-version fencing, direct expired-claim reclaim, controlled lease renewal, worker crash recovery, stale generations, durable payload compatibility, transaction retry and timeout behavior, pool error handling, outbox atomicity, duplicate delivery, lifecycle metadata privacy, deletion resumption, graceful shutdown, and queue query plans. The canonical design is `../architecture/F2_PERSISTENCE_WORKER_DESIGN.md`.

Prove:

- one occupied partnership slot per account
- unique verified current email
- idempotency uniqueness
- optimistic concurrency
- transaction rollback behavior
- reciprocal request races
- duplicate worker claims
- stale scheduled-action safety
- generation mismatch prevents stale lifecycle execution
- append-only lifecycle event creation
- deterministic two-account lock ordering
- deletion manifest idempotency
- expired durable claim recovery after worker crash through the normal claim query
- monotonically increasing claim-version fencing
- stale acknowledgement rejection after reclaim
- lease renewal succeeds only for the current worker and claim version
- claim ownership validation before acknowledgement
- outbox state-change atomicity
- duplicate-safe at-least-once outbox delivery
- lifecycle event private-content exclusion
- deletion manifest resume after process restart
- bounded worker concurrency and graceful shutdown
- unsupported scheduled-action payload version fails closed
- unsupported outbox payload version fails closed
- `READ COMMITTED` transaction behavior with explicit row locks
- whole-transaction retry on retryable SQLSTATEs
- statement, lock, idle-transaction, connection, and query timeout behavior
- PostgreSQL business-time versus lease-time clock semantics
- pool error handling and checked-out client release
- intended queue indexes are used for due and expired work on realistically sized synthetic data

The remaining items in this list are future coverage unless explicitly identified above as locally exercised.

### Integration

Exercise API plus PostgreSQL plus provider fakes.

Cover:

- registration and email verification
- session lifecycle
- email change
- partner discovery
- partner requests
- partnership formation
- breakup and restore
- account deletion and recovery
- device enrollment and revocation
- separation of account recovery from cryptographic recovery
- messaging
- media authorization
- relationship items
- notification outbox
- call signaling

### Threat-model driven security coverage

Security tests must trace back to the threat register in `../security/THREAT_MODEL.md`.

At minimum, automated or procedural verification must cover:

- credential and verification-code abuse
- session theft and fixation controls
- CSRF
- XSS-sensitive trusted-origin behavior
- cross-partnership IDOR
- direct API cooldown bypass
- double-partnership races
- stale lifecycle jobs
- account-deletion lockout
- former-partner realtime revocation
- local cache isolation
- device revocation
- email-only recovery not revealing E2EE history
- encrypted database and object-storage content expectations
- push payload minimization
- TURN credential expiry
- deletion manifest recovery
- backup restore not resurrecting deleted user access
- sensitive data exclusion from logs
- incompatible client and crypto versions failing closed

Tests that inspect fixtures, logs, stored rows, or provider payloads must also verify the handling rules in `../security/DATA_CLASSIFICATION.md`.

### Security regression

Maintain permanent regression tests for every security-relevant defect.

Required classes include:

- cross-partnership access
- guessed resource IDs
- media authorization bypass
- WebSocket channel escalation
- session fixation
- CSRF
- XSS-sensitive output handling
- verification-code replay
- direct API cooldown bypass
- stale worker finalization
- local partnership cache leakage
- revoked device cannot continue protected access
- TURN credentials expire and cannot be reused indefinitely
- unsupported client or crypto version fails closed
- deletion authorization remains revoked during cleanup retry

### E2E browser

Critical journeys:

- registration
- verified email
- login
- partner request
- mutual request
- partnership creation
- messaging
- edit and delete
- reaction
- breakup
- restore
- final dissolution
- account deletion recovery
- permanent deletion

### Physical Android device

Before stable release, validate:

- PWA installation
- background and foreground transitions
- notifications
- IndexedDB persistence
- offline retry
- media capture
- voice recording
- voice call
- video call
- camera and microphone permissions
- reconnection

## Race tests

Explicitly test concurrency.

Examples:

- one account accepts two partners at once
- reciprocal requests cross in flight
- restore arrives as breakup finalization begins
- account recovery races permanent deletion
- two workers claim the same deadline
- message retry arrives after first success

The system must remain correct regardless of request ordering.

## Worker tests

Every job handler must prove idempotency.

Test:

- repeated execution
- stale execution
- stale fenced acknowledgement after another worker reclaims a job
- lease renewal and lease expiry
- unknown durable payload version
- partial provider failure
- retry after process restart
- duplicate outbox delivery
- already-completed target state
- generation mismatch
- deletion target partial failure
- deletion manifest resume after restart

## Offline tests

Test:

- send while offline
- reconnect and retry
- duplicate prevention
- account switch with queued data
- partnership termination while device is offline
- queued mutation rejected after lifecycle changes
- purge of old partnership namespace
- crypto epoch transition
- local schema version migration
- revoked device with queued mutations

## E2EE tests

After protocol selection, include:

- official or reviewed test vectors where available
- cross-device encryption and decryption
- wrong-partnership failure
- wrong-device failure
- attachment encryption
- key rotation
- device enrollment
- recovery
- email-only account recovery does not reveal historical plaintext
- trusted-device or recovery-secret key restoration
- device revocation
- crypto epoch rotation
- protocol version mismatch
- partnership termination
- account deletion
- future partnership cannot decrypt previous partnership content

## Call tests

Cover:

- voice
- video
- accept
- reject
- cancel
- missed call
- network interruption
- TURN relay
- relay over TCP or TLS fallback where supported
- breakup_pending explicit acceptance
- account-deletion state rejection
- short-lived TURN credential issuance
- expired TURN credential rejection
- relay-first path verification where supported

## Acceptance principle

A feature is not complete merely because UI automation passes.

Stable-release evidence must combine:

- unit tests
- PostgreSQL invariant tests
- API integration
- security regression
- browser E2E
- physical-device checks for mobile-critical flows
