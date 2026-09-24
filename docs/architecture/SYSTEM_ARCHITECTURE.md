# System Architecture

## Status

Accepted architecture baseline for implementation.

## Goals

The architecture must support the product rules in the PRD while remaining secure, testable, affordable, and practical to operate as a public PWA.

The design prioritizes:

- strong partnership isolation
- transactional lifecycle rules
- durable deadline execution
- explicit authorization
- offline reliability
- end-to-end encryption readiness
- low operational complexity
- clear dependency boundaries
- future scale without premature microservices

## Architecture choice

Shawtie pls uses a modular monolith with a separate durable worker.

The runtime consists of:

```text
React PWA
   |
HTTPS and WebSocket
   |
Fastify API
   |
   +-- PostgreSQL
   +-- private object storage
   +-- transactional outbox
   +-- scheduled actions
   |
Durable worker
   |
   +-- deadline processing
   +-- email
   +-- push
   +-- deletion
   +-- retries

Voice and video:
PWA <-> WebRTC <-> TURN relay when required
```

Microservices are intentionally not used for the initial system. The product requires strong transactional consistency across accounts, partner requests, partnerships, cooldowns, and lifecycle transitions. A modular monolith keeps those transitions inside one database transaction and avoids unnecessary distributed failure modes.

## Applications

### apps/web

Responsibilities:

- React user interface
- routing and application shell
- account and partnership UX
- IndexedDB cache
- offline mutation queues
- WebSocket client
- WebRTC client
- client-side cryptographic operations
- encrypted media preparation
- PWA manifest and service worker

The web client is not authoritative for eligibility, cooldowns, lifecycle deadlines, or authorization.

### apps/api

Responsibilities:

- authentication and session validation
- request validation
- account operations
- partner discovery and requests
- partnership lifecycle commands
- messaging API
- relationship-space API
- media authorization
- WebSocket authentication and signaling
- call signaling
- server-side authorization
- transactional writes
- outbox creation
- scheduled-action creation

The API should remain stateless between requests except for database-backed and explicitly ephemeral connection state.

### apps/worker

Responsibilities:

- scheduled deadline execution
- partner-request expiry
- breakup finalization
- account-deletion finalization
- reminder scheduling
- email delivery
- push delivery
- object purge orchestration
- outbox processing
- bounded maintenance jobs
- retry with idempotency

The worker is a first-class application. Long-lived timers must not be held only in API process memory.

## Packages

### packages/domain

Pure business rules and state transitions.

It must not import React, Fastify, PostgreSQL clients, storage SDKs, email SDKs, or provider-specific infrastructure.

Examples:

- age eligibility
- username eligibility
- partner-request eligibility
- partnership formation
- breakup initiation
- one-hour breakup cancellation
- restoration intent
- final dissolution
- partner cooldowns
- message edit eligibility
- account-deletion recovery policy

### packages/contracts

Runtime-validated request, response, and realtime schemas.

All external input must be parsed at runtime. TypeScript compile-time types alone are not sufficient for trust boundaries.

### packages/db

Database schema, migrations, relations, query helpers, transaction helpers, and repository implementations.

### packages/crypto

A narrow abstraction over reviewed cryptographic implementations.

Application code must not depend directly on low-level cryptographic primitives.

### packages/ui

Reusable presentation components without product-domain authority.

### packages/testkit

Synthetic fixtures, deterministic clocks, database helpers, fake providers, and reusable test utilities.

No real user data belongs in this package.

## Dependency direction

Preferred dependency direction:

```text
apps/web ------> contracts, crypto, ui
apps/api ------> domain, contracts, db, crypto
apps/worker ---> domain, contracts, db
domain --------> no infrastructure package
db ------------> schema and persistence concerns only
crypto --------> reviewed crypto implementation only
```

Avoid generic catch-all folders such as `shared`, `common`, `helpers`, or `misc`.

## Central capability engine

State-dependent permissions are resolved by a centralized capability engine in `packages/domain`.

API handlers, workers, and UI presentation must not invent independent versions of lifecycle permission rules.

The API always evaluates capabilities against authoritative state before mutation.

See `CAPABILITY_MODEL.md`.

## Device and recovery boundary

Account authentication recovery and E2EE content recovery are separate.

Verified-email recovery may restore account access, but it must not automatically expose historical encrypted plaintext.

Devices are first-class security principals with revocable authentication and cryptographic authorization.

See `../security/DEVICE_AND_RECOVERY.md`.

## Cryptographic epochs

Each partnership owns a cryptographic context with an explicit epoch.

Epoch changes support reviewed key rotation, device revocation, and future protocol migration without changing the partnership identity.

A completely new partnership always starts with a new cryptographic root and new epoch namespace.

## Source of truth

PostgreSQL is authoritative for:

- account status
- username eligibility
- verified email ownership
- partner requests
- partnership occupancy
- breakup state
- restoration intent
- deadlines
- partner cooldowns
- account-deletion state
- durable message metadata
- relationship-item metadata
- job state
- outbox state

Clients may cache state but may not decide authoritative lifecycle outcomes.

## Time

All authoritative timestamps are generated from trusted server infrastructure and stored as UTC instants.

For PostgreSQL-backed authoritative mutations, transaction-consistent business time comes from PostgreSQL transaction time. Lease expiry and renewal use an explicitly advancing PostgreSQL clock rather than Node process time.

Calendar-month rules are computed on the server.

Examples:

- three calendar months after breakup final dissolution
- one calendar month after permanent partner-account deletion
- one calendar year after username change

Client clocks are display-only.

## F2 runtime design

The concrete persistence and worker implementation design is defined in `F2_PERSISTENCE_WORKER_DESIGN.md`.

F2 is implemented and locally verified. It provides the transaction kernel, durable worker, scheduled actions, outbox, claim fencing, lifecycle-event persistence, deletion runtime, and PostgreSQL integration harness used by later epics.

## A1 accounts and authentication design

The account and authentication runtime is implemented and verified complete from `A1_ACCOUNTS_DEVICES_DESIGN.md`. A1 is DONE at 20/20 acceptance gates.

A1 preserves this system architecture and implements:

- Argon2id password credentials
- registration intents and verified-email challenges
- opaque server-revocable browser sessions
- versioned HMAC verifiers and key rotation
- device records and non-authenticating device handles
- exact-origin, Fetch Metadata, and custom-header CSRF defenses
- explicit trusted-proxy handling
- PostgreSQL-backed security rate limits
- durable security-email delivery through the F2 outbox
- account deletion request, recovery, and generation-guarded finalization
- strict account-recovery versus cryptographic-recovery separation

A1 adds no Redis, stateless browser JWT session model, or new lifecycle authority. PostgreSQL remains authoritative.

## P1 discovery and partner-request design

The partner-discovery and request implementation design is defined in `P1_DISCOVERY_REQUESTS_DESIGN.md`.

P1 uses:

- authenticated exact username discovery
- privacy-safe profile projection
- A1 sessions and username normalization
- deterministic F2 account locking
- PostgreSQL partner-request state
- PostgreSQL pair-limit history
- generalized A1 security-rate-limit buckets
- F2 scheduled actions for request expiry
- logical expiry checks so worker timing cannot extend product deadlines

P1 is locally verified and exposes the reciprocal-candidate seam while intentionally not creating partnerships in test-only request mode. P2 implements that exact verified seam for transactional reciprocal formation and also owns explicit acceptance while preserving the same deterministic account locks.

## P2 partnership formation design

The hardened P2 design is defined in `P2_PARTNERSHIP_FORMATION_DESIGN.md`. Its runtime is implemented against the committed P1 interface and locally verified at all 11 P2 acceptance gates on closure commit `fa2301d0`. The verified matrix includes domain/contracts 14/14, security 5/5, nine migrations with database invariants green, disposable integration 27/27 with `P2_LOCAL_POSTGRES_PASS`, full repository health, and a zero-high-severity dependency audit.

P2 preserves the modular-monolith transaction boundary:

- P1 owns request creation, request timing, limits, reciprocal detection, idempotency, and request-expiry scheduling
- P2 owns explicit acceptance and formation, and cancels still-pending expiry actions for requests consumed by formation
- reciprocal formation executes through P1's committed `handleReciprocalCandidate` seam before the P1 create transaction commits
- both accounts are locked in deterministic order
- PostgreSQL occupied-slot uniqueness is the final double-partnership defense
- every request carries a manually entered relationship start date so reciprocal formation never invents one from activation time
- metadata edits use partnership `version`; lifecycle deadlines use `generation`
- the fresh immutable partnership ID is the local and future cryptographic namespace root; actual cryptographic keys and epochs remain deferred to S1
- an expiry action already processing when formation wins must observe the accepted terminal request and complete as a safe no-op
- P2 provides durable in-app partnership notifications without requiring push transport

## P3 partnership lifecycle design

The hardened P3 design is defined in `P3_PARTNERSHIP_LIFECYCLE_DESIGN.md` on the dedicated `feat/p3-partnership-lifecycle` branch. P3-A through P3-H are implemented and locally verified at all 22 acceptance gates. The verified matrix includes lifecycle domain/contracts 28/28, security 6/6, ten migrations with database invariants green, disposable integration 39/39 with `P3_LOCAL_POSTGRES_PASS`, full repository health, and a zero-high-severity dependency audit.

P3 preserves the existing authority boundaries:

- A1 owns account deletion and recovery
- P1 owns discovery and partner-request behavior
- P2 owns partnership formation and mutable relationship metadata
- P3 owns breakup, restoration, final dissolution, lifecycle cooldowns, former-partner blocking, and partnership-scoped destructive cleanup
- F2 provides scheduled actions, lifecycle events, outbox delivery, and deletion target processing

P3 uses one canonical partnership-dissolution kernel for both normal breakup and permanent partner-account deletion. It revokes authorization synchronously by terminating the partnership and releasing occupied memberships before deletion workers process physical cleanup. Breakup finalizers are fenced by breakup-process generation. Lifecycle-only transitions advance `generation` and leave P2 metadata `version` unchanged.

Migration 0010 implements breakup cancellation and supersession terminal markers, cooldown and block hardening, former-history and cleanup indexes, and one-partnership deletion-manifest uniqueness without rewriting verified migrations 0001 through 0009.

## M1 messaging core design

The refined M1 design is defined in `M1_MESSAGING_CORE_DESIGN.md` and `../api/M1_MESSAGING_API.md`.

M1 preserves the verified P3 lifecycle and transaction authority while adding the conversation substrate:

- `server_sequence` remains immutable message creation order and history pagination
- a separate `change_sequence` orders durable send/edit/delete/reaction mutations
- content-free `conversation_changes` provide canonical mutation catch-up for polling and later M2 reconnect
- M1 writes content-free versioned outbox invalidations in the same authoritative mutation transaction
- edits use `expectedContentVersion` so concurrent clients cannot silently overwrite one another
- pre-S1 development stores only current message/reaction plaintext and does not create plaintext edit history
- private mutation mismatch fingerprints use a versioned keyed server construction rather than an ordinary digest of message content
- presence disclosure is limited to the current partnership and does not reveal last-seen activity from before that partnership activated
- typing and presence use centralized server-owned TTL, cadence, coalescing, and rate limits
- messaging cleanup remains module-owned and composes with the canonical P3 dissolution kernel

M1 keeps PostgreSQL and HTTP canonical. M2 may add WebSocket delivery and offline queues without redefining message order, mutation order, lifecycle authorization, or deletion semantics.

## R1 relationship-space design

The hardened R1 design is defined in `R1_RELATIONSHIP_SPACE_DESIGN.md` and `../api/R1_RELATIONSHIP_SPACE_API.md`. R1 is implemented and DONE on the combined integration baseline `5db7a94`.

R1 preserves the same partnership authority boundary while adding:

- relationship-item CRUD and structured relationship experiences
- explicit creator-owned versus pair-mutable policy
- preview and sealed-main release semantics
- generation-fenced scheduled release using the existing F2 worker substrate
- account-deletion pause/recovery and P3 final-dissolution cleanup
- R1-owned migrations 0013 and 0014 after M1-owned 0011 and 0012
- a registered M1 message-reference resolver that authorizes only real same-partnership messages
- independent Remember This snapshots that never server-copy M1 message plaintext
- fail-closed M3 media/voice references until M3 exists

The exhaustive combined baseline applies canonical migrations 0001 through 0014 with no reservations and passes R1 69/69 plus the full repository health matrix.

## M2 realtime and offline reliability design

The concrete M2 design is defined in `M2_REALTIME_OFFLINE_DESIGN.md` and `../api/M2_REALTIME_PROTOCOL.md`.

M2 preserves the modular monolith and adds a transport/cache reliability layer without creating a second authority system:

- the API exposes one authenticated WebSocket endpoint for content-free invalidations and transient presence/typing
- the existing HttpOnly server session authenticates the upgrade
- realtime scope is derived by the server from current account, partnership, and conversation state
- durable product mutations remain on existing HTTP endpoints
- the F2 durable outbox remains the source for reliable change publication
- the worker publishes validated compact PostgreSQL NOTIFY hints
- each API process uses one dedicated LISTEN connection for cross-process fanout
- missed NOTIFY or WebSocket delivery is repaired from canonical HTTP/PostgreSQL state
- LISTEN reset forces local socket resynchronization, while visible-page anti-entropy bounds silent hint-loss recovery
- a socket keeps immutable partnership/conversation identity for its lifetime; identity change forces reconnect
- the client enters live state only after a dirty-counter/high-water synchronization barrier closes
- IndexedDB stores bounded account/partnership/conversation-scoped cache and typed offline queues
- pre-S1 cold-start offline mode keeps protected local plaintext locked until server-session validation
- multi-tab queue replay uses local claim-generation fencing in addition to server idempotency
- offline replay occurs only after authoritative session/lifecycle reconciliation
- final dissolution is a hard local namespace purge boundary
- service workers cache application shell/static assets only and never private API data

M2 introduces no Redis and is expected to require no new PostgreSQL migration.

M1 sequence semantics remain unchanged: `server_sequence` is history order and `change_sequence` is durable mutation synchronization order.

## C1 voice-calling implementation

The concrete C1 design and source implementation are defined by `C1_VOICE_CALLING_DESIGN.md`, with API contract `../api/C1_CALLING_API.md` and transient signaling protocol `../api/C1_SIGNALING_PROTOCOL.md`. Source implementation and automated/local closure are complete on `feat/c1-voice-calling`, with canonical local closure at `439b09f`; mandatory physical Android acceptance and final M3-integrated migration closure remain open.

C1 preserves the modular monolith and PostgreSQL authority while adding:

- refined durable state in the existing call tables
- authenticated HTTP for every durable call mutation
- explicit `shawtie.realtime.v2` negotiation for content-free `call.changed` invalidation while M2 v1 remains unchanged
- dedicated accepted-call `shawtie.call.v1` signaling for transient SDP/ICE
- fixed caller endpoint and first-accept-wins callee endpoint
- relay-only TURN with short-lived credentials
- candidate-free SDP and server-validated relay-only trickle candidates
- generic Web Push background wakeup bound to current account/device authorization
- durable ring/connect/hard timeout fencing
- implemented C1 migrations 0017/0018 coordinated with implemented but unmerged M3 0015/0016
- physical Android acceptance

C1 does not add Redis, an SFU/MCU, call recording, direct peer fallback, or video. C2 later enables video over the same verified call substrate.

Accepted ADR-013 isolates call signaling from M2 realtime. Accepted ADR-014 refines the frozen relay-first baseline to relay-only for C1.

## Durable deadlines

Never implement product deadlines with only in-memory timers.

Use a table such as:

```text
scheduled_actions
- id
- action_type
- aggregate_type
- aggregate_id
- execute_at
- status
- attempt_count
- deduplication_key
- payload
- created_at
- completed_at
```

Workers claim due rows with transaction-safe locking such as `FOR UPDATE SKIP LOCKED`.

F2 requires claimed durable work to use recoverable lease semantics plus a monotonically increasing fencing token so a worker crash cannot leave a row permanently stranded in `processing` and a late stale worker cannot acknowledge reclaimed work. Normal claim queries reclaim expired processing rows directly. Claim transactions remain short and must not hold row locks while external work executes.

Polling remains the correctness mechanism. PostgreSQL `LISTEN/NOTIFY` may be added only as an optional wake-up optimization with polling fallback.

Every scheduled action must be idempotent.

Lifecycle-sensitive scheduled actions also carry an expected aggregate generation or version.

Before execution, the worker compares the expected generation with current authoritative state.

A mismatch marks the job stale and prevents an outdated deadline from mutating newer state.

## Lifecycle event ledger

Sensitive lifecycle transitions also append a non-content event record.

Examples:

- breakup initiated
- breakup cancelled
- restore intent submitted
- partnership restored
- partnership dissolved
- account deletion started
- account recovered
- account permanently deleted
- cooldown started
- cooldown ended
- device revoked

The ledger is not full event sourcing. Current relational rows remain the source of current state.

Lifecycle events contain identifiers, versions, timestamps, and transition metadata, but never private message or relationship content.

## Transactional outbox

Important state changes and their side effects must be connected through a transactional outbox.

Example breakup transaction:

```text
BEGIN
  update partnership lifecycle
  insert breakup process
  insert scheduled deadline
  insert outbox event
COMMIT
```

The worker later delivers WebSocket events, push notifications, and email from the outbox.

Outbox delivery is at-least-once. Consumers must tolerate duplicate delivery and should use provider idempotency where available. Scheduled-action and outbox durable payloads are explicitly versioned and unsupported versions fail closed. External provider calls do not occur inside the authoritative database transaction.

This prevents database state from disagreeing with notification side effects after partial failures.

## Deletion workflow

Cross-system deletion uses durable deletion manifests.

Authorization and cryptographic access are revoked first. Physical cleanup across PostgreSQL, object storage, local clients, push state, and backup-expiration obligations is then retried until complete.

See `DELETION_ARCHITECTURE.md`.

## Two-account transaction helper

Operations involving two accounts use a shared transaction helper that locks account rows in deterministic immutable-ID order.

This applies to partnership formation, reciprocal partner requests, and other race-sensitive two-account transitions.

The helper reduces deadlocks and prevents inconsistent lock ordering across modules.

## Database runtime safety

F2 normally uses PostgreSQL `READ COMMITTED` with explicit row locks and database constraints.

The database runtime owns whole-transaction retry classification for retryable PostgreSQL failures such as deadlocks and serialization failures.

Application connections use bounded statement, lock, and idle-in-transaction timeout policy. The Node PostgreSQL pool owns idle-client error handling and guarantees client release.

Queue indexes must be validated against realistic synthetic queue sizes and the intended due-work query plans.

## Runtime dependencies

Do not add Redis to the initial architecture.

PostgreSQL owns durable sessions, scheduled jobs, outbox state, idempotency records, and rate-limit state where practical.

Redis may be introduced later only when measured production behavior shows a clear need and its consistency model is explicitly documented.

## Deployment principle

Prefer one deployment unit for the API, one for the worker, one static or edge deployment for the PWA, one PostgreSQL database, one private object store, and TURN infrastructure.

Provider choice may change without changing domain contracts.

TURN credentials must be short-lived and issued only after authenticated call authorization. Static TURN credentials must never be embedded in the PWA.

## Scaling path

Scale vertically and with additional stateless API or worker replicas before considering service extraction.

Potential future extraction candidates, only if justified by measured load, include:

- media processing
- realtime gateway
- email delivery
- call signaling

Domain ownership and database invariants must remain explicit if any extraction occurs.
