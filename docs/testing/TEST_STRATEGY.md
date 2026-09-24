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

### R1 relationship-space verification

Canonical design:

- `../architecture/R1_RELATIONSHIP_SPACE_DESIGN.md`
- `../api/R1_RELATIONSHIP_SPACE_API.md`

R1 runtime verification is complete on the combined integration baseline. Domain/contracts pass 16/16, R1 security passes 13/13, and the canonical disposable PostgreSQL/API/worker matrix passes 69/69 with `R1_LOCAL_POSTGRES_PASS` after applying real migrations 0001 through 0014 with no reservations and database invariants green.

Executed R1 closure evidence covers canonical migrations 0001 through 0014, same-partnership/immutable-root invariants, all-mutation idempotency and keyed fingerprints, creator/shared-state permission checks, preview versus sealed-content denial, recipient-open/creator-reveal authorization, breakup scheduled-release exception, account-deletion pause/recovery wake, destructive-deadline precedence, release-generation and claim fencing, linked-target deletion/version behavior, final-dissolution cleanup, future-partnership isolation, the real M1 message resolver plus fail-closed M3 resolver gate, Voice Letter container visibility, coordinate/log non-leakage, date precision/future rejection, February 29 anniversary behavior, deterministic unranked derived experiences, explicit signals, browser lifecycle modes, full health, and dependency audit.

Planned command surface:

```text
npm run test:relationship-space
npm run test:r1:security
npm run test:r1:postgres
npm run test:r1:local
npm run health

The integrated `test:r1:local` path uses no migration reservation. It positively verifies a real same-partnership M1 message reference while preserving the independent client-supplied R1 snapshot and proves invalid or unavailable external references fail closed.
npm audit --audit-level=high
```

These names are design targets until implemented and executed.

R1 core closure does not require physical Redmi acceptance. M2 owns offline/reconnect device acceptance, M3 owns media transport acceptance, and S1 owns E2EE acceptance.

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

## M3 Media and Voice Messages verification

Source implementation and the closure harness were committed through `afc73baf`. `npm run test:m3:closure` passed at `305891f` before device work and every step passed again after the physical fixes; all 20 physical Android scenarios then passed (final code SHA `ee59850`, evidence in `M3_ANDROID_ACCEPTANCE_EVIDENCE.md`). The physical run found three defects the automated suites missed (upload draft state after failure, microphone capture while hidden, and a 500 instead of 503 when the object store fails during completion), each now covered by a focused regression test. Canonical commands now include `test:m3:contracts`, `test:m3:storage`, `test:m3:storage:integration`, `test:m3:browser`, `test:m3:browser:e2e`, `test:m3:security`, `test:m3:postgres`, `test:m3:local`, `test:m3:closure`, and the device prepare/cleanup commands.

M3 has a dedicated closure matrix because media correctness spans browser processing, private object storage, lifecycle authorization, M1/R1 atomic binding, durable cleanup, IndexedDB draft persistence, service-worker exclusion, and physical-device camera/microphone behavior.

Canonical design: `../architecture/M3_MEDIA_VOICE_DESIGN.md`.

Canonical API/storage contract: `../api/M3_MEDIA_API.md`.

Physical device procedure: `M3_ANDROID_ACCEPTANCE.md`.

Planned command surface:

```text
npm run test:m3:contracts
npm run test:m3:security
npm run test:m3:postgres
npm run test:m3:storage
npm run test:m3:browser
npm run test:m3:browser:e2e
npm run test:m3:local
npm run test:m3:closure
npm run test:m3:device:prepare
npm run test:m3:device:cleanup
```

Automated/local evidence must prove migrations 0001-0016 with no reservation, media state/binding invariants, opaque/private object storage, upload/completion idempotency, cross-partnership denial, M1/R1 atomic binding, Voice Letter container visibility, lifecycle denial, deletion retry, no protected media in logs/outbox/cache, IndexedDB storage-failure behavior, and real Chromium media/service-worker behavior.

Physical Android acceptance is mandatory and contains 20 scenarios. Desktop automation cannot close M3.

Critical race coverage includes upload-complete vs lifecycle change, bind vs dissolution, upload expiry vs message send, double bind, delete vs access grant, R1 release/delete vs media access, object-delete crash recovery, device revocation during upload, completion replay, and two-tab stale finalization.
## C1 voice-calling tests

Canonical sources:

- `../architecture/C1_VOICE_CALLING_DESIGN.md`
- `../api/C1_CALLING_API.md`
- `../api/C1_SIGNALING_PROTOCOL.md`
- `C1_ANDROID_ACCEPTANCE.md`

Implemented C1 command surface:

```text
npm run test:c1
npm run test:c1:postgres
npm run test:c1:local
npm run test:c1:browser:e2e
npm run test:c1:closure
npm run test:c1:device:prepare
npm run test:c1:device:cleanup
```

The focused real-Chromium suite exercises browser media-owner/Permissions-Policy behavior. Isolated automated/local closure passed at `439b09f551512ea79a16e8f3d047a32b9a722203` with only the documented 0015/0016 reservations. Final integrated closure passed at `9b5c255b5e8c60cbe8da4bcd2b6f7596c56687a0` against real migrations 0001 through 0018 with `reserved=0`, including focused C1 21/21, integrated PostgreSQL/API/worker 111/111, C1 real Chromium 2/2, the retained M3 PostgreSQL/MinIO/Chromium gates, full health, zero high-severity vulnerabilities, and git hygiene. Full relay-path WebRTC and Android behavior still require the documented environment and physical acceptance procedure.

Coverage must include:

- one non-terminal call per partnership under simultaneous initiation
- first-accept-wins with two callee devices
- fixed caller endpoint and participant rows as sole endpoint-role/device authority
- create/accept/reject/cancel/end lost-response idempotency
- expectedVersion races for aggregate commands
- endpoint-connected without expectedVersion, including concurrent caller/callee reports
- first endpoint-connected report does not invalidate accepted-call connect timeout
- independent deadline_generation fencing for ring/connect/hard timeout work
- active/breakup/account-deletion/terminated lifecycle behavior
- selected-device and session revocation
- future-partnership call-history isolation
- final-dissolution history cleanup
- realtime v1/v2 negotiation and `call.changed` content minimization
- call.changed dirty-counter barrier race and visible anti-entropy repair after deliberately suppressed hint
- stale v1 client not treated as C1-capable
- exact Origin/session/device/call authorization on `shawtie.call.v1`
- unaccepted/random/foreign/non-winning-device signaling denial
- binary/oversized/unknown/stale-generation signaling denial
- shared WebSocket zero/multiple/cross-family subprotocol rejection
- M2 4 KiB application-frame rejection remains intact after signaling integration
- SDP candidate-line rejection
- exactly-one-audio SDP enforcement and video/data-channel rejection
- host/srflx/prflx/malformed candidate rejection
- privacy-unsafe relay related/base-address rejection
- relay-only candidate forwarding
- SDP/ICE/TURN/push capability absence from logs, with raw push capability storage limited to the device-bound subscription table and keyed endpoint fingerprint stored for uniqueness
- perfect-negotiation glare handling
- candidate-before-description buffering
- signaling reconnect and process-loss recovery
- same-device two-tab single media owner and generation-fenced owner failover, including the real-Chromium C1 ownership harness
- stale old-owner callbacks cannot capture/send/report after takeover
- relay-only ICE restart after network change
- pre-accept TURN denial
- TURN expiry and authorization refresh
- post-revocation TURN refresh denial plus bounded existing allocation lifetime
- TURN/UDP plus TCP/TLS fallback where deployed
- generic call_state_changed push payload fixture review
- delayed/duplicate/reordered push convergence and stale-notification dismissal
- stale push suppression after terminal call
- logged-out/revoked-device push routing denial
- push-denied foreground calling through realtime v2
- caller Call-gesture and callee Accept-gesture microphone acquisition
- failed/raced create or accept stops pre-acquired tracks
- camera permission is never requested in C1
- public outcome mapping hides internal session/device/deletion/lifecycle causes
- microphone permission denial and teardown
- physical Android voice-call acceptance

Isolated C1 database validation may reserve only M3-owned 0015/0016. Final integrated C1 closure passed real migrations 0001 through 0018 with `reserved=0` at `9b5c255`.

## C2 video-calling tests

C2 must reuse the verified C1 call authority, signaling protocol, TURN policy, push substrate, and deletion model.

Additional coverage includes explicit camera permission, no hidden video activation, local/remote rendering, camera on/off, front/back switching where supported, generation-safe video renegotiation, bandwidth/network transitions, and physical Android video acceptance.

## Acceptance principle

A feature is not complete merely because UI automation passes.

Stable-release evidence must combine:

- unit tests
- PostgreSQL invariant tests
- API integration
- security regression
- browser E2E
- physical-device checks for mobile-critical flows

## M2 Realtime and Offline Reliability verification

M2 has a dedicated closure matrix because WebSocket delivery, browser local persistence, service-worker lifecycle, and physical-device suspension cannot be proven by unit tests alone.

Implemented M2 command surface:

```text
npm run test:m2:install-browser
npm run test:realtime-offline
npm run test:m2:security
npm run test:m2:postgres
npm run test:m2:browser
npm run test:m2:browser:e2e
npm run test:m2:local
npm run test:m2:closure
npm run health
npm audit --audit-level=high
npm run test:m2:device:prepare
npm run test:m2:device:cleanup
```

Required contract/unit evidence includes:

- strict realtime protocol v1 client/server frame schemas
- oversize and unexpected-field rejection
- unknown critical version failure
- SyncCoordinator state transitions
- dirty-counter/high-water live-barrier races
- old browser connection-generation callback rejection
- change-sequence versus server-sequence separation
- local namespace construction
- atomic cursor/projection persistence behavior
- offline retry classification
- chat and R1 operation whitelist validation
- service-worker compatibility decisions

Required API/security evidence includes:

- exact trusted-Origin WebSocket upgrade enforcement
- existing server-session authentication
- no bearer token in the WebSocket URL
- no arbitrary account/partnership/conversation subscription
- stale and revoked session closure
- server-derived scope revalidation
- malformed and oversize frame handling
- connection/frame-rate policy
- no protected content in realtime frames
- no protected content in PostgreSQL NOTIFY payloads
- binary frame rejection and disabled WebSocket compression
- immutable socket partnership/conversation identity
- scope-identity change forcing reconnect

Required PostgreSQL/API/worker integration evidence includes:

- durable M1 outbox invalidation to realtime publish
- duplicate publish safety
- missing LISTEN consumer safety
- LISTEN reconnect
- LISTEN reset while browser sockets stay open forcing `listener_reset` canonical resync
- durable outbox acknowledgement only after committed NOTIFY publication
- multiple API listener processes
- worker event-family isolation
- content-free partnership/R1/security invalidations
- all earlier milestone regression surfaces

The browser closure has two layers: fast Node/static synchronization checks in `test:m2:browser` and real Chromium acceptance in `test:m2:browser:e2e`. The composite `test:m2:local` runs the PostgreSQL/API/worker closure first and then the real Chromium suite.

`test:m2:closure` is the canonical automated M2 closure wrapper. It additionally requires the exact M2 branch and remote SHA, a clean worktree, `[skip ci]` on M2 commits while Actions capacity is being conserved, no newly introduced Unicode em dash, full repository health, a high-severity dependency audit, `git diff --check`, and final worktree cleanliness. Physical Android acceptance remains a separate mandatory gate.

Required browser automation includes:

- IndexedDB persistence across reload
- atomic canonical projection plus cursor update
- offline message queue persistence
- idempotent reconnect replay
- edit/version conflict handling
- duplicate and out-of-order realtime hints
- invalidation arriving during the final reconciliation window preventing premature live mode
- low-frequency visible anti-entropy repairing a deliberately suppressed realtime hint
- missed realtime hint followed by canonical repair
- online/offline transitions
- page background/foreground transitions
- multi-tab duplicate replay safety
- persisted claim-generation fencing where an older tab returns late after another tab reclaimed the operation
- final-dissolution namespace purge
- service-worker update with pending offline operations
- pre-S1 offline cold-start showing a locked shell until server-session validation
- IndexedDB quota/transaction failure preserving unsent user content and refusing false queued state
- browser storage persistence request/fallback behavior without claiming guaranteed survival of user-cleared site data
- private API responses absent from Cache API
- future partnership isolation

Physical Android acceptance is mandatory for M2. Use `docs/testing/M2_ANDROID_ACCEPTANCE.md` and `npm run test:m2:device:prepare` for the non-destructive device/CDP preflight; that preflight is not scenario acceptance evidence. It must prove foreground/background socket suspension recovery, offline queue/replay, lifecycle change while offline, final-dissolution purge before replay, session/device revocation behavior, service-worker update safety, future-partnership local isolation, pre-S1 cold-start locking, LISTEN-reset resynchronization, storage-failure handling, and multi-tab stale-claim fencing on the supported physical device where practical.

M2 does not close from simulated socket delivery alone. The authoritative acceptance catalog is in `../ROADMAP_EPICS.md`, and the detailed architecture is in `../architecture/M2_REALTIME_OFFLINE_DESIGN.md`.

M2 automated/local closure passed at `4bbffdfbcd70bd4160e50c52bb14048cf3339dc0`. The canonical run passed migrations 0001 through 0014 with `reserved=0`, database invariants, the PostgreSQL/API/worker matrix 100/100, real Chromium 7/7, full health with Domain 60/60, Contracts 36/36, API unit/security 49/49, and Worker 9/9, a zero-vulnerability high-severity audit, and git hygiene. It ended with `M2_AUTOMATED_CLOSURE_PASS`. All 14 mandatory physical Android scenarios subsequently executed and passed on a physical Xiaomi Redmi Note 9S, final physical acceptance SHA `b83102f`, recorded in `docs/testing/M2_ANDROID_ACCEPTANCE_EVIDENCE.md`. That physical run found and fixed seven real M2 defects not caught by the automated/local closure, each with a focused regression test. M2 is DONE.

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

M1 verification completed locally on 2026-09-22. `npm run test:m1:security` passed 17/17, and the original `test:m1:local` closure applied migrations 0001 through 0012 and passed 64/64 with `M1_LOCAL_POSTGRES_PASS`. The later exhaustive integration baseline `5db7a94` re-ran M1 against the real canonical 0001 through 0014 schema and again passed 64/64. That same baseline closes R1 at 69/69 and ends with full health at Domain 60/60, Contracts 29/29, API unit/security 44/44, Worker 4/4, plus a zero-vulnerability audit and clean git hygiene. Hosted GitHub Actions verification remains separate under V1.
