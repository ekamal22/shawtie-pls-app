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

## Upgrade requirements

The server accepts the WebSocket upgrade only when:

- Origin matches the trusted application origin
- the existing session cookie is present and valid
- the session is not expired or revoked
- the current account is authorized
- the client offers shawtie.realtime.v1
- connection-rate policy allows the attempt

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
    "latestServerSequence": 42,
    "latestChangeSequence": 58
  }
}
~~~

The high-water values are synchronization hints.

The client still performs canonical reconciliation before entering live state.

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
    "reason": "gap|backpressure|scope_changed|unknown_state"
  }
}
~~~

The client pauses optimistic live assumptions and runs canonical HTTP synchronization.

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

## Connection closure

Normal closure uses standard WebSocket close behavior.

Policy/auth/protocol failures use a policy close after any safe control frame.

The client treats every unexpected close as requiring authority revalidation before replay.

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
3. change_sequence
4. required server_sequence history gap
5. R1 stale state
6. offline queue replay

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
- session revocation while connected
- final dissolution while connected
