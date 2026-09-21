# Database Package

## Status

The PostgreSQL schema is locally verified through A1 migration 0007. The F2 database runtime remains verified, and the A1 account/auth repositories plus migration 0007 are implemented and validated by the completed 27/27 disposable PostgreSQL A1 suite.

Earlier database validation established migration rerun idempotency, checksum-drift rejection, invariant coverage, critical catalog objects, occupied-slot contention safety, scheduled-action claim contention safety, and deterministic account-lock ordering. The completed F2 run applies all six migrations from a blank disposable PostgreSQL 16 database and passes 17/17 PostgreSQL integration tests.

The F2 runtime in this package and `apps/worker` includes claim-version fencing, controlled lease renewal, `READ COMMITTED` transaction policy, bounded whole-transaction retry, defensive timeout policy, PostgreSQL clock semantics, durable payload versions, direct expired-claim reclaim, lifecycle-event persistence, outbox repositories, deletion recovery, and queue query-plan verification.

## Migration order

Migrations are immutable after they have been applied outside disposable development databases.

Current implemented migrations:

1. `0001_identity.sql`
2. `0002_partnership_lifecycle.sql`
3. `0003_durable_operations.sql`
4. `0004_content_metadata.sql`
5. `0005_relational_integrity.sql`
6. `0006_durable_runtime_reliability.sql`
7. `0007_accounts_devices_runtime.sql`

Migration 0006 implements recoverable durable-work leases, direct expired-claim reclaim, claim-version fencing, retry availability, and scheduled-action/outbox payload versions. It is locally verified from a blank database as part of the passing F2 suite.

Migration 0007 implements the A1 account/auth runtime schema. It is verified: `npm run test:a1:local` applies all seven migrations from zero, database invariants pass, and the expanded A1 integration/acceptance matrix passes 27/27.

## Commands

Static migration-plan check:

```text
npm run db:migrations:check
```

Apply migrations to `DATABASE_URL` using the repository's pinned Node PostgreSQL driver:

```text
npm run db:migrate
```

Run invariant tests against a disposable test database:

```text
DB_TEST_CONFIRM=1 npm run db:test:invariants
```

On PowerShell with an existing disposable PostgreSQL database:

```powershell
$env:DATABASE_URL = "postgresql://..."
$env:DB_TEST_CONFIRM = "1"
npm run db:migrate
npm run db:test:invariants
```

For the complete F2 PostgreSQL verification path, Docker Desktop can provide the disposable database automatically:

```text
npm run test:f2:local
```

The local F2 command starts an ephemeral PostgreSQL 16 container, injects the disposable connection string, runs the full F2 PostgreSQL suite, and removes the container afterward. A separately installed `psql` executable is not required.

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

Local F2 database verification is complete.

The static migration plan is part of the local health command and baseline CI configuration. The disposable Docker path applies all six migrations, runs invariants, and executes the complete F2 PostgreSQL integration matrix. The latest F2 run passes 17/17, and the final full repository health regression is green.

Hosted GitHub Actions and hosted PostgreSQL reproduction remain separate under V1. They are required before R2 Public Readiness, not for reopening F2.
