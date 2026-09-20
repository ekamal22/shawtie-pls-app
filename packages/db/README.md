# Database Package

## Status

The PostgreSQL schema and migration foundation is implemented in this package and has passed local disposable-database validation against PostgreSQL 16.15.

All five migrations have been applied from a blank database twice. Migration rerun idempotency, checksum-drift rejection, the invariant suite, critical catalog objects, occupied-slot concurrency, scheduled-action claim concurrency, and deterministic account-lock ordering have been validated locally.

The F2 runtime architecture and implementation sequence are designed and refined in `docs/architecture/F2_PERSISTENCE_WORKER_DESIGN.md`. The approved design includes claim-version fencing, controlled lease renewal, `READ COMMITTED` transaction policy, bounded whole-transaction retry, defensive timeout policy, PostgreSQL clock semantics, durable payload versions, direct expired-claim reclaim, and queue query-plan gates. The database runtime and all of those refinements remain pending implementation.

## Migration order

Migrations are immutable after they have been applied outside disposable development databases.

Current implemented migrations:

1. `0001_identity.sql`
2. `0002_partnership_lifecycle.sql`
3. `0003_durable_operations.sql`
4. `0004_content_metadata.sql`
5. `0005_relational_integrity.sql`

F2 plans a future forward migration, expected to be `0006_durable_runtime_reliability.sql`, for recoverable durable-work leases, direct expired-claim reclaim, claim-version fencing, retry availability, and scheduled-action/outbox payload versions. It is design-only and does not exist yet.

## Commands

Static migration-plan check:

```text
npm run db:migrations:check
```

Apply migrations to `DATABASE_URL` using the local `psql` executable:

```text
npm run db:migrate
```

Run invariant tests against a disposable test database:

```text
DB_TEST_CONFIRM=1 npm run db:test:invariants
```

On PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://..."
$env:DB_TEST_CONFIRM = "1"
npm run db:migrate
npm run db:test:invariants
```

## Safety

Do not point invariant tests at production.

The invariant test file runs inside a transaction and rolls back its test rows, but production execution is still prohibited.

## ID policy

Application code supplies UUID identifiers.

The initial migrations intentionally avoid requiring a PostgreSQL UUID extension.

UUIDv7 remains preferred for application-generated identifiers when the implementation library is selected.

## Canonical database helpers

`sql/lock-accounts.sql` defines deterministic account-row lock ordering.

`sql/claim-scheduled-actions.sql` defines the worker claim pattern using `FOR UPDATE SKIP LOCKED`.

Application repositories should reuse these semantics rather than inventing alternate locking behavior.


## Current verification boundary

The migration files, migration runner, static migration-plan checker, deterministic lock query, scheduled-action claim query, and invariant test suite are committed.

The static migration plan is part of the local health command and baseline CI configuration.

Real PostgreSQL execution has passed locally against disposable PostgreSQL 16.15. The remaining F2 verification boundary is runtime integration for the database kernel, transaction retry and timeout policy, durable leases and fencing, worker payload compatibility, direct expired-claim reclaim, outbox, lifecycle events, deletion, automated concurrency regressions, and queue query-plan coverage. Hosted PostgreSQL verification is tracked separately under V1.
