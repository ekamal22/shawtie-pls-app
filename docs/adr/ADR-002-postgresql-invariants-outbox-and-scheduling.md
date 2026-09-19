# ADR-002: PostgreSQL Invariants, Outbox, and Durable Scheduling

## Status

Accepted.

## Context

The product includes race-sensitive rules:

- one occupied partnership slot per account
- reciprocal partner requests
- breakup deadlines
- restoration deadlines
- account-deletion recovery
- one-month and three-month cooldowns
- request expiry
- destructive finalization

Application-level checks alone are insufficient under concurrency.

Notifications and other side effects must not become inconsistent with committed state.

## Decision

PostgreSQL is authoritative for lifecycle state.

Use database constraints for critical invariants.

Use transactions and deterministic locking for multi-account transitions.

Use a transactional outbox for side effects.

Use a PostgreSQL-backed scheduled-action table for deadlines and retryable jobs.

Worker claims should use safe locking such as `FOR UPDATE SKIP LOCKED`.

Jobs must be idempotent and must re-check current authoritative state before mutating.

## Consequences

Benefits:

- strong consistency for lifecycle rules
- crash-safe deadlines
- reliable retry
- notifications cannot become the source of truth
- multiple workers can operate safely

Costs:

- schema and migration quality become critical
- worker throughput depends on careful indexing and claim queries
- stale jobs must be explicitly handled

## Rejected alternatives

### In-memory timers

Rejected because deployments, crashes, process sleep, and horizontal scaling can lose or duplicate timers.

### Message broker as initial source of scheduled truth

Rejected for the initial system because it adds infrastructure without removing the need for database authority.

### Application-only uniqueness checks

Rejected because concurrent requests can violate product invariants.
