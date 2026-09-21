# Data Model

## Purpose

This document defines the logical persistence model and the database invariants that must protect Shawtie pls even when clients race, retry, disconnect, or behave maliciously.

PostgreSQL is the authoritative transactional store.

## Physical schema status

The first physical schema foundation is committed under `packages/db/migrations`.

It includes identity, partnership lifecycle, durable operations, content metadata, relational-integrity hardening, the F2 durable-runtime reliability migration, and committed A1 migration 0007.

The physical schema has passed local disposable-database validation against PostgreSQL 16 through migration 0007. All seven migrations apply from zero, the invariant suite passes, the F2 runtime suite passes 17/17, and the completed A1 disposable PostgreSQL acceptance suite passes 27/27.

This document remains the logical model. F2 repository integration, automated concurrency regression coverage, worker infrastructure, outbox transaction infrastructure, deletion retry infrastructure, and query-plan validation are implemented and locally verified. Hosted PostgreSQL reproduction remains a separate V1 concern.

A1 migration `0007_accounts_devices_runtime.sql` is implemented and locally verified. It commits registration intents, password credentials, account-email display preservation, hardened email challenges, session token-generation fencing, device-handle verifiers, versioned PostgreSQL security-rate-limit buckets, durable security-email deliveries, and append-only security-event hardening.

P1 reserves the planned migration `0008_partner_discovery_requests_runtime.sql` to add exact request-expiry evidence, terminal-shape constraints, pair-limit indexes, decline-cooldown indexes, request-attempt hardening, append-only attempt behavior, and the manually entered `relationship_start_date` required by P2 formation. P2 reserves `0009_partnership_formation_runtime.sql` for accepted-request linkage, fresh partnership security namespaces, and durable account notifications. Both migrations remain design-only.

Migration policy and verification commands are documented in `../database/MIGRATIONS.md`.

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
security_context_id
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

`relationship_start_date` is entered by the request sender and is private to request participants. `accepted_partnership_id` is populated only when P2 accepts the request into a partnership.

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

`security_context_id` is a unique non-secret namespace identifier created fresh for every partnership. It is not key material and does not imply that S1 E2EE has been provisioned.

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

Representative fields:

```text
id
partnership_id
initiated_by_account_id
initiated_at
initiator_cancel_until
base_deadline
extended_deadline
member_a_restore_at
member_b_restore_at
final_deadline
restored_at
dissolved_at
version
```

Restoration timestamps are append-only. Once a restoration intent is recorded, normal product behavior must not clear it.

The persisted final deadline is authoritative.

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

Logical tables:

```text
conversations
messages
message_versions
message_reactions
message_receipts
```

Representative message fields:

```text
id
conversation_id
partnership_id
sender_account_id
sender_device_id
ciphertext
ciphertext_version
reply_to_message_id
client_idempotency_key
server_sequence
created_at
edited_at
deleted_at
```

### Ordering

Use a monotonic per-conversation server sequence for deterministic synchronization.

Timestamps remain useful metadata but should not be the sole ordering primitive.

### Edits

Message versions preserve encrypted edit history where required by product behavior.

The server validates the 30-minute edit window using server time.

### Deletes

Deletion removes protected content from normal access and preserves only the minimal tombstone information needed to render:

`This message has been deleted`

The system must not retain plaintext deleted content in logs.

## Relationship space

Use a generic item table with typed operational detail where required.

```text
relationship_items
relationship_events
```

Representative item fields:

```text
id
partnership_id
creator_account_id
kind
lifecycle
version
created_at
occurred_date
occurred_precision
encrypted_payload
```

Kinds may include:

- memory
- remember_this
- first
- place
- for_you
- voice_letter
- future_us
- love
- someday
- surprise
- reunion
- proposal
- relationship_signal

Server-readable typed tables should exist only for operational fields the server must evaluate, such as unlock timestamps.

Private content should remain inside encrypted payloads once E2EE is active.

## Calls

Logical tables:

```text
call_sessions
call_participants
call_events
```

Call history is partnership-scoped and follows partnership deletion rules.

Persist only the metadata required for call state and history.

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

Clients send `expectedVersion`.

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
