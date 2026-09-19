# ADR-010: PostgreSQL First Without Redis

## Status

Accepted.

## Context

The initial architecture already depends on PostgreSQL for authoritative state.

Adding Redis immediately would create another state system for sessions, jobs, rate limits, or caching before production measurements show a need.

## Decision

Do not require Redis in the initial architecture.

Use PostgreSQL for durable:

- lifecycle state
- session state where selected by implementation
- scheduled actions
- transactional outbox
- idempotency
- durable rate-limit state where appropriate
- lifecycle event records

Use in-process ephemeral caches only when correctness does not depend on them.

Introduce Redis later only if measured production load or latency justifies it and the consistency boundary is documented.

## Consequences

Benefits:

- fewer moving parts
- lower cost
- simpler local development
- less state divergence
- simpler recovery and deployment

Costs:

- PostgreSQL indexing and query discipline matter more
- some high-frequency workloads may eventually need a dedicated cache or coordination layer
