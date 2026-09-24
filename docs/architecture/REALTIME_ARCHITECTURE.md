# Realtime Architecture

## Purpose

Realtime transport improves responsiveness but does not replace authoritative state in PostgreSQL.

## Version compatibility

Realtime connections identify supported client and realtime protocol versions.

Unknown critical event versions cause canonical resynchronization instead of unsafe interpretation.

The client also tracks API, crypto protocol, and local schema compatibility as defined in `VERSIONING_AND_COMPATIBILITY.md`.

## M2 concrete implementation

The concrete M2 implementation is defined in:

- `M2_REALTIME_OFFLINE_DESIGN.md`
- `../api/M2_REALTIME_PROTOCOL.md`

Implementation status: M2 realtime/offline closure is complete and merged. C1 source implementation adds an explicitly negotiated realtime v2 call invalidation without reopening M2 v1 semantics; C1 final integrated automated/local verification passed at `9b5c255`, and mandatory physical Android acceptance then passed 25/25 on the Redmi Note 9S, including realtime v2 negotiation, dropped-hint anti-entropy repair and the dirty barrier.

M2 uses the official Fastify WebSocket integration, the existing HttpOnly session cookie, exact trusted-Origin validation, server-derived scope, and one dedicated PostgreSQL LISTEN connection per API process.

Cross-process fanout uses compact validated PostgreSQL NOTIFY messages emitted by the durable worker after content-free outbox validation. NOTIFY remains a latency hint only. HTTP and PostgreSQL reconciliation remain authoritative.

M2 does not put durable product mutations on WebSocket. Message and R1 writes remain on their existing HTTP APIs.

One socket's partnership/conversation identity is immutable after ready. If authoritative identity changes, the old scope is removed and the socket reconnects. Browser code also ignores callbacks from an older in-memory connection generation after reconnect. `partnership.changed` invalidations are internally routable by both partnership and authoritative member account IDs so a socket that connected while unpaired can be revalidated immediately when partnership authority changes.

The API LISTEN connection has an in-memory generation. LISTEN loss marks local sockets dirty; after listener recovery the hub sends `control.resync_required(listener_reset)`. Visible clients additionally run low-frequency canonical anti-entropy so silent hint loss cannot leave a healthy-looking socket stale indefinitely.

M2 uses no Redis and is expected to require no new PostgreSQL migration.

## Transport

Use one authenticated WebSocket connection per active device where practical. Application frames are small text JSON only; binary application frames are rejected and per-message compression is disabled.

The connection is authenticated using the same trusted session identity as the HTTP API.

## Authorization

Clients must not be allowed to subscribe to arbitrary resource identifiers. M2 exposes no client subscribe/unsubscribe command; account, partnership, and conversation scope is derived only from the authenticated server session and current database state.

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

After reconnect, the client first verifies authoritative partnership access, then repairs durable messaging changes after its last committed change sequence. Message history gaps use server-sequence pagination. The client enters live mode only after a dirty-counter/high-water barrier proves no relevant realtime invalidation raced the final reconciliation window.

An edit, deletion, or reaction change to an old message must therefore be recoverable even when no new message was created.

WebSocket events are hints for low latency. PostgreSQL plus the canonical HTTP change/history APIs remain the source of truth. The client advances its durable local change cursor only in the same IndexedDB transaction that commits the canonical projections obtained through HTTP reconciliation.

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

## C1 call realtime and signaling

M2 `shawtie.realtime.v1` remains the closed content-free protocol that shipped with M2.

C1 introduces `shawtie.realtime.v2`, which preserves v1 behavior and adds only `call.changed` containing opaque call identity/version information required to trigger canonical HTTP refresh. Existing frame schema versions remain independent from the negotiated WebSocket subprotocol version.

SDP, ICE, TURN credentials, device labels, IP/network data, and call-control mutations never enter the ordinary realtime channel.

After explicit call acceptance, C1 uses the separate authenticated `shawtie.call.v1` WebSocket at `/api/v1/calls/:callId/signal` for transient WebRTC negotiation.

The existing Fastify WebSocket plugin is a shared transport seam, not a shared application protocol. C1 changes global negotiation to an explicit single-protocol allowlist and every route rechecks the exact negotiated protocol it owns. If transport `maxPayload` rises for signaling SDP, M2 v1/v2 still enforce the existing 4 KiB application-frame ceiling before JSON interpretation.

For realtime v2, `call.changed` increments the normal dirty counter and current-call HTTP reconciliation participates in initial sync, reconnect repair, listener-reset repair, and visible anti-entropy.

Signaling data is never persisted or logged. SDP is candidate-free and trickle candidates are parsed and restricted to relay candidates before forwarding.

The signaling WebSocket does not carry call media.

See `C1_VOICE_CALLING_DESIGN.md` and `../api/C1_SIGNALING_PROTOCOL.md`.

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
