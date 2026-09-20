# Database Package

## Status

The PostgreSQL schema and migration foundation is implemented in this package.

The migrations have not yet been executed against a real PostgreSQL instance in this repository workflow.

Do not describe the persistence foundation as verified until the migrations and invariant tests pass against PostgreSQL.

## Migration order

Migrations are immutable after they have been applied outside disposable development databases.

Current migrations:

1. `0001_identity.sql`
2. `0002_partnership_lifecycle.sql`
3. `0003_durable_operations.sql`
4. `0004_content_metadata.sql`

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
