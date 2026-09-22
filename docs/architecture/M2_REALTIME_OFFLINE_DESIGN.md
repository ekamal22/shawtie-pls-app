# M2 Realtime and Offline Reliability Design

## Status

DESIGN COMPLETE, SECOND-PASS HARDENED. IMPLEMENTATION NOT STARTED.

Branch:

feat/m2-realtime-offline

Base:

main @ 9f4237e90c4d289f8b316e5d8dd2bba41609c95d

Inherited verified runtime baseline:

- M1 runtime closure: aa40a2c
- R1 source closure: 9bc9ba4
- M1/R1 technical integration anchor: 5db7a94
- M1/R1 documentation-closed mainline: 9f4237e
- canonical PostgreSQL migrations: 0001 through 0014
- M1 integration matrix: 64/64
- R1 integration matrix: 69/69
- exhaustive pre-M2 repository validation: 40/40 gates

M2 is the first milestone that requires physical Android acceptance.

## Purpose

M2 turns the verified HTTP-first M1 messaging and R1 relationship-space substrate into a resilient PWA that remains correct across unreliable networks, suspended mobile browsers, duplicated realtime events, process restarts, offline user actions, lifecycle transitions, and stale cached application code.

M2 improves latency and offline usability. It does not create a new source of truth.

PostgreSQL and the existing HTTP APIs remain authoritative.

WebSocket delivery is a hint.

IndexedDB is a cache and retry substrate.

The server capability engine and lifecycle state remain authoritative on every replayed mutation.

## Second-pass hardening decisions

The second architecture pass tightens correctness around failure modes that are easy to miss in a normal WebSocket/offline design:

- a socket is not considered live until a race-free synchronization barrier closes
- partnership/conversation scope identity is immutable for one socket lifetime
- client callbacks from an older socket generation are ignored after reconnect
- API LISTEN loss or reconnect forces local clients to resynchronize
- visible clients perform low-frequency canonical anti-entropy even when the socket looks healthy
- multi-tab queue replay uses local claim generation fencing in addition to server idempotency
- successful queue replay is not removed locally until canonical state and queue completion commit together
- pre-S1 cold-start offline mode does not reveal protected IndexedDB plaintext before online session validation
- IndexedDB quota/storage failure must fail visibly before an operation is represented as queued
- browser site-data eviction is treated as an external storage-loss event, not as a silently guaranteed offline durability case
- WebSocket compression is disabled and binary application frames are rejected because M2 frames are small and content-free
- R1 offline replay uses an exact conservative whitelist rather than a broad category description
- PostgreSQL NOTIFY publication must be committed before the durable outbox claim is acknowledged delivered

These refinements do not add a new product milestone or durable authority system.

## Non-goals

M2 does not implement:

- media upload or media delivery
- voice messages
- push-provider integration
- voice or video calling
- call signaling payloads beyond reserving a future protocol extension point
- production E2EE
- cryptographic device enrollment or recovery
- a new messaging order model
- a new relationship-space conflict model
- arbitrary client-selected subscriptions
- Redis
- a durable server-side WebSocket session table
- plaintext content in realtime invalidation payloads
- a second partnership lifecycle authority

M3 owns media and voice-message transport.

C1 owns call signaling and WebRTC.

S1 owns reviewed E2EE and cryptographic recovery.

## Inherited invariants

M2 must preserve the following verified invariants.

### Message order and mutation order remain separate

M1 owns two monotonic per-conversation sequences:

- server_sequence is immutable message creation order and history pagination order
- change_sequence is durable synchronization order for send, edit, delete, and reaction mutations

M2 must never collapse these counters.

A realtime event that reports a new change sequence does not create a new message sequence.

A reconnect that repairs message history by server sequence is not sufficient to repair edits, deletes, or reactions to older messages.

### HTTP and PostgreSQL remain canonical

Every durable user mutation continues through the existing authenticated HTTP API.

M2 WebSocket frames do not become an alternate durable mutation API.

WebSocket invalidations tell the client that canonical state may have changed.

The client then reconciles through the existing HTTP read models.

### Lifecycle authority remains server-side

Queued operations are not permissions.

Before offline replay, the client refreshes authoritative account, partnership, conversation, and capability state.

The server independently rechecks the same state inside the mutation path.

A mutation that was valid when queued may be rejected later because of breakup, account deletion, final dissolution, edit-window expiry, version conflict, or another authoritative state change.

### Partnership identity remains the isolation root

The immutable partnership ID remains the namespace boundary for:

- authorization
- local cache
- offline queues
- realtime membership
- R1 state
- future S1 cryptographic state

A future partnership, including a future partnership between the same two accounts, gets a different namespace.

## Architectural summary

~~~text
                        PostgreSQL
                   authoritative state
                         |
              +----------+----------+
              |                     |
       HTTP read/write          transactional
          API paths                 outbox
              |                     |
              |               durable worker
              |                     |
              |             validated invalidation
              |                     |
              |             PostgreSQL NOTIFY
              |                     |
              +----------+----------+
                         |
                  API realtime hub
                  LISTEN connection
                         |
               authenticated WebSocket
                         |
                  browser sync engine
                    /           \
             IndexedDB        HTTP reconcile
             cache/queue      canonical API
~~~

Correctness does not depend on PostgreSQL NOTIFY being delivered.

Correctness does not depend on a WebSocket event being delivered.

Correctness does depend on the durable M1 change ledger, authoritative HTTP reads, server-side mutation idempotency, expected-version checks, and lifecycle authorization.

## Server transport choice

Use the official Fastify WebSocket integration compatible with the repository's Fastify major version.

The WebSocket endpoint is:

/api/v1/realtime

The connection uses the existing HttpOnly server-managed session cookie.

No bearer token is placed in:

- URL query parameters
- localStorage
- sessionStorage
- WebSocket subprotocol data
- client-readable persistent storage

The only accepted realtime subprotocol for the initial implementation is:

shawtie.realtime.v1

## WebSocket upgrade security

The upgrade path must:

1. require the configured trusted application Origin
2. reject a missing or foreign Origin in production
3. parse the existing session cookie
4. load the authoritative session from PostgreSQL
5. reject expired or revoked sessions
6. derive account ID and device ID from the authenticated session
7. negotiate exactly one supported realtime protocol version
8. derive current partnership and conversation scope from authoritative database state
9. register only those server-derived scopes in the connection hub
10. return no private content during upgrade

Additional transport rules:

- application frames are text JSON only
- binary application frames are rejected
- per-message WebSocket compression is disabled
- the accepted subprotocol must be exactly `shawtie.realtime.v1`
- no private data is placed in close reason text
- scope identity is frozen after `control.ready`; if authoritative partnership or conversation identity changes, the server requests resynchronization and closes the socket so reconnect derives a fresh scope

The browser cannot request a partnership, conversation, account, item, or message subscription by identifier.

## Server-derived connection scope

A connection context contains server-derived values only:

- connectionId
- accountId
- deviceId
- sessionId or opaque server session identity
- current partnershipId, nullable
- current conversationId, nullable
- current partnership lifecycle generation, when applicable
- realtime protocol version
- connectedAt
- lastPongAt
- lastSessionValidationAt

The hub maintains in-memory indexes for local process fanout:

- accountId -> connection set
- partnershipId -> connection set
- conversationId -> connection set

These indexes are acceleration structures, not authorization databases.

A later lifecycle invalidation causes scope refresh or connection closure.

A periodic session/scope revalidation closes a stale connection even if a realtime invalidation was missed.

The partnership/conversation identity attached to one WebSocket is immutable. Lifecycle state may change while that identity remains current, in which case the socket emits an invalidation and the client refreshes capabilities. If the authoritative partnership ID or conversation ID changes, including final dissolution followed by later re-pairing, the old socket is removed from its scopes and closed. A fresh connection must derive the new identity.

The browser maintains an in-memory `connectionGeneration`. Every socket callback captures the generation that created it. After reconnect increments the generation, callbacks from an older socket are ignored even if the browser event loop delivers them late. This is a client race guard, not a wire protocol field.

## No Redis

M2 does not introduce Redis.

Cross-process realtime fanout uses PostgreSQL LISTEN/NOTIFY as a low-latency transport hint.

Each API process owns one dedicated PostgreSQL listener connection.

Each worker publish uses a compact validated notification payload.

If a notification is missed because an API process is down or disconnected, reconnect and HTTP reconciliation restore correctness.

## Durable event to realtime bridge

M1 already writes content-free durable outbox events for:

- message.created
- message.updated
- message.deleted
- message.reaction_changed

M2 changes the M1 outbox validation sink into a validation plus publish handler.

The worker flow becomes:

1. claim the durable outbox row through the existing fenced F2 consumer
2. validate event type, payload version, aggregate type, and content-free payload
3. map the event to a versioned internal realtime invalidation
4. publish the compact internal invalidation through PostgreSQL NOTIFY
5. mark the durable outbox row delivered through the existing fenced acknowledgement path

The worker publishes the notification through a committed PostgreSQL operation before acknowledging the durable outbox claim as delivered. If the worker crashes after publish but before durable acknowledgement, later duplicate publication is safe.

A successful NOTIFY means only that PostgreSQL accepted and committed the transient notification.

It does not mean any browser received it.

That is acceptable because the durable change ledger remains the synchronization source of truth.

The API listener owns a monotonically increasing in-memory listener generation. When the LISTEN connection is lost, all local sockets are marked synchronization-dirty. After LISTEN is re-established, the hub sends `control.resync_required` with reason `listener_reset` to connected clients. The client performs canonical HTTP reconciliation before treating the connection as fully synchronized again.

In addition, a visible authenticated client runs a low-frequency anti-entropy reconciliation even when WebSocket transport appears healthy. This periodic pass is deliberately much less frequent than the pre-M2 2-second poll and exists only to bound recovery from silent transport-hint loss, worker delay, proxy oddities, or a missed listener-reset signal. Exact cadence is a tested configuration constant rather than product authority.

## Additional content-free invalidations

M2 adds content-free outbox invalidations where a connected client otherwise needs low-latency refresh.

Expected families are:

- conversation.receipt_changed
- conversation.nickname_changed
- partnership.changed
- relationship.changed
- account.security_changed

Payloads may contain only routing and synchronization metadata such as:

- aggregate ID
- partnership ID
- conversation ID
- item ID where needed
- generation
- metadata version
- item version
- receipt high-water sequence
- event type
- payload version

They must not contain:

- message body
- reaction emoji
- nickname text
- R1 protected payload
- relationship coordinates
- email
- date of birth
- session token
- verification code
- private cryptographic material

## Transient presence and typing

Presence and typing are transient.

They are not placed in a durable offline queue.

The client prefers WebSocket commands while connected:

- presence.heartbeat
- typing.set

The server routes these commands through the existing M1 presence and typing service rules so existing rate limits, TTLs, partnership checks, and privacy behavior remain authoritative.

HTTP presence and typing endpoints remain a compatibility fallback during M2.

Transient presence and typing notifications may use PostgreSQL NOTIFY directly after authoritative state is written.

Losing a transient notification is harmless because TTL and later canonical refresh repair the visible state.

## Durable mutations stay on HTTP

The WebSocket protocol does not accept durable application mutations for:

- message send
- message edit
- message delete
- reactions
- read receipts
- nicknames
- partnership lifecycle
- R1 item create/update/delete
- R1 release/open/reveal
- account changes

Those operations retain their existing HTTP idempotency, expected-version, CSRF, and lifecycle behavior.

This avoids two mutation transports with different retry semantics.

## Realtime protocol versioning

Initial values:

- realtimeProtocolVersion = 1
- localSchemaVersion = 1
- API namespace remains /api/v1

The client also sends a build/client compatibility identifier through normal HTTP compatibility headers once M2 compatibility middleware is active.

Unknown critical realtime protocol versions fail closed.

The server never guesses how to interpret an unknown client frame.

The client never guesses how to interpret an unknown critical server frame.

Unknown critical server frames cause:

1. pause offline replay
2. canonical HTTP resynchronization if safe
3. update-required state if the protocol is unsupported

## Realtime delivery semantics

Realtime delivery is at-least-once and unordered across unrelated event classes.

A client must tolerate:

- duplicate frames
- delayed frames
- out-of-order frames
- a missing frame
- a socket close between frames
- a socket reconnect to another API process

Message mutation order is recovered only through change_sequence.

Message history order is recovered only through server_sequence.

WebSocket arrival order is never product order.

## Backpressure

A realtime connection must not have an unbounded send queue.

Implementation rules:

- typing and presence hints may be coalesced or dropped under pressure
- multiple message invalidations for the same conversation may be coalesced to the highest observed change sequence
- relationship invalidations may be coalesced to a generic relationship refresh
- partnership invalidations may be coalesced to a generic partnership refresh
- if the connection cannot drain bounded critical hints, send resync-required when possible and close the connection
- the reconnect path repairs canonical state over HTTP

The server must not buffer private content because realtime frames are content-free.

## Liveness

The server sends a small control ping on a bounded interval.

The browser responds with control pong.

The connection tracks lastPongAt.

A stale connection is closed after a bounded missed-heartbeat window.

Presence heartbeat remains a separate product signal and must not be treated as the transport liveness protocol.

## Reconnect policy

The client reconnect state machine is:

~~~text
disconnected
    |
    v
connecting
    |
    v
socket-ready
    |
    v
canonical-reconcile
    |
    v
live
~~~

Additional terminal or paused states:

- offline
- auth-revoked
- update-required
- namespace-revoked

Reconnect behavior:

- attempt immediately when the app becomes visible and network access may be available
- use exponential backoff with jitter for repeated failures
- cap visible-page retry delay
- avoid aggressive hidden-page retry loops
- browser online/offline events are hints only
- a successful socket connection is not considered synchronized until canonical reconciliation completes

## Race-free live synchronization barrier

A WebSocket opening does not make the client live.

For each connection generation, the client keeps:

- `syncDirtyCounter`, incremented for every relevant realtime invalidation
- `highestHintedChangeSequence` for the current conversation
- the high-water values supplied by `control.ready`
- the locally committed change and history cursors

A synchronization pass:

1. snapshots the current `syncDirtyCounter`
2. reconciles canonical HTTP state
3. drains M1 changes until the committed local `latestChangeSequence` reaches the authoritative high-water observed during that pass
4. repairs required history gaps
5. refreshes partnership/R1 authority
6. commits all local cursor/projection state
7. checks whether `syncDirtyCounter` is unchanged and whether no higher hinted change sequence arrived during the pass
8. enters `live` only if both conditions hold
9. otherwise loops through another bounded synchronization pass

This closes the race where an invalidation arrives while the client is between its final HTTP read and the state transition to live.

There is no client `control.synced` authority message. The barrier is local; the server never trusts the browser to declare canonical state complete.

## Canonical reconnect algorithm

After WebSocket ready, application foreground, network restoration, or explicit resync request:

1. serialize through one SyncCoordinator
2. verify the current authenticated session by HTTP
3. load the current partnership/conversation authority
4. compare the authoritative partnership/conversation with the active local namespace
5. if authority changed, remove old data from UI immediately and purge or quarantine the old namespace before replay
6. repair M1 durable changes after the last committed local change_sequence
7. fetch authoritative current projections for affected message IDs
8. commit projections and the new change cursor atomically in IndexedDB
9. repair any required contiguous recent history gap by server_sequence
10. refresh partnership and conversation summary
11. refresh or invalidate R1 cached state as required
12. replay permitted offline operations only after authoritative refresh
13. refresh read/delivery high-water state
14. enter live state
15. close the race-free live synchronization barrier; if another invalidation arrived while synchronizing or a higher hinted change sequence appeared, run another bounded sync cycle
16. while visible, schedule the low-frequency anti-entropy reconciliation even if the socket remains healthy

Only one sync cycle may mutate local cursor state at a time.

## Applying M1 change pages

For each change page:

1. read local latestChangeSequence
2. request changes after that cursor
3. validate the response contract
4. preserve the highest returned change sequence
5. coalesce repeated message IDs within the page where safe
6. fetch the authoritative current message projection for every affected message
7. start one IndexedDB transaction
8. write all validated message projections
9. write the new latestChangeSequence only after all projections are stored
10. commit the transaction
11. continue while hasMore is true

A crash before the cursor transaction commits causes safe replay.

A duplicate page is safe because message projections are keyed by immutable IDs and versions.

The client never advances latestChangeSequence merely because a WebSocket frame arrived.

## Message-history gap repair

The local message cache tracks a contiguous retained history window.

Intentional eviction below the retained window is not a synchronization gap.

A missing server sequence inside the retained window is a gap.

When latestServerSequence is above the locally known contiguous end:

1. request messages with afterSequence from the last contiguous retained sequence
2. persist each page
3. extend the contiguous window only after the page transaction commits
4. continue until caught up or the configured page budget yields
5. resume on the next sync turn if more pages remain

Initial bootstrap may fetch the latest history page and then set the local change cursor to the authoritative latest change sequence only when that page and the authoritative conversation snapshot belong to the same synchronization pass and the race-free live barrier subsequently closes. A realtime invalidation during bootstrap makes the pass dirty and forces another reconciliation before live mode.

Existing caches use change reconciliation first.

## R1 reconciliation

R1 does not gain a second durable event-sourcing system in M2.

Realtime relationship.changed frames invalidate or identify R1 state.

On reconnect:

- refresh Relationship Home metadata
- refresh explicitly stale cached items
- revalidate current lifecycle mode
- preserve expectedVersion behavior for shared state
- never infer release or visibility from local time alone

R1 release, recipient-open, creator-reveal, and scheduled-delivery authority remains server-side.

## IndexedDB physical isolation

M2 uses an application-controlled IndexedDB database per authenticated account.

Recommended database name shape:

shawtie-local-v1:<accountId>

The local adapter binds the account ID at construction time.

Callers do not pass arbitrary account IDs to normal store methods.

Every partnership-scoped record additionally contains:

- partnershipId
- conversationId where applicable
- contentContextKey
- localSchemaVersion

Before S1, contentContextKey is the explicit string:

pre-s1

This is not a cryptographic epoch and must never be documented as one.

S1 later replaces the content context with real reviewed cryptographic epoch identity.

## IndexedDB schema version 1

Object stores:

### appMeta

Key:

singleton

Fields include:

- localSchemaVersion
- clientBuildId
- accountId
- lastAuthoritativeSessionAt

### namespaceMeta

Key:

partnershipId

Fields include:

- partnershipId
- conversationId
- contentContextKey
- lifecycleSnapshot
- createdAt
- lastAuthoritativeSyncAt
- revokedAt nullable

### conversationSync

Key:

[partnershipId, conversationId]

Fields include:

- latestChangeSequence
- latestServerSequence
- retainedHistoryStartSequence
- retainedHistoryEndSequence
- pendingDeliveredThrough
- pendingReadThrough
- lastSyncedAt

### messages

Primary key:

[partnershipId, conversationId, messageId]

Indexes:

- [partnershipId, conversationId, serverSequence]
- [partnershipId, conversationId, lastChangeSequence]

The value stores the canonical M1 message projection plus local cache metadata.

### relationshipItems

Primary key:

[partnershipId, itemId]

The value stores the current server projection and version metadata.

### relationshipMeta

Key:

partnershipId

Fields include:

- stale
- lastSyncedAt
- lastKnownLifecycleMode

### chatOutbox

Key:

operationId

Fields include:

- operationId
- partnershipId
- conversationId
- operationType
- idempotencyKey
- request body
- expectedContentVersion nullable
- queuedAt
- retryCount
- nextAttemptAt
- status
- lastErrorCode nullable

### relationshipOutbox

Key:

operationId

Fields include:

- operationId
- partnershipId
- operationType
- idempotencyKey
- request body
- expectedVersion nullable
- queuedAt
- retryCount
- nextAttemptAt
- status
- lastErrorCode nullable

## Pre-S1 local plaintext boundary

M2 occurs before S1.

Therefore local persisted message and R1 content may still be development plaintext.

This is not stable-release security.

Before stable release, S1 must either:

- migrate local protected content into the reviewed encrypted representation, or
- purge and rehydrate protected local caches under the new encrypted representation

M2 must not invent fake local ciphertext or fake crypto epochs.

## Cache bounds

Private local storage is bounded.

The implementation must define and test ceilings for:

- cached message projections per conversation
- cached R1 projections
- queued chat operations
- queued relationship operations
- maximum serialized queue payload size

Eviction applies only to canonical cache entries, never silently to unsent user operations.

The installed PWA should request persistent browser storage when supported and record whether persistence was granted, but correctness never assumes the browser will preserve site data forever. User-cleared site data, browser storage eviction, OS cleanup, or private-browsing semantics are external storage-loss cases.

Before presenting a mutation as `queued`, the client must durably persist the queue record. If IndexedDB is unavailable, quota is exhausted, serialization fails, or the transaction aborts, the UI keeps the user's unsent content in the composer/editor when possible and reports that offline persistence failed. It must not show a false queued state.

Storage pressure handling may evict rehydratable canonical cache first. It must not silently evict unsent queue entries to make space.

When an old message page is evicted, retainedHistoryStartSequence advances explicitly so the missing old range is not mistaken for a synchronization gap.

## Offline authentication bootstrap

A network failure is not the same as HTTP 401.

On application startup:

- HTTP 401 means signed out; stop replay and purge pre-S1 plaintext local state
- explicit logout means purge pre-S1 plaintext local state
- device revocation means stop replay, close realtime, and purge authorization-bound local state
- a temporary network failure is not treated as HTTP 401
- if the application was already authenticated and then loses connectivity while still running, it may continue showing the already-open authorized in-memory/local view while clearly offline
- a cold start, hard reload, browser restart, or service-worker relaunch while offline must not unlock protected pre-S1 IndexedDB plaintext because the browser cannot revalidate the HttpOnly server session
- cold-start offline mode therefore renders a locked/offline shell until online session validation succeeds
- once connectivity returns, session validation occurs before local protected content is opened and before any replay

The current application behavior that treats an arbitrary session-load failure as signed out must be refined for M2, but pre-S1 development plaintext must not become an offline authentication bypass. S1 may later define a reviewed encrypted offline-unlock model.

## Offline chat queue

M2 supports typed, persisted chat operations.

Initial queueable operations:

- message.send
- message.edit
- message.delete
- reaction.set
- reaction.remove

A reply may be queued only when replyToMessageId refers to an authoritative server message.

M2 does not allow a queued reply to depend on another unsent temporary local message in version 1.

Typing and presence are never queued.

Read receipts are represented as monotonic pending high-water state rather than a long list of queued receipt operations.

Nickname mutation remains online-only in the first M2 slice unless implementation evidence justifies adding a typed queue entry.

## Offline send representation

A locally queued send does not receive a fake serverSequence.

The UI renders it as a separate pending local item with:

- local operation ID
- local queued time
- body
- optional authoritative reply target
- state: queued, sending, retrying, blocked, or failed

The UI must not label a queued message as Sent, Delivered, or Read.

When the server accepts or idempotently replays the send:

1. receive authoritative messageId, serverSequence, and changeSequence
2. fetch the canonical message projection
3. begin one IndexedDB completion transaction
4. persist the canonical projection
5. remove the queued local operation only if its current claim generation still belongs to this replay attempt
6. update any local pending-send overlay
7. commit
8. advance synchronization cursors only through the normal canonical synchronization rules

If the browser crashes after the server accepts the mutation but before the IndexedDB completion transaction commits, the same stable idempotency key is replayed after restart. The queue is not considered complete merely because an HTTP response was observed.

## Queued edit semantics

A queued edit stores:

- authoritative messageId
- body
- expectedContentVersion
- original server createdAt or computed edit deadline where useful for UX
- stable idempotency key

Replay never extends the M1 30-minute edit window.

The server remains authoritative for expiry.

VERSION_CONFLICT, MESSAGE_DELETED, PRE_BREAKUP_MESSAGE_LOCKED, and MESSAGE_EDIT_WINDOW_EXPIRED are terminal for that queued edit.

The UI keeps the attempted text available for the user to copy or review, but does not overwrite canonical state.

## Offline relationship queue

M2 introduces a separate typed R1 queue.

The M2 version-1 R1 queue uses an exact conservative whitelist.

Queueable:

- `POST /relationship-space/items` only when `release` is null or `release.mode` is `immediate`, all references are already-authoritative resource IDs supported by the current resolver set, and no M3 media/voice dependency exists
- `PATCH /relationship-space/items/:itemId` only when the patch omits the `release` field entirely and carries the existing `expectedVersion`; content, occurrence, story membership, Someday/shared feature state, links, references, reunion state, and saved curation changes remain server-validated at replay time
- `DELETE /relationship-space/items/:itemId` with the existing `expectedVersion`

Not queueable in M2 version 1:

- `POST /relationship-space/items/:itemId/release`
- create with `scheduled`, `recipient_open`, or `creator_reveal` release mode
- any patch that includes the `release` field, including reschedule or release-mode replacement
- any operation that can immediately expose previously sealed content
- media or Voice Letter references before M3
- an external reference whose resolver is unavailable

Every R1 replay still performs authoritative lifecycle, ownership, reference, time, and expected-version validation on the server.

Unknown R1 operation types fail closed and are not replayed.

## Queue replay ordering

Replay occurs only after canonical reconciliation.

Within one partnership namespace:

- preserve queue insertion order unless operations are independent and proven reorder-safe
- never replay two mutations against the same aggregate concurrently
- message.send operations may be retried independently because idempotency keys are stable
- expected-version R1 or message operations are serialized against their aggregate
- a namespace revocation cancels replay before the next HTTP mutation is sent

Multiple browser tabs may attempt replay.

Correctness relies on server idempotency and expected-version checks, but local coordination is hardened so a stale tab cannot remove work completed or reclaimed by a newer tab.

Each queued operation supports local claim metadata:

- `claimOwner`
- `claimGeneration`
- `claimExpiresAt`

A claimant updates those fields in one IndexedDB transaction. Completion, retry scheduling, or queue removal is accepted only when the claimant still owns the same claim generation. A later claimant increments the generation, so an older tab returning late from the network cannot delete or rewrite the newer claim.

`navigator.locks`, when available, is an outer efficiency optimization. The persisted local claim generation is the fallback coordination mechanism. Neither is an authorization control; server idempotency remains the correctness backstop.

Duplicate replay must remain safe even if all browser coordination fails.

## Retry classification

Retryable:

- network failure
- connection reset
- 408 where produced by infrastructure
- 429 with bounded Retry-After handling
- retryable 5xx responses

Terminal or blocked:

- 401 authentication failure
- explicit authorization denial
- partnership or conversation unavailable
- lifecycle denial
- VERSION_CONFLICT
- edit-window expiry
- message already deleted where canonical state differs from the queued intent
- unsupported client or protocol version
- malformed local operation
- unavailable resolver for a required external resource

Retryable operations remain visible to the user.

M2 does not silently discard unsent private content after an arbitrary retry-count ceiling.

After repeated failures, automatic retries may pause and expose a manual retry action.

## Receipts

Delivered and read state remains monotonic.

M2 stores local pending high-water values rather than one queued row per message.

When the client receives or renders canonical messages offline:

- pendingDeliveredThrough may advance locally
- pendingReadThrough may advance only according to the same visible/read UX rules used online

After reconnect and authority refresh, send the maximum pending high-water values through the existing HTTP receipt endpoint.

Never decrease a receipt high-water mark.

## Service worker boundary

The service worker owns only application-shell availability and static asset caching.

It must not cache:

- /api/*
- responses marked private or no-store
- message JSON
- R1 JSON
- account JSON
- authenticated HTML containing private data
- WebSocket traffic
- private media

Private application data belongs only in the explicit IndexedDB layer.

Recommended strategy:

- hashed static assets: cache-first
- navigation shell: network-first with a version-compatible cached shell fallback
- API requests: always network, never Cache API
- WebSocket: browser network stack, not service-worker data cache

## Service worker update safety

Do not automatically force a waiting service worker to replace a running incompatible client.

The application owns update coordination.

When a new worker is waiting:

1. pause offline queue replay
2. inspect client/local schema compatibility
3. finish or safely checkpoint current local transactions
4. activate the new worker
5. reload the application
6. reopen and migrate or validate IndexedDB
7. validate the session
8. reconcile canonical state
9. resume offline replay

If safe compatibility cannot be proven, fail closed and require an application refresh before mutation.

The service worker does not migrate IndexedDB itself and does not own durable product-mutation replay in M2. Replay remains in the authenticated page application, where session/lifecycle authority and conflict UX are available.

## Local schema migration failure

An IndexedDB migration failure must not submit queued operations under an unknown schema.

Failure behavior:

- stop replay
- keep the failed database closed
- show a local-data recovery/reset state
- do not merge namespaces
- do not guess field meaning
- canonical cache may be discarded and rehydrated after explicit safe reset
- unsent operations must not be silently deleted

Version 1 starts with no historical M2 local schema migration.

## Partnership lifecycle behavior

### Breakup initiation

On authoritative breakup change:

- refresh conversation and partnership state
- queued new messages/replies may remain replayable only if server capability still permits them
- queued edits/deletes/reactions to pre-breakup frozen messages become blocked
- queued R1 mutations become blocked because R1 is view-only
- preconfigured server-side scheduled R1 release behavior remains server-owned

### Restoration

On restoration:

- keep the same partnership namespace
- canonical refresh updates lifecycle capability
- blocked operations are not automatically replayed merely because permission returned unless their original semantics remain valid and the user explicitly retries where required

### Account deletion recovery overlay

When account deletion makes the partnership view-only:

- stop durable mutation replay
- retain authorized cached view state for the remaining partner according to current product rules
- unreleased R1 delivery remains server-paused
- reconnect validates account and partnership state before any replay

### Final dissolution

Final dissolution is a hard local namespace boundary.

As soon as the client learns the partnership is no longer authorized:

1. remove old partnership content from React state immediately
2. close or remove partnership realtime scope
3. cancel or block queued operations for that namespace
4. delete partnership messages from IndexedDB
5. delete R1 cache from IndexedDB
6. delete partnership queue entries
7. delete partnership sync metadata
8. delete future M3 local media metadata
9. delete future S1 local key namespace
10. ensure a future partnership cannot query the old namespace

If the device was offline during dissolution, these steps happen before queue replay after reconnect.

## Account logout, account switch, and device revocation

Before S1, local protected content is plaintext development data.

Therefore explicit logout or observed permanent authentication revocation deletes the account's M2 IndexedDB database.

A temporary network outage does not.

Account switch always closes the old realtime connection and opens only the new account-bound local database.

Device revocation:

- invalidates server session
- closes realtime after security invalidation or periodic revalidation
- stops queue replay
- purges authorization-bound local state
- remains compatible with future S1 key revocation

## Session and scope revalidation

A long-lived socket cannot trust upgrade-time authorization forever.

M2 requires:

- periodic session revalidation
- revalidation after account.security_changed
- revalidation after partnership.changed
- revalidation before accepting client transient commands if the validation window is stale
- immediate close when the session is revoked or account no longer has access

This closes the stale-WebSocket threat even if a transient internal notification is missed.

## Multi-tab behavior

M2 correctness must tolerate multiple tabs.

Each tab may have its own WebSocket.

Duplicate realtime delivery is safe.

Offline replay uses stable server idempotency keys.

Where available, one browser replay lock reduces duplicate network requests.

No correctness property depends on a single-tab assumption.

A future optimization may share one connection through a browser coordination primitive only after mobile/browser compatibility is proven.

## Browser visibility and background behavior

Mobile browsers may suspend timers and sockets.

Therefore:

- background socket survival is not assumed
- on visibility return, canonical sync always runs
- on pageshow after back-forward cache restoration, compatibility and sync are rechecked
- on online event, schedule immediate sync but still treat the event as only a hint
- typing is cleared by server TTL if the browser is suspended
- presence becomes offline through server TTL if heartbeats stop

## Rate limits

Client-originating realtime frames are limited to narrow transient commands.

Existing server-owned M1 rate limits remain authoritative for:

- typing
- presence

M2 additionally bounds:

- malformed frames per connection
- frame bytes
- ping/pong abuse
- connection attempts per account/IP where existing security primitives permit
- concurrent realtime connections per account/device where practical

Repeated protocol abuse closes the connection.

## Frame and payload ceilings

Initial design ceilings:

- client realtime frame: maximum 4 KiB
- server realtime frame: maximum 4 KiB
- internal PostgreSQL NOTIFY payload: comfortably below PostgreSQL's notification limit, target maximum 2 KiB
- no private content in any realtime frame

Exact constants belong in packages/contracts and must have boundary tests.

## Internal NOTIFY security

The API listener treats PostgreSQL NOTIFY payloads as untrusted serialized input.

It must:

- parse JSON defensively
- validate protocol version
- validate event type
- validate UUIDs and safe integer cursors
- reject unexpected fields
- reject oversize payloads
- never forward an internal payload blindly to a browser
- route only to connection scopes already authorized by the server

## Failure matrix

### Worker publishes while no API process is listening

Outbox event may be marked delivered.

No correctness loss.

Later reconnect repairs from canonical state.

### API LISTEN connection resets while WebSockets remain open

The hub marks local connections dirty.

After LISTEN reconnect, connected clients receive `control.resync_required` with reason `listener_reset`.

Visible-page anti-entropy also bounds recovery if that signal itself is missed.

No durable state depends on the listener generation.

### Client receives an old-socket callback after reconnect

The callback carries the old in-memory `connectionGeneration`.

The client ignores it.

It cannot mutate the current synchronization coordinator or namespace.

### Cold start occurs while offline before S1

The application shell may load.

Protected IndexedDB content remains locked.

No queue replay occurs.

Online server-session validation is required before protected local state becomes visible.

### IndexedDB quota prevents queue persistence

The operation is not labeled queued.

The unsent content remains available to the user where practical.

Canonical cache may be evicted first, but unsent queue entries are not silently sacrificed.

### API process crashes after receiving NOTIFY

Some sockets miss the hint.

No correctness loss.

Reconnect or next invalidation causes canonical repair.

### Browser receives duplicate invalidation

SyncCoordinator coalesces or repeats a safe HTTP reconcile.

No duplicate durable mutation occurs.

### Browser receives higher change sequence before lower hint

Client requests canonical changes after its committed cursor.

The HTTP change feed returns ordered durable changes.

### Browser is offline while partner edits an old message

On reconnect, change_sequence repair fetches the modified old message even if latest server_sequence did not change.

### Browser queues mutation then breakup changes permissions

Canonical lifecycle refresh runs before replay.

Client blocks disallowed operation.

Server independently rejects any race that passes the client check.

### Browser queues operation then final dissolution occurs

Namespace authorization check fails.

Old namespace is purged before replay.

No queued mutation reaches a future partnership.

### Realtime protocol version is unsupported

No live mode.

No offline replay.

Client enters update-required state.

## File and module plan

### packages/contracts

Add:

packages/contracts/src/realtime/m2.ts

Owns:

- protocol version constants
- server frame schemas
- client frame schemas
- internal invalidation schemas where shared
- frame ceilings
- compatibility constants

Add contract tests for every frame type and boundary.

### packages/db

Add a narrow PostgreSQL realtime notification adapter.

Expected responsibilities:

- publish validated compact NOTIFY payload
- create and manage a dedicated LISTEN client for API runtime
- reconnect listener connection safely
- expose parsed raw notification to API realtime module

Do not add domain authorization to packages/db.

### apps/worker

Add:

apps/worker/src/realtime/realtime-publisher.ts

Refine existing messaging invalidation handlers to publish after validation.

Add handlers for newly introduced content-free realtime outbox event families.

Keep handler registration explicit so the realtime worker cannot claim unrelated outbox events.

### apps/api

Add:

apps/api/src/modules/realtime/routes.ts
apps/api/src/modules/realtime/realtime-hub.ts
apps/api/src/modules/realtime/realtime-listener.ts
apps/api/src/modules/realtime/realtime-auth.ts
apps/api/src/modules/realtime/realtime-session-validator.ts

Responsibilities:

- WebSocket upgrade
- exact-origin enforcement
- session authentication
- server-derived scope
- local connection indexes
- internal NOTIFY validation
- bounded fanout
- transient typing/presence command routing
- backpressure and liveness
- session/scope revalidation
- graceful shutdown

### apps/web

Add:

apps/web/src/lib/realtime/realtime-client.ts
apps/web/src/lib/realtime/sync-coordinator.ts
apps/web/src/lib/offline/local-db.ts
apps/web/src/lib/offline/namespace.ts
apps/web/src/lib/offline/chat-outbox.ts
apps/web/src/lib/offline/relationship-outbox.ts
apps/web/src/lib/offline/replay-engine.ts
apps/web/src/lib/offline/replay-claims.ts
apps/web/src/lib/offline/compatibility.ts
apps/web/src/lib/pwa/service-worker-registration.ts

Refine:

apps/web/src/features/messaging/MessagingPanel.tsx
apps/web/src/features/relationship-space/RelationshipSpacePanel.tsx
apps/web/src/app/App.tsx

The feature panels consume synchronized local projections.

They do not each implement independent sockets, polling loops, or IndexedDB logic.

## M2 implementation sequence

### M2-A Protocol, contracts, and compatibility skeleton

Implement:

- realtime protocol v1 contracts
- frame bounds
- compatibility constants
- explicit client frame allowlist
- explicit server frame allowlist
- no-content contract scans
- local schema v1 types

Exit evidence:

- contract tests green
- malformed and unknown versions fail closed
- no product runtime behavior changed yet

### M2-B Authenticated WebSocket and server-derived scope

Implement:

- official Fastify WebSocket integration
- /api/v1/realtime
- exact Origin check
- session-cookie authentication
- protocol negotiation
- current account/partnership/conversation derivation
- connection hub indexes
- liveness
- bounded backpressure
- graceful API shutdown

Exit evidence:

- arbitrary subscription impossible
- revoked/expired session cannot establish or retain a live socket
- guessed identifiers cannot change scope
- duplicate connections remain safe
- partnership/conversation identity is immutable for one socket lifetime
- binary frames and per-message compression are disabled/rejected as designed
- old client socket generations cannot affect the new connection

### M2-C Durable invalidation publisher

Implement:

- RealtimePublisher port
- PostgreSQL NOTIFY publisher
- API LISTEN connection
- M1 outbox validation-to-publish path
- content-free partnership, relationship, receipt, nickname, and account-security invalidations where required
- explicit event registry ownership

Exit evidence:

- M1 durable change rows remain canonical
- dropped NOTIFY does not lose correctness
- duplicate NOTIFY is safe
- unrelated outbox families remain unclaimed
- LISTEN loss/reconnect causes client resynchronization rather than silent stale live state
- publish is committed before the durable outbox claim is acknowledged delivered

### M2-D Client realtime and canonical synchronization engine

Implement:

- realtime client state machine
- SyncCoordinator single-flight behavior
- change_sequence repair
- server_sequence history-gap repair
- event coalescing
- visibility/online reconnect
- HTTP polling fallback during socket outage
- race-free live barrier using dirty-counter/high-water checks
- low-frequency visible-page anti-entropy even with a healthy socket

The existing 2-second visible polling loop may remain as a bounded fallback during early M2 slices but should no longer be the normal live path after closure.

Exit evidence:

- edit/delete/reaction to old message repairs correctly
- duplicate/out-of-order/missed realtime hints repair correctly
- canonical HTTP state wins every conflict

### M2-E IndexedDB namespace and cache

Implement local schema v1.

Move canonical recent message and R1 projections into the account-bound partnership namespace.

Implement:

- atomic cursor plus projection transactions
- bounded cache
- explicit retained history window
- namespace purge
- pre-S1 contentContextKey
- logout/account-switch handling

Exit evidence:

- account and partnership isolation tests
- future partnership cannot render old cache
- cursor cannot advance without associated data commit
- failed local transaction safely replays

### M2-F Offline chat queue

Implement:

- persistent send/edit/delete/reaction queue
- stable idempotency keys
- no fake server sequence
- optimistic pending-send presentation
- retry classifier
- aggregate serialization
- persisted local claim-generation fencing across tabs
- atomic canonical-projection plus queue-completion transaction
- edit conflict UX
- pending receipt high-water state

Exit evidence:

- process/browser restart preserves unsent queue
- reconnect replays idempotently
- lost HTTP response cannot duplicate message
- lifecycle change blocks stale queued mutation
- edit deadline and expectedContentVersion stay authoritative

### M2-G Offline R1 queue

Implement explicit safe whitelist only.

Implement:

- typed R1 queue
- expectedVersion preservation
- local pending overlays
- lifecycle preflight
- conflict/blocked UX

Keep release/open/reveal and scheduled-release mutations online-only.

Exit evidence:

- stale R1 mutation cannot silently overwrite partner state
- breakup/account-deletion blocks replay
- final dissolution destroys queue namespace
- queued R1 content never enters realtime or logs

### M2-H Service worker and update compatibility

Implement:

- app-shell/static caching only
- no API/private-response caching
- controlled waiting-worker activation
- replay pause during upgrade
- local-schema compatibility check
- update-required UX

Exit evidence:

- stale service worker cannot submit unknown mutation shape
- private API data absent from Cache API
- interrupted update recovers safely
- incompatible local schema fails closed

### M2-I Security hardening, integration closure, and physical Android

Implement closure harnesses and device validation.

Required physical Android scenarios:

1. install the PWA
2. send online and receive realtime update
3. disable network, queue message, restore network, verify one authoritative message
4. queue edit then create server-side conflict, verify blocked conflict behavior
5. background app long enough for socket suspension, foreground, verify canonical catch-up
6. restart API while app is open, verify reconnect and catch-up
7. intentionally miss a realtime notification, verify HTTP repair
8. duplicate realtime hint, verify no duplicate state
9. enter breakup while device is offline, reconnect, verify capability refresh before replay
10. final dissolution while device is offline, reconnect, verify old namespace purge before replay
11. revoke current device or session, verify realtime closes and replay stops
12. service-worker update with queued operations, verify safe checkpoint/reload behavior
13. future partnership cannot render previous partnership local data
14. cold-start offline before S1 shows a locked shell rather than cached private plaintext
15. reset the API LISTEN connection while WebSockets stay open and verify forced canonical resync
16. induce IndexedDB quota/storage failure and verify the UI never falsely reports an operation as queued
17. race two tabs replaying one queued operation and verify stale local claim completion cannot delete a newer claim

M2 is not DONE until physical-device evidence is recorded.

## Test command plan

Add root commands:

- test:realtime-offline
- test:m2:security
- test:m2:postgres
- test:m2:browser
- test:m2:local

Expected layers:

### Contract/unit

- frame schemas
- compatibility logic
- sync state machine
- queue retry classifier
- local namespace key construction
- cache-gap logic
- replay ordering

### API security

- Origin rejection
- session rejection
- arbitrary-scope escalation
- malformed frame handling
- oversize frame handling
- unsupported protocol
- stale session closure
- content-free frame enforcement
- connection-rate limits

### PostgreSQL/API/worker integration

- outbox to NOTIFY
- duplicate publish
- missing listener
- two API listeners
- API listener reconnect
- M1 invalidation delivery
- lifecycle invalidation
- account security invalidation
- worker event-family isolation
- full earlier-milestone regressions

### Browser automation

Use a real browser harness for:

- IndexedDB persistence
- offline/online transitions
- socket reconnect
- page visibility
- service worker update
- multi-tab duplicate safety
- queue persistence across reload
- namespace purge

Physical Android remains a separate closure requirement even when browser automation is green.

## Migration ownership

M2 is expected to require no PostgreSQL migration.

It reuses:

- existing sessions
- existing M1 conversation changes
- existing M1 outbox events
- existing F2 outbox worker
- existing P3 lifecycle
- existing R1 persistence
- PostgreSQL LISTEN/NOTIFY

Migration 0015 is not reserved merely for M2.

If implementation evidence proves durable server-side schema is required, the design must be amended before adding the next migration.

## Dependency policy

Server:

- add the official Fastify WebSocket plugin compatible with the repository's Fastify major version
- do not add Redis
- do not add a second message broker

Browser:

- prefer native WebSocket, IndexedDB, BroadcastChannel where useful, navigator.locks where available, and service-worker APIs
- avoid a large client state/database framework unless implementation evidence shows the native wrapper is insufficient
- keep the trusted-origin dependency surface small

Browser automation may add a maintained Playwright test dependency during implementation.

## Observability

M2 may log only operational metadata.

Allowed examples:

- connection opened/closed counts
- protocol version
- close reason code
- reconnect count
- sync page counts
- queue counts
- retry class
- event type
- anonymous or bounded internal identifiers where already allowed by the data-classification policy

Never log:

- message body
- reaction emoji
- nickname text
- R1 protected content
- queued private request body
- relationship coordinates
- raw cookies
- session tokens
- WebSocket payloads wholesale

## Performance targets

M2 correctness is more important than synthetic latency.

Reasonable local targets:

- one realtime connection should not require one dedicated database connection
- one API process uses one dedicated LISTEN connection plus the normal pool
- message invalidation frames stay small and content-free
- duplicate invalidations should coalesce rather than trigger unbounded HTTP requests
- SyncCoordinator yields between large page batches so the browser remains responsive
- background pages do not spin aggressive reconnect loops

Production performance claims require later operational evidence.

## Security review checklist

Before M2 closure, verify:

- exact Origin upgrade defense
- no auth token in WebSocket URL
- server-derived channel membership only
- current session revalidation
- device revocation closes future access
- no durable mutation transport over WebSocket
- no private content in outbox invalidations
- no private content in PostgreSQL NOTIFY
- no private content in WebSocket invalidations
- bounded frame size
- bounded send queue
- malformed internal NOTIFY rejected
- stale partnership socket cannot receive future partnership data
- final dissolution purges local namespace
- account switch cannot render previous account data
- service worker cannot cache private API data
- IndexedDB failure cannot cause unsafe mutation replay
- offline queue cannot bypass lifecycle or version checks
- future partnership cannot reuse old queue or cache entries

## Canonical M2 acceptance gates

M2 is DONE only when all of the following have executed evidence:

1. authenticated WebSocket uses the existing server session and exact trusted Origin
2. client cannot subscribe to arbitrary account, partnership, conversation, or item scopes
3. unsupported critical realtime protocol version fails closed
4. realtime and internal notification payloads contain no protected content
5. duplicate realtime delivery is safe
6. out-of-order realtime delivery is safe
7. missed realtime events are recovered through canonical HTTP resynchronization
8. change_sequence repairs old-message edits, deletes, and reactions
9. server_sequence repairs required message-history gaps without becoming mutation order
10. local cursor advance is atomic with corresponding projection persistence
11. offline message send survives reload and replays idempotently
12. queued edit preserves expectedContentVersion and cannot extend the edit window
13. lifecycle change while offline blocks or rejects now-invalid queued operations
14. R1 offline replay is limited to an explicit safe operation whitelist
15. release/open/reveal transitions remain online and server-authoritative
16. IndexedDB is partitioned by account, partnership, conversation, and content context
17. pre-S1 local storage does not claim fake encryption or fake crypto epochs
18. explicit logout/account switch/revocation cannot expose prior account local plaintext
19. final dissolution removes old partnership UI state before replay and purges the local namespace
20. a future partnership cannot render or replay old partnership data
21. stale or revoked WebSocket authorization is closed through invalidation or periodic revalidation
22. PostgreSQL NOTIFY loss does not break correctness
23. service worker never caches private API responses
24. incompatible service-worker/client/local-schema combination fails closed before mutation
25. multi-tab duplicate realtime and replay remain safe
26. reconnect and offline browser automation passes
27. full repository health passes
28. high-severity dependency audit passes
29. physical Android M2 acceptance passes
30. a socket cannot enter live state until the dirty-counter/high-water synchronization barrier closes without a concurrent invalidation
31. partnership/conversation scope identity is immutable for one socket lifetime and identity change forces reconnect
32. callbacks from an older browser connection generation cannot mutate the current sync state
33. API LISTEN loss/reconnect forces canonical resynchronization for local sockets
34. visible-page anti-entropy repairs silent missed hints even while WebSocket transport appears healthy
35. multi-tab replay uses claim-generation fencing so a stale tab cannot remove or overwrite a newer local claim
36. pre-S1 cold-start offline mode does not expose protected IndexedDB plaintext before server-session validation
37. IndexedDB quota/storage failure cannot be represented as successful offline queueing and never silently evicts unsent operations
38. WebSocket binary application frames are rejected and per-message compression is disabled
39. R1 offline queue enforcement matches the exact version-1 whitelist
40. successful or idempotently replayed mutations remove their local queue record only through a fenced local completion transaction after canonical state is persisted
41. PostgreSQL NOTIFY publication is committed before the corresponding durable outbox claim is acknowledged delivered

## Handoff to later milestones

### M3

M3 may reuse:

- realtime hub extension points
- local namespace infrastructure
- service-worker compatibility controls
- offline operation infrastructure

M3 owns actual media upload, media retrieval, media local metadata, and voice-message transport.

### C1

C1 may add call signaling frame types to a new reviewed realtime protocol version or a backward-compatible v1 extension if compatibility rules allow it.

M2 does not pre-implement call signaling.

### S1

S1 replaces pre-S1 protected local plaintext with reviewed encrypted local state.

S1 owns real crypto epochs.

M2's contentContextKey exists only to make that migration explicit without inventing cryptographic state early.

## Completion statement

M2 architecture and implementation sequencing are now defined.

Implementation must begin from main @ 9f4237e90c4d289f8b316e5d8dd2bba41609c95d on feat/m2-realtime-offline.

Any implementation change that would:

- make WebSocket state authoritative
- collapse server_sequence and change_sequence
- introduce Redis
- invent crypto epochs
- add durable server schema without evidence
- make final-dissolution purge optional
- cache private API responses in the service worker

requires an explicit architecture review before proceeding.
