# Roadmap

## Status

Refreshed: 2026-09-22.

This is the canonical high-level execution roadmap for Shawtie pls.

Verified current implementation state lives in `docs/PROJECT_STATE.md`.
Detailed epic scope and acceptance gates live in `docs/ROADMAP_EPICS.md`.
The compact dependency graph lives in `docs/EXECUTION_GRAPH.md`.

An epic is DONE only when its required acceptance gates have executed evidence.

## Verified baseline

The verified P3 code baseline is commit `9820801`, now contained in `main`. Documentation-only roadmap reconciliation may advance the `main` branch beyond that code commit without changing the verified runtime baseline.

Completed milestones:

| Milestone | Status | Verified boundary |
| --- | --- | --- |
| 0 Verified Foundation | DONE | F0, F1, F2 |
| 1 A1 Accounts and Devices | DONE | 20/20 gates |
| 2 P1 Discovery and Partner Requests | DONE | 14/14 gates |
| 3 P2 Partnership Formation | DONE | 11/11 gates |
| 4 P3 Partnership Lifecycle | DONE | 22/22 gates |
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
4. media and calling
5. reviewed end-to-end encryption and cryptographic recovery
6. public-readiness verification
7. stable release

Do not reopen verified foundation or lifecycle boundaries without concrete regression evidence or an approved architecture change.

## Milestone summary

| Milestone | Status | Depends on | Physical Android |
| --- | --- | --- | --- |
| 5A M1 Messaging Core | NEXT | P3 | No for core closure |
| 5B R1 Relationship Space | NEXT, may run in parallel | P3 | No for core closure |
| 6 M2 Realtime and Offline Reliability | PLANNED | M1 | Yes |
| 7 M3 Media and Voice Messages | PLANNED | M2 | Yes |
| 8 C1 Voice and Video Calling | PLANNED | M2 | Yes, mandatory |
| 9 S1 E2EE and Cryptographic Recovery | PLANNED | M3 and C1 | Yes, mandatory |
| 10 R2 Public Readiness | PLANNED | all pre-release epics plus V1 | Yes, final acceptance |
| Stable Release | BLOCKED | R2 | Yes |
| X1 Post-stable Maturity | PLANNED | Stable Release | As needed |
| X2 Deferred Heavy Features | DEFERRED | production evidence | As required |

## Immediate execution sequence

The next verified-mainline work is:

~~~text
latest main containing verified P3
  |
  +--> feat/m1-messaging-core
  |
  +--> feat/r1-relationship-space
~~~

M1 and R1 may progress in parallel because both now depend on the verified P3 lifecycle/capability boundary rather than on each other.

Recommended execution order:

1. create `feat/m1-messaging-core` from the latest `main` containing verified P3
2. create `feat/r1-relationship-space` from that same verified mainline when R1 implementation begins
3. keep M1 and R1 schema/API changes explicitly coordinated
4. close each epic only from its own acceptance evidence
5. merge completed milestone branches back to main before dependent milestones branch
6. begin M2 only from main containing verified M1
7. keep V1 separate until hosted Actions capacity returns

# Milestone 5A: M1 Messaging Core

Status: NEXT.

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

## Closure boundary

M1 is DONE only after its API, persistence, ordering, durable synchronization, idempotency, optimistic-concurrency, lifecycle, race, deletion, privacy, security, and browser core gates pass.

**REDMI PHONE REQUIRED: NO for core closure.**

# Milestone 5B: R1 Relationship Space

Status: NEXT. May run in parallel with M1.

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
- breakup_pending makes mutable relationship objects view-only
- scheduled For You and Future Us releases continue according to product rules
- restoration returns permitted objects to writable state
- final dissolution removes relationship-space authorization before cleanup
- location memories require explicit user-created location data
- no passive background location tracking
- no inferred emotional state
- no followers, feeds, rankings, ads, or streak mechanics

## Closure boundary

R1 is DONE only after data-model, versioning, lifecycle, deletion, privacy, cross-partnership, and browser gates pass.

**REDMI PHONE REQUIRED: NO for core closure.**

# Milestone 6: M2 Realtime and Offline Reliability

Status: PLANNED.

Depends on verified M1.

## Goal

Make messaging reliable across reconnects, offline periods, browser lifecycle changes, and duplicate delivery.

## Core scope

- authenticated WebSocket
- server-derived channel membership
- reconnect
- canonical resynchronization
- sequence-gap repair
- duplicate-safe realtime delivery
- IndexedDB namespace partitioning
- offline message queue
- relationship mutation queue
- lifecycle-aware queued mutation rejection
- service-worker compatibility handling
- client/API/realtime version safety

## Closure boundary

M2 must prove reconnect, resync, offline retry, local namespace isolation, dissolution purge, compatibility behavior, and physical mobile lifecycle behavior.

**REDMI PHONE REQUIRED: YES.**

# Milestone 7: M3 Media and Voice Messages

Status: PLANNED.

Depends on verified M2.

## Goal

Add private media and recorded voice while preserving partnership authorization, deletion, and future E2EE compatibility.

## Core scope

- images
- short video
- selected files
- voice messages
- client-side media preparation
- private object storage
- opaque object keys
- short-lived signed access
- attachment authorization
- deletion-manifest integration
- E2EE-compatible media path

## Closure boundary

M3 must prove size limits, private storage, authorization, signed-access expiry, cross-partnership denial, deletion behavior, cleanup retry, and physical Android media flows.

**REDMI PHONE REQUIRED: YES.**

# Milestone 8: C1 Voice and Video Calling

Status: PLANNED.

Depends on verified M2 and may progress alongside M3.

## Goal

Add authorized private realtime calling with explicit privacy and lifecycle rules.

## Core scope

- call signaling
- voice calls
- video calls
- accept, reject, cancel
- missed-call state
- call history
- short-lived TURN credentials
- relay-first privacy
- TURN/TCP or TURN/TLS fallback where supported
- breakup-pending explicit acceptance for every call

## Closure boundary

C1 must prove authorization, no auto-answer, TURN credential expiry, relay behavior, lifecycle restrictions, call-history isolation/deletion, reconnect safety, and real physical-device calls.

**REDMI PHONE REQUIRED: YES, MANDATORY.**

# Milestone 9: S1 E2EE and Cryptographic Recovery

Status: PLANNED.

Depends on verified messaging/media/calling semantics and requires protocol review before implementation.

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

# Milestone 10: R2 Public Readiness

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
