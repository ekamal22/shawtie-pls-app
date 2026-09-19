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

All authoritative timestamps are server-generated and stored as UTC instants.

Calendar-month rules are computed on the server.

Examples:

- three calendar months after breakup final dissolution
- one calendar month after permanent partner-account deletion
- one calendar year after username change

Client clocks are display-only.

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

Every scheduled action must be idempotent.

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

This prevents database state from disagreeing with notification side effects after partial failures.

## Deployment principle

Prefer one deployment unit for the API, one for the worker, one static or edge deployment for the PWA, one PostgreSQL database, one private object store, and TURN infrastructure.

Provider choice may change without changing domain contracts.

## Scaling path

Scale vertically and with additional stateless API or worker replicas before considering service extraction.

Potential future extraction candidates, only if justified by measured load, include:

- media processing
- realtime gateway
- email delivery
- call signaling

Domain ownership and database invariants must remain explicit if any extraction occurs.
