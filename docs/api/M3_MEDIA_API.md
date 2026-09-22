# M3 Media API and Integration Contract

## Status

DESIGN COMPLETE. NOT YET IMPLEMENTED.

M3 implementation depends on verified M2 closure and merge.

Base path:

`/api/v1/media`

This document defines the planned M3 HTTP and cross-feature contract. It does not describe current runtime behavior until M3 implementation evidence exists.

## General rules

All media endpoints except policy discovery require an authenticated session.

Every private response uses:

`Cache-Control: private, no-store`

The server derives current account and partnership authority.

A client-supplied partnership ID is never authorization input.

The API never accepts media plaintext bytes.

The API never returns a permanent object URL.

The API never puts signed URLs, media keys, original filenames, private MIME descriptors, or ciphertext in logs, durable outbox payloads, notifications, realtime frames, or analytics.

Unknown and foreign media IDs use the same private not-found behavior.

## Media classes

```text
image
video
file
voice
```

These coarse classes are server-visible operational metadata.

Exact MIME type and display filename are encrypted inside the media object descriptor.

## Media states

```text
pending_upload
ready
delete_pending
storage_deleted
```

A parent message or relationship item may reference only `ready` media.

## Object format

Initial M3 object format:

`m3-secretstream-xchacha20poly1305-v1`

This identifies encrypted object framing. It is not an S1 E2EE protocol version.

Unknown object-format versions fail closed.

## GET /api/v1/media/policy

Returns the server-owned media policy needed by the trusted PWA.

Representative response:

```json
{
  "policyVersion": 1,
  "objectFormat": "m3-secretstream-xchacha20poly1305-v1",
  "maxAttachmentsPerMessage": 10,
  "classes": {
    "image": {
      "maxSourceBytes": 10485760,
      "maxLongestSidePx": 4096,
      "targetProcessedBytes": 2097152
    },
    "video": {
      "maxSourceBytes": 52428800,
      "maxDurationMs": 120000
    },
    "file": {
      "maxSourceBytes": 26214400
    },
    "voice": {
      "maxSourceBytes": 15728640,
      "maxDurationMs": 600000
    }
  }
}
```

The exact configured values may change without an API version bump when they remain within the same semantic contract.

The browser must not assume a value is permanent merely because it is shown in the initial PRD.

## POST /api/v1/media/uploads

Creates a pending media asset after local encryption.

Header:

`Idempotency-Key`

Representative pre-S1 body:

```json
{
  "mediaId": "client-generated-uuid",
  "expectedPartnershipId": "uuid",
  "mediaClass": "image",
  "ciphertextSize": 2048123,
  "objectFormat": "m3-secretstream-xchacha20poly1305-v1",
  "developmentMediaKey": "base64url-encoded-32-byte-key"
}
```

The pre-S1 `developmentMediaKey` field is temporary and exists only under ADR-012.

It is:

- accepted only in explicit development-escrow mode
- excluded from request logs
- held in process memory only long enough to create a wrapped key envelope
- never stored plaintext
- never forwarded to object storage

S1 removes this field.

Rules:

- `mediaId` must be a valid random UUID and becomes the stable media resource ID
- server derives current partnership
- `expectedPartnershipId` must exactly match current authority
- caller must have capability to create chat media in the current lifecycle state
- ciphertext size must fit the server policy for the declared media class
- object format must be supported
- caller becomes the uploader
- server allocates the opaque storage object key
- pending upload expiry is server-owned
- exact idempotent retry returns the same media identity
- different namespace or metadata under a reused idempotency key fails closed

Success:

`201`

```json
{
  "mediaId": "uuid",
  "mediaClass": "image",
  "state": "pending_upload",
  "uploadExpiresAt": "2026-09-24T12:00:00.000Z"
}
```

No signed URL is persisted in the idempotency response.

## POST /api/v1/media/:mediaId/upload-grant

Creates or refreshes an ephemeral direct-upload capability.

Request body:

```json
{}
```

Rules:

- uploader only
- pending state only
- media upload expiry not reached
- current lifecycle still permits media creation
- current partnership must still match the media namespace
- provider object key is never returned separately from the signed URL
- signed request is restricted to the existing opaque object key
- required headers include `Content-Type: application/octet-stream`
- expected content length is bound when the provider supports it
- grant expiry is recorded in `last_upload_grant_expires_at`

Representative response:

```json
{
  "method": "PUT",
  "url": "ephemeral-signed-url",
  "expiresAt": "2026-09-23T12:15:00.000Z",
  "headers": {
    "Content-Type": "application/octet-stream"
  }
}
```

The response is never stored by the service worker and must not be logged.

## POST /api/v1/media/:mediaId/complete

Finalizes a direct upload.

Header:

`Idempotency-Key`

Body:

```json
{}
```

The API performs an authoritative storage HEAD/stat.

Completion succeeds only when:

- caller is the uploader
- media is still pending
- current partnership and lifecycle allow completion
- upload has not expired
- provider object exists
- provider object key is exactly the server-owned key
- stored ciphertext length equals expected ciphertext length

The server does not decrypt the object to complete it.

Success:

```json
{
  "mediaId": "uuid",
  "mediaClass": "image",
  "state": "ready",
  "ciphertextSize": 2048123,
  "readyAt": "2026-09-23T12:04:00.000Z"
}
```

Exact retry is safe.

If lifecycle authority was lost after the PUT but before completion, completion fails. The object remains inaccessible and is removed by upload-expiry or partnership deletion cleanup.

## GET /api/v1/media/:mediaId

Returns content-free media state.

For a ready referenced asset, caller needs current visibility through at least one parent reference.

For an unreferenced pending/ready draft, uploader access is allowed only while the same partnership remains current and authorized.

Representative response:

```json
{
  "mediaId": "uuid",
  "mediaClass": "voice",
  "state": "ready",
  "ciphertextSize": 512345,
  "readyAt": "2026-09-23T12:04:00.000Z"
}
```

The projection never contains private descriptor fields.

## POST /api/v1/media/:mediaId/access

Issues a short-lived authorized ciphertext read capability.

Body:

```json
{}
```

Authorization succeeds only if:

- media is ready
- media is not delete-pending
- current partnership is authoritative
- caller is uploader of an unreferenced draft, or
- at least one current M1/R1 reference is visible to the caller

Pre-S1 development response:

```json
{
  "mediaId": "uuid",
  "mediaClass": "voice",
  "method": "GET",
  "url": "ephemeral-signed-url",
  "expiresAt": "2026-09-23T12:06:00.000Z",
  "objectFormat": "m3-secretstream-xchacha20poly1305-v1",
  "developmentMediaKey": "base64url-encoded-32-byte-key"
}
```

The server unwraps and returns the temporary development key only after the same authorization decision.

This response is not E2EE.

S1 replaces development key delivery with the reviewed cryptographic descriptor/key-distribution contract.

## POST /api/v1/media/:mediaId/cancel

Cancels an uploader-owned unreferenced draft.

Header:

`Idempotency-Key`

Rules:

- uploader only
- no live parent reference
- current partnership must still be authoritative unless cleanup is system-driven
- pending upload becomes delete-pending
- ready orphan becomes delete-pending
- provider deletion is durable and idempotent
- already referenced media cannot be directly cancelled

Success returns content-free state.

## Message send extension

M3 extends the existing M1 send body.

Planned shape:

```json
{
  "body": null,
  "replyToMessageId": null,
  "attachments": [
    {
      "mediaId": "uuid",
      "position": 0
    }
  ]
}
```

Rules:

- body is optional only when at least one attachment exists
- at least one of body or attachments is required
- maximum 10 attachments
- position is 0 through 9
- media must be ready
- actor must be allowed to reference it
- media and conversation must belong to the same partnership
- message creation and reference rows commit atomically
- message idempotency fingerprint includes ordered media IDs
- edit does not mutate attachment set
- delete removes all message attachment rows

Planned message projection attachment:

```json
{
  "mediaId": "uuid",
  "mediaClass": "image",
  "position": 0
}
```

No URL or private descriptor is embedded.

## Reply-context extension

A reply target may be media-only.

M3 extends reply context with an optional content-free summary:

```json
{
  "attachmentCount": 1,
  "attachmentClasses": ["image"]
}
```

The summary exists for rendering only and carries no filenames, MIME values, or URLs.

Deleted reply targets expose no active media references.

## R1 resolver contract

M3 implements the existing R1 media resolver seam.

Logical authorization input:

```text
partnershipId
actorAccountId
referenceId = mediaId
```

The resolver returns true only when the actor can currently reference that ready media in the same partnership. Reference permission requires the actor to be the uploader or already have a current visible parent path to the media; partnership membership by itself is insufficient.

For `role = voice_letter`, R1 and database validation require `mediaClass = voice`.

The containing R1 item remains authoritative for release visibility.

## Access resolver graph

Media read authorization delegates parent visibility.

Logical interfaces:

```ts
interface MediaParentVisibilityResolver {
  canViewMediaReference(
    executor,
    {
      accountId,
      partnershipId,
      mediaId
    }
  ): Promise<boolean>;
}
```

Registered adapters:

- M1 message attachment visibility
- R1 relationship-item reference visibility

Access is allowed if at least one adapter proves a current visible reference.

An adapter error fails closed.

## Media policy and exact MIME

The server-visible `mediaClass` is coarse.

Exact MIME and display filename remain inside the encrypted descriptor.

The client uses the policy plus browser decoding/recording checks to classify content.

A general file is treated as untrusted even when its decrypted descriptor declares a familiar MIME.

The browser must not use a filename extension alone to decide inline execution.

## Lifecycle behavior

### active

- create upload: allowed
- upload grant: allowed
- complete: allowed
- chat media reference: allowed
- R1 reference: allowed according to R1 capability
- existing authorized read: allowed

### breakup_pending

- create/upload/complete ordinary chat media: allowed
- ordinary chat media message: allowed
- R1 user mutation: denied by existing R1 view-only rule
- existing R1 media read: according to current R1 visibility
- scheduled R1 release may expose an already-bound media reference

### account deletion pending

Deleting account:

- session access revoked

Remaining partner:

- existing authorized media can be read while shared data remains viewable
- no new upload
- no new completion
- no new message attachment
- no new R1 reference

### terminated

- no new read grants
- no mutation
- durable physical deletion proceeds asynchronously

## Signed-capability caveat

Provider-signed URLs are bearer capabilities until expiry.

The API cannot revoke a URL already issued by the provider.

M3 therefore:

- keeps read TTL very short
- records upload-grant expiry
- stops issuing new grants synchronously when authority is revoked
- waits for stale upload grants to expire before declaring partnership provider cleanup complete
- never claims that bytes already downloaded can be revoked

This is an explicit acceptance property, not an implementation footnote.

## Client encryption descriptor

Logical encrypted descriptor v1:

```json
{
  "v": 1,
  "mime": "image/jpeg",
  "displayName": "optional private filename",
  "contentBytes": 1827345,
  "width": 2048,
  "height": 1536,
  "durationMs": null
}
```

Fields not relevant to the media class are absent.

The descriptor is authenticated inside the encrypted container.

The server and storage provider do not read it.

## Idempotency

Durable media resource creation and completion use normal authenticated M3 idempotency.

Ephemeral signed-URL generation is intentionally not stored as an idempotent response because a replayed stored URL may already be expired.

A retried upload grant produces a fresh capability for the same pending media object.

Parent M1/R1 mutation idempotency remains owned by those modules.

## Rate and abuse policy

M3 requires server-side abuse controls for:

- upload reservation frequency
- concurrent pending uploads per account
- rolling ciphertext bytes reserved/uploaded
- access-grant request frequency
- repeated failed completion

Exact thresholds are configuration and acceptance-test inputs rather than hardcoded product rules.

Rate-limit metadata contains no private media content.

## Error mapping

Private not-found:

`404 MEDIA_NOT_FOUND`

Representative conflict/policy errors:

- `409 MEDIA_NOT_READY`
- `409 MEDIA_NAMESPACE_CHANGED`
- `409 MEDIA_UPLOAD_EXPIRED`
- `409 MEDIA_REFERENCED`
- `422 MEDIA_POLICY_REJECTED`
- `422 MEDIA_INTEGRITY_FAILED`
- `429 RATE_LIMITED`
- `503 MEDIA_STORAGE_UNAVAILABLE`

Foreign-partnership IDs do not produce a distinguishable "foreign media" error.

## Cache policy

Private API media responses:

`Cache-Control: private, no-store`

Signed object responses are fetched directly by the application and are never placed in the service-worker Cache API.

The PWA does not persist signed URLs.

## Stable-release replacement

S1 must update this API contract before stable release.

At minimum S1 removes:

- `developmentMediaKey` upload input
- server-recoverable development key envelope
- `developmentMediaKey` access output

The outer media ID, partnership binding, object-storage state, parent references, lifecycle, and deletion semantics are intended to survive S1.
