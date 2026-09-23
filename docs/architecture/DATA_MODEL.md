# Data Model

## Purpose

This document defines the logical persistence model and the database invariants that must protect Shawtie pls even when clients race, retry, disconnect, or behave maliciously.

PostgreSQL is the authoritative transactional store.

## Physical schema status

The first physical schema foundation is committed under `packages/db/migrations`.

It includes identity, partnership lifecycle, durable operations, content metadata, relational-integrity hardening, the F2 durable-runtime reliability migration, A1 migration 0007, verified P1 migration 0008, verified P2 migration 0009, and verified P3 migration `0010_partnership_lifecycle_runtime.sql`.

The physical schema has passed local disposable-database validation against PostgreSQL 16 through migration 0010. All ten migrations apply from zero, database invariants pass, the P3 lifecycle domain/contracts suite passes 28/28, P3 security passes 6/6, and the disposable PostgreSQL/API/worker integration matrix passes 39/39 with `P3_LOCAL_POSTGRES_PASS`. Earlier F2, A1, P1, and P2 verification remains preserved by the corresponding regression surfaces.

This document remains the logical model. F2 repository integration, automated concurrency regression coverage, worker infrastructure, outbox transaction infrastructure, deletion retry infrastructure, and query-plan validation are implemented and locally verified. Hosted PostgreSQL reproduction remains a separate V1 concern.

A1 migration `0007_accounts_devices_runtime.sql` is implemented and locally verified. It commits registration intents, password credentials, account-email display preservation, hardened email challenges, session token-generation fencing, device-handle verifiers, versioned PostgreSQL security-rate-limit buckets, durable security-email deliveries, and append-only security-event hardening.

P1 migration `0008_partner_discovery_requests_runtime.sql` is implemented and verified with exact request-expiry evidence, terminal-shape constraints, pair-limit indexes, decline-cooldown indexes, request-attempt hardening, append-only attempt behavior, and the manually entered `relationship_start_date` required by P2 formation. P2 migration `0009_partnership_formation_runtime.sql` is implemented and verified with accepted-request linkage, restrictive foreign-key semantics, legacy-safe `NOT VALID` linkage constraints, minimal durable account notifications, and formation/query indexes. Migration 0008 remains unchanged at SHA-256 `94e2d22ceff3b73fc990fc07810cabedea097d7440a571c54c00ec185bebd18e`. P3 migration `0010_partnership_lifecycle_runtime.sql` is implemented and verified with breakup cancellation/supersession terminal markers, lifecycle indexes and constraints, exact cooldown hardening, block-source hardening, notification event expansion, and one-partnership deletion-manifest uniqueness without rewriting migrations 0001 through 0009. The fresh immutable partnership ID remains the namespace root.

M1 owns forward-only migrations 0011 and 0012 on its parallel branch. R1 owns forward-only migrations 0013 and 0014 on `feat/r1-relationship-space`. Those four migrations are design targets until their source and executable PostgreSQL evidence exist. Neither feature branch may consume the other branch's migration numbers.

Migration policy and verification commands are documented in `../database/MIGRATIONS.md`.

M1 reserves forward-only migrations 0011 and 0012 on `feat/m1-messaging-core`. The refined design extends the existing conversation/message and breakup-process substrate with a separate durable mutation change sequence, a content-free conversation-change ledger, current-content versioning, keyed private-request fingerprints, compact receipt/nickname/presence/typing state, and module-owned messaging cleanup. M1 does not persist plaintext edit history. The 0011 and 0012 migration source is implemented on the M1 branch. Disposable-PostgreSQL execution evidence is still required before M1 can close. R1 separately reserves migrations 0013 and 0014.

## Identifier policy

Use immutable random identifiers for externally referenced records.

UUIDv7 is preferred where library support is mature because it combines high uniqueness with insertion locality and sortable creation order.

Usernames and display names must never be used as relational identity.

## Accounts

Core logical tables:

```text
accounts
account_profiles
account_emails
email_verifications
account_sessions
account_devices
account_recovery_material
account_deletion_requests
username_change_history
security_events
```

### accounts

Representative fields:

```text
id
username_normalized
username_display
date_of_birth
date_of_birth_corrected_at
status
next_username_change_eligible_at
created_at
updated_at
```

### account_emails

Representative fields:

```text
account_id
email_normalized
verified_at
is_current
created_at
```

The current verified email must be unique across accounts.

Permanent account deletion releases the email only after the seven-day recovery period completes.

### account_devices

Representative fields:

```text
id
account_id
display_name
created_at
last_seen_at
revoked_at
crypto_identity_public_key
crypto_protocol_version
```

Device revocation affects both authentication and cryptographic authorization.

### account_recovery_material

Stores only client-encrypted recovery material and metadata required by the reviewed recovery design.

The server must not possess the high-entropy recovery secret needed to decrypt it.

## Partner requests

```text
partner_requests
partner_request_attempts
```

Representative request fields:

```text
id
sender_account_id
recipient_account_id
status
created_at
expires_at
declined_at
cancelled_at
accepted_at
relationship_start_date nullable only for pre-P1 legacy compatibility; required on every new request
accepted_partnership_id
```

`relationship_start_date` is entered by the request sender and is private to request participants. Migration 0008 uses a `NOT VALID` non-null check so new and updated request rows must carry it without fabricating legacy values. `accepted_partnership_id` is populated only when P2 accepts the request into a partnership and uses restrictive foreign-key semantics so retained acceptance evidence cannot silently lose its replay identity.

The attempt ledger supports:

- maximum three requests to the same account in a rolling month
- one-hour cooldown after a decline
- abuse analysis without mutable counters becoming the only evidence

Mutual pending requests are resolved transactionally into one partnership.

## Partnerships

```text
partnerships
partnership_members
breakup_processes
partnership_cooldowns
partnership_blocks
partnership_crypto_epochs
partnership_lifecycle_events
```

### partnerships

Representative fields:

```text
id
created_at
activated_at
relationship_start_date
lifecycle_state
terminated_at
termination_reason
version
```

The immutable random partnership ID is the namespace root for partnership-scoped server state, local storage, and later S1 cryptographic context. No second namespace identifier is required.

### partnership_members

Representative fields:

```text
partnership_id
account_id
joined_at
released_at
```

The database must enforce that an account occupies at most one current partnership slot.

Preferred invariant:

```sql
UNIQUE(account_id)
WHERE released_at IS NULL
```

The exact migration syntax may vary with the final table design, but the invariant must exist in the database, not only in application code.

### account_notifications

P2 adds a minimal durable in-app notification store:

```text
id
recipient_account_id
actor_account_id
partnership_id
event_type
deduplication_key
created_at
read_at
```

P2 initially uses it for partnership formation and relationship-start-date change events. Notification rows carry routing/event identity only and do not duplicate relationship dates, private content, email, DOB, device state, or cryptographic material. Push transport is added later without changing formation authority.

### partnership_crypto_epochs

Representative fields:

```text
partnership_id
epoch
crypto_protocol_version
created_at
retired_at
rotation_reason
```

A new partnership starts with a new cryptographic root.

Epoch changes do not reuse prior partnership secrets.

### partnership_lifecycle_events

Append-only non-content records for security-sensitive lifecycle transitions.

Representative fields:

```text
id
partnership_id
event_type
actor_account_id
aggregate_version
created_at
metadata_json
```

The metadata must not contain private message, media, or relationship content.

## Breakup process

Representative breakup-process fields:

```text
id
partnership_id
initiated_by_account_id
initiated_at
initiator_cancel_until
base_deadline
final_deadline
generation
restored_at
dissolved_at
cancelled_at
superseded_at
```

Restoration intents remain separate immutable rows in `breakup_restore_intents`, keyed by breakup process and account. Once an intent is recorded, normal product behavior must not clear it.

P3 migration 0010 adds `cancelled_at` for one-hour unilateral cancellation and `superseded_at` when another destructive lifecycle, currently permanent partner-account deletion, terminates the partnership before that breakup deadline. At most one breakup terminal marker may be present.

The persisted final deadline is authoritative. The breakup-process generation fences deadline workers and is separate from partnership metadata version.

## Cooldowns

Use an explicit eligibility record rather than a generic boolean.

```text
account_partner_eligibility
- account_id
- eligible_at
- reason
- source_partnership_id
- created_at
```

Reasons include:

```text
BREAKUP_DISSOLUTION
PARTNER_ACCOUNT_DELETED
```

Policy:

- breakup dissolution creates a three-calendar-month cooldown
- permanent partner-account deletion from an active partnership creates a one-calendar-month cooldown for the remaining partner
- logical eligibility returns at `eligible_at`; a worker is not required for correctness
- expired open eligibility rows are resolved under account lock before a new cooldown is inserted
- successful future partnership formation resolves expired prior cooldown rows for both accounts
- an overlapping still-active cooldown where a new cooldown would be created is an invariant violation, not a silent conflict

## Blocking

Blocking is only allowed after final dissolution.

Representative fields:

```text
partnership_blocks
- blocker_account_id
- blocked_account_id
- source_partnership_id
- created_at
- removed_at
```

An active block prevents:

- normal username discovery by the blocked account
- partner requests
- future partnership formation

## Conversations and messages

Logical M1 tables and state:

```text
conversations
messages
message_versions
message_reactions
message_receipts
conversation_changes
conversation_member_state
partnership_chat_nicknames
account_presence
conversation_typing_state
```

Representative conversation fields:

```text
id
partnership_id
kind
next_server_sequence
next_change_sequence
created_at
```

`next_server_sequence` orders message creation. `next_change_sequence` orders durable message-state mutations. They are separate because editing, deleting, or reacting to an older message must be synchronizable without pretending a new message was created.

Representative message fields after the M1 refinement:

```text
id
conversation_id
partnership_id
sender_account_id
sender_device_id
body_text
ciphertext
ciphertext_version
reply_to_message_id
client_idempotency_key
request_fingerprint
server_sequence
content_version
last_change_sequence
created_at
edited_at
deleted_at
```

The sender device ID is derived from the authenticated session, not from caller-controlled request input.

### Message ordering

Use the monotonic per-conversation `server_sequence` for immutable message creation order and history pagination.

Timestamps remain useful metadata but are not an ordering primitive.

### Durable mutation synchronization

Use a separate monotonic `change_sequence` for:

- message creation
- message edit
- message deletion
- reaction set/change/remove

`conversation_changes` is append-only while retained and carries only synchronization metadata:

```text
conversation_id
change_sequence
change_type
message_id
content_version nullable
created_at
```

It must never contain message bodies, reaction emoji, nickname text, reply content, or other protected payload.

The message row records its latest applied change sequence. HTTP polling in M1 and later realtime reconnect repair can therefore discover mutations to old messages without relying on client timestamps or new-message sequence movement.

### Edits

The server validates the 30-minute edit window using trusted server time.

An edit supplies `expectedContentVersion`. The locked row must still match that version or the mutation returns a deterministic version conflict.

Pre-S1 M1 stores only the current development plaintext body. It does not write prior plaintext bodies to `message_versions`. The existing versions table remains compatibility/future encrypted-history substrate.

### Deletes

Deletion removes current protected content and any historical content storage, retires reactions, and preserves only minimal tombstone metadata.

The system must not retain plaintext deleted content in logs, versions, durable change rows, outbox events, scheduled work, or idempotency metadata.

### Reactions

One active reaction per account per message is database-enforced for M1.

Reaction content exists only in the authoritative reaction row. Durable change rows and outbox invalidations identify the affected message/change but never duplicate the emoji.

### Delivery and read state

M1 writes monotonic high-water marks in `conversation_member_state`.

Read never trails delivered, neither mark may exceed the latest committed message sequence, and clients must not acknowledge across a known unresolved forward-synchronization gap.

The older per-message receipt table remains compatibility substrate rather than the normal M1 write path.

### Presence and typing

`account_presence` stores only the current account snapshot, not history. Disclosure remains partnership-scoped: the current partner may not receive `last_seen_at` information older than the current partnership's activation time.

`conversation_typing_state` is short-lived, server-expiring state. M1 uses centralized server-owned TTL, heartbeat, coalescing, and rate-limit policy so high-frequency interaction metadata cannot create unbounded database writes.

### Shared chat nicknames

`partnership_chat_nicknames` is partnership-scoped shared metadata with optimistic versioning.

Nicknames are protected partnership content. They may be server-readable during pre-S1 development, but the S1 design must explicitly decide their encrypted representation rather than treating them as an accidental permanent plaintext exception.

### Idempotency and private request fingerprints

Retryable private-content mutations use versioned keyed request fingerprints, such as a server-held HMAC over a canonical request representation.

An ordinary unkeyed digest of message text is not a sufficient durable mismatch verifier.

Idempotency records and mutation response metadata must not duplicate private content.

## Relationship space

R1 keeps the existing `relationship_items` table as the aggregate root and adds typed supporting state only where the server must enforce product semantics.

Canonical design:

```text
relationship_items
relationship_events
relationship_someday_state
relationship_signal_state
relationship_reunion_state
relationship_curations
relationship_item_references
relationship_item_links
relationship_story_members
```

Migration 0013 owns preview/main content roles, normalized occurrence components, release state/generation, feature state, query indexes, and a composite `UNIQUE (id, partnership_id)` root key. Migration 0014 owns same-partnership child foreign keys, loose references, curation/prepared-content links, Our Story membership, and event hardening.

Representative root fields:

```text
id
partnership_id
creator_account_id
kind
lifecycle
version
content_schema_version
development_preview_payload
development_plaintext_payload
encrypted_preview_payload
encrypted_payload
ciphertext_version
occurred_precision
occurred_year
occurred_month
occurred_day
unlock_at
release_mode
release_generation
released_at
created_at
updated_at
deleted_at
```

Root item ID, partnership ID, creator account ID, kind, and created timestamp are immutable.

The existing `occurred_date` remains compatibility substrate. Explicit components preserve day/month/year/unknown precision. Historical occurrences are not future-dated under trusted PostgreSQL UTC date.

Protected content has two roles: preview and main. Pre-S1 development uses explicit development columns. S1 later uses separate encrypted preview/main envelopes and the reviewed ciphertext version. Development and encrypted storage modes never mix on one item.

Voice Letter is a media reference role, not a standalone item kind. The containing item owns release and visibility.

Loose message/media references are accepted only when the corresponding M1/M3 resolver exists. A reference never grants authorization.

Item links support only curation and reunion prepared-content links to independently visible same-partnership targets. Surprise/Proposal private sequences stay inside the protected container payload.

Incoming target deletion is explicit for surviving curation owners so owner versions increment rather than changing silently through cascade.

Scheduled For You/Future Us release uses existing durable `scheduled_actions` with empty payload and `expected_generation = release_generation`. Original `execute_at` remains product time even if `available_at` is postponed during account-deletion recovery.

User item deletion hard-deletes the item after incoming-link reconciliation. Final dissolution remains P3-owned and deletes R1 relational content after synchronous authorization revocation.

The full R1 design is canonical in `R1_RELATIONSHIP_SPACE_DESIGN.md`.

## Calls

C1 refines existing `call_sessions`, `call_participants`, and `call_events`; it does not create a second aggregate.

`call_sessions` owns aggregate fields including `version`, independent `deadline_generation`, ring/connect/hard deadlines, aggregate `connected_at`, `ended_at`, and internal `terminal_reason`.

`call_participants` owns exactly two role rows and is the sole durable endpoint authority: caller/callee `role`, account, `endpoint_device_id`, `accepted_at`, `connected_at`, and `left_at`. Caller endpoint is fixed at creation; callee endpoint is selected once by first successful acceptance. Existing `initiated_by_account_id` must agree with the caller participant. No duplicate caller/callee endpoint columns are added to `call_sessions`.

Constraints enforce one non-terminal call per partnership, one caller/callee role, initiator consistency, device ownership, fixed caller endpoint, and first-accept-wins callee selection.

States are `ringing`, `accepted`, `connected`, and terminal `ended`. Internal terminal reasons map to a smaller privacy-safe public outcome vocabulary.

`deadline_generation` is independent from call `version`. Ring/connect/hard-expiry work checks it. The first endpoint-connected attestation does not advance it, so connect timeout remains valid until both endpoints attest or another authoritative transition replaces the deadline.

`call_events` never stores SDP, ICE, TURN credentials, device labels, raw provider errors, or audio. History is partnership-scoped and deleted at final dissolution.

Migration `0018_push_runtime.sql` adds device-bound Web Push subscriptions for generic `call_state_changed` reachability. Push capability data is sensitive and never public/logged.

C2 later enables video over the same call model.

## Media

Logical media metadata should reference random object identifiers, not user filenames.

Representative fields:

```text
media_objects
- id
- partnership_id
- uploader_account_id
- storage_object_key
- ciphertext_size
- created_at
- deleted_at
```

The object store contains ciphertext.

Access to signed object URLs still requires authenticated partnership authorization.

## Durable operations

```text
scheduled_actions
outbox_events
```

### scheduled_actions

Used for:

- request expiry
- breakup deadlines
- breakup reminders
- account-deletion finalization
- scheduled relationship unlocks
- bounded cleanup

The current physical table already stores status, attempt count, claim metadata, expected generation, deduplication key, and payload.

F2 plans to add runtime-reliability fields including:

- `available_at`
- `lease_expires_at`
- monotonically increasing `claim_version`
- `payload_version`

`execute_at` remains the original product deadline. Retry scheduling must not destroy that historical business time.

The normal claim query will consider both due pending work and processing work whose lease expired. `claim_version` fences late acknowledgements from stale workers.

### outbox_events

Used to bridge committed database state to:

- WebSocket invalidations
- push
- email
- worker side effects

F2 plans to add:

- `lease_expires_at`
- `max_attempts`
- monotonically increasing `claim_version`
- `payload_version`

Outbox delivery remains at-least-once. Durable payload versions fail closed when unsupported.

## Deletion manifests

Logical tables:

```text
deletion_manifests
deletion_targets
```

Deletion manifests coordinate revocation and cleanup across database data, media objects, push state, key envelopes, local purge notification, and backup-expiration obligations.

F2 plans claim ownership, lease expiry, and a monotonically increasing `claim_version` on deletion targets so cleanup can resume safely after worker crash while stale workers are fenced from acknowledgement.

The manifest is operational metadata and must not duplicate deleted private content.

## Optimistic concurrency

Shared mutable records should contain a version.

Clients send a feature-specific expected version, such as P2 `expectedMetadataVersion` for relationship metadata.

A mutation succeeds only when the stored version still matches. Conflicts return a deterministic conflict response instead of silently overwriting the partner's newer update.

## Deterministic account locking

Multi-account transactions lock involved account rows in canonical immutable-ID order.

The same helper must be used across all modules that acquire more than one account lock.

## Idempotency

Retryable mutations must use client idempotency keys.

Use database uniqueness such as:

```text
UNIQUE(account_id, client_idempotency_key)
```

or an equivalent scope appropriate to the operation.

## Deletion

Final partnership dissolution and permanent account deletion are destructive boundaries.

Deletion orchestration must cover:

- database rows
- object-store ciphertext
- local client namespaces
- queued mutations
- partnership cryptographic state
- notification subscriptions

Backup retention must be documented separately and must never make deleted content available through normal product functionality.
