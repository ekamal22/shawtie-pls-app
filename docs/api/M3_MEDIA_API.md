# M3 Media API and Storage Contract

## Status

**Design complete. Implementation not started.**

Branch: `feat/m3-media-voice`
Required base: `main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`
Canonical architecture: `docs/architecture/M3_MEDIA_VOICE_DESIGN.md`

This contract defines the M3 HTTP boundary, upload lifecycle, authorization rules, M1/R1 binding semantics, and object-storage interaction. PostgreSQL remains authoritative. Object storage is never an authorization source.

## Security boundary

Protected media plaintext must not reach the API or object-storage provider. The browser prepares and encrypts media before upload. S1, not M3, owns the reviewed production media-key distribution protocol.

Signed URLs are short-lived bearer capabilities. They must never be stored in PostgreSQL projections, M1/R1 content, logs, analytics, outbox payloads, or service-worker caches.

## Initial policy

| Kind | Limit |
| --- | ---: |
| image | 10 MB source |
| video | 50 MB and 120 seconds |
| file | 25 MB |
| voice | 15 MB and 600 seconds |

Maximum attachments per message: 10. Client checks are advisory; server policy is authoritative.

## Media states

`uploading -> ready_unbound -> bound -> deletion_pending` with `failed` for terminal upload failure states. A media object binds exactly once to one `message` or `relationship_item` with role `attachment`, `voice_message`, or `voice_letter`.

## Response rules

Authenticated private media responses use `Cache-Control: no-store`. Guessed foreign IDs and unauthorized cross-partnership IDs should converge on privacy-safe not-found behavior.

Representative errors:

```text
NO_CURRENT_PARTNERSHIP
ACCOUNT_LOCKED
PARTNERSHIP_TERMINATED
MEDIA_NOT_FOUND
MEDIA_NOT_READY
MEDIA_ALREADY_BOUND
MEDIA_UPLOAD_EXPIRED
MEDIA_POLICY_VIOLATION
MEDIA_SIZE_MISMATCH
MEDIA_CHECKSUM_MISMATCH
MEDIA_FORMAT_UNSUPPORTED
MEDIA_BINDING_INVALID
IDEMPOTENCY_KEY_REUSED
```

## GET /api/v1/media/policy

Returns server-controlled compatibility and media limits. Exact signed-grant TTL values are configuration, not product invariants.

## POST /api/v1/media/uploads

Requires `Idempotency-Key`.

Representative request:

```json
{
  "kind": "image",
  "formatCode": "image/jpeg",
  "ciphertextBytes": 1827361,
  "ciphertextSha256": "digest",
  "cryptoProtocolVersion": "version"
}
```

The API authenticates session/device, loads current partnership, evaluates `send_media`, validates policy/rate limits, allocates `mediaId` and opaque object key, inserts `uploading`, schedules expiry, and returns a short-lived signed upload grant.

Signed upload URL and required signing headers must never enter routine logs.

## POST /api/v1/media/:mediaId/refresh-upload

Refreshes only the current uploader's still-authorized `uploading` object. It cannot change media identity, partnership, object key, or revive bound/deleting media. Refresh is generation-fenced.

## POST /api/v1/media/:mediaId/complete

Completion is replay-safe. The API verifies current upload generation and asks `MediaObjectStore.verifyObject()` to prove object existence, expected ciphertext size, and checksum where supported. Success transitions `uploading -> ready_unbound`.

A forged complete request cannot make a missing object usable.

## DELETE /api/v1/media/:mediaId

Direct delete is allowed only for uploader-owned unbound media. It revokes access, moves to `deletion_pending`, and schedules cleanup. Bound media is deleted through its authoritative M1/R1 container.

## GET /api/v1/media/:mediaId

Returns safe metadata only. It never returns durable storage URLs or key material.

## GET /api/v1/media/:mediaId/access

Re-evaluates current authority and returns a very short-lived signed GET grant only after authorization.

Unbound media is uploader-only.

Message-bound media requires current partnership membership, same partnership, M1 conversation visibility, a non-deleted owning message, and lifecycle permission to view shared data.

R1-bound media requires same partnership and the containing item's authoritative visibility, including release/open/reveal/account-deletion rules. A Voice Letter cannot be fetched independently of its R1 container.

## M1 send extension

M3 extends the existing M1 send contract with an `attachments` array. Valid shapes are text-only, text plus attachments, attachments-only, and voice-only.

Voice message requirements:

```text
body = null
one media only
kind = voice
role = voice_message
position = 0
```

The message transaction locks and validates every referenced `ready_unbound` media row, creates the M1 message, binds media, appends the canonical change, and queues the existing content-free invalidation atomically.

M3 v1 does not replace attachments through edit.

## R1 resolver contract

M3 implements R1's `mediaReferenceResolver`. R1 create/update verifies existence, same partnership, uploader ownership, `ready_unbound`, role/kind compatibility, and no prior binding. `voice_letter` requires voice media.

Binding commits in the same transaction as the R1 reference. Removing/replacing the reference immediately revokes the old media and schedules deletion.

## Object-store provider contract

`MediaObjectStore` provides `createUploadGrant()`, `verifyObject()`, `createDownloadGrant()`, and `deleteObject()`. Provider code owns provider APIs/signing only, not partnership authorization.

Object keys are random opaque values and do not encode account, partnership, container, filename, or MIME information.

## Lifecycle semantics

- active: normal upload/bind/access
- breakup_pending: new chat media remains allowed, new R1 mutation/binding remains disallowed because R1 is view-only
- account-deletion overlay: no new media writes
- terminated: no new upload/refresh/complete/bind/access grant

## Deletion contract

Container deletion revokes access before asynchronous object cleanup.

Final partnership dissolution includes a `partnership_media_objects` deletion target. That handler deletes ciphertext idempotently before removing the metadata needed to locate it. Missing object on retry is success.

## Realtime and caching

M3 creates no media-content WebSocket channel. M1 `message.created` and R1 `relationship.changed` invalidations drive canonical refetch.

Realtime/outbox payloads must never contain signed URLs, filenames, plaintext, ciphertext bytes, or decryption material.

Service worker must never cache signed media URLs, authorized media responses, or decrypted media.

## Logging

Operational logging may include request ID, media ID when necessary, provider operation, state, byte count, error code, and latency. Never log signed URLs, object bodies, original filenames, plaintext metadata, encryption/decryption material, or attachment descriptor ciphertext.

## Compatibility

M3 API/local-schema versioning is independent from S1 crypto protocol versioning. Unknown critical versions fail closed. S1 must be able to replace the test-only media crypto adapter without changing the M3 transport and authorization model.
