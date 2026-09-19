# ADR-008: Lifecycle Ledger and Generation Guards

## Status

Accepted.

## Context

Breakup, restoration, account deletion, cooldowns, device revocation, and scheduled finalization are security-sensitive transitions.

Idempotency alone does not prevent an old scheduled job from acting on a newer lifecycle state.

Debugging race conditions also requires durable transition evidence without adopting full event sourcing.

## Decision

Use:

- append-only lifecycle event records for sensitive transitions
- aggregate generation or version values
- expected-generation values on lifecycle-sensitive scheduled actions

A worker compares the scheduled expected generation with current authoritative state before mutation.

A mismatch means the job is stale and must not mutate the aggregate.

Lifecycle events contain only identifiers, event type, actor where relevant, version, timestamp, and non-content transition metadata.

Current relational rows remain the source of current state.

## Consequences

Benefits:

- stale jobs fail safely
- race analysis is easier
- sensitive transitions are auditable
- no need for full event sourcing

Costs:

- aggregate generation rules must be consistent
- event retention policy must be defined
- lifecycle events must remain free of private content
