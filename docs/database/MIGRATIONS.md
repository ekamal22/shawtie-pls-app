# Database Migrations

## Status

The initial PostgreSQL migration set is implemented in `packages/db/migrations` and has passed local disposable-database validation against PostgreSQL 16.15.

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

On 2026-09-20, a disposable PostgreSQL 16.15 Docker container was used to verify:

- all five migrations apply from an empty database
- a second blank container reproduces the migration and invariant results
- a second migration run skips all five checksum-matched migrations
- `_schema_migrations` contains five distinct filenames and valid SHA-256 checksum shapes
- checksum drift is rejected with a nonzero exit
- the invariant SQL suite passes
- critical indexes, checks, foreign keys, and triggers exist in the PostgreSQL catalogs
- concurrent partnership inserts cannot occupy the same account twice
- two sessions using the committed scheduled-action claim SQL do not claim the same row
- opposite caller orders using the committed account-lock SQL acquire accounts in immutable UUID order without deadlock

## Planned F2 forward migration

The F2 runtime design identifies a crash-recovery gap in durable work that has already been marked `processing`.

A future forward migration, expected to be `0006_durable_runtime_reliability.sql`, is planned to add the durable runtime fields required by the refined F2 design. This migration does not exist yet and must not be treated as applied or verified until implementation.

Planned changes include:

- scheduled actions: retry `available_at`, `lease_expires_at`, monotonically increasing `claim_version`, and `payload_version`
- outbox events: `lease_expires_at`, `max_attempts`, monotonically increasing `claim_version`, and `payload_version`
- deletion targets: `available_at`, `claimed_at`, `claimed_by`, `lease_expires_at`, and monotonically increasing `claim_version`
- indexes that support both due pending work and direct reclaim of expired processing work

`execute_at` remains the original scheduled-action business deadline and is not repurposed for retry timing.

The exact planned behavior is documented in `../architecture/F2_PERSISTENCE_WORKER_DESIGN.md`.

## What remains unverified

The following cannot yet be claimed as complete:

- planned durable-work reliability migration with fencing tokens and payload versions
- direct expired-claim reclaim behavior
- lease renewal ownership rules
- automated race coverage committed to the repository
- database runtime pool and transaction integration
- integrated worker-instance behavior beyond the database claim SQL
- lease expiry and crash recovery
- outbox transaction and delivery integration
- lifecycle-event runtime persistence
- deletion-manifest retry and resume integration
- transaction isolation, retry, and timeout runtime policy
- queue query-plan and index validation against realistically sized synthetic data
- PostgreSQL hosted verification, tracked separately under V1

## PostgreSQL verification command

Use a disposable PostgreSQL database.

Set `DATABASE_URL`, then run:

```text
npm run db:migrations:check
npm run db:migrate
npm run db:test:invariants
```

The invariant test command requires `DB_TEST_CONFIRM=1`.

Do not run the invariant test command against production.


## Committed verification artifacts

The repository now includes:

- `scripts/db/check-migrations.mjs`
- `scripts/db/migrate.mjs`
- `scripts/db/test-invariants.mjs`
- `packages/db/tests/invariants.sql`
- `packages/db/sql/lock-accounts.sql`
- `packages/db/sql/claim-scheduled-actions.sql`

These artifacts define the repeatable PostgreSQL verification path. The concurrency exercises should be promoted into committed automation before they are treated as a durable regression gate.
