# M1 Messaging Core Architecture and Implementation Design

## Status

DONE. COMBINED INTEGRATION VALIDATED AND MERGED TO MAIN.

Branch:

`feat/m1-messaging-core`

Verified closure commit:

`aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`

Branch base:

`main @ ac7423d` was the parallel-development base.

Combined validation baseline:

`integration/m1-r1 @ 5db7a94183bca153d142389d7188e3887653a9ec`

M1 owns migration numbers:

- `0011_messaging_core_runtime.sql`
- `0012_messaging_interaction_runtime.sql`

R1 owns `0013` and `0014`. The combined integration baseline contains all four real migrations 0011 through 0014, and M1 does not consume R1's numbers.

M1 closed from executed local evidence on 2026-09-22. Hosted GitHub Actions verification remains separate under V1.

## Purpose

M1 creates the authoritative private text conversation substrate for exactly one current partnership.

It must provide:

- one primary conversation per current partnership
- text messages
- replies with stable reply context
- deterministic server message ordering
- a separate durable mutation synchronization cursor for sends, edits, deletes, and reactions
- retry-safe sends and mutations
- 30-minute editing with optimistic content-version checks
- deletion tombstones
- reactions
- delivery and read state
- typing state
- online and last-seen state
- shared partnership-scoped chat nicknames
- content-free invalidation events that M2 can later deliver over WebSockets
- exact P3 lifecycle behavior
- strict cross-partnership isolation

M1 is deliberately transport-conservative. PostgreSQL and HTTP remain canonical. M1 may poll the durable change cursor so edits, deletes, and reactions to older messages cannot be missed. WebSocket delivery, offline IndexedDB queues, reconnect orchestration, and physical-device lifecycle acceptance belong to M2.

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

M3 is now design-complete in `M3_MEDIA_VOICE_DESIGN.md` and keeps these M1 non-goals intact. M1 remains the message authority; M3 will add immutable ready-media references without moving binary storage, upload state, signed transfer capabilities, or provider deletion into the messaging module.

M1 may provide short HTTP polling in the browser so the core chat is usable before M2. Polling is a temporary transport adapter, not M2 completion.

## Security boundary before S1

Stable release requires reviewed E2EE, but S1 has not been implemented yet.

M1 must not fake encryption.

For pre-S1 development only, M1 may store current message bodies and current reactions in explicitly named development plaintext columns. It must never place plaintext into a field named or documented as ciphertext.

Rules:

- pre-S1 message content is development-only and must not be treated as suitable for sensitive real-world use
- M1 does not create plaintext edit-history rows; editing replaces the current development body and increments content metadata only
- message, reaction, and nickname plaintext must never be written to application logs, lifecycle events, account notifications, outbox payloads, scheduled actions, analytics, error traces, durable change rows, or idempotency response bodies
- request fingerprints over private mutation content must use a versioned keyed server HMAC or an equivalently reviewed keyed construction; an ordinary unkeyed hash of private message text is not sufficient
- partnership chat nicknames are protected partnership content even though they remain server-readable during pre-S1 development
- S1 must stop plaintext writes for protected messaging content
- S1 must either wipe pre-S1 development plaintext or migrate it through a reviewed client-side re-encryption flow
- the S1 design must explicitly decide the encrypted representation for partnership chat nicknames; they must not silently remain a permanent plaintext exception
- stable release is blocked until verification proves protected content is no longer stored server-readable except for any explicitly reviewed metadata exception

This is intentionally explicit so the repository never makes a false encryption claim and does not accumulate avoidable plaintext history before S1.

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

Each primary conversation owns:

`next_server_sequence`

Every successful send atomically allocates exactly one monotonically increasing positive server sequence.

The server sequence is:

- authoritative message creation order
- independent of client clock
- independent of network arrival order
- stable across retries
- never reused
- the basis for message-history pagination

Failed or rolled-back sends must not consume a committed server sequence.

Server sequence alone is not sufficient for synchronization because editing, deleting, or reacting to an older message does not create a new message sequence.

### Durable change sequence is synchronization order

Each primary conversation also owns:

`next_change_sequence`

Every committed message-state mutation allocates exactly one monotonically increasing positive change sequence:

- message created
- message edited
- message deleted
- reaction set, changed, or removed

M1 persists a content-free `conversation_changes` row for each committed change.

The change row contains only synchronization metadata such as:

- conversation ID
- change sequence
- change type
- message ID
- current content version where applicable
- trusted server timestamp

It never contains:

- message body
- historical body
- nickname text
- reaction emoji
- reply body

The message row stores its latest applied change sequence.

The browser uses the change cursor for polling and reconciliation. M2 may deliver the same change identities over WebSockets, but correctness remains recoverable from PostgreSQL and HTTP.

No committed mutation may advance a client-visible cursor without the corresponding canonical state being committed in the same transaction.

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

Add:

- `next_change_sequence bigint NOT NULL DEFAULT 1`

Rules:

- `next_server_sequence` orders message creation
- `next_change_sequence` orders durable messaging mutations
- both counters are positive and advance only inside the mutation transaction
- failed or rolled-back mutations do not consume a committed counter value

Backfill one primary conversation for each partnership whose lifecycle is `active` or `breakup_pending`.

Future partnership formation inserts the primary conversation in the same transaction that forms the partnership.

### messages

Add:

- `body_text text` for explicit pre-S1 development plaintext
- `content_version bigint NOT NULL DEFAULT 1`
- `request_fingerprint bytea`
- `last_change_sequence bigint`

The existing encrypted fields remain reserved for S1.

Payload invariant for new rows:

- non-deleted pre-S1 row: exactly one current content representation
- encrypted future row: ciphertext must carry a crypto version
- deleted row: no message content remains

M1 writes only the explicit current development plaintext representation.

Safety ceilings are implementation limits, not product semantics:

- request contract rejects empty or whitespace-only text
- message text is bounded to prevent unbounded request and database payloads
- database checks provide a second defensive bound
- reply targets must belong to the same conversation
- `last_change_sequence` must identify the most recent committed durable change affecting the message

### conversation_changes

Add a compact, content-free synchronization ledger.

Representative fields:

- conversation_id
- change_sequence
- change_type
- message_id
- content_version nullable
- created_at

Invariants:

- `UNIQUE (conversation_id, change_sequence)`
- positive change sequence
- referenced message belongs to the same conversation
- no private body, nickname, reaction emoji, or other protected content
- rows are append-only while retained

M1 history pagination continues to use server sequence. Polling and later M2 reconnect repair use change sequence.

### message_versions

M1 does not store plaintext edit history.

The existing table remains compatibility and future encrypted-history substrate. The pre-S1 M1 write path does not insert current or previous plaintext bodies into `message_versions`.

On edit:

1. lock the current message
2. require the caller's expected content version to match
3. replace the current development body
4. increment `content_version`
5. allocate and store the new change sequence
6. set `edited_at`

On delete:

- current content is removed
- any legacy or future historical content associated with the message must be physically removed
- the message row remains as a tombstone
- deletion gets a durable change sequence

A deleted message must never retain readable content through another repository path.

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
- a current-partnership projection suppresses any last-seen heartbeat older than that partnership's `activated_at`

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
- authenticated session device identity where available
- conversation ID
- client idempotency key
- body
- optional reply-to message ID

The sender device ID is derived from the authenticated session. It is never accepted as caller-controlled message input.

Transaction:

1. obtain trusted PostgreSQL transaction time
2. load conversation partnership/member IDs
3. lock both accounts in canonical order
4. lock partnership lifecycle
5. evaluate `send_message` or `reply_message`
6. lock the primary conversation
7. resolve any existing row for the same sender and idempotency key
8. compare the stored keyed request fingerprint
9. replay the original message identity on exact retry
10. reject key reuse with a different fingerprint
11. validate reply target belongs to the same conversation
12. allocate the next server sequence
13. allocate the next durable change sequence
14. insert the message with trusted server timestamp and `last_change_sequence`
15. insert the corresponding content-free `conversation_changes` row
16. insert a content-free, versioned outbox invalidation event for the committed change
17. commit

Replying to a deleted tombstone may remain allowed if the referenced message still belongs to the same conversation. The reply never recovers deleted content.

## Idempotency

### Send

The existing unique key:

`(conversation_id, sender_account_id, client_idempotency_key)`

is the primary send deduplication invariant.

M1 stores a content-independent, keyed request fingerprint so the same key cannot be reused for a different body or reply target without persisting private request content.

The fingerprint construction must:

- be versioned
- use a server-held HMAC key or equivalent reviewed keyed primitive
- canonicalize the mutation type and relevant request fields
- never use an ordinary unkeyed hash of the private message body as the durable verifier
- support key rotation according to the repository's existing server-key pattern

### Other mutations

Edit, delete, reaction, and nickname mutation reuse the existing generic `idempotency_records` infrastructure through M1-specific repository wrappers.

Private mutation inputs that participate in mismatch detection use the same keyed-fingerprint rule.

Idempotency records must store only minimal mutation identity, expected version, and result metadata.

They must not duplicate:

- message body
- nickname text
- reaction emoji
- private reply content

Idempotency response bodies must never contain private content.

## Message listing and pagination

Canonical message-history pagination uses server sequence, never client timestamp.

Initial history:

- request latest bounded page
- database reads by descending server sequence
- response is returned in ascending display order

Message-creation catch-up may request messages after the last known server sequence.

Limits:

- bounded default page
- bounded maximum page
- no unbounded conversation dump

Message projections include only current content plus tombstone state.

Historical edit versions are never returned through the normal read API.

Every reply projection includes enough tombstone-safe reply context to render a reply even when the referenced message is outside the loaded history page. The context is derived from the referenced message under the same conversation authorization and must never resurrect deleted content.

### Durable mutation synchronization

M1 adds a bounded change feed keyed by `change_sequence`.

The client records its latest committed change sequence and asks for changes after that cursor.

For every returned change, the client either:

- applies the included content-free invalidation to already-loaded state, then refetches the authoritative message projection as required; or
- reloads the affected bounded message range/current conversation projection

The client advances its durable local change cursor only after it has reconciled all earlier returned changes.

This closes the correctness gap where an edit, deletion, or reaction to an old message would otherwise be invisible to forward polling based only on new-message server sequence.

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
- caller-supplied `expectedContentVersion` matching the locked row
- if breakup is pending, message sequence above the breakup freeze sequence

Every successful edit:

- replaces only the current content representation
- increments content version
- allocates a durable change sequence
- updates `last_change_sequence`
- emits a content-free change/outbox invalidation
- sets edited timestamp
- renders an edited indicator

Concurrent edits from different devices do not silently overwrite one another. A stale expected content version returns `VERSION_CONFLICT`.

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

Acknowledgements are monotonic and cannot exceed the latest committed server sequence.

The browser must not advance a forward-sync receipt across a known message gap. It must never label a locally queued or failed request as delivered.

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
- a newly formed partnership must not expose presence activity from before that partnership's `activated_at`
- the read projection treats pre-partnership `last_seen_at` as unavailable for that partnership

The persistence row may remain account-scoped, but disclosure is partnership-scoped and activation-bounded.

## Typing

Typing is always enabled by product rule while message sending is permitted.

Initial M1 semantics:

- browser sends a debounced `typing=true` heartbeat
- server assigns a short expiry
- client does not choose the expiry
- `typing=false` may clear early
- partner view polls the compact conversation state
- expired rows are treated as false
- no typing history is persisted
- redundant refreshes are coalesced so a visible typing indicator cannot create an unbounded PostgreSQL write rate
- endpoint rate limits apply independently from ordinary message-send limits

M2 replaces polling delivery with WebSocket events.

### Server-owned interaction limits

M1 uses one centralized server-owned configuration surface for:

- maximum UTF-8 message size
- maximum nickname size
- idempotency-key length
- history default and maximum page size
- change-feed default and maximum page size
- visible-browser message/change polling cadence
- typing TTL and minimum refresh cadence
- presence heartbeat cadence and online TTL
- typing and presence endpoint rate limits

These values may later change through reviewed server policy, but they must not be duplicated as unrelated magic numbers across contracts, API routes, repositories, tests, and browser code.

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
- latest committed message server sequence
- latest committed durable change sequence
- self identity
- partner identity
- shared nickname projections
- partner presence, activation-bounded to the current partnership
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
- `GET /api/v1/conversations/:conversationId/changes`
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
- poll the durable change feed while visible
- use server-sequence pagination for message history and message-creation catch-up
- periodically refresh compact interaction state for presence and typing
- optimistic local send only after assigning a stable client idempotency key
- reconcile every send against server response
- show explicit sending, sent, delivered, and read states
- never advance a synchronization cursor past an unreconciled change
- expose reply context even when the referenced message is outside the current page
- expose edit only within the locally estimated window, while server remains authoritative
- send `expectedContentVersion` on edit and surface deterministic version conflicts
- show tombstone instead of deleted body
- show edited indicator
- show default reaction tray plus add-emoji path
- show partner typing
- show online or last seen only within the current-partnership privacy boundary
- show shared nicknames

No IndexedDB outbox is introduced in M1. That belongs to M2.

### Pre-M2 outbox handling

M1 persists content-free versioned invalidation events in the authoritative mutation transaction, but it does not attempt realtime delivery before M2.

The M1 worker therefore registers a narrow validation sink for the M1 message event families:

- `message.created`
- `message.updated`
- `message.deleted`
- `message.reaction_changed`

The worker claims only event types owned by its registry. This prevents the M1 registry from consuming or failing unrelated auth, lifecycle, or future feature outbox families.

For M1 payload version 1, the sink:

- verifies the conversation aggregate
- verifies opaque conversation/message identifiers and cursor/version shape
- rejects any unexpected payload field so message body, reaction content, nickname content, or other private content cannot silently enter durable transport metadata
- marks a valid invalidation delivered without attempting WebSocket transport

Unknown payload versions for a recognized M1 event family fail closed.

The durable `conversation_changes` ledger remains the synchronization source of truth. M2 may replace the no-transport sink with realtime delivery without changing cursor correctness or requiring historical M1 invalidations to remain pending.

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

M1 must keep messaging cleanup module-owned rather than expanding R1-owned relationship semantics. The P3 dissolution path composes module cleanup without requiring either parallel feature branch to own the other's private tables.

The earlier parallel branches used non-overlapping migration ownership. On the combined baseline, real 0011, 0012, 0013, and 0014 are contiguous in ancestry, migration-plan validation passes with `reserved=0`, and M1 does not change R1's numbers or scope.

## Implementation sequence

### M1-A Domain refinement and contracts

Implement:

- sequence-based pre-breakup freeze context
- legacy timestamp fallback
- messaging-specific capability helpers that reuse P3 lifecycle guards without changing relationship-object semantics
- message/reaction/nickname validation contracts
- pagination and durable change-feed contracts
- receipt contracts
- presence and typing contracts
- keyed private-request fingerprint contract
- centralized server-owned interaction limits
- denial-code contract tests

Exit evidence:

- existing P3 capability tests remain green
- new exact freeze-sequence tests pass
- contracts reject malformed and oversized requests
- private mutation fingerprinting does not persist or use an unkeyed digest of message content

### M1-B Migrations and repositories

Implement migrations 0011 and 0012.

Add repositories for:

- primary conversation provisioning
- server-sequence allocation
- durable change-sequence allocation
- append-only content-free conversation changes
- message insert/replay/list/lock
- current-content edit with optimistic version checks
- tombstone delete
- reactions
- receipt high-water state
- nicknames
- presence
- typing
- M1 idempotency wrappers
- module-owned messaging relational cleanup

Update:

- partnership formation to create the primary conversation
- partnership breakup initiation to capture the message freeze sequence
- the P3 deletion composition point to invoke messaging cleanup without taking ownership of relationship-space tables
- permanent account cleanup to delete presence state

Exit evidence:

- migrations 0001 through 0012 apply from zero
- invariant suite passes
- P1/P2/P3 migration checks remain green
- conversation/message creation and every durable message mutation produce gap-free committed change sequences
- no M1 migration changes R1-reserved numbering or relationship-item semantics

### M1-C Core read and send API

Implement:

- current conversation projection
- sequence-based history pagination
- bounded durable change-feed polling
- send
- reply with stable tombstone-safe reply context
- send replay
- keyed request-fingerprint mismatch denial
- receipt acknowledgement
- content-free versioned outbox invalidation events

Exit evidence:

- one primary conversation per current partnership
- deterministic server sequence under concurrency
- deterministic change sequence under concurrency
- reply isolation
- send idempotency
- old-message mutation reconciliation through the change cursor
- cross-partnership denial

### M1-D Message mutation API

Implement:

- edit with `expectedContentVersion`
- delete
- reaction set/change/remove
- 30-minute exact boundary
- sequence freeze enforcement
- tombstone projection
- no plaintext edit-history writes
- durable change/outbox invalidation for every committed mutation

Exit evidence:

- ownership rules
- exact edit window
- stale edit version conflicts
- concurrent edit determinism
- edited indicator
- tombstone content destruction
- reaction rules
- breakup freeze behavior
- edit/delete/reaction changes to old messages are recoverable through the change cursor

### M1-E Shared chat interaction

Implement:

- nicknames
- presence heartbeat
- typing TTL
- compact interaction projection
- centralized interaction limits and rate controls

Exit evidence:

- nickname visibility to both partners
- nickname CAS conflict behavior
- breakup nickname exception
- account-deletion denial
- presence privacy
- a new partnership does not inherit pre-partnership last-seen disclosure
- typing expiry and lifecycle denial
- high-frequency typing and presence requests are bounded and coalesced

### M1-F Browser core

Implement the functional PWA chat surface using HTTP canonical APIs and bounded polling.

Exit evidence:

- send/reply/edit/delete/reaction flows
- server-sequence history plus change-sequence mutation synchronization
- receipt state
- typing/presence
- nickname UI
- reply context outside the currently loaded page
- deterministic stale-edit conflict handling
- breakup-restricted UI
- account-deletion view-only behavior
- no physical Android requirement for M1 closure

### M1-G Lifecycle, deletion, race, and security hardening

Required races:

- concurrent sends
- duplicate send retries
- concurrent change-sequence allocation across different mutation types
- send versus breakup initiation
- send versus account deletion request
- edit versus breakup initiation
- edit at exact 30-minute boundary
- edit versus edit with the same expected content version
- edit versus delete
- reaction versus delete
- reaction versus breakup initiation
- nickname concurrent writes
- receipt monotonic concurrent updates
- final dissolution versus send
- final dissolution versus edit/delete/reaction
- account deletion recovery preserving conversation
- cross-partnership guessed conversation/message access

Required synchronization proof:

- editing an old message is discovered from a later change cursor
- deleting an old message is discovered from a later change cursor
- changing/removing a reaction on an old message is discovered from a later change cursor
- duplicate polling does not duplicate canonical state
- a client can resume from any retained change cursor without relying on wall-clock ordering
- content-free outbox events are sufficient for M2 invalidation without becoming the source of truth

Required deletion proof:

- conversation authorization ends synchronously at final dissolution
- module-owned messaging cleanup is idempotent and composable with the P3 deletion kernel
- conversation deletion cascades messages, reactions, receipts, member state, typing, and change rows
- nickname state is removed
- permanent account deletion removes presence
- no deleted message body survives in current state or historical storage

Required security proof:

- message body never enters logs
- message body never enters account notifications
- message body never enters lifecycle events
- message body never enters durable job payloads
- message body and reaction content never enter change/outbox invalidations
- idempotency metadata does not duplicate private content
- private request fingerprints use a keyed construction
- pre-partnership presence is not disclosed to a newly formed partner
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

The M1-A through M1-H runtime, persistence, API, browser, worker invalidation-sink, race/security test source, and closure harness are implemented and verified. The M1 source head `b29b095` is integrated with R1 and exhaustively revalidated at `integration/m1-r1 @ 5db7a94`.

Closure evidence executed on 2026-09-22:

- `npm run test:m1:local` passed the original 0001 through 0012 closure 64/64 and later passed 64/64 again on the integrated canonical 0001 through 0014 schema
- `npm run test:m1:security` passed 17/17 across M1 domain, contract, and security coverage
- `npm run health` passed repository health, typecheck, production builds, lint, formatting, dependency checks, and 108/108 unit/security tests
- `npm audit --audit-level=high` reported 0 vulnerabilities
- `git diff --check` passed

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
18. API and security regression tests pass, including durable mutation synchronization, stale-edit conflict, keyed-fingerprint, presence-privacy, bounded-interaction, deletion-composition, and content-free invalidation evidence

## Closure standard

All 18 canonical gates are supported by executed evidence, so M1 is DONE. Source reintegration with R1 is complete, exhaustively validated, and merged to `main @ d7d95a6`.

No hosted GitHub Actions run is required for M1 closure while V1 remains separately blocked, but every M1 commit continues to use `[skip ci]` until that policy changes.

Physical Redmi testing begins at M2 and is not required for M1 core closure.
