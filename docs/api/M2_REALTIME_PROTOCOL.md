# M2 Realtime Protocol

## Status

Canonical protocol design for M2 implementation.

Protocol identifier:

shawtie.realtime.v1

Protocol version:

1

Endpoint:

/api/v1/realtime

The protocol is content-free for durable application invalidations.

Durable product mutations remain on HTTP.

Second-pass hardening adds a race-free live barrier, immutable socket scope identity, listener-reset resynchronization, low-frequency visible anti-entropy, and strict rejection of binary/compressed application transport.

## Upgrade requirements

The server accepts the WebSocket upgrade only when:

- Origin matches the trusted application origin
- the existing session cookie is present and valid
- the session is not expired or revoked
- the current account is authorized
- the client offers shawtie.realtime.v1
- connection-rate policy allows the attempt
- per-message WebSocket compression is disabled
- application data frames are text JSON only

The client does not send an access token in the URL or subprotocol.

The server derives account, device, partnership, and conversation identity.

## Envelope rules

Every application frame is JSON.

Every frame contains:

~~~json
{
  "v": 1,
  "type": "control.ready",
  "payload": {}
}
~~~

Rules:

- v is an integer protocol version
- type is a closed enum
- payload is type-specific and closed
- unexpected fields fail validation
- client and server frames are bounded to 4 KiB
- unknown critical frame types fail closed
- private content is prohibited
- binary application frames are rejected
- one socket's partnership/conversation identity is immutable after `control.ready`

## Server to client frames

### control.ready

Sent after upgrade authentication and initial server-derived scope load.

~~~json
{
  "v": 1,
  "type": "control.ready",
  "payload": {
    "connectionId": "uuid",
    "serverTime": "2026-09-22T12:00:00.000Z",
    "accountId": "uuid",
    "partnershipId": "uuid-or-null",
    "conversationId": "uuid-or-null",
    "partnershipGeneration": 7,
    "latestServerSequence": 42,
    "latestChangeSequence": 58
  }
}
~~~

The high-water values are synchronization targets for the current connection generation, not proof that local state is current.

`partnershipGeneration` is the authoritative lifecycle generation observed while deriving the ready scope. It is not a client capability token.

The client still performs canonical reconciliation before entering live state. It may enter live only after the dirty-counter/high-water synchronization barrier closes without a concurrent invalidation.

### control.ping

~~~json
{
  "v": 1,
  "type": "control.ping",
  "payload": {
    "nonce": "opaque-bounded-string"
  }
}
~~~

### control.resync_required

~~~json
{
  "v": 1,
  "type": "control.resync_required",
  "payload": {
    "scope": "account|partnership|conversation|relationship",
    "reason": "gap|backpressure|scope_changed|listener_reset|anti_entropy|unknown_state"
  }
}
~~~

The client pauses optimistic live assumptions and runs canonical HTTP synchronization. `listener_reset` is emitted after the API's PostgreSQL LISTEN connection is re-established because notifications may have been missed while the browser WebSocket remained open.

### control.update_required

~~~json
{
  "v": 1,
  "type": "control.update_required",
  "payload": {
    "minimumRealtimeProtocolVersion": 1,
    "minimumClientProtocolVersion": 1
  }
}
~~~

No private state is included.

### message.changed

~~~json
{
  "v": 1,
  "type": "message.changed",
  "payload": {
    "eventId": "uuid",
    "conversationId": "uuid",
    "messageId": "uuid",
    "mutation": "created|updated|deleted|reaction_changed",
    "changeSequence": 58,
    "serverSequence": 42,
    "contentVersion": 3
  }
}
~~~

Rules:

- serverSequence is required only for created
- contentVersion may be null for a deletion where the durable event contract defines null
- body is forbidden
- reply body is forbidden
- reaction emoji is forbidden

The client uses the frame only to schedule canonical change reconciliation.

### conversation.receipt_changed

~~~json
{
  "v": 1,
  "type": "conversation.receipt_changed",
  "payload": {
    "eventId": "uuid",
    "conversationId": "uuid",
    "deliveredThrough": 42,
    "readThrough": 40
  }
}
~~~

The server sends only the receipt state authorized for the current partner projection.

### conversation.nickname_changed

~~~json
{
  "v": 1,
  "type": "conversation.nickname_changed",
  "payload": {
    "eventId": "uuid",
    "partnershipId": "uuid",
    "subjectAccountId": "uuid",
    "version": 4
  }
}
~~~

Nickname text is not included.

The client refreshes the conversation summary.

### partnership.changed

~~~json
{
  "v": 1,
  "type": "partnership.changed",
  "payload": {
    "eventId": "uuid",
    "partnershipId": "uuid",
    "generation": 7,
    "metadataVersion": 3
  }
}
~~~

The client refreshes authoritative partnership/conversation state before replaying queued mutations.

### relationship.changed

~~~json
{
  "v": 1,
  "type": "relationship.changed",
  "payload": {
    "eventId": "uuid",
    "partnershipId": "uuid",
    "itemId": "uuid-or-null",
    "itemVersion": 5
  }
}
~~~

Protected R1 content is not included.

A null itemId means refresh the relationship aggregate.

### account.security_changed

~~~json
{
  "v": 1,
  "type": "account.security_changed",
  "payload": {
    "eventId": "uuid"
  }
}
~~~

The client immediately revalidates the session.

The server also revalidates all matching local connections.

No reason that could expose another device's security state is required in the browser frame.

### presence.changed

Transient frame:

~~~json
{
  "v": 1,
  "type": "presence.changed",
  "payload": {
    "online": true
  }
}
~~~

The payload is already filtered through current-partnership authorization.

No pre-partnership last-seen timestamp is sent.

### typing.changed

Transient frame:

~~~json
{
  "v": 1,
  "type": "typing.changed",
  "payload": {
    "typing": true,
    "expiresAt": "2026-09-22T12:00:05.000Z"
  }
}
~~~

Typing is not durable and may be dropped or coalesced.

### namespace.revoked

~~~json
{
  "v": 1,
  "type": "namespace.revoked",
  "payload": {
    "partnershipId": "uuid",
    "reason": "authorization_changed"
  }
}
~~~

This frame is a hint to remove the namespace immediately.

The client then verifies canonical state.

The server removes the connection from that partnership scope regardless of whether the frame is received.

## Client to server frames

M2 accepts only narrow transient commands.

### control.pong

~~~json
{
  "v": 1,
  "type": "control.pong",
  "payload": {
    "nonce": "opaque-bounded-string"
  }
}
~~~

### presence.heartbeat

~~~json
{
  "v": 1,
  "type": "presence.heartbeat",
  "payload": {}
}
~~~

The server derives account identity from the connection.

### typing.set

~~~json
{
  "v": 1,
  "type": "typing.set",
  "payload": {
    "typing": true
  }
}
~~~

The server derives the current conversation.

The client cannot submit a conversationId to select another conversation.

## Frames explicitly not accepted from clients

The server rejects client frames attempting to perform:

- subscribe
- unsubscribe
- message.send
- message.edit
- message.delete
- message.react
- receipt.update
- nickname.update
- partnership mutation
- relationship mutation
- call signaling in M2
- media mutation

Durable mutations stay on HTTP.

## Internal PostgreSQL notification envelope

The worker publishes a separate internal envelope.

Example:

~~~json
{
  "v": 1,
  "kind": "message.changed",
  "scope": {
    "conversationId": "uuid"
  },
  "data": {
    "eventId": "uuid",
    "messageId": "uuid",
    "changeSequence": 58,
    "serverSequence": 42,
    "contentVersion": 3,
    "mutation": "created"
  }
}
~~~

The API listener validates this envelope before routing.

It never forwards the raw string blindly.

The internal envelope target size is at most 2 KiB.

## Routing

The API realtime hub routes by its own authenticated connection indexes.

Examples:

- message.changed -> current connections registered for conversationId
- relationship.changed -> current connections registered for partnershipId
- partnership.changed -> current connections registered for partnershipId, followed by scope revalidation
- account.security_changed -> current connections registered for accountId, followed by session revalidation

The client never supplies these routing keys as subscriptions.

## Socket scope lifetime

The account identity is bound to the authenticated session for the socket lifetime.

The partnership and conversation identity reported by `control.ready` are also immutable for that socket lifetime.

If authoritative scope identity changes:

1. the server removes the connection from the old scope indexes
2. it emits `control.resync_required` with reason `scope_changed` when safe
3. it closes the socket
4. the client reconnects and receives a new server-derived scope

A lifecycle change that keeps the same partnership/conversation identity may remain on the socket and is handled as an invalidation plus canonical capability refresh.

The browser separately increments an in-memory `connectionGeneration` for every new WebSocket object. Event callbacks created by an older generation are ignored after reconnect. This generation is intentionally not trusted or transmitted over the wire.

## Ordering

The protocol defines no global WebSocket event order.

For messages:

- changeSequence defines durable mutation order
- serverSequence defines immutable creation/history order

For R1 and partnership state:

- the event is an invalidation hint
- authoritative version/generation is read from the canonical HTTP API

A lower-sequence WebSocket frame arriving after a higher-sequence frame is harmless.

The client compares with its committed cursor and performs canonical reconciliation.

## Race-free transition to live

For one browser connection generation, every relevant realtime frame increments an in-memory dirty counter and may raise the highest hinted message change sequence.

A sync pass snapshots that counter before canonical reads.

After reconciliation, the client enters live only when:

- the local committed change cursor has reached the authoritative/highest hinted target for the pass
- required recent history gaps are repaired
- partnership and R1 authority are refreshed
- the dirty counter has not changed during the pass
- no higher hinted change sequence arrived during the pass

Otherwise the client immediately runs another bounded reconciliation pass.

There is no client frame that declares itself synchronized. The server never trusts a browser assertion of canonical completeness.

## Deduplication

eventId may be used for short-lived client or server deduplication.

Correctness must not require retaining eventId forever.

Durable replay safety comes from:

- HTTP idempotency keys
- expected versions
- canonical change_sequence
- server lifecycle checks

## Backpressure behavior

The server keeps a bounded per-connection send buffer.

Under pressure:

1. coalesce typing/presence
2. coalesce repeated conversation invalidations to the highest observed change sequence
3. coalesce R1 invalidations to relationship refresh
4. coalesce partnership invalidations to partnership refresh
5. send control.resync_required if possible
6. close if the connection remains unable to drain

The server does not grow an unbounded queue.

Per-message compression is disabled, so backpressure accounting is performed on the actual small uncompressed application frames rather than an attacker-controlled compression ratio.

## Connection closure

Normal closure uses standard WebSocket close behavior.

Policy/auth/protocol failures use a policy close after any safe control frame.

The client treats every unexpected close as requiring authority revalidation before replay.

A client also performs low-frequency canonical anti-entropy while visible even when the socket has not closed. This bounds recovery from a silently missed NOTIFY, proxy behavior, or transport-hint loss. Anti-entropy is not a second product-ordering mechanism; it invokes the same canonical synchronization path.

A close reason is operational metadata only.

Do not include private state in close reason text.

## Compatibility

The browser offers:

shawtie.realtime.v1

If the server cannot support it, the upgrade is rejected or the connection receives update-required and closes.

A future compatible extension may add optional server frame types only when old v1 clients can safely ignore them.

A required new semantic must use a new protocol version.

C1 call signaling must not be inserted into v1 unless compatibility review proves old M2 clients remain safe.

## Security requirements

Every implementation must prove:

- exact trusted Origin on upgrade
- no bearer token in URL
- no arbitrary subscription
- frame-size bounds
- schema validation
- rate limits
- current session revalidation
- current partnership revalidation
- no protected content in frames
- no protected content in internal NOTIFY
- malformed internal payload does not crash API
- malformed client payload does not crash API
- unknown critical version fails closed
- revoked device cannot retain future realtime access
- final dissolution removes partnership scope
- future partnership cannot inherit old scope

## Reconnect requirement

Receiving control.ready does not mean synchronized.

The client must run canonical HTTP reconciliation before entering live mode.

The minimum reconnect repair is:

1. session
2. current partnership/conversation
3. verify ready scope identity still matches authoritative state
4. change_sequence
5. required server_sequence history gap
6. R1 stale state
7. close the dirty-counter/high-water live barrier
8. offline queue replay

If the API listener generation reset while the socket remained open, the same repair runs after control.resync_required(listener_reset).

While visible, the client also schedules bounded low-frequency anti-entropy through this same path.

## Testing requirements

Protocol tests must include:

- every valid server frame
- every valid client frame
- unknown type
- unknown version
- missing required field
- unexpected extra field
- oversize frame
- malformed JSON
- foreign Origin
- missing session
- revoked session
- arbitrary subscription attempt
- message content injection attempt
- R1 content injection attempt
- duplicate event
- out-of-order message change hints
- dropped internal NOTIFY
- listener reconnect
- multiple API listeners
- slow connection backpressure
- binary frame rejection
- per-message compression disabled
- scope identity change forces reconnect
- late callback from an old browser connection generation is ignored
- invalidation arriving during final sync prevents premature live transition
- LISTEN reset with healthy WebSocket forces resync
- healthy-socket anti-entropy repairs a deliberately missed hint
- session revocation while connected
- final dissolution while connected
