# ADR-003: Realtime and Offline Consistency

## Status

Accepted.

## Context

The PWA must support realtime communication and unreliable networks without treating WebSocket delivery or client cache as authoritative.

Partnership transitions can invalidate permissions while a device is offline.

## Decision

Use authenticated WebSockets for realtime invalidation, synchronization hints, presence, typing, read-receipt routing, and call signaling.

Use HTTP API and PostgreSQL state as canonical authority.

Use two monotonic per-conversation sequences for messaging:

- server sequence for immutable message creation order and history pagination
- durable change sequence for synchronization of message creation, edits, deletes, and reaction mutations

Persist content-free change metadata so reconnect can recover mutations to older messages even when no new message sequence was created.

Use IndexedDB for local state, partitioned by account, partnership, conversation, and cryptographic context.

Track client, API, crypto protocol, and local schema versions explicitly. Unsupported critical versions fail closed and trigger refresh, upgrade, or canonical resynchronization rather than unsafe interpretation.

Use separate typed offline queues for chat and relationship mutations.

All retryable mutations use idempotency keys.

Shared mutable objects use expected-version checks.

## Consequences

Benefits:

- reconnect can repair missed realtime events and old-message mutations from the durable change cursor
- immutable message ordering is not overloaded as mutation ordering
- duplicate delivery is safe
- stale offline actions can be rejected after lifecycle changes
- old partnership data has a clear purge boundary
- WebSocket outages do not corrupt durable state

Costs:

- clients need explicit reconciliation logic
- local schema migrations require care
- conflict UX must be defined for shared mutable objects
- compatibility policy must be maintained across PWA, API, crypto, realtime, and IndexedDB changes
