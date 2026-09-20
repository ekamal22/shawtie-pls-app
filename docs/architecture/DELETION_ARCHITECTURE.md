# Deletion Architecture

## Purpose

Permanent partnership dissolution and permanent account deletion require deletion across multiple systems.

PostgreSQL, object storage, local browser storage, push routing, cryptographic state, and backups cannot be deleted atomically in one transaction.

Deletion therefore uses a formal durable workflow.

## Security ordering

The first objective is to make deleted data inaccessible.

Preferred order:

1. revoke authorization
2. invalidate partnership or account access
3. invalidate cryptographic access where applicable
4. prevent new writes
5. create durable deletion manifest
6. delete relational private data
7. purge object-storage ciphertext
8. invalidate push and realtime routing
9. notify clients to purge local namespaces
10. track backup-expiration obligations

Physical cleanup may retry after access has already been revoked.

## Deletion manifest

Use durable records such as:

```text
deletion_manifests
deletion_targets
```

Representative manifest fields:

```text
id
scope_type
scope_id
reason
created_at
authorization_revoked_at
crypto_invalidated_at
completed_at
status
```

Representative target fields:

```text
manifest_id
target_type
target_id
status
attempt_count
last_error_code
completed_at
```

Targets may include:

- messages
- relationship data
- media objects
- call history
- push subscriptions
- encrypted key envelopes
- local-purge notification
- backup-expiration record

## Runtime target processing

F2 processes deletion targets as durable worker jobs. Targets use claim ownership, recoverable leases, and a monotonically increasing claim-version fencing token so a worker crash does not strand cleanup indefinitely and a stale worker cannot acknowledge a target after reclaim.

The manifest remains the durable proof of deletion scope, while individual targets are the normal unit of claiming and retry.

After each target completion, the runtime checks whether every target for the manifest is complete. Only then is the manifest marked complete.

A failed or expired target remains resumable. The normal target-claim query may reclaim expired processing rows directly. Long-running target handlers may renew their lease only while claim ownership and claim version still match. Access must remain revoked for the entire retry period.

See `F2_PERSISTENCE_WORKER_DESIGN.md` for the concrete worker and repository design.

## Idempotency

Every deletion target handler must be idempotent.

Deleting an already deleted object is success.

A worker retry must never recreate data.

## Authorization boundary

Once a destructive lifecycle deadline becomes final, authorization must be revoked before asynchronous storage cleanup is considered complete.

A slow object-store deletion must not leave the object reachable through the application.

## Cryptographic deletion

Where the E2EE design supports it, destroy or invalidate partnership decryption material as part of the access-revocation phase.

Cryptographic erasure complements physical deletion.

It does not replace database and storage deletion obligations.

## Backup behavior

Backups may require bounded retention rather than immediate physical mutation.

The system must record:

- deletion time
- affected scope
- backup retention policy
- expected final backup expiry

Deleted content must never be restored into normal application access from a backup.

Disaster recovery procedures must replay deletion state before restoring user-facing availability.

## Local client deletion

Final dissolution or permanent account deletion must cause the client to purge:

- message cache
- relationship cache
- media metadata
- offline queues
- partnership cryptographic state
- partnership push state
- partnership realtime state

A device that was offline at deletion time must purge when it reconnects and learns the authoritative lifecycle state.

## Observability

Deletion observability may record identifiers, states, attempts, timestamps, and error codes.

It must not retain deleted private content.

## Failure behavior

If a deletion target fails:

- access remains revoked
- manifest remains incomplete
- worker retries with backoff
- operational alerting may trigger
- user-facing content must not become accessible again
