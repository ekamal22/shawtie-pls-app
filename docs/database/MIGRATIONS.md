# Database Migrations

## Status

The PostgreSQL migration set is implemented through P3 migration `0010_partnership_lifecycle_runtime.sql`. Migrations 0001 through 0009 remain locally verified from P2 closure. Migration 0010 was observed applying successfully from zero in the 2026-09-21 pre-closure P3 run, but that run then failed in P3 invariant SQL before full database verification; the invariant quoting defect was repaired in `4f832cc`, so a fresh complete P3 run is still required.

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

P3 security verification now pins verified migration 0009 before P3-only migration work is accepted. Fresh execution of the committed P3 security and PostgreSQL suites remains required for closure.

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
