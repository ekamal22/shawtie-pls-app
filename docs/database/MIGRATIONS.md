# Database Migrations

## Status

The verified merged mainline is implemented through migration 0018. On `feat/s1-e2ee-crypto-recovery`, S1 source implementation adds real forward-only migrations `0019_s1_device_crypto_runtime.sql`, `0020_s1_partnership_crypto_runtime.sql`, and `0021_s1_protected_content_runtime.sql`. Those migrations are committed and covered by the S1 closure harness, but the canonical disposable PostgreSQL S1 closure has not yet been executed and recorded, so migrations 0019 through 0021 are not yet described as verified/merged mainline state.

The existing verified M1/R1 baseline remains migrations 0001 through 0014 with `reserved=0`; M3/C1 later extend the merged chain through 0018 without reservations. S1 must consume 0001 through 0018 unchanged.

## Current and next migration

A1 migration `0007_accounts_devices_runtime.sql` is committed and verified.

Its implemented scope includes:

- registration intents
- password credentials
- account-email display form
- email challenge subject and key-version hardening
- active-challenge uniqueness
- session token-generation fencing
- device-handle verifiers
- PostgreSQL security-rate-limit buckets
- durable security-email deliveries
- append-only security-event hardening

P1 migration `0008_partner_discovery_requests_runtime.sql` is committed and locally verified. It adds request terminal-shape hardening, persisted expired timestamps, pair-limit and decline-cooldown indexes, append-only request-attempt evidence, and the manually entered `relationship_start_date` used by P2 formation. Its legacy-compatible checks protect new/updated rows without fabricating old request history.

P2 migration `0009_partnership_formation_runtime.sql` is committed and locally verified. It adds accepted-request partnership linkage with restrictive foreign-key semantics, legacy-safe `NOT VALID` linkage constraints, minimal durable account notifications, and formation/query indexes. It consumes migration 0008 unchanged as verified P1 substrate. The existing fresh partnership ID remains the namespace root; migration 0009 adds no redundant security-context identifier or cryptographic key material.

Migration 0008 remains verified by the clean nine-migration P2 run and passing database invariants. P2 security coverage pins SHA-256 `94e2d22ceff3b73fc990fc07810cabedea097d7440a571c54c00ec185bebd18e` so later work cannot silently rewrite it. Migration 0009 participates in the same clean run, including catalog checks that its legacy-safe accepted-linkage constraints remain `NOT VALID`.

P3 forward-only migration `0010_partnership_lifecycle_runtime.sql` is committed. Its implemented scope is:

- add `cancelled_at` and `superseded_at` breakup terminal markers
- rebuild the one-open-breakup index around all terminal markers
- add legacy-safe breakup terminal-shape and exact-timing hardening
- harden reason-specific three-month and one-month cooldown durations
- require a source partnership for new former-partner block rows
- add released-membership history lookup support
- add pending scheduled-action aggregate lookup support
- ensure one destructive partnership deletion manifest per partnership
- preserve migrations 0001 through 0009 byte-for-byte

P3 security verification pins verified migration 0009 before P3-only migration work is accepted. The clean ten-migration P3 run and catalog invariants are green; migration 0010 has SHA-256 `f976bee5747938b1f0b9759bf601419d1296648b7d92421bdd45ee12ea445b1d`.

## Parallel feature migration reservations

The verified physical schema on `main` is implemented through migration 0018.

Completed ownership:

- M1: `0011_messaging_core_runtime.sql`, `0012_messaging_interaction_runtime.sql`
- R1: `0013_relationship_space_runtime.sql`, `0014_relationship_space_interaction_runtime.sql`
- M3: `0015_media_runtime.sql`, `0016_media_integration_runtime.sql`
- C1: `0017_calling_runtime.sql`, `0018_push_runtime.sql`
- C2: no migration

S1 owns and has implemented the next forward-only range on `feat/s1-e2ee-crypto-recovery`:

- `0019_s1_device_crypto_runtime.sql`
- `0020_s1_partnership_crypto_runtime.sql`
- `0021_s1_protected_content_runtime.sql`

Implemented responsibilities:

### 0019

- recovery public roots
- device crypto identities
- trusted-device approval evidence
- MLS KeyPackage inventory
- encrypted recovery bundle metadata

It must contain no plaintext private device key and no Recovery Master Secret.

### 0020

- partnership crypto groups
- group generation
- current MLS epoch
- crypto membership
- ordered crypto-control messages
- rekey-required state
- uniqueness preventing two authoritative groups for one partnership generation

### 0021

- M1 encrypted protected fields
- encrypted reaction and nickname representation
- R1 preview/main encrypted envelopes
- M3 production protected key-envelope integration
- content-key references and per-account encrypted recovery capsules
- pre-S1 plaintext retirement constraints

S1 must consume migrations 0001 through 0018 unchanged. Any need for additional S1 migration numbers must be documented before another milestone claims them.

## Policy

Production migrations are forward-first.

Once a migration has been applied to a non-disposable environment:

- do not edit its contents
- do not reorder it
- do not reuse its numeric prefix
- repair mistakes with a new migration
- prefer additive and backward-compatible transitions
- separate destructive cleanup from compatibility rollout where practical

A source rollback must not assume the database can be rolled backward safely.

When a deployment must be reversed, prefer restoring application compatibility with the already-migrated schema and follow with a corrective forward migration.

## Migration ledger

The migration runner creates:

```text
_schema_migrations
```

Each applied migration records:

- filename
- SHA-256 checksum
- applied timestamp

If a previously applied migration file changes, the runner fails rather than silently accepting drift.

## Initial schema

The initial migration set covers:

- accounts and public profile metadata
- verified email ownership
- email verification state
- devices and sessions
- encrypted recovery material
- account deletion requests
- username change history
- partner requests and request-attempt history
- partnerships and occupied member slots
- breakup processes and restore intents
- partner cooldown eligibility
- former-partner blocking
- partnership crypto epochs
- idempotency records
- lifecycle events
- scheduled actions
- transactional outbox
- deletion manifests and targets
- security events
- conversation and message metadata
- relationship-space encrypted item metadata
- encrypted media metadata
- call metadata
- relational hardening for device ownership, breakup intents, message replies, reactions, receipts, and call membership

## Important database invariants

The schema defines database-level protection for:

- one current username
- one current verified email per account
- one current verified owner of an email
- one pending account deletion request
- no self partner request
- one pending request per direction
- one occupied partnership slot per account
- exact breakup base timing
- breakup final deadline restricted to day 7 or day 10
- one open breakup process per partnership
- one restore intent per member per breakup
- one open partner cooldown per account
- one active block per direction
- idempotency key uniqueness
- scheduled-action deduplication
- outbox deduplication
- append-only lifecycle event rows while retained
- conversation server-sequence uniqueness
- message idempotency uniqueness
- no more than two members in a partnership
- device ownership consistency for sessions, recovery material, and message senders
- reply messages constrained to the same conversation
- call and receipt actors constrained to the partnership

## Local verification record

The database foundation has repeatable local PostgreSQL 16 evidence.

Earlier verification established:

- clean migration from zero for migrations 0001 through 0005
- migration rerun idempotency and checksum-drift rejection
- invariant SQL success
- critical index, check, foreign-key, and trigger creation
- occupied partnership-slot contention safety
- scheduled-action `SKIP LOCKED` contention safety
- deterministic account-lock ordering

F2 completion then verified:

- all six migrations apply from an empty disposable PostgreSQL 16 container
- `0006_durable_runtime_reliability.sql` applies successfully
- database invariants pass after the six-migration run
- the complete F2 PostgreSQL integration suite passes 17/17
- direct expired-claim reclaim works for scheduled actions, outbox work, and deletion targets
- fencing rejects stale ownership and stale acknowledgement
- current owners can renew approved leases
- `READ COMMITTED`, whole-transaction retry, PostgreSQL business time, and advancing lease time behave as designed
- outbox state changes are atomic with authoritative mutations and duplicate delivery is safe
- lifecycle metadata is append-only and rejects content-shaped fields
- deletion manifests resume after retryable and repairable permanent failure while access remains revoked
- intended scheduled-work queue indexes are used on realistically sized synthetic data
- bounded worker shutdown behavior passes
- the final full repository health regression remains green

## F2 durable-runtime migration

`0006_durable_runtime_reliability.sql` closes the crash-recovery gap for durable work already marked `processing`.

Verified changes include:

- scheduled actions: retry `available_at`, `lease_expires_at`, monotonically increasing `claim_version`, and `payload_version`
- outbox events: `lease_expires_at`, `max_attempts`, monotonically increasing `claim_version`, and `payload_version`
- deletion targets: `available_at`, `claimed_at`, `claimed_by`, `lease_expires_at`, and monotonically increasing `claim_version`
- indexes that support both due pending work and direct reclaim of expired processing work

`execute_at` remains the original scheduled-action business deadline and is not repurposed for retry timing.

Local F2 verification is complete. Hosted PostgreSQL reproduction remains separate under V1 and does not change the local F2 DONE status.

## PostgreSQL verification commands

The migration runner and invariant runner use the repository's pinned Node PostgreSQL driver and do not require a separately installed `psql` executable.

With an existing disposable PostgreSQL database, set `DATABASE_URL` and `DB_TEST_CONFIRM=1`, then run:

```text
npm run db:migrations:check
npm run db:migrate
npm run db:test:invariants
npm run test:f2:postgres
```

For local development with Docker Desktop, the preferred complete F2 path is:

```text
npm run test:f2:local
```

That command starts an ephemeral PostgreSQL 16 container, waits for readiness, supplies the disposable connection string, runs the full F2 PostgreSQL suite, and removes the container afterward.

Do not run invariant or F2 integration tests against production.


## Committed verification artifacts

The repository now includes:

- `scripts/db/check-migrations.mjs`
- `scripts/db/migrate.mjs`
- `scripts/db/test-invariants.mjs`
- `packages/db/tests/invariants.sql`
- `packages/db/sql/lock-accounts.sql`
- `packages/db/sql/claim-scheduled-actions.sql`

These artifacts define the repeatable PostgreSQL verification path. Automated runtime and concurrency tests under `packages/testkit/tests` and `apps/worker/tests` pass locally through `npm run test:f2:local`.

## M2 migration position

M2 Realtime and Offline Reliability is expected to require no PostgreSQL migration.

M2 reuses:

- existing server sessions
- M1 `conversation_changes`
- M1 content-free outbox events
- the F2 durable outbox worker
- P3 lifecycle state and cleanup boundaries
- R1 persistence and versioning
- PostgreSQL LISTEN/NOTIFY as a transient low-latency fanout hint

Migration `0015` is not reserved merely because M2 is the next milestone.

If implementation evidence proves that new durable server schema is required, the M2 architecture document and migration ownership section must be amended before a migration is added. Any new migration remains forward-only and must preserve the verified 0001 through 0014 checksums and invariants.

IndexedDB local schema versions are client schema and are not PostgreSQL migration numbers.

## M3 migration ownership

M3 Media and Voice Messages owns the next two forward-only PostgreSQL migrations:

- `0015_media_runtime.sql`
- `0016_media_integration_runtime.sql`

`0015_media_runtime.sql` is implemented and refines the existing `media_objects` aggregate with media kind/format, upload state, uploader device, ciphertext digest, upload generation/expiry, ready time, one-time binding fields, and deletion generation.

`0016_media_integration_runtime.sql` is implemented and owns M1/R1 integration hardening: media-only message support where required, container attachment indexes, immutable binding invariants, and media cleanup lookup paths.

M3 must not modify M1-owned 0011/0012 or R1-owned 0013/0014. The committed M3 closure harness applies real migrations 0001 through 0016 from zero with `reserved=0` and all database invariants green; the closure passed at `305891f` and again after the physical fixes (`MIGRATION_PLAN_PASS count=16 reserved=0` and `DATABASE_INVARIANTS_PASS`). The physical Android run required no migration change.

## C1 migration ownership after M3 integration

M3 owns real migrations 0015 and 0016, now merged to main.

C1 Voice Calling owns:

- `0017_calling_runtime.sql`
- `0018_push_runtime.sql`

The earlier isolated C1 closure used `SHAWTIE_MIGRATION_RESERVATIONS=0015,0016` without placeholder files or copied M3 SQL. After reconciliation, final C1 validation used the real contiguous migration chain with no reservations.

Isolated C1 automated/local closure passed at `439b09f` with only M3-owned 0015/0016 reserved. M3 then merged its real 0015/0016 migrations and C1 reconciled onto that mainline. The first real-migration C1 closure passed at `9b5c255`, applying migrations 0001 through 0018 with `reserved=0` and green invariants. A later stale media-owner code fix did not change schema; the full integrated closure re-passed at `b29aaa1` against the same canonical 0001 through 0018 chain with `reserved=0`. Physical acceptance used the same migration chain.

`0017` is implemented and refines existing call tables for versioned state, endpoint selection, trusted deadlines, history, call uniqueness, endpoint-session binding, and legacy-call terminalization.

`0018` is implemented and adds device-bound Web Push subscription persistence, keyed endpoint fingerprints with key versioning, active endpoint/fingerprint uniqueness, and call push-routing indexes.

## C2 migration position

C2 Video Calling required no PostgreSQL migration and reserves none. The canonical automated/local closure first passed at executable SHA `94e0e9329e083cb3d9bcf4e3b13ad60d4af2e978` and re-passed at final executable SHA `ecbb2e1877fbc8ee7bbeac0c15674a66683e8143` with physical acceptance complete, applying real migrations 0001 through 0018 from zero with `reserved=0` and `DATABASE_INVARIANTS_PASS`. The existing schema already permits `call_type IN ('voice','video')`, while C2 camera/media state remains transient client state. C2 owns no later migration. S1 has now materialized its owned forward-only range `0019` through `0021` on the feature branch; C2 must not modify or consume that range.

## S1 migration implementation and closure

S1 migration source is committed at the implementation/harness baseline `0e28675`.

- `0019_s1_device_crypto_runtime.sql` implements crypto-device identities, trusted-device approvals, KeyPackage state, encrypted recovery bundle metadata, recovery challenges, and A1-linked crypto revocation.
- `0020_s1_partnership_crypto_runtime.sql` implements partnership MLS groups, group generations, epochs, active device membership, ordered control messages, and rekey-required propagation.
- `0021_s1_protected_content_runtime.sql` implements protected-content key metadata, per-account recovery capsules, M1/R1/M3 protected key references, and database triggers that reject protected plaintext after `crypto_required_from`.

The database invariant suite now includes S1 catalog checks plus negative writes proving crypto-required plaintext message, reaction, nickname, relationship-item, and legacy media writes fail at the database layer.

The executable S1 database path is:

```text
npm run test:s1:postgres
npm run s1:plaintext:assert-clean
npm run test:s1:local
npm run test:s1:closure
```

`test:s1:local` creates disposable PostgreSQL, builds the OpenMLS WASM artifact, runs migrations/invariants and the S1 API integration suite, asserts the plaintext inventory is clean, runs real Chromium S1 E2E, builds the production web bundle, and runs the production crypto scan. These commands are committed but their PASS markers are not yet recorded as closure evidence.

## M1 and R1 migration ownership

The parallel M1 and R1 milestone branches used non-overlapping forward-only migration ranges, now materialized together in the validated integration baseline.

M1 owns:

- `0011_messaging_core_runtime.sql`
- `0012_messaging_interaction_runtime.sql`

R1 owns:

- `0013_relationship_space_runtime.sql`
- `0014_relationship_space_interaction_runtime.sql`

The integrated migration chain is contiguous and uses no reservation.

Repository health enforces one contiguous migration sequence. The combined branch contains real 0011, 0012, 0013, and 0014 in ancestry, so `scripts/db/check-migrations.mjs` passes with `count=14 reserved=0`. M1 and R1 retain their documented migration ownership.

M1 migration 0011 implements the existing conversation/message substrate without rewriting migrations 0001 through 0010. Its responsibilities include:

- primary-conversation backfill and future formation provisioning
- exact breakup `message_freeze_sequence` capture
- separate `next_server_sequence` message ordering and `next_change_sequence` mutation synchronization
- append-only, content-free `conversation_changes`
- explicit pre-S1 current message/reaction plaintext fields without plaintext edit history
- message `content_version` and `last_change_sequence`
- versioned keyed private-request fingerprints
- active-reaction uniqueness and content-removal constraints
- indexes and constraints required for bounded server-sequence history and change-sequence synchronization

M1 migration 0012 implements compact interaction state:

- conversation-member delivered/read high-water marks
- partnership chat nicknames with optimistic versioning
- current account presence snapshots
- short-lived conversation typing state
- constraints supporting partnership-scoped presence disclosure and bounded interaction state

M1 does not add durable per-heartbeat history.

Both M1 migrations are locally verified. On 2026-09-22 the M1 closure harness applied migrations 0001 through 0012 and passed 64/64. The later exhaustive integration baseline `5db7a94` applied the canonical 0001 through 0014 chain with no reservations and database invariants green; M1 again passed 64/64 and R1 passed 69/69. The M1 runtime closure anchor remains `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`.

The M1 migration/integration tests must additionally prove:

- committed message creation allocates one server sequence and one change sequence
- edit/delete/reaction mutations allocate change sequences without changing immutable message order
- failed/rolled-back mutations do not consume committed cursor values
- old-message mutations are discoverable through the change ledger
- no change row contains message, reaction, nickname, or reply content
- no M1 migration writes plaintext message edit history
- messaging cleanup remains module-owned and compatible with the existing P3 dissolution kernel
