# ADR-001: Modular Monolith and Durable Worker

## Status

Accepted.

## Context

Shawtie pls has tightly coupled transactional rules across accounts, partner requests, partnerships, cooldowns, breakup restoration, account deletion, messaging metadata, and relationship data.

Splitting these concerns into microservices would introduce distributed transactions and operational complexity before there is evidence that independent scaling is needed.

At the same time, lifecycle deadlines, email, push, deletion, and retry work must survive API restarts and cannot rely on in-process timers.

## Decision

Use:

- one modular Fastify API application
- one separate durable worker application
- one PostgreSQL transactional source of truth
- explicit internal module boundaries
- shared domain rules in `packages/domain`

The worker handles durable asynchronous and scheduled work.

## Consequences

Benefits:

- lifecycle changes can remain transactional
- fewer distributed failure modes
- lower deployment cost
- simpler local development
- worker failures do not require API request handlers to stay alive
- later service extraction remains possible if measured load justifies it

Costs:

- discipline is required to preserve module boundaries
- API and worker may share a database
- some scaling dimensions are coupled until a future extraction is justified

## Revisit when

Revisit only when measured production load, team ownership, regulatory isolation, or availability requirements justify service extraction.
