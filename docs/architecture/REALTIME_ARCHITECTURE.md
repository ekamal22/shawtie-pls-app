# Realtime Architecture

## Purpose

Realtime transport improves responsiveness but does not replace authoritative state in PostgreSQL.

## Version compatibility

Realtime connections identify supported client and realtime protocol versions.

Unknown critical event versions cause canonical resynchronization instead of unsafe interpretation.

The client also tracks API, crypto protocol, and local schema compatibility as defined in `VERSIONING_AND_COMPATIBILITY.md`.

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
  "messageId": "opaque-id",
  "serverSequence": 944,
  "changeSequence": 1201,
  "contentVersion": 1
}
```

Messaging invalidation events remain content-free. They identify what changed and the authoritative cursor/version needed for reconciliation; they do not carry message bodies or reaction content.

## Message synchronization

M1 establishes two distinct monotonic per-conversation sequences:

- `server_sequence` is immutable message creation order and history pagination
- `change_sequence` is durable synchronization order for message creation, edit, delete, and reaction mutations

Realtime transport must preserve this distinction.

After reconnect, the client first verifies authoritative partnership access, then repairs durable messaging changes after its last committed change sequence. Message history gaps use server-sequence pagination.

An edit, deletion, or reaction change to an old message must therefore be recoverable even when no new message was created.

WebSocket events are hints for low latency. PostgreSQL plus the canonical HTTP change/history APIs remain the source of truth.

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
4. repair durable conversation change-sequence gaps
5. repair any required message-history server-sequence gaps
6. invalidate stale relationship state
7. resume presence and typing state

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

## Push minimization

Push providers should receive the minimum metadata required to wake or notify the client.

Prefer opaque payloads such as:

```json
{
  "type": "message_available",
  "resource": "opaque-id"
}
```

Where the platform permits it, the client fetches and decrypts content before rendering a detailed notification.

Product notification preview settings still apply.

## Security

Every realtime message is schema-validated.

Authorization is evaluated server-side.

A user must never gain access by guessing:

- partnership IDs
- conversation IDs
- media IDs
- call IDs

Rate limits apply to high-frequency event classes such as typing and signaling.
