# M1 Messaging Core Architecture and Implementation Design

## Status

DESIGN COMPLETE, IMPLEMENTATION PENDING.

Branch:

`feat/m1-messaging-core`

Branch base:

`main @ ac7423d`

M1 owns migration numbers:

- `0011_messaging_core_runtime.sql`
- `0012_messaging_interaction_runtime.sql`

The parallel R1 branch reserves `0013` and `0014`. M1 must not consume those numbers.

M1 closes only from executed evidence. Source presence alone does not make the epic DONE.

## Purpose

M1 creates the authoritative private text conversation substrate for exactly one current partnership.

It must provide:

- one primary conversation per current partnership
- text messages
- replies
- deterministic server ordering
- retry-safe sends
- 30-minute editing
- deletion tombstones
- reactions
- delivery and read state
- typing state
- online and last-seen state
- shared partnership-scoped chat nicknames
- exact P3 lifecycle behavior
- strict cross-partnership isolation

M1 is deliberately transport-conservative. PostgreSQL and HTTP remain canonical. WebSocket delivery, offline IndexedDB queues, reconnect repair, and physical-device lifecycle acceptance belong to M2.

## Non-goals

M1 does not implement:

- WebSocket realtime transport
- offline IndexedDB queues
- media attachments
- voice messages
- push notification previews
- voice or video calling
- message search
- disappearing messages
- production E2EE
- cryptographic device enrollment
- cryptographic recovery

M1 may provide short HTTP polling in the browser so the core chat is usable before M2. Polling is a temporary transport adapter, not M2 completion.

## Security boundary before S1

Stable release requires reviewed E2EE, but S1 has not been implemented yet.

M1 must not fake encryption.

For pre-S1 development only, M1 may store message and reaction content in explicitly named development plaintext columns. It must never place plaintext into a field named or documented as ciphertext.

Rules:

- pre-S1 message content is development-only and must not be treated as suitable for sensitive real-world use
- message and reaction plaintext must never be written to application logs, lifecycle events, account notifications, outbox payloads, scheduled actions, idempotency response bodies, analytics, or error traces
- S1 must stop plaintext writes
- S1 must either wipe pre-S1 development plaintext or migrate it through a reviewed client-side re-encryption flow
- stable release is blocked until verification proves protected content is no longer stored server-readable

This is intentionally explicit so the repository never makes a false encryption claim.

## Architectural invariants

### One conversation per partnership

Each non-terminated partnership owns exactly one primary conversation.

The existing database invariant remains authoritative:

`UNIQUE (partnership_id, kind)`

with `kind = 'primary'`.

M1 will:

- backfill a primary conversation for current active or breakup-pending partnerships
- create the primary conversation transactionally during future partnership formation
- never derive conversation identity from username or mutable profile state

### Partnership is the authorization root

Every message, receipt, reaction, typing state, nickname, and conversation read model is scoped to the immutable partnership ID.

Authorization is always derived from authoritative membership and lifecycle state.

A guessed conversation ID or message ID never grants access.

### Server sequence is message order

Each primary conversation already owns:

`next_server_sequence`

Every successful send atomically allocates exactly one monotonically increasing positive sequence.

The sequence is:

- authoritative ordering
- independent of client clock
- independent of network arrival order
- stable across retries
- the basis for later M2 gap repair

Failed or rolled-back sends must not consume a committed sequence.

### Canonical lock order

Lifecycle-sensitive messaging mutations use the same lock discipline as P3:

1. derive the two partnership account IDs
2. lock both account rows in canonical account-ID order
3. lock the partnership lifecycle row
4. evaluate the centralized capability
5. lock the conversation or message row required by the mutation
6. mutate transactionally

This ordering is required for:

- send versus breakup initiation
- send versus account deletion
- edit/delete/reaction versus breakup initiation
- final dissolution versus messaging mutation

M1 must not introduce a partnership-first lock path that can deadlock against P3.

## Exact breakup message freeze boundary

Timestamp comparison alone is not sufficiently exact for determining which messages existed before breakup initiation.

M1 introduces an authoritative sequence cutoff:

`breakup_processes.message_freeze_sequence`

At breakup initiation, while the P3 canonical account locks are held:

1. load the current primary conversation
2. read `next_server_sequence - 1`
3. store that value as `message_freeze_sequence`
4. transition the partnership to `breakup_pending`

A message is pre-breakup when:

`message.server_sequence <= breakup.message_freeze_sequence`

This avoids same-millisecond ambiguity and remains correct under concurrency.

For legacy breakup rows that do not have a cutoff, the existing trusted timestamp comparison remains the compatibility fallback.

Consequences:

- messages existing before breakup are viewable and replyable but cannot be edited, deleted, or reacted to
- messages sent after breakup begins have a sequence above the cutoff and remain governed by normal message mutation rules
- a later breakup after restoration gets a new cutoff
- restoration does not rewrite old message sequences

## Migration 0011: messaging core runtime

`0011_messaging_core_runtime.sql` owns authoritative conversation and message content behavior.

Planned changes include:

### breakup_processes

Add:

`message_freeze_sequence bigint`

Rules:

- nullable for legacy compatibility
- nonnegative when present
- captured at breakup initiation
- immutable for that breakup process

### conversations

Retain:

- immutable ID
- partnership ID
- kind
- next server sequence

Add only indexes or constraints that executed evidence proves are necessary.

Backfill one primary conversation for each partnership whose lifecycle is `active` or `breakup_pending`.

Future partnership formation inserts the primary conversation in the same transaction that forms the partnership.

### messages

Add:

- `body_text text` for explicit pre-S1 development plaintext
- `content_version bigint NOT NULL DEFAULT 1`
- `request_fingerprint bytea`

The existing encrypted fields remain reserved for S1.

Payload invariant for new rows:

- non-deleted pre-S1 row: exactly one content representation
- encrypted future row: ciphertext must carry a crypto version
- deleted row: no message content remains

M1 writes only the explicit development plaintext representation.

Safety ceilings are implementation limits, not product semantics:

- request contract rejects empty or whitespace-only text
- message text is bounded to prevent unbounded request and database payloads
- database checks provide a second defensive bound

### message_versions

Add a development plaintext representation and allow the existing ciphertext column to be nullable.

On edit:

1. lock the current message
2. persist the previous content as its previous content version
3. update the current body
4. increment `content_version`
5. set `edited_at`

On delete:

- all historical message-version content is physically removed
- current content is removed
- the message row remains as a tombstone

A deleted message must never retain an old plaintext version that can be read through another repository path.

### message_reactions

Add an explicit pre-S1 `emoji_text` representation.

For M1:

- one active reaction per account per message
- changing reaction retires or replaces the prior active reaction transactionally
- removing a reaction removes reaction content rather than retaining the emoji indefinitely
- active reaction uniqueness is database-enforced
- deleted messages cannot receive reactions

The default UI tray remains:

`❤️ 😂 😭 😮 😡 👍`

The custom emoji path accepts one bounded supported emoji/grapheme representation according to the contract policy.

## Migration 0012: interaction runtime

`0012_messaging_interaction_runtime.sql` owns compact shared chat state.

### conversation_member_state

One row per conversation member.

Representative fields:

- conversation_id
- partnership_id
- account_id
- last_delivered_sequence
- last_read_sequence
- delivered_at
- read_at
- updated_at

Invariants:

- high-water sequences are nonnegative
- read sequence never exceeds delivered sequence
- acknowledgements are monotonic
- a client cannot acknowledge beyond the current committed conversation sequence
- membership is database-enforced

This high-water model is the canonical M1 receipt representation.

The older per-message receipt table remains compatibility substrate and is not required as the M1 write path.

### partnership_chat_nicknames

One shared metadata row per partnership member.

Representative fields:

- partnership_id
- subject_account_id
- nickname nullable
- version
- updated_by_account_id
- updated_at

Rules:

- both subject and updater must be partnership members
- absence or null nickname falls back to the account display name
- nickname changes are shared and immediately visible to both partners
- nickname changes remain allowed during `breakup_pending`
- nickname changes are denied during account-deletion view-only state
- mutation uses optimistic versioning to prevent silent lost updates
- final dissolution deletes nickname state

### account_presence

One current presence snapshot per account.

Representative fields:

- account_id
- last_seen_at
- online_until
- updated_at

M1 does not keep a presence history.

Browser behavior:

- heartbeat while an authenticated app is visible
- online state is derived from trusted server time and `online_until`
- last seen is the latest accepted server heartbeat
- permanent account deletion scrubs the presence row
- presence is exposed only to the currently authorized partner

### conversation_typing_state

One short-lived row per conversation member.

Representative fields:

- conversation_id
- partnership_id
- account_id
- expires_at
- updated_at

Rules:

- typing state is transient
- no historical typing log exists
- true refreshes a short trusted-server TTL
- false removes or expires the row
- expired state is ignored and cleaned opportunistically
- typing is denied when message sending is denied
- final dissolution removes typing state through conversation deletion

PostgreSQL is used as the M1 cross-process coordination store. M2 may replace polling transport with WebSockets without changing the product semantics.

## Message send transaction

A send request carries:

- authenticated account identity
- conversation ID
- client idempotency key
- body
- optional reply-to message ID

Transaction:

1. obtain trusted PostgreSQL transaction time
2. load conversation partnership/member IDs
3. lock both accounts in canonical order
4. lock partnership lifecycle
5. evaluate `send_message` or `reply_message`
6. lock the primary conversation
7. resolve any existing row for the same sender and idempotency key
8. compare the stored request fingerprint
9. replay the original message identity on exact retry
10. reject key reuse with a different fingerprint
11. validate reply target belongs to the same conversation
12. allocate the next server sequence
13. insert message with trusted server timestamp
14. commit

Replying to a deleted tombstone may remain allowed if the referenced message still belongs to the same conversation. The reply never recovers deleted content.

## Idempotency

### Send

The existing unique key:

`(conversation_id, sender_account_id, client_idempotency_key)`

is the primary send deduplication invariant.

M1 stores a content-independent request fingerprint so the same key cannot be reused for a different body or reply target.

### Other mutations

Edit, delete, reaction, and nickname mutation reuse the existing generic `idempotency_records` infrastructure through M1-specific repository wrappers.

Idempotency records must store only minimal mutation identity and version metadata.

They must not duplicate:

- message body
- nickname text
- reaction emoji
- private reply content

## Message listing and pagination

Canonical endpoint pagination uses server sequence, never client timestamp.

Initial history:

- request latest bounded page
- database reads by descending server sequence
- response is returned in ascending display order

Forward synchronization:

- request messages after the last committed server sequence
- response is ascending

Limits:

- bounded default page
- bounded maximum page
- no unbounded conversation dump

Message projections include only current content plus tombstone state.

Historical edit versions are never returned through the normal read API.

## Edit semantics

Only the original sender may edit.

Trusted boundary:

`now < created_at + 30 minutes`

At exact equality, editing is expired.

Edit requires:

- current membership
- non-terminated partnership
- no account-deletion view-only overlay
- non-deleted message
- ownership
- active edit window
- if breakup is pending, message sequence above the breakup freeze sequence

Every successful edit:

- increments content version
- preserves the previous version internally
- sets edited timestamp
- renders an edited indicator

## Delete semantics

Only the original sender may delete.

Delete follows the same lifecycle freeze rule as edit.

Deletion:

- removes current content
- removes stored historical content versions
- sets `deleted_at`
- leaves immutable message ID, sender identity, server sequence, created timestamp, and reply topology needed for a tombstone
- retires active reactions
- does not reveal deleted content in the placeholder

Normal projection:

`This message has been deleted`

is UI text, not persisted replacement content.

## Reaction semantics

Either current partner may react to a non-deleted message when capability allows it.

During `breakup_pending`:

- messages at or below the breakup freeze sequence cannot be reacted to
- messages created after the cutoff may still be reacted to

One active reaction per reactor per message avoids ambiguous stacked self-reactions.

Changing reaction is one transaction.

Removing a reaction is idempotent.

## Delivery and read receipts

Receipts are always enabled.

M1 defines:

- server accepted: message transaction committed
- delivered: at least one authorized partner client explicitly acknowledges receiving through a sequence
- read: authorized partner explicitly acknowledges reading through a sequence

Read acknowledgement also advances delivered state to at least the same sequence.

The browser must never label a locally queued or failed request as delivered.

M2 later transports these updates over realtime channels but does not redefine their meaning.

## Presence

Presence is operational metadata, not relationship history.

Initial M1 semantics:

- browser sends a bounded heartbeat while authenticated and visible
- server time controls `last_seen_at` and `online_until`
- online is true only until a short server-owned TTL
- no client-provided last-seen timestamp is trusted
- presence is visible only to the current partner
- former partners cannot query it through old partnership identifiers

## Typing

Typing is always enabled by product rule while message sending is permitted.

Initial M1 semantics:

- browser sends a debounced typing=true heartbeat
- server assigns a short expiry
- typing=false may clear early
- partner view polls the compact conversation state
- expired rows are treated as false
- no typing history is persisted

M2 replaces polling delivery with WebSocket events.

## Shared nicknames

Nickname metadata belongs to the partnership, not to a global profile.

Either partner may change either partnership chat nickname according to the final UI contract.

Nickname writes:

- use current partnership membership
- evaluate `change_nickname`
- remain permitted during `breakup_pending`, including after restore intent
- are denied in account-deletion view-only state
- use optimistic versioning

Final dissolution removes nickname state before the partnership becomes reusable for future product access.

## Current conversation read model

M1 adds a canonical current conversation projection containing:

- conversation ID
- partnership ID
- lifecycle state
- interaction mode
- latest committed message sequence
- self identity
- partner identity
- shared nickname projections
- partner presence
- partner typing state
- self delivered/read high-water state
- partner delivered/read high-water state
- capability booleans needed by the browser

The projection is private and must send:

`Cache-Control: private, no-store`

Client capability booleans are advisory only. Every mutation re-evaluates authoritative server state.

## API surface

The detailed contract is maintained in:

`docs/api/M1_MESSAGING_API.md`

High-level routes:

- `GET /api/v1/conversations/current`
- `GET /api/v1/conversations/:conversationId/messages`
- `POST /api/v1/conversations/:conversationId/messages`
- `PATCH /api/v1/conversations/:conversationId/messages/:messageId`
- `DELETE /api/v1/conversations/:conversationId/messages/:messageId`
- `PUT /api/v1/conversations/:conversationId/messages/:messageId/reaction`
- `DELETE /api/v1/conversations/:conversationId/messages/:messageId/reaction`
- `POST /api/v1/conversations/:conversationId/receipt`
- `POST /api/v1/conversations/:conversationId/typing`
- `POST /api/v1/presence/heartbeat`
- `PATCH /api/v1/partnerships/:partnershipId/nicknames/:accountId`

## Stable denial model

Unauthorized resource guessing must not reveal whether another partnership resource exists.

Representative public codes:

- `CONVERSATION_NOT_FOUND`
- `MESSAGE_NOT_FOUND`
- `MESSAGE_NOT_AVAILABLE`
- `MESSAGE_NOT_OWNED`
- `MESSAGE_EDIT_WINDOW_EXPIRED`
- `PRE_BREAKUP_MESSAGE_LOCKED`
- `MESSAGE_DELETED`
- `IDEMPOTENCY_KEY_REUSED`
- `PARTNERSHIP_TERMINATED`
- `ACCOUNT_LOCKED`
- `VERSION_CONFLICT`

Cross-partnership conversation and message guesses map to the same not-found shape as unknown identifiers.

## Browser architecture

M1 adds a dedicated messaging feature module.

Recommended files:

- `apps/web/src/features/messaging/MessagingPanel.tsx`
- `apps/web/src/features/messaging/MessageList.tsx`
- `apps/web/src/features/messaging/MessageComposer.tsx`
- `apps/web/src/features/messaging/ReactionPicker.tsx`
- `apps/web/src/features/messaging/NicknameEditor.tsx`

M1 browser behavior:

- load canonical current conversation
- load latest bounded history
- poll forward for new messages while visible
- periodically refresh compact interaction state for edits, reactions, presence, typing, and receipts
- optimistic local send only after assigning a stable client idempotency key
- reconcile every send against server response
- show explicit sending, sent, delivered, and read states
- expose reply context
- expose edit only within the locally estimated window, while server remains authoritative
- show tombstone instead of deleted body
- show edited indicator
- show default reaction tray plus add-emoji path
- show partner typing
- show online or last seen
- show shared nicknames

No IndexedDB outbox is introduced in M1. That belongs to M2.

## Parallel R1 coordination

M1 and R1 share the same base but must minimize merge conflicts.

M1 owns:

- migrations 0011 and 0012
- conversation and message tables
- message repositories and contracts
- messaging API module
- messaging browser module
- presence, typing, receipts, and chat nickname persistence

R1 owns:

- migrations 0013 and 0014
- relationship-space persistence
- relationship-object API modules
- relationship-space browser modules

Shared files likely touched by both branches:

- `packages/contracts/src/index.ts`
- `packages/db/src/index.ts`
- `apps/api/src/application.ts`
- `apps/web/src/app/App.tsx`
- `package.json`
- roadmap/project-state documentation

Changes in shared files must be minimal and append-oriented so final branch integration is mechanical.

M1 must not modify `relationship_items` semantics for R1.

R1 must not take ownership of conversation/message schema.

## Implementation sequence

### M1-A Domain refinement and contracts

Implement:

- sequence-based pre-breakup freeze context
- legacy timestamp fallback
- message/reaction/nickname validation contracts
- pagination contracts
- receipt contracts
- presence and typing contracts
- denial-code contract tests

Exit evidence:

- existing P3 capability tests remain green
- new exact freeze-sequence tests pass
- contracts reject malformed and oversized requests

### M1-B Migrations and repositories

Implement migrations 0011 and 0012.

Add repositories for:

- primary conversation provisioning
- sequence allocation
- message insert/replay/list/lock
- edit versions
- tombstone delete
- reactions
- receipt high-water state
- nicknames
- presence
- typing
- M1 idempotency wrappers

Update:

- partnership formation to create the primary conversation
- partnership relational cleanup to delete nickname state
- permanent account cleanup to delete presence state

Exit evidence:

- migrations 0001 through 0012 apply from zero
- invariant suite passes
- P1/P2/P3 migration checks remain green

### M1-C Core read and send API

Implement:

- current conversation projection
- sequence pagination
- send
- reply
- send replay
- request-fingerprint mismatch denial
- receipt acknowledgement

Exit evidence:

- one primary conversation per current partnership
- deterministic sequence under concurrency
- reply isolation
- send idempotency
- cross-partnership denial

### M1-D Message mutation API

Implement:

- edit
- delete
- reaction set/change/remove
- 30-minute exact boundary
- sequence freeze enforcement
- tombstone projection
- version-history cleanup on delete

Exit evidence:

- ownership rules
- exact edit window
- edited indicator
- tombstone content destruction
- reaction rules
- breakup freeze behavior

### M1-E Shared chat interaction

Implement:

- nicknames
- presence heartbeat
- typing TTL
- compact interaction projection

Exit evidence:

- nickname visibility to both partners
- nickname CAS conflict behavior
- breakup nickname exception
- account-deletion denial
- presence privacy
- typing expiry and lifecycle denial

### M1-F Browser core

Implement the functional PWA chat surface using HTTP canonical APIs and bounded polling.

Exit evidence:

- send/reply/edit/delete/reaction flows
- receipt state
- typing/presence
- nickname UI
- breakup-restricted UI
- account-deletion view-only behavior
- no physical Android requirement for M1 closure

### M1-G Lifecycle, deletion, race, and security hardening

Required races:

- concurrent sends
- duplicate send retries
- send versus breakup initiation
- send versus account deletion request
- edit versus breakup initiation
- edit at exact 30-minute boundary
- edit versus delete
- reaction versus breakup initiation
- nickname concurrent writes
- receipt monotonic concurrent updates
- final dissolution versus send
- final dissolution versus edit/delete/reaction
- account deletion recovery preserving conversation
- cross-partnership guessed conversation/message access

Required deletion proof:

- conversation authorization ends synchronously at final dissolution
- conversation deletion cascades messages, versions, reactions, receipts, member state, and typing
- nickname state is removed
- permanent account deletion removes presence
- no deleted message body survives in version history

Required security proof:

- message body never enters logs
- message body never enters account notifications
- message body never enters lifecycle events
- message body never enters durable job payloads
- idempotency metadata does not duplicate private content
- no custom or fake cryptographic construction is added

### M1-H Closure harness and documentation

Add:

- `test:messaging-core`
- `test:m1:security`
- `test:m1:postgres`
- `test:m1:local`

The disposable PostgreSQL harness must run:

- migrations from zero
- database invariants
- domain and contract tests
- P1/P2/P3 regression suites
- M1 API integration tests
- M1 concurrency tests
- M1 deletion tests
- M1 security tests
- API/web builds

M1 remains IN_PROGRESS until:

- `npm run test:m1:local` passes
- `npm run health` passes
- `npm audit --audit-level=high` passes
- documentation is reconciled from executed evidence

## Acceptance-gate mapping

Canonical acceptance gates remain in `docs/ROADMAP_EPICS.md`.

Implementation evidence must prove every one of them:

1. one primary conversation exists per current partnership
2. sends are idempotent
3. server sequence is deterministic
4. replies stay inside the conversation
5. edits are limited to the exact 30-minute window
6. edited state is visible
7. deletion destroys content and leaves a tombstone
8. default reactions work
9. add-emoji reaction works
10. read receipts are always on
11. typing indicators are always on
12. online and last-seen follow server-owned rules
13. shared nicknames are visible to both partners
14. breakup_pending allows new messages and replies
15. pre-breakup messages freeze for edit/delete/reaction
16. nickname changes remain allowed during breakup_pending
17. cross-partnership access fails closed
18. API and security regression tests pass

## Closure standard

M1 is DONE only when all canonical gates are supported by executed local evidence.

No hosted GitHub Actions run is required for M1 closure while V1 remains separately blocked, but every M1 commit continues to use `[skip ci]` until that policy changes.

Physical Redmi testing begins at M2 and is not required for M1 core closure.
