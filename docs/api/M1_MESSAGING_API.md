# M1 Messaging API

## Status

IMPLEMENTED, COMBINED-INTEGRATION VALIDATED, MAIN MERGE PENDING.

Technical validation anchor: `integration/m1-r1 @ 5db7a94183bca153d142389d7188e3887653a9ec`. The M1 PostgreSQL/API/worker matrix passes 64/64 on the canonical 0001 through 0014 schema.

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
- private mutation mismatch fingerprints use a versioned keyed server HMAC or equivalently reviewed keyed construction, never an ordinary unkeyed digest of message text
- sender device identity is derived from the authenticated session and is never accepted as caller-controlled message input
- message content is never copied into durable operational metadata, durable change rows, or outbox invalidations

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
    "latestChangeSequence": 58,
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
      "replyToMessageId": "uuid",
      "replyContext": {
        "messageId": "uuid",
        "senderAccountId": "uuid",
        "body": "earlier message",
        "deleted": false
      },
      "body": "hello",
      "contentVersion": 1,
      "lastChangeSequence": 58,
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

`replyContext` is returned when a message references another message, even if the referenced message is outside the current history page. It is authorized through the same conversation boundary. If the referenced message is deleted, its reply context returns `body: null` and `deleted: true`; it never resurrects deleted content.

Message-history pagination is ordered by `serverSequence`. It is not the mutation synchronization mechanism for edits, deletes, or reaction changes to older messages.

## GET /conversations/:conversationId/changes

Query:

- `afterChangeSequence`: required nonnegative integer
- `limit`: bounded default and maximum

Returns content-free durable mutation invalidations after the supplied cursor, ascending by change sequence.

Example:

~~~json
{
  "items": [
    {
      "changeSequence": 59,
      "type": "message.updated",
      "messageId": "uuid",
      "contentVersion": 2,
      "changedAt": "2026-09-22T12:10:00.000Z"
    },
    {
      "changeSequence": 60,
      "type": "message.reaction_changed",
      "messageId": "uuid",
      "contentVersion": 2,
      "changedAt": "2026-09-22T12:10:03.000Z"
    }
  ],
  "latestChangeSequence": 60,
  "hasMore": false
}
~~~

Rules:

- change rows contain no message body, nickname text, reaction emoji, or reply content
- cursor order is authoritative for durable message-state synchronization
- exact retry of a poll is safe
- the client advances its stored cursor only after reconciling every earlier returned change
- an unknown or unauthorized conversation uses the same not-found shape as other conversation reads
- if a retained cursor is no longer available under a later retention policy, the server requires bounded canonical resynchronization rather than guessing from timestamps

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
- sender device ID comes only from the authenticated session
- the committed send allocates one server sequence and one durable change sequence
- the same transaction records a content-free change row and versioned outbox invalidation

Success: `201`

~~~json
{
  "messageId": "uuid",
  "serverSequence": 43,
  "contentVersion": 1,
  "changeSequence": 59,
  "createdAt": "2026-09-22T12:05:00.000Z"
}
~~~

Exact retry with the same key and keyed request fingerprint returns the same message identity and sequence metadata without allocating another server or change sequence.

Same key with different body or reply target returns:

`409 IDEMPOTENCY_KEY_REUSED`

## PATCH /conversations/:conversationId/messages/:messageId

Header:

`Idempotency-Key`

Body:

~~~json
{
  "body": "edited text",
  "expectedContentVersion": 1
}
~~~

Success response contains only mutation metadata:

~~~json
{
  "messageId": "uuid",
  "contentVersion": 2,
  "changeSequence": 60,
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
- `expectedContentVersion` must match the locked current message row
- stale concurrent edits return `409 VERSION_CONFLICT`
- editing replaces only the current pre-S1 development body; M1 does not persist plaintext edit history
- every committed edit allocates a durable change sequence and emits a content-free invalidation

## DELETE /conversations/:conversationId/messages/:messageId

Header:

`Idempotency-Key`

Success:

~~~json
{
  "messageId": "uuid",
  "changeSequence": 61,
  "deletedAt": "2026-09-22T12:15:00.000Z"
}
~~~

Rules:

- sender only
- same lifecycle freeze rules as edit
- current content and any historical content storage are removed
- retained row becomes a tombstone
- active reactions are retired or removed
- every committed delete allocates a durable change sequence and emits a content-free invalidation

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
  "changeSequence": 62,
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
- every committed set/change allocates a durable change sequence and emits only content-free invalidation metadata

## DELETE /conversations/:conversationId/messages/:messageId/reaction

Header:

`Idempotency-Key`

Success is idempotent:

~~~json
{
  "messageId": "uuid",
  "changeSequence": 63,
  "reaction": null
}
~~~

Removing an existing reaction allocates a durable change sequence. Repeating an already-completed removal returns the original mutation result and does not allocate another change sequence.

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
- the client must not acknowledge through a known unresolved forward-synchronization gap
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
- server-owned minimum refresh cadence and endpoint rate limits bound writes
- redundant refreshes may be coalesced without changing visible typing semantics

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

Presence disclosure is partnership-scoped. The current-conversation projection must not expose a `lastSeenAt` heartbeat older than the current partnership's `activatedAt`, so a newly formed partner cannot inherit presence history from before that partnership. Heartbeat cadence, online TTL, and rate limits are server-owned configuration.

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
- `CHANGE_CURSOR_RESYNC_REQUIRED`

## Content logging rule

No route, repository, error mapper, request logger, security event, lifecycle event, outbox event, scheduled action, durable change row, or idempotency response body may store or log:

- message body
- deleted message body
- historical edit body
- nickname text unless it is the authoritative nickname row
- reaction emoji outside the authoritative reaction row

Private request fingerprints use a versioned keyed construction and are never a durable ordinary digest of message text.

Content-free `conversation_changes` and outbox invalidations may carry only routing, cursor, resource identity, mutation type, and version metadata.

Tests must scan the M1 operational paths for accidental content duplication.
