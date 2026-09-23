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

P3 makes this concrete for partnership destruction: one canonical dissolution transaction sets the partnership to `terminated`, releases both occupied membership rows, advances lifecycle generation, creates the partnership deletion manifest, and only then commits. Deletion-target workers run after that authorization boundary is already closed. Partnership metadata `version` is not incremented by this lifecycle-only transition.

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

## A1 account deletion boundary

A1 owns the account-level start and recovery mechanics:

- immediate account status lockout
- immediate session revocation
- account deletion request record
- exact seven-day recovery deadline
- recovery email challenge
- generation-guarded account-deletion finalizer
- device and authentication cleanup

For a partnered account, A1 must not enable deletion until the account-deletion-specific partnership path is correct end to end.

That A1 boundary is now verified complete: the account-deletion-specific partnership path, breakup/deletion precedence handling, recovery behavior, and durable worker flow are covered by the completed A1 acceptance evidence.

That path uses the accepted P3 domain rules for:

- active-partnership deletion overlay
- remaining-partner view-only behavior
- recovery to the exact prior partnership state when still valid
- breakup/deletion deadline precedence
- permanent dissolution when the account-deletion deadline controls
- one-calendar-month cooldown for the remaining partner
- shared partnership deletion manifest creation and serious-event notices

At A1 closure, this account-deletion-specific implementation advanced only the P3 deletion subset and did not by itself complete P3. P3 is now independently DONE at all 22 acceptance gates with the canonical dissolution, breakup, restoration, cooldown, blocking, notification, deletion-manifest, worker, race, and security paths locally verified.

The hardened P3 design consolidates partnership destruction behind one canonical dissolution kernel shared by the normal breakup worker and A1 permanent account-deletion finalization. The P3 kernel creates a partnership-scoped deletion manifest in addition to A1's account-scoped authentication cleanup manifest. Legacy A1 breakup-precedence work remains compatible but must delegate to the same kernel so two termination implementations cannot drift.

Account recovery restores authentication state only. It does not recreate a partnership already dissolved by an earlier breakup deadline, and it does not recreate cryptographic trust or historical E2EE keys.

## M1 messaging cleanup boundary

M1 does not create a second dissolution mechanism.

The verified P3 dissolution kernel remains responsible for synchronous authorization revocation and partnership deletion-manifest creation. M1 supplies module-owned relational cleanup that the existing partnership relational deletion path composes.

Messaging cleanup must be idempotent and remove, as applicable:

- primary conversation rows
- current message content and tombstones
- message reactions
- compatibility receipt rows
- conversation-member delivered/read state
- typing state
- partnership chat nicknames
- durable conversation-change rows

Permanent account deletion additionally removes the account-scoped current presence snapshot through the account cleanup path.

No M1 cleanup handler may take ownership of unrelated relationship-space tables.

Deletion evidence must prove that no plaintext message body, historical body, reaction content, nickname content, or durable messaging change row survives final partnership cleanup, while authorization remains revoked throughout retries.

## R1 relationship-space deletion integration

R1 does not create a second partnership deletion workflow.

R1 child state remains under `relationship_items` with same-partnership foreign keys. The P3 `partnership_relational_content` target remains the destructive relational cleanup authority.

Before deleting an individual R1 target item, incoming curation/prepared-content links owned by surviving items are removed explicitly and each surviving owner version is incremented once. Target-side foreign keys do not silently cascade a surviving curation mutation behind its optimistic version.

Pending relationship-item release actions are cancelled before relational item cleanup. Already-processing workers re-check lifecycle and destructive deadlines and cannot reveal content after eligibility ends.

User item deletion hard-deletes preview, main content, child state, references, story membership, and item events rather than retaining a content-bearing tombstone.

If R1 introduces storage outside the relationship-item relational tree, the deletion manifest and retry-safe handlers must be extended before R1 can close.

## M3 media deletion integration

M3 does not create a second partnership deletion workflow.

After M3, the P3 dissolution manifest includes a module-owned `partnership_media_objects` target in addition to relational and crypto-state targets. The current relational cleanup must not delete `media_objects` metadata before object cleanup has enough information to locate and delete ciphertext.

Security ordering is:

1. P3 terminates partnership and revokes authorization synchronously
2. no new media access/upload/bind grant is issued
3. `partnership_media_objects` durable cleanup deletes private object-store ciphertext idempotently
4. media metadata is removed after its object is deleted or already absent

Missing object on retry is success. A worker crash after object deletion but before row deletion must replay safely. Storage-provider outage leaves the manifest incomplete while access remains revoked.

Individual message/R1 media deletion may use generation-fenced `m3.media_delete` scheduled work. Abandoned upload cleanup uses `m3.media_upload_expire`. These do not replace the partnership deletion manifest.

Final dissolution, logout, account switch, and device/session revocation also purge M3 local encrypted-draft namespaces when the client observes the authoritative state.

See `M3_MEDIA_VOICE_DESIGN.md` for the full binding and cleanup model.
## Failure behavior

If a deletion target fails:

- access remains revoked
- manifest remains incomplete
- worker retries with backoff
- operational alerting may trigger
- user-facing content must not become accessible again
