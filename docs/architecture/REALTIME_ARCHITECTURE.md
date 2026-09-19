# Realtime Architecture

## Purpose

Realtime transport improves responsiveness but does not replace authoritative state in PostgreSQL.

## Transport

Use one authenticated WebSocket connection per active device where practical.

The connection is authenticated using the same trusted session identity as the HTTP API.

## Authorization

Clients must not be allowed to subscribe to arbitrary resource identifiers.

The server derives authorized channels after authentication.

Internal channel concepts may include:

```text
account:{accountId}
partnership:{partnershipId}
conversation:{conversationId}
```

These names are implementation details, not client-granted capabilities.

## Event model

Prefer small invalidation and synchronization events.

Examples:

```text
message.created
message.updated
message.deleted
message.reaction_changed
partnership.changed
relationship.changed
call.signal
account.security_changed
```

A critical event should contain enough information to identify what changed, but clients should reconcile against canonical API state when correctness matters.

Example:

```json
{
  "type": "message.created",
  "conversationId": "opaque-id",
  "sequence": 944
}
```

## Message synchronization

Each conversation uses a monotonic server sequence.

After reconnect, the client requests all events or messages after its last committed sequence.

This avoids relying on socket delivery guarantees or wall-clock ordering.

## Delivery semantics

Design realtime delivery as at-least-once.

Clients must safely handle duplicate events.

All mutation endpoints require idempotency where retries can create duplicate writes.

## Reconnect

On reconnect:

1. reauthenticate
2. rebuild authorized channel membership
3. fetch authoritative partnership state
4. synchronize conversation sequence gaps
5. invalidate stale relationship state
6. resume presence and typing state

A reconnect must never assume the old partnership is still authorized.

## Presence, typing, and read receipts

These features are always enabled by product rule.

They should remain lightweight and use bounded retention.

Presence and typing are transient state, not durable relationship history.

Read receipts may be persisted only as required for synchronization.

## Partnership transitions

On breakup, restoration, account deletion, or final dissolution, the API emits an outbox event.

Realtime delivery then tells clients to refresh authoritative state.

At final dissolution:

- conversation access is revoked
- partnership channels are removed
- pending local operations are invalidated
- clients are instructed to purge the partnership namespace

## Call signaling

WebSocket signaling carries:

- call offers
- call answers
- ICE candidates where applicable
- ringing state
- accept or reject
- end state

The WebSocket does not carry call media.

## Security

Every realtime message is schema-validated.

Authorization is evaluated server-side.

A user must never gain access by guessing:

- partnership IDs
- conversation IDs
- media IDs
- call IDs

Rate limits apply to high-frequency event classes such as typing and signaling.
