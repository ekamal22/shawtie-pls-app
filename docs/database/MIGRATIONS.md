# Database Migrations

## Status

The initial PostgreSQL migration set is implemented in `packages/db/migrations`.

It is not yet verified against a real PostgreSQL instance.

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

## What remains unverified

Until PostgreSQL is available, the following cannot be claimed as complete:

- migration syntax execution
- clean-database migration from zero
- invariant SQL test pass
- concurrency behavior
- deterministic two-account race behavior
- multi-worker `SKIP LOCKED` behavior
- outbox transaction integration
- deletion-manifest retry integration
- query-plan and index validation

## First PostgreSQL verification

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

These artifacts define how the first real PostgreSQL verification should be performed once a database is available.
