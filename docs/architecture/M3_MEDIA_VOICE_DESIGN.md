# M3 Media and Voice Messages

## Status and base

**Status:** DESIGN COMPLETE, IMPLEMENTATION NOT STARTED
**Branch:** `feat/m3-media-voice`
**Required base:** `main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`

Canonical API contract: `docs/api/M3_MEDIA_API.md`.
Canonical physical Android procedure: `docs/testing/M3_ANDROID_ACCEPTANCE.md`.

M3 depends on the completed M2 realtime/offline substrate.

M3 owns chat images, short videos, selected files, chat voice messages, Relationship Space media attachments, R1 Voice Letter binary media, encrypted object-storage transport, upload/retrieval authorization, media deletion, abandoned-upload cleanup, and physical Android media acceptance.

M3 does not own general message E2EE, partnership cryptographic epochs, device enrollment, cryptographic recovery, voice calls, video calls, push notifications, server-side plaintext transcoding, or call recording.

## Existing boundaries M3 must preserve

- M1 owns authoritative conversation/message ordering and durable message change sequencing.
- M2 owns realtime invalidation, canonical reconciliation, IndexedDB partnership isolation, service-worker compatibility, offline mutation safety, and local purge boundaries.
- R1 already supports loose `media` references with roles `attachment` and `voice_letter`, but rejects them until an M3 resolver is registered.
- Voice Letter remains a media reference attached to an R1 item. It is not a standalone R1 aggregate.
- P3 owns partnership dissolution and synchronous authorization revocation.
- F2 owns durable scheduled/deletion worker infrastructure.
- the existing `media_objects` table is the aggregate root to refine. M3 must not create a second media identity system.

## Core architecture

```text
Browser/PWA
  |
  | local validation, processing, encryption
  v
ciphertext
  |
  | short-lived signed upload/download grants
  v
private object storage

Browser/PWA <-> Shawtie API <-> PostgreSQL authority
                       |
                       +-> durable cleanup workers
```

PostgreSQL remains authoritative for media identity, partnership scope, uploader, lifecycle state, object key, ciphertext size, coarse format classification, upload/finalization state, one-time binding, and deletion state.

The object store never grants application authorization by itself.

Object storage receives only random opaque object keys, ciphertext bytes, and minimum transport metadata. Object keys must not encode account IDs, partnership IDs, message IDs, filenames, MIME types, or relationship content.

## Encryption boundary

Protected media plaintext must be encrypted on the client before upload. The API and storage provider must never receive media plaintext.

M3 defines the transport and lifecycle seam through a high-level `MediaCryptoPort` with operations equivalent to:

```text
encryptMedia()
decryptMedia()
prepareMediaKeyEnvelope()
openMediaKeyEnvelope()
```

M3 must not invent the permanent media-key distribution protocol. S1 owns the reviewed production attachment-key envelope, device cryptographic identity, epochs, rotation, enrollment, and recovery.

Before S1, automated integration and synthetic-device work may use an isolated test-only crypto adapter for synthetic fixtures. The adapter must be impossible to enable in production. No sensitive real-world media use is allowed until S1 replaces it.

## Product limits

| Kind | Initial limit | Additional rule |
| --- | ---: | --- |
| `image` | 10 MB source | client re-encode, longest side <= 4096 px, target about 2 MB where practical |
| `video` | 50 MB | duration <= 120 seconds |
| `file` | 25 MB | allowlisted formats only |
| `voice` | 15 MB | duration <= 600 seconds |

Maximum attachments per message: 10.

Image processing must happen client-side before encryption. Re-encoding removes ordinary metadata. M3 v1 does not require server-side plaintext processing or browser video transcoding.

## PostgreSQL ownership

M3 owns:

- `0015_media_runtime.sql`
- `0016_media_integration_runtime.sql`

M3 must not modify M1-owned 0011/0012 or R1-owned 0013/0014.

`0015_media_runtime.sql` refines `media_objects` with fields equivalent to:

```text
media_kind
format_code
state
uploader_device_id
ciphertext_sha256
upload_generation
upload_expires_at
ready_at
binding_type
binding_id
binding_role
binding_position
deletion_generation
```

Existing `storage_object_key`, `ciphertext_size`, and `crypto_protocol_version` remain.

Allowed lifecycle states:

```text
uploading
ready_unbound
bound
deletion_pending
failed
```

`0016_media_integration_runtime.sql` owns M1/R1 binding constraints, lookup indexes, media-only message support, cleanup indexes, and immutable binding invariants.

## One-time binding invariant

One uploaded media object binds exactly once to exactly one authoritative container.

Binding types:

```text
message
relationship_item
```

Binding roles:

```text
attachment
voice_message
voice_letter
```

Once bound, binding identity and position are immutable. The same media ID cannot simultaneously be a visible chat attachment and a sealed R1 attachment. Reuse requires a second upload identity.

A `ready_unbound` object is visible only to its uploader. Partnership membership alone does not make it visible to the partner.

## Media state machine

```text
create upload -> uploading -> ready_unbound -> bound
                      \-> deletion_pending -> object removed -> row removed
ready_unbound --------/ 
bound -> deletion_pending -> object removed -> row removed
```

## Object-store abstraction

Introduce `MediaObjectStore` with:

```text
createUploadGrant()
verifyObject()
createDownloadGrant()
deleteObject()
```

Provider code owns signing/provider APIs only. Authorization remains in the media domain service. Provider choice must remain replaceable.

Use random opaque keys such as `media/v1/<random-value>` and never user/path-derived keys.

## Upload lifecycle

### 1. Local preparation

Browser validates product limits, processes images, validates supported format, encrypts plaintext, computes ciphertext length, and computes a strong ciphertext digest.

### 2. Authorize upload

`POST /api/v1/media/uploads` authenticates the current session/device, loads current partnership authority, evaluates `send_media`, enforces policy/rate limits, creates the `uploading` row, allocates an opaque storage key, schedules expiry, and returns a short-lived signed upload grant.

### 3. Upload ciphertext

The browser uploads ciphertext directly to private storage, preferably as `application/octet-stream` so descriptive metadata is minimized.

### 4. Finalize

`POST /api/v1/media/:mediaId/complete` verifies current generation, object existence, expected byte length, and checksum where supported, then transitions `uploading -> ready_unbound`.

Completion retry is idempotent. A forged completion cannot make a missing object usable.

## Abandoned upload cleanup

Use generation-fenced `m3.media_upload_expire` scheduled work. If a row is still `uploading` at expiry, revoke access, delete any object idempotently, and remove the row. Already-missing objects are success.

## Retrieval authorization

`GET /api/v1/media/:mediaId/access` re-evaluates current authority every time and only then returns a very short-lived signed GET grant.

Unbound media is uploader-only.

Message-bound media requires current partnership membership, M1 conversation visibility, a non-deleted owning message, and lifecycle permission to view shared data.

R1-bound media requires current partnership membership and the containing R1 item's authoritative visibility, including release, recipient-open, creator-reveal, and account-deletion rules.

A known `mediaId` never bypasses its owning container.

Signed URLs are bearer capabilities. After revocation no new grant may be issued; any already-issued grant is bounded by deliberately short TTL unless the provider offers stronger revocation.

## M1 integration

M3 extends M1 send rather than creating a second message system.

Valid message shapes:

- text only
- text plus attachments
- attachments only
- one voice-message media object only

Voice message shape:

```text
body = null
kind = voice
role = voice_message
position = 0
exactly one media object
```

The M1 send transaction must lock/validate all referenced `ready_unbound` media, create the message, bind media, append the canonical conversation change, and queue the existing content-free invalidation atomically.

If the transaction fails, media remains `ready_unbound`.

M3 v1 does not replace attachments during text edit. Replace attachments by delete and resend.

Message deletion immediately revokes attachment authorization, marks bound media `deletion_pending`, and schedules durable object cleanup while the normal M1 tombstone remains.

## R1 and Voice Letter integration

M3 implements the existing R1 `mediaReferenceResolver` seam.

At create/update, the resolver verifies media existence, same partnership, uploader ownership, `ready_unbound` state, correct role/kind, and absence of prior binding.

`voice_letter` requires `media_kind = voice`.

Binding must commit in the same PostgreSQL transaction as the R1 reference. Removing or replacing an R1 media reference sends the old object to `deletion_pending`; it never returns to `ready_unbound`.

Voice Letter visibility is inherited from the containing R1 item and has no independent visible flag.

## Lifecycle rules

### active

Normal media upload, binding, and access.

### breakup_pending

New chat images, videos, files, and voice messages remain allowed because the PRD explicitly permits them. R1 remains view-only, so new R1 media binding is not allowed. Existing R1 media follows the containing item's already-authorized visibility/release rules.

### account-deletion overlay

No new media writes. Existing reads follow authoritative lifecycle rules.

### terminated

No new upload, refresh, complete, bind, or access grant. Authorization ends synchronously before physical storage cleanup.

## Deletion integration

After M3, P3 relational cleanup must not remove media metadata before object cleanup has enough information to locate ciphertext.

Add a partnership deletion-manifest target:

```text
partnership_media_objects
```

P3 dissolution then composes:

```text
partnership_relational_content
partnership_media_objects
partnership_crypto_state
```

The M3 deletion handler receives only the partnership ID, iterates remaining media rows, deletes each object idempotently, removes corresponding metadata, and renews its deletion-target lease as required.

If the worker crashes after object deletion but before row deletion, retrying the missing object is success.

Individual message/R1 media cleanup may use generation-fenced immediate `m3.media_delete` scheduled work. Final partnership destruction continues to use the formal P3 deletion manifest.

## Realtime behavior

M3 creates no media-content WebSocket channel. Existing M1 `message.created` and R1 `relationship.changed` invalidations cause canonical refetch.

Realtime/outbox payloads must never include signed URLs, filenames, plaintext, ciphertext bytes, or decryption material.

## Offline and IndexedDB

Do not place binary media in the M2 `chatOutbox`.

Use a separate account-bound M3 local database/store for encrypted upload drafts and operational metadata only. Never persist plaintext drafts.

Upload itself requires network access. Encrypted drafts may survive temporary connectivity loss if IndexedDB persistence succeeds. Quota/storage failure must never be represented as safely queued.

No service worker may cache signed media URLs, authorized media responses, or decrypted media.

Downloaded plaintext should exist only in memory or short-lived Blob URLs and must be revoked when no longer needed.

Logout, account switch, device/session revocation, final dissolution, and later-partnership transition must purge the relevant M3 local namespace.

## Safe client rendering

After decryption, distrust sender metadata. Revalidate allowed magic bytes, never render arbitrary HTML, do not render SVG as active inline content in v1, never execute attachments, default general files to download, and render only allowlisted browser-safe image/video/audio formats.

Original filenames are not sent to the server in M3 v1. If retained later, they belong inside an S1-protected descriptor.

## Browser module plan

```text
apps/web/src/features/media/
  MediaPicker.tsx
  MediaPreview.tsx
  MediaAttachment.tsx
  VoiceRecorder.tsx
  VoicePlayer.tsx
  UploadProgress.tsx
  media-api.ts
  media-types.ts

apps/web/src/lib/media/
  crypto-port.ts
  media-validation.ts
  media-upload-runtime.ts
  media-download-runtime.ts
  media-local-db.ts

apps/web/src/workers/
  media-processing.worker.ts
```

Voice recorder state should explicitly model `idle`, `requesting_permission`, `recording`, `preview`, `encrypting`, `uploading`, `ready`, and `failed`. Closing must release MediaStream tracks, MediaRecorder, Blob URLs, and timers.

## API module plan

```text
apps/api/src/modules/media/
  media-service.ts
  media-reference-resolver.ts
  routes.ts

packages/media-storage/
  provider-neutral storage adapter
```

Repository/domain media access policy remains outside the provider package.

## Server-controlled policy

Centralize:

```text
imageSourceMaxBytes
imageProcessedLongestEdge
imageTargetBytes
videoMaxBytes
videoMaxDurationSeconds
fileMaxBytes
voiceMaxBytes
voiceMaxDurationSeconds
attachmentsPerMessage
uploadGrantTtlSeconds
downloadGrantTtlSeconds
unboundUploadRetentionSeconds
```

Client policy is advisory. API policy is authoritative.

## Implementation sequence

### M3-A Contracts and domain

Media kind/format schemas, policy contract, state machine, binding rules, projections, message attachment extension, Voice Letter role rules, and deletion rules.

### M3-B Migrations 0015/0016

Refine `media_objects`, add indexes and immutability constraints, M1 media-only support, upload cleanup state, and invariants. Canonical migration run must be 0001 through 0016 with no reservations.

### M3-C Object-store abstraction

Implement `MediaObjectStore` and a realistic private local test adapter. Verify grants, expiry, stat/checksum, signed download, deletion, and missing-object idempotency.

### M3-D Upload API

Policy, initiate, refresh, complete, cancel, abandoned-upload cleanup, rate limiting, and exact replay behavior.

### M3-E Retrieval authorization

Signed access, uploader-only unbound access, M1/R1 binding visibility, cross-partnership denial, and lifecycle denial.

### M3-F M1 integration

Attachments, media-only messages, voice messages, atomic binding, projection, and deletion revocation without changing M1 sequence semantics.

### M3-G R1 integration

Concrete media resolver, atomic binding, Voice Letter, release visibility inheritance, replacement/delete cleanup.

### M3-H Browser UX

Pickers, image processing, file/video selection, recorder, preview, progress, retry/cancel, safe rendering, voice playback, chat cards, and R1 attachment UI.

### M3-I Lifecycle, deletion, local storage

Breakup/account-deletion/final-dissolution behavior, `partnership_media_objects`, `m3.media_delete`, abandoned uploads, M3 local purge, M2 reconciliation compatibility, and service-worker exclusion.

### M3-J Closure

Contracts, security, PostgreSQL, object storage, browser, real Chromium, disposable local closure, health/audit, and mandatory physical Android acceptance.

Planned command surface:

```text
npm run test:m3:contracts
npm run test:m3:security
npm run test:m3:postgres
npm run test:m3:storage
npm run test:m3:browser
npm run test:m3:browser:e2e
npm run test:m3:local
npm run test:m3:closure
npm run test:m3:device:prepare
npm run test:m3:device:cleanup
```

## Critical race matrix

| Race | Required outcome |
| --- | --- |
| complete upload vs breakup | current lifecycle is re-evaluated; stale client authority is never trusted |
| bind vs final dissolution | termination wins; no new visibility |
| message send vs upload expiry | either atomic bind/send commits or send fails |
| same media bound twice | one wins, one fails |
| delete vs new access grant | no new grant after container deletion |
| R1 delete vs media access | deleted owner removes future access |
| scheduled R1 release vs dissolution | destructive deadline wins |
| worker crash after object delete | retry completes metadata cleanup |
| account/device revoke during upload | completion/binding fails closed |
| two tabs finalize same draft | generation fencing prevents stale finalization |
| completion retry | exact idempotent result |
| foreign media ID | privacy-safe rejection |

## Physical Android acceptance

M3 is not DONE from desktop automation alone. `docs/testing/M3_ANDROID_ACCEPTANCE.md` defines 18 mandatory physical scenarios covering image/video/file/voice flows, permission denial, backgrounding, network failure, lost finalize response, local quota failure, breakup/account-deletion/final-dissolution races, signed URL TTL behavior, later-partnership isolation, device revocation, Voice Letter visibility, service-worker safety, and two-tab fencing.

## Closure gates

M3 is DONE only after all of the following are green:

- migrations 0001 through 0016 apply from zero with `reserved=0`
- database invariants pass
- PRD size/duration/attachment limits are enforced server-side
- storage is private and object keys are opaque
- media plaintext never reaches API/object storage
- signed grants expire and are never persisted in product projections
- guessed/cross-partnership media IDs fail closed
- one-time binding prevents visibility-domain reuse
- M1 ordering/change semantics remain unchanged
- media-only and voice messages work
- breakup behavior matches PRD
- Voice Letter inherits R1 visibility
- message/R1 deletion immediately revokes new media access
- object cleanup is idempotent and retry-safe
- final dissolution revokes access before storage cleanup
- future partnership cannot access old media
- service worker never caches protected media
- plaintext/decryption material never enters logs/events/outbox
- physical Android matrix passes
- full repository health and high-severity dependency audit pass
- diff/worktree hygiene and local/remote SHA parity pass

## Architecture conclusion

M3 extends M1/R1 container authority, PostgreSQL metadata authority, M2 reconciliation, and P3/F2 deletion. It must not create a second message system, second relationship system, second deletion workflow, second realtime authority, or custom cryptographic identity system.

The two strongest invariants are:

1. one uploaded media object binds to exactly one authoritative container
2. media bytes are encrypted before leaving the browser, while production key distribution stays behind S1's reviewed cryptographic boundary
