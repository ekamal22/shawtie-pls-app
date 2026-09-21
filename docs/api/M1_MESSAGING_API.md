# M1 Messaging API

## Status

DESIGN COMPLETE, IMPLEMENTATION PENDING.

All routes are under `/api/v1`.

Every response containing private partnership data uses:

`Cache-Control: private, no-store`

Every mutation authenticates the session and re-evaluates authoritative server capability state.

## Common rules

- client timestamps are never authoritative
- conversation and message identifiers are opaque
- unauthorized guessed identifiers use the same not-found response shape as unknown identifiers
- mutation bodies are schema-validated
- mutation request bodies are not logged
- idempotency keys are required where retry can duplicate or reorder writes
- message content is never copied into durable operational metadata

## GET /conversations/current

Returns the current primary conversation for the authenticated account.

Response:

~~~json
{
  "conversation": {
    "conversationId": "uuid",
    "partnershipId": "uuid",
    "lifecycleState": "active",
    "interactionMode": "normal",
    "latestServerSequence": 42,
    "self": {
      "accountId": "uuid",
      "displayName": "A",
      "nickname": null,
      "nicknameVersion": 0
    },
    "partner": {
      "accountId": "uuid",
      "username": "partner",
      "displayName": "B",
      "nickname": "Bee",
      "nicknameVersion": 2,
      "presence": {
        "online": true,
        "lastSeenAt": "2026-09-22T12:00:00.000Z"
      },
      "typing": false
    },
    "receipts": {
      "selfDeliveredThrough": 42,
      "selfReadThrough": 42,
      "partnerDeliveredThrough": 41,
      "partnerReadThrough": 39
    },
    "capabilities": {
      "sendMessage": true,
      "changeNickname": true,
      "typing": true,
      "viewMessages": true
    }
  }
}
~~~

No current partnership returns:

~~~json
{ "conversation": null }
~~~

## GET /conversations/:conversationId/messages

Query:

- `limit`: default 50, bounded maximum
- `beforeSequence`: optional positive integer
- `afterSequence`: optional nonnegative integer

`beforeSequence` and `afterSequence` are mutually exclusive.

Initial history returns the newest bounded page but orders response items ascending by server sequence.

Forward synchronization returns sequences greater than `afterSequence`, ascending.

Response:

~~~json
{
  "items": [
    {
      "messageId": "uuid",
      "conversationId": "uuid",
      "serverSequence": 42,
      "senderAccountId": "uuid",
      "replyToMessageId": null,
      "body": "hello",
      "contentVersion": 1,
      "createdAt": "2026-09-22T12:00:00.000Z",
      "editedAt": null,
      "deletedAt": null,
      "reactions": [
        {
          "accountId": "uuid",
          "emoji": "❤️"
        }
      ]
    }
  ],
  "hasMore": false,
  "oldestSequence": 42,
  "newestSequence": 42
}
~~~

Deleted message projection sets:

- `body: null`
- `deletedAt` non-null
- reactions empty

The client renders the tombstone text.

## POST /conversations/:conversationId/messages

Header:

`Idempotency-Key`

Body:

~~~json
{
  "body": "hello",
  "replyToMessageId": null
}
~~~

Rules:

- body must contain non-whitespace content
- body is bounded
- reply target must belong to the same conversation
- reply to a retained tombstone is allowed
- send is allowed in active and breakup_pending
- send is denied during account-deletion view-only state
- send is denied after termination

Success: `201`

Exact retry with the same key and fingerprint returns the same message identity without allocating another sequence.

Same key with different body or reply target returns:

`409 IDEMPOTENCY_KEY_REUSED`

## PATCH /conversations/:conversationId/messages/:messageId

Header:

`Idempotency-Key`

Body:

~~~json
{
  "body": "edited text"
}
~~~

Success response contains only mutation metadata:

~~~json
{
  "messageId": "uuid",
  "contentVersion": 2,
  "editedAt": "2026-09-22T12:10:00.000Z"
}
~~~

Rules:

- sender only
- non-deleted
- trusted server time is before the 30-minute edit deadline
- active partnership, or breakup_pending message sequence above the freeze cutoff
- denied in account-deletion view-only state
- denied after termination

## DELETE /conversations/:conversationId/messages/:messageId

Header:

`Idempotency-Key`

Success:

~~~json
{
  "messageId": "uuid",
  "deletedAt": "2026-09-22T12:15:00.000Z"
}
~~~

Rules:

- sender only
- same lifecycle freeze rules as edit
- content and historical content versions are removed
- retained row becomes a tombstone

Retry after successful deletion is idempotent.

## PUT /conversations/:conversationId/messages/:messageId/reaction

Header:

`Idempotency-Key`

Body:

~~~json
{
  "emoji": "😂"
}
~~~

Success:

~~~json
{
  "messageId": "uuid",
  "reaction": {
    "accountId": "uuid",
    "emoji": "😂"
  }
}
~~~

Rules:

- one active reaction per account per message
- changing emoji replaces the caller's current reaction
- message must not be deleted
- pre-breakup frozen message cannot be reacted to during breakup_pending
- post-cutoff breakup message may be reacted to
- denied in account-deletion view-only state

## DELETE /conversations/:conversationId/messages/:messageId/reaction

Header:

`Idempotency-Key`

Success is idempotent:

~~~json
{
  "messageId": "uuid",
  "reaction": null
}
~~~

## POST /conversations/:conversationId/receipt

Body:

~~~json
{
  "type": "read",
  "throughSequence": 42
}
~~~

`type` is:

- `delivered`
- `read`

Rules:

- sequence cannot exceed the latest committed sequence
- high-water marks only advance
- read also advances delivered to at least the same sequence
- view authorization is sufficient, so the remaining partner may acknowledge viewed data during account-deletion view-only state
- former partners cannot acknowledge after termination

Success:

~~~json
{
  "deliveredThrough": 42,
  "readThrough": 42
}
~~~

## POST /conversations/:conversationId/typing

Body:

~~~json
{ "typing": true }
~~~

Rules:

- typing=true is allowed only when message sending is allowed
- server assigns expiry
- client does not choose expiry
- typing=false clears early
- state is transient and not historical

Success:

~~~json
{
  "typing": true,
  "expiresAt": "2026-09-22T12:00:05.000Z"
}
~~~

## POST /presence/heartbeat

No client timestamp is accepted.

Success:

~~~json
{
  "online": true,
  "lastSeenAt": "2026-09-22T12:00:00.000Z",
  "onlineUntil": "2026-09-22T12:01:00.000Z"
}
~~~

The endpoint is available only to an active authenticated account.

Presence is never a public profile field.

## PATCH /partnerships/:partnershipId/nicknames/:accountId

Header:

`Idempotency-Key`

Body:

~~~json
{
  "nickname": "Bee",
  "expectedVersion": 1
}
~~~

Clear nickname:

~~~json
{
  "nickname": null,
  "expectedVersion": 2
}
~~~

Rules:

- caller and subject must belong to the same current partnership
- both partners observe the same resulting nickname
- allowed during active and breakup_pending
- allowed after either restore intent
- denied in account-deletion view-only state
- denied after termination
- stale expected version returns `409 VERSION_CONFLICT`

Success:

~~~json
{
  "partnershipId": "uuid",
  "accountId": "uuid",
  "nickname": "Bee",
  "version": 2,
  "updatedAt": "2026-09-22T12:00:00.000Z"
}
~~~

## Error privacy

Unknown and unauthorized conversation IDs:

`404 CONVERSATION_NOT_FOUND`

Unknown and unauthorized message IDs:

`404 MESSAGE_NOT_FOUND`

Do not expose whether a resource belongs to another partnership.

Representative lifecycle and mutation denials:

- `ACCOUNT_LOCKED`
- `PARTNERSHIP_TERMINATED`
- `MESSAGE_DELETED`
- `MESSAGE_NOT_OWNED`
- `MESSAGE_EDIT_WINDOW_EXPIRED`
- `PRE_BREAKUP_MESSAGE_LOCKED`
- `IDEMPOTENCY_KEY_REUSED`
- `VERSION_CONFLICT`

## Content logging rule

No route, repository, error mapper, request logger, security event, lifecycle event, outbox event, scheduled action, or idempotency response body may store or log:

- message body
- deleted message body
- historical edit body
- nickname text unless it is the authoritative nickname row
- reaction emoji outside the authoritative reaction row

Tests must scan the M1 operational paths for accidental content duplication.
