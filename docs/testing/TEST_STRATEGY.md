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

Separate two-session exercises passed for occupied partnership-slot contention, scheduled-action `SKIP LOCKED` claiming, and deterministic account lock ordering. Those original manual race exercises are now represented by committed F2 integration tests.

F2 includes a reusable disposable-database harness under `packages/testkit` plus runtime failure tests for claim leases, claim-version fencing, direct expired-claim reclaim, controlled lease renewal, worker crash recovery, stale generations, durable payload compatibility, transaction retry and timeout behavior, pool error handling, outbox atomicity, duplicate delivery, lifecycle metadata privacy, deletion resumption, graceful shutdown, and queue query plans. The Docker-backed F2 run applies all six migrations and passes 17/17 PostgreSQL integration tests. The canonical design is `../architecture/F2_PERSISTENCE_WORKER_DESIGN.md`.

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

The F2-specific items in this list have committed local evidence and the F2 PostgreSQL suite passes 17/17. Later product-epic items remain future coverage.

### A1 accounts and authentication verification

A1 uses the refined test architecture in `../architecture/A1_ACCOUNTS_DEVICES_DESIGN.md`.

Required A1 evidence includes:

- pure domain age, username, password-policy, and DOB-correction tests
- migration 0007 from zero
- username and verified-email ownership races
- registration completion races
- one-active-challenge and attempt-exhaustion races
- opaque session verifier uniqueness
- session absolute and idle expiry
- fenced session-token rotation
- device revocation fan-out to sessions
- HMAC key-version rotation and unknown-version fail-closed behavior
- trusted-proxy spoofing regression
- PostgreSQL security-rate-limit contention
- registration, login, logout, password recovery, email change, username, DOB, deletion recovery, and device API integration
- raw password, raw code, raw session token, and raw device handle exclusion from logs and durable storage
- CSRF, origin, Fetch Metadata, and cookie regressions
- account-recovery versus cryptographic-recovery separation
- complete account-deletion-specific partnership persistence before partnered deletion is enabled

Committed A1 verification commands are:

```text
npm run test:accounts
npm run test:a1:postgres
npm run test:a1:api
npm run test:a1:security
npm run test:a1:local
```

The completed A1 branch has the required local evidence: the expanded disposable PostgreSQL A1 suite passes 27/27, the dedicated A1 security suite passes 16/16, the full repository health regression passes, and the high-severity dependency audit reports 0 vulnerabilities. All 20 A1 acceptance gates are closed.

### P1 discovery and request verification

P1 uses the test architecture in `../architecture/P1_DISCOVERY_REQUESTS_DESIGN.md`.

Verified P2 closure evidence includes:

- exact authenticated username discovery
- safe public projection with no exact DOB or email
- blocker-hidden discovery behavior
- exact seven-day logical and persisted expiry
- exact one-hour decline-cooldown boundary
- rolling one-calendar-month successful-request count
- multiple incoming requests
- self and duplicate rejection
- deterministic same-direction, same-idempotency-key, opposite-direction, cancel/accept, and decline/accept races
- direct API eligibility bypass rejection
- discovery and create abuse-rate limits
- generic target-unavailable mapping for private recipient state
- lost-response create replay through Idempotency-Key
- idempotency fingerprint changes when only `relationshipStartDate` changes
- snapshot-bound request pagination remains stable while new requests arrive
- cursor pagination without active-request omission or duplication
- P1 service rejects production `request_only_test` mode and requires a coordinator for `paired` mode; the P2 application wiring supplies the real coordinator
- A1 deletion, P2 formation, and P3 block invalidation hooks
- cancel and decline availability despite exhausted discovery/create abuse buckets
- scheduled expiry through F2
- standalone P1 request-only regression proves reciprocal candidate detection without P1 owning partnership persistence

Committed P1 verification commands are:

```text
npm run test:partner-requests
npm run test:p1:postgres
npm run test:p1:api
npm run test:p1:security
npm run test:p1:local
```

P1 verification is complete: the disposable PostgreSQL/API/worker suite passes 16/16 with `P1_LOCAL_POSTGRES_PASS`, migration 0008 participates in the clean eight-migration run with database invariants green, full repository health passes, and the high-severity dependency audit reports 0 vulnerabilities.

### P2 partnership formation verification

P2 uses the test architecture in `../architecture/P2_PARTNERSHIP_FORMATION_DESIGN.md`.

Required evidence includes:

- manually entered request relationship date and trusted-server future-date rejection
- explicit acceptance only by the request recipient
- reciprocal automatic formation in the same P1 transaction
- accepted-request linkage and retention-scoped lost-response replay
- deterministic two-account locking
- occupied-slot database protection under competing formation
- explicit-accept versus reciprocal-request race
- accept versus sender-cancel and recipient-decline races
- accepted-request expiry-action cancellation
- already-processing expiry worker safely observing accepted terminal state
- database-side accepted-request update guards for pending, unexpired, relationship-date-bearing, unlinked source rows
- incompatible request invalidation
- fresh partnership-ID namespace with no reuse of prior local or cryptographic state
- current partnership read isolation
- relationship-date expectedMetadataVersion conflict behavior
- lost-response retry of an already-applied relationship date returning a no-op with current metadataVersion
- active and breakup-pending relationship-date mutation capability, with account-deletion and terminated-state denial
- durable other-partner relationship-date notification, including exact persisted recipient routing
- persisted partnership-formation lifecycle event evidence
- persisted proof that relationship-date metadata edits do not change lifecycle generation
- notification account isolation, private no-store responses, snapshot-bound pagination, and a persistence-column allowlist that excludes private content
- no fake E2EE key or epoch creation before S1
- P2 closure reruns the P1 integration surface with the real P2 coordinator in `paired` mode; standalone `npm run test:p1:local` remains the original request-only P1 evidence
- migration 0009 verification that committed migration 0008 is consumed unchanged, including a pinned SHA-256 regression check

Committed P2 verification commands:

```text
npm run test:partnership-formation
npm run test:p2:postgres
npm run test:p2:api
npm run test:p2:security
npm run test:p2:local
```

P2 verification is complete at closure commit `fa2301d0`: the domain/contracts suite passes 14/14, the security suite passes 5/5, all nine migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker integration matrix passes 27/27 with `P2_LOCAL_POSTGRES_PASS`. Full repository health passes with Domain 45/45, Contracts 15/15, API unit/security 16/16, Worker 4/4, typecheck, builds, lint, Prettier, and dependency checks green. `npm audit --audit-level=high` reports 0 vulnerabilities. The final test-quality review found only missing persisted-state assertions, which were added before the full green rerun. Hosted GitHub Actions verification remains separate under V1.

### P3 partnership lifecycle verification

P3 uses the hardened test architecture in `../architecture/P3_PARTNERSHIP_LIFECYCLE_DESIGN.md`.

P3 verification is complete: the lifecycle domain/contracts suite passes 28/28, P3 security passes 6/6, all ten migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker integration matrix passes 39/39 with `P3_LOCAL_POSTGRES_PASS`. Full repository health passes with Domain 48/48, Contracts 17/17, API unit/security 22/22, Worker 4/4, typecheck, builds, lint, Prettier, and dependency checks green. `npm audit --audit-level=high` reports 0 vulnerabilities.

Required evidence includes:

- cancellation allowed strictly before the one-hour boundary and denied at equality
- restoration intent denied before one hour, allowed at equality with the cancel boundary, and denied at the final deadline
- first restoration intent extends exactly once from day seven to day ten
- restoration intent is immutable
- second intent restores the same partnership
- lifecycle-only transitions change generation but not metadata version
- breakup-process generation fences scheduled finalizers
- stale day-seven work cannot dissolve an extended breakup
- stale work cannot dissolve a restored or superseded partnership
- canonical account lock order across breakup, restoration, account deletion, blocking, and P2 metadata mutation
- exact three-calendar-month breakup cooldown
- exact one-calendar-month permanent-partner-deletion cooldown
- expired cooldown rows are resolved so later cooldown persistence cannot be blocked by stale provenance
- earlier breakup deadline wins over a later account-deletion deadline
- account recovery preserves an existing breakup deadline and restoration intent
- recovery after completed breakup does not recreate the dissolved partnership
- partnership authorization and occupied membership are revoked synchronously before deletion targets finish
- one partnership deletion manifest is created per destructive dissolution
- deletion targets are idempotent, reclaimable, and fenced
- former-partner block targets are derived from a terminated source partnership
- block creation invalidates pending requests and prevents discovery, requests, and future formation
- unblock does not bypass cooldown or fresh-consent rules
- blocked accounts receive no block notification
- serious lifecycle email parameters contain no private shared content
- account notifications and lifecycle events remain routing or transition metadata only
- migration 0010 consumes verified migrations 0001 through 0009 unchanged
- A1 account-deletion, P1 request/discovery, and P2 formation/metadata regression surfaces remain green
- race tests assert persisted end state rather than HTTP status alone

Committed P3 verification commands:

```text
npm run test:partnership-lifecycle
npm run test:p3:security
npm run test:p3:postgres
npm run test:p3:api
npm run test:p3:local
npm run health
npm audit --audit-level=high
```

The P3 local harness emitted `P3_LOCAL_POSTGRES_PASS` after migrations, invariants, API, worker, race, deletion, and cross-epic regression work completed successfully. Hosted GitHub Actions verification remains separate under V1.

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

## M1 Messaging Core verification

M1 uses a dedicated disposable PostgreSQL closure harness.

Implemented closure commands:

~~~text
npm run test:messaging-core
npm run test:m1:security
npm run test:m1:postgres
npm run test:m1:local
npm run health
npm audit --audit-level=high
~~~

The M1 PostgreSQL matrix must include:

- migrations 0001 through 0012 from zero
- database invariants
- P1/P2/P3 regression suites
- primary-conversation provisioning
- deterministic server-sequence allocation for message creation
- deterministic durable change-sequence allocation across send/edit/delete/reaction mutations
- bounded change-feed replay from a committed cursor
- edit/delete/reaction of an old message discovered without relying on a new-message server sequence
- send idempotency and keyed request-fingerprint mismatch
- proof that private request fingerprints are keyed and do not persist raw or ordinary-digest message content
- same-conversation reply enforcement
- reply-context rendering when the referenced message is outside the loaded history page
- tombstone-safe reply context for deleted referenced messages
- exact 30-minute edit boundary
- optimistic edit version checks and stale `expectedContentVersion` rejection
- concurrent edit versus edit
- edit versus delete
- reaction versus delete
- tombstone deletion with no plaintext edit-history retention
- reaction add/change/remove
- default and add-emoji paths
- monotonic delivered/read high-water marks
- no receipt advancement across a known unresolved forward-sync gap
- typing expiry, write coalescing, and endpoint rate limiting
- presence privacy and current-partnership activation boundary
- proof that a newly formed partner cannot observe pre-partnership last-seen activity
- nickname version conflicts
- breakup sequence-freeze behavior
- send versus breakup initiation
- send versus account deletion
- final dissolution versus message mutation
- account recovery preserving authorized conversation state
- cross-partnership conversation/message guessing denial
- module-owned messaging cleanup idempotency
- final-dissolution cleanup of messages, reactions, receipt/member state, typing, nickname state, and durable change rows
- permanent account-deletion presence cleanup
- content-free outbox invalidations for durable message mutations
- pre-M2 M1 outbox sink delivers valid message invalidations without transport
- M1 outbox claiming is restricted to M1-owned message event types and leaves unrelated event families pending
- malformed or private-content M1 invalidation payloads fail closed
- unknown payload versions for recognized M1 event types fail closed
- security guards proving private message content is absent from logs, lifecycle events, notifications, durable work, change rows, outbox payloads, and idempotency metadata
- centralized interaction-limit contract coverage so message, page, typing, presence, and idempotency ceilings do not drift between layers

M1 does not require physical Redmi acceptance. Physical Android validation begins at M2.
