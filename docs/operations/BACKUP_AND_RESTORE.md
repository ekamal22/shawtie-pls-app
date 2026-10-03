# Backup, Restore, and Erasure Replay

## Goal

A database snapshot must never be allowed to restore private user-facing access that was deleted after the snapshot was taken.

## Backup set

A production backup set contains:

1. PostgreSQL custom-format backup created by `scripts/operations/postgres-backup.mjs`
2. the latest separately retained erasure journal exported with `scripts/operations/export-erasure-journal.mjs`
3. the journal SHA-256 sidecar
4. object-storage backup according to the provider's encrypted retention policy

The erasure journal contains only opaque account/partnership UUIDs, deletion timestamps, and bounded reasons. It must be replicated separately from ordinary database backups so a restore of an older snapshot can still learn about later deletions.

## Backup commands

```text
node scripts/operations/postgres-backup.mjs /secure/backups/shawtie.dump
node scripts/operations/export-erasure-journal.mjs /secure/journal/erasure.json
```

Do not place backups or erasure journals in the public repository.

## Restore fence

A restore must occur in an isolated environment that cannot receive public traffic.

Required order:

1. set the isolated restore database as `DATABASE_URL`
2. set `R2_RESTORE_CONFIRM=RESTORE`
3. set `R2_RESTORE_ISOLATED=1`
4. set `R2_RESTORE_TARGET_DATABASE` to the exact isolated database name in `DATABASE_URL`
5. restore the PostgreSQL snapshot
6. run current forward migrations
7. replay the latest erasure journal
8. start the current worker with access to the restored private object store
9. wait until replay-created deletion manifests complete
10. run `scripts/operations/verify-erasure-restore.mjs`
11. run the normal health and operational checks
12. only then may the restored database become eligible for production traffic

The repository helper performs steps 4 through 6:

```text
node scripts/operations/postgres-restore.mjs backup.dump erasure.json
```

The helper intentionally stops before declaring the restored system safe.

## Deletion proof

`verify-erasure-restore.mjs` fails if an erased account has active authentication/profile state or if an erased partnership is not terminated, has unreleased members, or has an incomplete deletion manifest.

Stable Release requires an executed restore drill using synthetic accounts and partnerships. Repository tooling alone is not evidence that a provider backup actually works.
