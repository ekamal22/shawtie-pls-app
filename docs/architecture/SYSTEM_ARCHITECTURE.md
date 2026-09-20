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

The active account and authentication implementation design is defined in `A1_ACCOUNTS_DEVICES_DESIGN.md`.

A1 preserves this system architecture and adds implementation detail for:

- Argon2id password credentials
- registration intents and verified-email challenges
- opaque server-revocable browser sessions
- versioned HMAC verifiers and key rotation
- device records and non-authenticating device handles
- exact-origin, Fetch Metadata, and custom-header CSRF defenses
- explicit trusted-proxy handling
- PostgreSQL-backed authentication rate limits
- durable security-email delivery through the F2 outbox
- account deletion request, recovery, and generation-guarded finalization
- strict account-recovery versus cryptographic-recovery separation

A1 adds no Redis, stateless browser JWT session model, or new lifecycle authority. PostgreSQL remains authoritative.

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
