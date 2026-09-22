# Roadmap

## Status

Refreshed: 2026-09-23.

This is the canonical high-level execution roadmap for Shawtie pls.

Verified current implementation state lives in `docs/PROJECT_STATE.md`.
Detailed epic scope and acceptance gates live in `docs/ROADMAP_EPICS.md`.
The compact dependency graph lives in `docs/EXECUTION_GRAPH.md`.

An epic is DONE only when its required acceptance gates have executed evidence.

## Verified baseline

`main @ 9f4237e90c4d289f8b316e5d8dd2bba41609c95d` is the verified M1/R1-derived mainline from which M2 was created. The exhaustive technical validation anchor remains `5db7a94183bca153d142389d7188e3887653a9ec`. M2 Realtime and Offline Reliability is the active milestone; implementation is complete and acceptance closure is pending.

Completed milestones:

| Milestone | Status | Verified boundary |
| --- | --- | --- |
| 0 Verified Foundation | DONE | F0, F1, F2 |
| 1 A1 Accounts and Devices | DONE | 20/20 gates |
| 2 P1 Discovery and Partner Requests | DONE | 14/14 gates |
| 3 P2 Partnership Formation | DONE | 11/11 gates |
| 4 P3 Partnership Lifecycle | DONE | 22/22 gates |
| 5A M1 Messaging Core | DONE, merged to main | 18/18 gates; combined anchor `5db7a94` |
| V1 Hosted CI Verification | BLOCKED | separate track until GitHub Actions capacity returns |

P3 closure evidence remains:

- lifecycle domain/contracts 28/28
- P3 security 6/6
- migrations 0001 through 0010 from zero
- database invariants PASS
- PostgreSQL/API/worker integration 39/39
- `P3_LOCAL_POSTGRES_PASS`
- full repository health PASS
- `npm audit --audit-level=high`: 0 vulnerabilities

## Delivery principle

Build the private two-person product in dependency order:

1. identity and lifecycle authority
2. messaging and relationship content
3. realtime and offline reliability
4. media and voice calling
5. video calling
6. reviewed end-to-end encryption and cryptographic recovery
7. public-readiness verification
8. stable release

Do not reopen verified foundation or lifecycle boundaries without concrete regression evidence or an approved architecture change.

## Milestone summary

| Milestone | Status | Depends on | Physical Android |
| --- | --- | --- | --- |
| 5A M1 Messaging Core | DONE, merged to main | P3 | No for core closure |
| 5B R1 Relationship Space | DONE, merged to main | P3 | No for core closure |
| 6 M2 Realtime and Offline Reliability | IN_PROGRESS, source implementation complete; validation and device closure pending | M1 + R1 merged mainline | Yes |
| 7 M3 Media and Voice Messages | PLANNED, design complete; implementation blocked on M2 closure | M2 | Yes |
| 8 C1 Voice Calling | PLANNED | M2 | Yes, mandatory |
| 9 C2 Video Calling | PLANNED | C1 | Yes, mandatory |
| 10 S1 E2EE and Cryptographic Recovery | PLANNED | M3 + C1 + C2 | Yes, mandatory |
| 11 R2 Public Readiness | PLANNED | all pre-release epics plus V1 | Yes, final acceptance |
| Stable Release | BLOCKED | R2 | Yes |
| X1 Post-stable Maturity | PLANNED | Stable Release | As needed |
| X2 Deferred Heavy Features | DEFERRED | production evidence | As required |

## Immediate execution sequence

The next verified-mainline work is:

```text
main @ 9f4237e
M1 + R1 merged
        |
        v
feat/m2-realtime-offline
```

M1 and R1 progressed in parallel from the verified P3 boundary, were source-integrated at `01fa182`, exhaustively validated together at `5db7a94183bca153d142389d7188e3887653a9ec`, documentation-closed at `d7d95a6`, and are now on `main`.

Next:

1. preserve the M1 runtime closure anchor `aa40a2c` and R1 source history `9bc9ba4`
2. preserve M1 ownership of 0011/0012 and R1 ownership of 0013/0014
3. execute `npm run test:m2:closure` from a clean checkout at the current M2 implementation head
4. execute and record the mandatory physical Android scenarios
5. fix only evidence-backed regressions, then reconcile final M2 evidence/docs and merge when every closure gate is green
6. keep V1 hosted verification separate until Actions capacity returns

# Milestone 5A: M1 Messaging Core

Status: DONE and merged to `main`. Runtime acceptance closed at `aa40a2c`; source head `b29b095` is combined and exhaustively validated at `5db7a94` and included in `main @ d7d95a6`.

Canonical detailed gates:

`docs/ROADMAP_EPICS.md#M1-Messaging-Core`

## Goal

Create the authoritative private conversation substrate for one active partnership with separate immutable message ordering and durable mutation synchronization.

## Core scope

- one primary conversation per active partnership
- text messages
- replies with stable tombstone-safe context
- stable message IDs
- deterministic server message sequence
- durable change sequence for send/edit/delete/reaction synchronization
- idempotent sends and mutations with keyed private-request fingerprints
- 30-minute edit window with optimistic content-version conflict handling
- deletion tombstones without plaintext edit-history retention
- reactions
- read receipts
- typing indicators with bounded TTL/write cadence
- partnership-scoped presence and last-seen disclosure
- shared nicknames
- content-free change/outbox invalidation metadata for later M2 transport
- module-owned messaging cleanup over the verified P3 dissolution kernel

## P3 lifecycle obligations

M1 must preserve the verified P3 capability model:

- active partnership: normal messaging
- breakup_pending: new messages and replies remain allowed
- breakup_pending: pre-breakup messages cannot be edited, deleted, or reacted to
- account-deletion view-only state: mutations fail closed
- terminated partnership: no message mutation authority
- no cross-partnership access under any identifier guess or race

## Synchronization obligations

M1 must not use message creation sequence as the only reconnect/poll cursor.

- `server_sequence` remains immutable message order and history pagination
- `change_sequence` covers every durable send/edit/delete/reaction mutation
- old-message edits, deletes, and reaction changes must be discoverable from a later change cursor
- durable change rows and outbox invalidations carry no private content
- browser polling remains canonical-API reconciliation; M2 may later deliver the same invalidations over WebSockets

## Current implementation state

The M1 branch contains the locally verified runtime implementation for migrations, repositories, lifecycle integration, messaging API, browser chat, content-free pre-M2 outbox invalidation handling, domain/contracts, database invariants, race/security tests, and the disposable-PostgreSQL closure harness.

On 2026-09-22, M1 closure passed 64/64 and all 18 acceptance gates closed at `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`. The later combined baseline `5db7a94` re-ran M1 against the canonical 0001 through 0014 schema and again passed 64/64 with `M1_LOCAL_POSTGRES_PASS`, full health, audit, and git hygiene green. M1 is merged to `main @ d7d95a6`.

## Closure boundary

M1 is DONE only after its API, persistence, ordering, durable synchronization, idempotency, optimistic-concurrency, lifecycle, race, deletion, privacy, security, and browser core gates pass.

**REDMI PHONE REQUIRED: NO for core closure.**

# Milestone 5B: R1 Relationship Space

Status: DONE. R1 source head `9bc9ba4` is combined with verified M1 and exhaustively validated on `integration/m1-r1 @ 5db7a94`. The canonical PostgreSQL/API/worker matrix runs real migrations 0001 through 0014 with `reserved=0`, passes database invariants and 69/69 tests with `R1_LOCAL_POSTGRES_PASS`, proves a real same-partnership M1 message can be referenced without server-side plaintext copying, keeps invalid and unavailable references fail-closed, and passes full repository health plus a zero-vulnerability audit. R1 is merged to `main @ d7d95a6`.

Canonical architecture:

`docs/architecture/R1_RELATIONSHIP_SPACE_DESIGN.md`

Canonical API:

`docs/api/R1_RELATIONSHIP_SPACE_API.md`

Canonical detailed gates:

`docs/ROADMAP_EPICS.md#R1-Relationship-Space`

## Goal

Implement the private shared relationship space without introducing public-social mechanics.

## First-stable scope

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
- explicit relationship signals

## P3 lifecycle obligations

- relationship objects are partnership-scoped
- breakup_pending makes user-driven relationship-object mutations view-only
- preconfigured For You/Future Us scheduled release may continue during breakup only strictly before the effective destructive deadline
- account-deletion recovery pauses unreleased relationship-space delivery
- recovery preserves original unlock time and safely wakes due work
- destructive deadline wins over release at exact equality and when finalization is late
- restoration returns permitted objects to writable state without recreating schedules
- final dissolution removes relationship-space authorization before cleanup
- location memories require explicit user-created location data
- no passive background location tracking
- no inferred emotional state
- no followers, feeds, rankings, ads, or streak mechanics

## Closure boundary

R1 is DONE only after data-model, versioning, lifecycle, deletion, privacy, cross-partnership, and browser gates pass.

**REDMI PHONE REQUIRED: NO for core closure.**

# Milestone 6: M2 Realtime and Offline Reliability

Status: IN_PROGRESS, IMPLEMENTATION COMPLETE. Refined architecture and protocol design, runtime implementation, reliability hardening, browser acceptance automation, local closure orchestration, and Android preflight tooling are complete through `6e3c019371edd96a081c71ff178b6ee82f406566`. The latest source closes revoked-session purge ordering, account-routed partnership scope refresh, and offline sync-start gaps, and expands real Chromium acceptance for reconnect/replay idempotency, account isolation, partnership purge, and protected cold-start behavior. `npm run test:m2:closure` now composes branch-policy checks, `test:m2:local`, full health, audit, diff hygiene, and final worktree cleanliness. Executed local closure and physical Android scenario evidence are pending, so the milestone is not yet DONE or merge-ready.

Architecture:

`docs/architecture/M2_REALTIME_OFFLINE_DESIGN.md`

Protocol:

`docs/api/M2_REALTIME_PROTOCOL.md`

## Goal

Make the verified M1 and R1 experience resilient across realtime delivery, mobile suspension, unreliable networks, offline user actions, duplicate events, stale local caches, service-worker updates, lifecycle changes, and process restarts without changing the canonical authority model.

## Non-negotiable authority boundary

- PostgreSQL remains authoritative
- durable mutations remain on authenticated HTTP
- WebSocket frames are content-free invalidation hints plus transient typing/presence
- `server_sequence` remains immutable message creation/history order
- `change_sequence` remains durable mutation synchronization order
- IndexedDB is cache/retry state, not authority
- queued operations are never permissions
- final dissolution is a hard local namespace boundary
- socket live state requires a race-free dirty-counter/high-water reconciliation barrier
- socket partnership/conversation identity is immutable and identity changes force reconnect
- LISTEN reset plus low-frequency visible anti-entropy prevents silent stale healthy-looking sockets
- pre-S1 cold-start offline cannot reveal cached private plaintext before session validation
- multi-tab replay is locally claim-generation fenced while server idempotency remains authoritative
- offline queue success exists only after durable IndexedDB commit; quota/storage failure cannot fake a queued state
- M2 introduces no Redis
- M2 is expected to require no PostgreSQL migration; migration 0015 is not pre-reserved

## Implementation slices

### M2-A Protocol, contracts, and compatibility

- realtime protocol v1
- strict frame schemas and byte ceilings
- compatibility constants
- local schema v1 types
- unknown critical versions fail closed

### M2-B Authenticated WebSocket and server-derived scope

- `/api/v1/realtime`
- exact Origin validation
- existing HttpOnly session authentication
- official Fastify WebSocket integration
- account/device/session context
- server-derived partnership/conversation membership
- bounded liveness and backpressure
- periodic authorization revalidation

### M2-C Durable invalidation publisher

- F2 outbox to RealtimePublisher
- PostgreSQL NOTIFY fanout hint
- dedicated API LISTEN connection
- M1 message invalidations
- partnership/R1/receipt/nickname/account-security invalidations
- explicit event-family ownership
- lost NOTIFY remains correctness-safe

### M2-D Client realtime and canonical synchronization

- one SyncCoordinator
- `change_sequence` repair
- `server_sequence` gap repair
- duplicate/out-of-order event coalescing
- visibility and reconnect handling
- canonical HTTP reconciliation before live mode
- polling retained only as bounded fallback

### M2-E IndexedDB namespace and cache

- account-bound database
- partnership/conversation/content-context keys
- local schema version 1
- atomic projection plus cursor transactions
- bounded message/R1 cache
- explicit retained-history window
- logout/account-switch/final-dissolution purge

### M2-F Offline chat queue

- persisted send/edit/delete/reaction operations
- stable idempotency keys
- no fake server sequence
- queued/sending/retrying/blocked UI state
- expectedContentVersion preservation
- monotonic pending receipt high-water state
- lifecycle-aware replay

### M2-G Offline R1 queue

- separate typed queue
- explicit safe operation whitelist
- expectedVersion preservation
- conflict UI
- release/open/reveal and scheduled-release changes remain online-only

### M2-H Service worker and compatibility

- app-shell/static caching only
- no private API Cache API entries
- controlled worker activation
- local-schema compatibility check
- update-required mode
- safe recovery from interrupted update

### M2-I Security, integration closure, and physical Android

- realtime security suite
- PostgreSQL/API/worker integration
- static/unit browser synchronization suite
- real Chromium IndexedDB/service-worker/cold-start acceptance
- service-worker tests
- multi-tab duplicate safety
- non-destructive Android preparation/evidence harness
- Redmi physical-device scenario acceptance
- full health and audit

## Closure boundary

M2 is DONE only when the canonical acceptance gates in `docs/ROADMAP_EPICS.md` are green, including physical Android evidence.

# Milestone 7: M3 Media and Voice Messages

Status: PLANNED, DESIGN COMPLETE. Implementation is blocked until M2 closes and is merged to `main`.

Design:

`docs/architecture/M3_MEDIA_VOICE_DESIGN.md`

API:

`docs/api/M3_MEDIA_API.md`

Pre-S1 media security bridge:

`docs/adr/ADR-012-pre-s1-media-encryption-bridge.md`

## Goal

Add private partnership-scoped images, short video, selected files, ordinary voice messages, and R1 media/Voice Letters without weakening lifecycle isolation, offline reliability, deletion guarantees, or the future S1 E2EE boundary.

## Refined architecture

M3 treats media as a first-class partnership asset.

M1 messages and R1 items store references to ready media IDs. The media module owns:

- upload state
- opaque provider object key
- ciphertext size and media class
- signed transfer grants
- reference-aware access authorization
- upload expiry
- orphan cleanup
- provider deletion
- pre-S1 development key envelope

Private object storage receives ciphertext only.

A generic same-partnership read rule is forbidden because an unreleased R1 Voice Letter must remain inaccessible to the recipient even when the recipient knows or guesses its media ID.

## Planned implementation slices

1. M3-A contracts, policy, encrypted-container and storage boundaries
2. M3-B media persistence and migration 0015
3. M3-C private object-storage port and provider adapter
4. M3-D media HTTP API
5. M3-E M1 message attachments and migration 0016
6. M3-F R1 attachments and Voice Letters
7. M3-G browser image/video/file/voice UX
8. M3-H offline media drafts/upload coordinator and local-schema upgrade
9. M3-I upload expiry, orphan cleanup, and deletion-manifest integration
10. M3-J security, PostgreSQL, browser, repository-health, and Android closure

## Security boundary

M3 does not implement stable E2EE.

ADR-012 allows a development-only server-recoverable media-key escrow while keeping object storage ciphertext-only. This is architecture debt with an explicit removal condition.

S1 must client-reencrypt retained pre-S1 assets with fresh keys never disclosed to the server, or wipe them. Rewrapping an old server-known media key is not sufficient to claim E2EE.

## Lifecycle boundary

- active: normal media send/reference/read
- breakup_pending: ordinary chat media remains allowed; R1 user mutations remain view-only
- account-deletion pending: existing authorized shared media is view-only; no new media mutation
- terminated: no new grants or mutations; durable provider cleanup proceeds

## Closure boundary

M3 is DONE only after its detailed gates in `ROADMAP_EPICS.md` pass, including:

- migrations 0015/0016
- private ciphertext-only provider storage
- signed transfer authorization
- M1/R1 reference isolation
- offline upload recovery
- generation-fenced orphan cleanup
- deletion-manifest provider cleanup
- browser acceptance
- physical Android image/video/file/voice flows
- full health and dependency audit

**REDMI PHONE REQUIRED: YES.**

Detailed design-time physical-device acceptance is defined in `testing/M3_ANDROID_ACCEPTANCE.md`. The named M3 device commands remain planned until implementation creates them.

M3 implementation must start from the verified mainline after M2 closure. The current `design/m3-media-voice` branch is documentation only.

# Milestone 8: C1 Voice Calling

Status: PLANNED.

Depends on verified M2 and may progress alongside M3.

## Goal

Establish the shared private calling substrate and close audio-only calling end to end before adding camera/video complexity.

## Core scope

- call signaling and shared call lifecycle
- voice calls
- microphone permission and audio capture
- accept, reject, cancel
- missed-call state
- call history with call type = voice
- short-lived TURN credentials
- relay-first privacy
- TURN/TCP or TURN/TLS fallback where supported
- breakup-pending explicit acceptance for every call
- interruption, reconnect, and background/foreground behavior for voice calls

## Explicit C1 boundary

C1 does not enable camera capture or video media. It establishes the signaling, authorization, TURN, lifecycle, history, and reconnect substrate that C2 reuses.

## Closure boundary

C1 must prove authorization, no auto-answer, microphone permission behavior, audio-only WebRTC media, TURN credential expiry, relay behavior, lifecycle restrictions, voice call-history isolation/deletion, reconnect safety, and real physical-device voice calls.

**REDMI PHONE REQUIRED: YES, MANDATORY.**

# Milestone 9: C2 Video Calling

Status: PLANNED.

Depends on verified C1 Voice Calling.

## Goal

Extend the verified C1 call core with private camera/video media without duplicating signaling, TURN, lifecycle, or call-history authority.

## Core scope

- video calls using the C1 signaling and call lifecycle
- camera permission and video capture
- video media negotiation over WebRTC
- call history with call type = video
- relay-first privacy inherited from C1
- TURN credentials and restrictive-network fallback inherited from C1
- breakup-pending explicit acceptance inherited from C1
- video-specific interruption, reconnect, background/foreground, and device behavior

## Explicit C2 boundary

C2 must reuse C1 authorization, signaling state, TURN issuance, call-state persistence, deletion, and lifecycle rules. It must not create a parallel video-call authority or a second call-state model.

## Closure boundary

C2 must prove camera permission behavior, video media negotiation, relay/privacy behavior, lifecycle restrictions, call-history isolation/deletion, reconnect safety, and real physical-device video calls while the complete C1 voice regression remains green.

**REDMI PHONE REQUIRED: YES, MANDATORY.**

# Milestone 10: S1 E2EE and Cryptographic Recovery

Status: PLANNED.

Depends on verified messaging, M3 media, C1 voice-calling, and C2 video-calling semantics and requires protocol review before implementation.

## Goal

Protect stable-release private content with reviewed end-to-end encryption while keeping account recovery distinct from cryptographic recovery.

## Core scope

- reviewed maintained protocol selection
- per-device cryptographic identity
- per-partnership cryptographic roots
- crypto epochs
- message encryption
- relationship-object encryption
- attachment encryption
- trusted-device enrollment
- device revocation
- encrypted recovery material
- high-entropy recovery secret
- metadata minimization
- protocol versioning
- lifecycle cryptographic deletion

## Non-negotiable boundary

Email-only account recovery must never recover historical protected plaintext.

## Closure boundary

S1 requires protocol review, test vectors where available, ciphertext-at-rest evidence, device enrollment/revocation tests, recovery-secret tests, future-content denial after revocation, previous-partnership isolation, cryptographic deletion, updated threat model, and physical-device validation.

**REDMI PHONE REQUIRED: YES, MANDATORY.**

# Milestone 11: R2 Public Readiness

Status: PLANNED.

Depends on all stable-release feature epics and V1 Hosted CI Verification.

## Goal

Turn the verified private product into an operationally releasable system.

## Core scope

- hosted CI verification
- dependency and secret scanning
- privacy documentation
- abuse/reporting controls
- production provider configuration
- backup/restore deletion safety
- observability
- browser E2E
- deletion operational recovery
- migration and release runbook
- final security review
- staged release and rollback

## Closure boundary

R2 is DONE only when every stable-release PRD gate, V1, browser acceptance, physical Android acceptance, calling privacy acceptance, E2EE review, deletion recovery, and launch rollback gate is green.

**REDMI PHONE REQUIRED: YES, MANDATORY.**

# Stable Release

Status: BLOCKED until R2 is DONE.

Stable release requires:

- verified partnership isolation
- reviewed E2EE
- safe account and cryptographic recovery separation
- verified deletion workflows
- browser security baseline
- media/calling privacy acceptance
- supported physical-device acceptance
- operational release and rollback evidence

# Verification Track: V1 Hosted CI

Status: BLOCKED while GitHub Actions capacity is unavailable.

V1 does not block feature development, but R2 cannot close without it.

When capacity returns:

1. run Baseline CI without a skip marker or manually dispatch it
2. verify hosted `npm ci`
3. verify hosted `npm run ci:baseline`
4. verify hosted dependency audit
5. record workflow evidence in `PROJECT_STATE.md`
6. close every V1 gate in `ROADMAP_EPICS.md`

# Post-stable: X1 Maturity

Status: PLANNED after stable release.

Use production evidence to drive:

- reliability follow-up
- incident learning
- storage and bandwidth measurement
- media growth and deletion-cost measurement
- call quality and usage measurement
- retention and backup cost measurement
- targeted optimization
- native clients only if justified
- infrastructure extraction only if measured need justifies it

# Deferred: X2 Heavy Features

Status: DEFERRED.

Optional storage-heavy or privacy-heavy features do not enter the stable-release path merely because they are technically possible.

Initial candidate:

- consensual call recording

Before reconsidering X2, require production evidence for demand, cost, retention, deletion, backup expiry, E2EE compatibility, privacy, legal feasibility, and explicit consent.

Redis and microservices are not roadmap goals by themselves.

## Milestone branch policy

For every milestone branch from this point forward:

1. branch from the latest verified `main`
2. keep unrelated milestones out of scope
3. preserve existing verified migrations unless a forward-only migration is required
4. use committed evidence rather than source presence to close gates
5. reconcile `PROJECT_STATE.md`, `ROADMAP.md`, `ROADMAP_EPICS.md`, and architecture docs at closure
6. merge only after all required gates are green
7. preserve the completed branch for history
8. create dependent milestone branches only after the required upstream milestone is on main
