# M3 Media and Voice Messages Architecture and Implementation Design

## Status

DESIGN COMPLETE. IMPLEMENTATION MUST WAIT FOR VERIFIED M2 CLOSURE AND MERGE.

Design branch:

`design/m3-media-voice`

Design base:

`feat/m2-realtime-offline @ cbbb824913c7f55519cc5e942d5fe127376d5fb4`

Required implementation branch after M2 closes:

`feat/m3-media-voice`

M3 must be created from the then-current verified `main` after M2 is accepted and merged. This design branch is not an implementation branch and must not be used to bypass the milestone dependency.

Planned PostgreSQL migration ownership after implementation begins:

- `0015_media_runtime.sql`
- `0016_media_references_runtime.sql`

These numbers describe planned M3 ownership. Placeholder migration files must not be committed. The canonical migration chain remains contiguous with no reservation files.

M3 is the first feature milestone that introduces binary user content and private object storage.

## Purpose

M3 adds partnership-scoped images, short video, selected files, ordinary chat voice messages, and R1 media references without weakening the verified P3 lifecycle, M1 conversation model, R1 release model, M2 offline/realtime guarantees, or the stable-release E2EE boundary.

The central architectural rule is:

> Media is a first-class partnership asset. Messages and relationship items reference media assets; they do not own object-storage behavior.

That rule gives one storage, authorization, retry, deletion, and future-E2EE substrate to both M1 and R1.

## Product scope

M3 implements:

- image attachments
- short video attachments
- selected general file attachments
- ordinary chat voice messages
- R1 media attachments
- R1 Voice Letter references
- client-side image preparation
- client-side voice recording
- private object storage
- direct signed ciphertext upload
- short-lived authorized ciphertext download
- upload retry and offline draft orchestration
- provider-neutral media storage abstraction
- durable provider deletion
- final-dissolution media cleanup
- physical Android media acceptance

M3 does not implement:

- voice or video calls
- call recording
- public media galleries
- public object URLs
- server-side media thumbnails
- server-side transcoding
- server-side plaintext malware scanning
- arbitrary inline rendering of uploaded files
- account avatars
- production E2EE key distribution
- cryptographic device enrollment or recovery
- a new realtime ordering model
- a second lifecycle authority
- a CDN requirement
- multipart upload

Account avatars remain outside M3 because they are account-scoped rather than partnership-scoped. They require a separate account-media authorization and deletion design if added later.

## Inherited authority

M3 does not create new product authority.

PostgreSQL remains authoritative for:

- current account and session
- current partnership membership
- partnership lifecycle
- conversation and message state
- relationship-item state and release visibility
- media asset metadata
- media references
- deletion workflow state

Private object storage is authoritative only for whether ciphertext bytes physically exist at an opaque object key.

The object store does not determine:

- who may access media
- whether a partnership exists
- whether an R1 item is released
- whether a message is visible
- whether a media asset is safe to reference

Browser local storage is retry and draft state only.

## Architectural invariants

### Media is partnership-scoped from creation

Every media row belongs to one immutable partnership ID.

A media asset cannot be moved to a later partnership.

A future partnership between the same two accounts cannot reuse an old media row or object key.

The client may supply a stable random `mediaId` generated while offline, but the server derives and persists the authoritative partnership from the authenticated session. The request includes `expectedPartnershipId` only as a stale-namespace guard. It is never authorization input.

If the client's expected partnership differs from current authority, creation fails with a namespace-change error.

### The object store receives ciphertext only

The storage provider must never receive:

- source image plaintext
- video plaintext
- file plaintext
- voice-message plaintext
- original filename
- exact client MIME descriptor
- captions
- media encryption keys

The object-store object key is random and opaque. It contains no account ID, partnership ID, username, filename, MIME extension, or relationship meaning.

Object responses use `application/octet-stream`. Exact descriptive metadata lives inside the encrypted media container.

### M3 does not claim E2EE

M3 must satisfy the frozen encrypted-object-storage boundary before S1, but S1 still owns the reviewed stable-release end-to-end key-distribution protocol.

The accepted development-only bridge is documented in:

`docs/adr/ADR-012-pre-s1-media-encryption-bridge.md`

In pre-S1 development mode:

- the browser generates a random per-media data-encryption key
- the browser encrypts the media object before upload
- the API may temporarily recover that media key through a versioned development escrow envelope
- the API never receives or proxies media plaintext bytes
- the object-storage provider receives ciphertext only
- no UI, documentation, or release note may describe this mode as E2EE

Stable release is blocked until S1 removes the development escrow path and migrates or wipes every pre-S1 media asset.

A pre-S1 media key previously recoverable by the server cannot become retrospectively E2EE merely by rewrapping the same key. Preserved media must be decrypted on an authorized client and re-encrypted with fresh S1 key material that was never disclosed to the server, or the media must be deleted.

### Media visibility is reference-aware

Same-partnership membership is necessary but not sufficient for media access.

A generic rule such as "both partnership members can read every media row" is forbidden.

An asset may be:

- an uploader-owned unreferenced draft
- attached to a visible M1 message
- attached to an unreleased R1 item
- attached to a released R1 item
- referenced by more than one authorized parent

The access service authorizes a read only when at least one current visibility path allows it.

This prevents a recipient from guessing the media ID of an unreleased For You, Future Us, Surprise, Proposal, or Voice Letter object.

### Realtime carries no media bytes

M3 adds no binary WebSocket transport.

No media key, signed URL, filename, MIME descriptor, ciphertext chunk, or media plaintext enters an M2 realtime frame or PostgreSQL NOTIFY payload.

When a message with media is created, the existing `message.created` invalidation is sufficient.

When an R1 item gains or loses media references, the existing `relationship.changed` invalidation is sufficient.

### Parent writes reference only ready media

Messages and R1 items may reference only a media row in `ready` state.

No parent can reference:

- pending upload
- expired upload
- delete-pending media
- deleted media
- foreign-partnership media

Reference authorization is re-evaluated inside the parent mutation transaction.

### Parent semantics stay authoritative

M3 does not duplicate M1 or R1 visibility logic.

The media module uses registered visibility ports supplied at application composition:

- MessageMediaVisibilityResolver
- RelationshipMediaVisibilityResolver

The M1 adapter decides whether the caller may view a message attachment.

The R1 adapter decides whether the caller may view the full item references under R1 release and lifecycle rules.

Conversely, R1's already-existing `mediaReferenceResolver` is wired to the M3 media module so R1 create/patch requests can validate real same-partnership ready media.

This avoids circular business-rule ownership.

## Product limits

Initial policy follows the PRD:

| Media class | Source/client limit | Additional rule |
| --- | ---: | --- |
| image | 10 MB | longest side at most 4096 px after processing; target about 2 MB or less when practical |
| video | 50 MB | at most 2 minutes |
| file | 25 MB | selected file types only |
| voice | 15 MB | at most 10 minutes |
| message attachments | 10 | one message |

These are server-controlled policy values, not hardcoded UI-only assumptions.

Because the server does not inspect media plaintext, it enforces:

- media class
- ciphertext-size ceiling derived from the class limit plus deterministic container overhead
- attachment counts
- lifecycle and authorization
- supported object-format version

The trusted PWA additionally enforces:

- source size
- image dimensions
- video duration
- voice duration
- file-selection policy
- exact MIME handling
- image processing policy

Stable E2EE necessarily limits server-side plaintext inspection. Recipient safety therefore also relies on safe rendering and explicit file-download behavior.

## M3 encrypted media container v1

M3 uses a versioned media container so the object store sees only ciphertext.

Logical format:

```text
magic/version
secretstream header
encrypted descriptor frame
encrypted media chunk 0
encrypted media chunk 1
...
encrypted final media chunk
```

The implementation uses the standard libsodium secretstream XChaCha20-Poly1305 API rather than inventing a cipher or nonce schedule.

Recommended plaintext chunk size:

`1 MiB`

Each frame has an explicit bounded length prefix. The final frame must carry the secretstream final tag. Truncation, reordering, insertion, and authenticated-data mismatch fail decryption.

Authenticated context binds the object to:

- container version
- media ID
- partnership ID
- media class

The encrypted descriptor contains private descriptive metadata such as:

- descriptor schema version
- exact MIME type
- safe display filename where applicable
- processed byte length
- image width and height where applicable
- video or voice duration where applicable

The descriptor is never persisted server-side in plaintext.

The provider object itself carries no private descriptive metadata.

## Media lifecycle

The durable server state machine is:

```text
pending_upload
      |
      | complete after authoritative HEAD verification
      v
    ready
      |
      | no live parent reference after grace
      | explicit draft cancellation
      | final partnership deletion
      v
delete_pending
      |
      | idempotent provider deletion
      v
storage_deleted
      |
      | no remaining relational reference
      v
row removed
```

A pending row also has a hard upload-expiry deadline.

A ready asset with no parent reference is an orphan candidate. The implementation uses generation-fenced orphan cleanup so a stale cleanup action cannot delete media that was referenced again.

Recommended initial orphan grace:

`24 hours`

This value is operational configuration, not a product retention promise.

## Planned persistence

### Migration 0015: media runtime

The existing `media_objects` skeleton is retained and hardened instead of replaced.

Planned additions include:

- `UNIQUE (id, partnership_id)`
- `media_class`
- `state`
- `object_format_version`
- nullable `ciphertext_size` while pending
- `upload_expires_at`
- `last_upload_grant_expires_at`
- `ready_at`
- `orphaned_at`
- `orphan_generation`
- `storage_deleted_at`
- indexes for pending-expiry, orphan cleanup, and partnership deletion
- immutable media identity trigger for ID, partnership, uploader, storage key, and creation time

A separate M3 development key-envelope table stores only the pre-S1 wrapped media key:

```text
media_development_key_envelopes
  media_id
  partnership_id
  wrap_key_version
  wrap_nonce
  wrapped_media_key
  created_at
```

The wrapping key itself is never stored in PostgreSQL.

S1 must eliminate this table or make it empty before stable release.

### Migration 0016: parent references

M3 adds:

```text
message_media_attachments
  message_id
  conversation_id
  partnership_id
  media_id
  position
  created_at
```

Database rules include:

- same-conversation message identity
- same-partnership media identity
- positions 0 through 9
- unique position per message
- no duplicate media ID within one message

Messages gain a bounded attachment count so a non-deleted message can legally contain:

- text only
- media only
- text plus media

A deferred integrity check verifies that the stored attachment count matches actual attachment rows and that deleted messages retain no attachment references.

M3 also adds a database trigger for existing R1 `relationship_item_references` rows where `reference_type = 'media'`.

The trigger rejects a media reference unless:

- media exists
- media belongs to the same partnership
- media is ready
- `voice_letter` role points to voice media

R1 retains ownership of relationship-item release semantics.

## Upload protocol

The browser can prepare and encrypt a draft while offline.

When online:

1. generate or reuse the stable local `mediaId`
2. revalidate current account and partnership namespace
3. encrypt the processed media into the M3 container
4. call `POST /api/v1/media/uploads`
5. API derives current partnership and creates the pending media row
6. API wraps the development media key only in pre-S1 mode
7. client requests a short-lived upload grant
8. client uploads ciphertext directly to private object storage
9. client calls media completion
10. API rechecks lifecycle authority
11. API performs authoritative object metadata lookup
12. exact object key and expected ciphertext size must match
13. API marks media ready
14. only then may M1 or R1 bind the media ID

The API never accepts the uploaded media bytes.

### Upload grant lifetime

Recommended initial maximum signed upload lifetime:

`15 minutes`

A grant can be refreshed while the media row is still pending and current lifecycle authority still permits creation.

The same pending asset always uses the same opaque object key. A refreshed grant is for the same expected ciphertext and key. Replacing content requires a new media ID.

The server records the latest upload-grant expiry.

This is required for correct deletion because a pre-signed upload capability cannot be recalled after issuance.

## Completion and lifecycle races

Media completion is not proof of authorization.

Completion re-evaluates:

- authenticated session
- account-deletion state
- current partnership
- lifecycle capability
- expected partnership namespace
- media ownership
- upload expiry
- expected state

`breakup_pending` still allows supported chat media, matching the PRD.

`account_deletion_pending` denies new upload creation, new grants, completion, and new parent references.

Terminated partnerships deny all new media mutation.

If dissolution races upload completion:

- if completion wins before dissolution, the asset is ordinary partnership data and the deletion manifest owns cleanup
- if dissolution wins, completion fails and no parent reference can be created
- an already-issued upload URL may still physically write ciphertext until it expires
- the partnership media deletion target waits until all previously issued upload grants are expired, then performs a final provider sweep before completing

This prevents a late signed upload from recreating an object after the deletion manifest falsely reported completion.

## Download and playback authorization

The client never stores permanent provider URLs.

To access media it asks the API for a read grant.

The API:

1. authenticates the current session
2. loads the media row by current partnership
3. rejects non-ready or delete-pending state
4. evaluates current parent-reference visibility
5. issues a short-lived signed GET URL only when authorized
6. in pre-S1 development mode, returns the temporary media key only after the same authorization decision
7. uses `Cache-Control: private, no-store`

Recommended initial signed read lifetime:

`2 minutes`

The exact TTL is server-controlled and should remain short.

An already-issued provider capability cannot be recalled. Therefore "immediate revocation" means the API stops issuing new grants immediately and all application authorization is revoked synchronously; previously issued read capabilities have only the bounded signed-URL lifetime. Bytes already downloaded or decrypted can never be technically recalled.

The PWA fetches ciphertext with `Referrer-Policy: no-referrer`, decrypts locally, and renders through a local Blob URL.

The service worker must not cache:

- signed provider URLs
- ciphertext responses
- decrypted media

M3 v1 does not persist received decrypted media.

## Message attachment integration

M1 remains the owner of messages.

M3 extends message creation with attachment references.

Logical send input:

```json
{
  "body": "optional text",
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

- body may be null only when at least one attachment exists
- at most 10 attachments
- all referenced media must be ready
- all media must resolve to the current partnership
- attachment binding and message creation commit atomically
- send idempotency includes stable attachment IDs and positions
- attachments are immutable after message creation
- message editing edits only text
- message deletion removes attachment references and creates the normal tombstone
- removed media becomes orphan-eligible only if no other live parent reference exists

Message projections expose only content-free attachment metadata:

- media ID
- media class
- position

They do not embed:

- signed URL
- original filename
- MIME type
- media key
- encrypted descriptor

A reply context for a media-only message exposes a content-free attachment summary so the UI does not render an empty reply target.

No new realtime event family is required because M1 message creation and mutation synchronization remain canonical.

## R1 integration

R1 already supports media reference shapes:

- `role = attachment`
- `role = voice_letter`

M3 registers the real media resolver that R1 intentionally left unavailable.

R1 create/patch can bind only media authorized for the actor and in ready state.

Reference authorization is deliberately stricter than same-partnership membership. The actor may create a new parent reference only when the actor is the original uploader of the ready asset or already has a current visible parent path to that asset. This permits intentional reuse of an already-shared photo or recording while preventing a guessed unreleased R1 media ID from being rebound into a visible object.

R1 projection rules remain unchanged:

- unreleased recipient projections do not expose full references
- creator-authorized projections may expose references while R1 allows
- release determines when recipient references become visible

The media read service asks the R1 visibility adapter whether the caller can currently view the parent item.

A Voice Letter therefore cannot be fetched merely because the recipient belongs to the same partnership.

## Reference liveness and orphan cleanup

A media object is live when at least one live parent reference exists in:

- `message_media_attachments`
- R1 `relationship_item_references`

A ready unreferenced media row has an orphan generation.

When the final live reference is removed:

1. mark `orphaned_at`
2. increment `orphan_generation`
3. schedule `media_orphan_cleanup` with that generation

When a media row becomes referenced again:

- clear `orphaned_at`
- increment generation so older scheduled work becomes stale

The worker locks the media row before cleanup and rechecks reference existence.

A stale generation is a successful no-op.

## Direct storage abstraction

M3 introduces an explicit provider-neutral package:

`packages/media-storage`

It is not a generic infrastructure junk drawer.

The port exposes only operations M3 needs:

- createUploadGrant
- headObject
- createReadGrant
- deleteObject

Both API and worker use this package.

Provider SDKs do not enter:

- `packages/domain`
- `packages/contracts`
- `packages/db`

The production adapter must satisfy contract tests before M3 closure.

A local/test adapter is used for deterministic integration and browser acceptance.

Provider requirements:

- bucket/container is private
- public ACLs are disabled
- list access is not exposed to clients
- CORS allows only the trusted app origin and required methods/headers
- signed URLs are bounded
- credentials remain server/worker only
- object keys are opaque
- no user metadata is written to provider object metadata
- delete is idempotent
- HEAD/stat returns authoritative content length

## Image behavior

Before encryption the trusted client:

- rejects source images above 10 MB
- decodes image orientation correctly
- resizes longest side to at most 4096 px
- compresses toward approximately 2 MB or less when practical
- re-encodes rather than preserving source metadata by default
- strips EXIF/location metadata by default
- validates the resulting image before upload

M3 does not preserve original image bytes by default.

## Video behavior

M3 v1 does not perform browser video transcoding.

The client:

- rejects files above 50 MB
- rejects duration above 2 minutes
- validates that the browser can safely identify the selected media as a supported video
- uploads the locally encrypted selected video

Server-side transcoding is intentionally absent from M3 because it would either require server plaintext or a substantially more complex encrypted-processing architecture.

## General file behavior

Selected files have an initial 25 MB limit.

The trusted client applies the server-delivered file policy before encryption.

Because encrypted attachments cannot be reliably server-scanned:

- files are never auto-executed
- generic files are not rendered inline as active HTML/SVG/script content
- provider responses remain `application/octet-stream`
- the recipient explicitly chooses download/open
- the decrypted filename is sanitized before use in a browser download attribute
- the product does not claim malware scanning of encrypted attachments

## Voice-message behavior

Ordinary chat voice messages use `MediaRecorder` behind an explicit user gesture.

The client:

- requests microphone permission only when recording begins
- chooses a supported codec with `MediaRecorder.isTypeSupported`
- records for at most 10 minutes
- auto-stops at the duration limit
- allows preview before send
- allows cancellation before send
- applies the 15 MB stored-content limit
- encrypts the accepted recording before object upload
- does not upload cancelled recordings

Playback uses the same authorized fetch, decrypt, Blob URL flow as other media.

Voice Letters use the same binary media substrate but are referenced through R1 rather than ordinary chat message attachments.

## Offline and unreliable network design

M3 does not place binary media inside the M2 JSON chat outbox.

M3 raises the browser local schema version and adds account/partnership-scoped stores for:

- media draft metadata
- media draft blobs
- media upload jobs
- pending message bundles

A pending message bundle contains:

- stable message idempotency key
- optional text
- optional reply target
- ordered local media draft IDs

The online replay sequence is:

1. validate session and current partnership
2. verify the bundle still belongs to the authoritative namespace
3. encrypt any draft not yet encrypted
4. create or resume each server media row
5. upload/finalize each media asset
6. persist the resulting ready media IDs
7. materialize the normal M2 message-send operation with those IDs
8. let normal M2 authoritative replay send the message
9. remove the bundle only after canonical message success

A network loss after object upload but before completion is safe because completion is idempotent.

A network loss after media completion but before message send is safe because the ready object remains orphan-protected during the grace window and the same message idempotency key is reused.

A permanent lifecycle rejection leaves any unreferenced ready media to generation-fenced orphan cleanup.

Queueing is successful only after the draft/blob/job/bundle transaction commits to IndexedDB.

Quota or transaction failure must be visible to the user and must never be represented as "queued".

Pre-S1 local media drafts follow M2's locked cold-start rule. They may exist as development plaintext on the authorized client, but they must not render before server session validation. S1 must migrate or wipe any pre-S1 local draft representation that is incompatible with reviewed device encryption.

## Local storage budget

The client uses `navigator.storage.estimate()` as advisory preflight only.

No fixed browser quota is assumed.

Before accepting a large offline draft the UI estimates required space and can reject the operation when available space is clearly insufficient.

The IndexedDB transaction remains authoritative. If persistence fails, the operation is not queued.

M3 v1 does not promise indefinite offline retention of large media against browser site-data eviction.

## Service-worker behavior

The service worker caches no media API response and no object-storage response.

Media storage origins are network-only.

A waiting service-worker update pauses media replay using the same compatibility barrier as M2.

The client resumes media upload/replay only after:

- reload
- session validation
- local-schema validation
- authoritative partnership validation
- canonical M2 resynchronization

## Lifecycle matrix

| State | Existing authorized media read | New chat media | New R1 media reference | Upload finalize |
| --- | --- | --- | --- | --- |
| active | Yes | Yes | According to R1 capability | Yes |
| breakup_pending | Yes | Yes | No because R1 user mutations are view-only | Yes for chat-bound media |
| account_deletion_pending, remaining partner | Existing view only | No | No | No |
| account_deletion_pending, deleting account | No session access | No | No | No |
| terminated | No | No | No | No |

Scheduled R1 release during breakup_pending may make an already-referenced Voice Letter visible because that is an R1 release transition, not creation of new media.

## Deletion architecture

Final dissolution already revokes application authorization synchronously.

M3 extends the deletion manifest with a dedicated target:

`partnership_media_storage`

The existing `partnership_relational_content` target must stop unconditionally deleting `media_objects` before provider cleanup evidence exists.

The two targets are deliberately order-independent.

### If relational cleanup runs first

- message/R1 references are deleted
- media rows remain until provider storage deletion succeeds
- media target later deletes ciphertext objects
- media rows are then removed

### If media storage cleanup runs first

- provider objects are deleted
- media rows record `storage_deleted_at`
- rows remain while relational references still exist
- relational target later removes parent references and media rows

The media deletion target completes only when every partnership media row has either:

- confirmed idempotent provider deletion, or
- already been absent from the provider

Before the final provider sweep, the handler waits until all recorded upload grants have expired so a stale pre-signed upload cannot recreate an object after deletion completion.

Provider 404/not-found is treated as successful idempotent deletion.

Transient provider failures use the existing deletion-target lease, retry, and fencing machinery.

Authorization never waits for provider cleanup.

## Individual parent deletion

Deleting a message or removing/deleting an R1 item removes only that reference.

The media object is physically deleted only when it has no remaining live parent reference and the orphan grace expires.

This permits an intentionally reused shared photo or recording to remain available through another valid parent without duplicating provider bytes.

## Concurrency and lock ordering

Lifecycle-sensitive M3 writes preserve the P3 canonical account/partnership lock discipline.

When multiple media rows are involved, lock media IDs in stable lexical UUID order after lifecycle authority has been locked.

Parent mutations must not acquire media locks in an arbitrary client-provided order.

Required race coverage includes:

- upload completion versus breakup initiation
- upload completion versus account deletion
- upload completion versus final dissolution
- message send with media versus final dissolution
- R1 reference creation versus final dissolution
- orphan cleanup versus re-reference
- parent deletion versus media access grant
- provider deletion versus stale upload grant expiry

## Error privacy

Unknown and foreign media IDs use one not-found shape where distinguishing them would reveal another partnership's resource.

Representative errors:

- `MEDIA_NOT_FOUND`
- `MEDIA_NOT_READY`
- `MEDIA_UPLOAD_EXPIRED`
- `MEDIA_POLICY_REJECTED`
- `MEDIA_NAMESPACE_CHANGED`
- `MEDIA_ACCESS_DENIED`
- `MEDIA_STORAGE_UNAVAILABLE`
- `MEDIA_INTEGRITY_FAILED`
- `MEDIA_LOCAL_STORAGE_FAILED`
- `REFERENCE_TYPE_UNAVAILABLE`

Errors never contain:

- signed URL
- object key
- media key
- original filename
- exact private MIME descriptor
- ciphertext
- provider credentials

## Logging and observability

Allowed operational metrics include:

- upload reservation count
- upload completion count
- failed upload count by bounded error code
- ciphertext bytes uploaded
- provider latency
- provider delete retry count
- orphan-cleanup count
- media class
- browser-side processing failure count without content

Logs must not contain:

- signed URLs
- raw object URLs
- original filename
- encrypted descriptor
- media key
- wrapped key
- ciphertext body
- decrypted bytes
- private R1 context

Metrics are reliability and cost metrics, not engagement analytics.

## Implementation sequence

### M3-A Contracts, policy, and crypto/storage boundaries

- M3 media contracts
- server-owned media policy
- media class and state enums
- object-format version
- accepted pre-S1 bridge ADR
- provider-neutral storage port
- strict no-content logging rules

### M3-B Persistence and media repository

- migration 0015
- harden existing `media_objects`
- development key-envelope table
- pending/ready/delete state machine
- upload expiry
- orphan generation fencing
- repository and database invariants

### M3-C Private object storage adapter

- local deterministic adapter
- production provider adapter
- private-container validation
- upload grants
- HEAD/stat
- read grants
- idempotent delete
- CORS and signed-URL policy

### M3-D Media HTTP API

- policy read
- upload reservation
- upload-grant refresh
- completion
- state read
- authorized access grant
- draft cancellation
- lifecycle revalidation
- rate and rolling-byte abuse controls

### M3-E M1 message attachments

- migration 0016 message attachment table
- message body-or-attachment shape
- send contract
- idempotency fingerprint update
- message projections
- reply attachment summary
- deletion/orphan reconciliation
- M1 sync regression coverage

### M3-F R1 attachments and Voice Letters

- register M3 resolver
- database same-partnership ready-media trigger
- voice-letter class enforcement
- release-aware media visibility adapter
- create/patch/delete orphan reconciliation
- R1 regression coverage

### M3-G Browser processing and voice recording

- image processing
- video validation
- selected-file policy
- MediaRecorder voice flow
- encrypted-container writer/reader
- upload progress
- preview/cancel UX
- safe file download behavior

### M3-H Offline media orchestration

- local schema upgrade
- media drafts
- upload jobs
- pending message bundles
- stable IDs and idempotency
- resume after reload/network loss
- quota failure behavior
- account/partnership purge integration
- service-worker compatibility

### M3-I Durable cleanup

- media upload-expiry scheduled action
- generation-fenced orphan cleanup
- partnership media deletion handler
- signed-upload-expiry barrier
- order-independent deletion-manifest integration
- repair/retry evidence

### M3-J Security, browser, integration, and Android closure

- media contract/security tests
- PostgreSQL/API/worker matrix
- provider contract suite
- Chromium direct-upload/decrypt tests
- offline/reload tests
- R1 release isolation tests
- full repository health and audit
- mandatory physical Android acceptance

## Automated closure design

M3 should mirror the successful M2 local-closure philosophy.

Planned commands:

```text
npm run test:m3:security
npm run test:m3:postgres
npm run test:m3:browser
npm run test:m3:browser:e2e
npm run test:m3:local
npm run test:m3:closure
npm run test:m3:device:prepare
npm run test:m3:device:cleanup
```

`test:m3:local` should compose disposable PostgreSQL, API, worker, deterministic object-storage adapter, and real Chromium acceptance.

`test:m3:closure` should additionally enforce:

- exact branch/SHA
- clean worktree
- `[skip ci]` branch policy while hosted Actions are being conserved
- no Unicode em dash
- full repository health
- high-severity dependency audit
- git diff hygiene
- final worktree cleanliness

Physical Android remains separate mandatory evidence.

## Physical Android acceptance

At minimum, the supported Android device must prove:

1. choose, process, send, receive, and view an image
2. enforce image source and dimension limits
3. choose and send a valid short video and reject duration/size violations
4. send and explicitly download a permitted general file
5. microphone permission is requested only from explicit recording action
6. record, preview, cancel, send, receive, and play a voice message
7. auto-stop voice recording at the duration boundary
8. network loss during direct upload resumes safely without duplicate media
9. network loss after object upload but before completion resumes safely
10. offline media draft survives reload when local persistence succeeds
11. local quota/persistence failure does not claim the draft is queued
12. breakup_pending still permits ordinary chat media
13. account-deletion view-only state denies all new media mutation
14. an unreleased R1 Voice Letter cannot be fetched by the recipient
15. R1 release makes the already-authorized Voice Letter fetchable without changing media ownership
16. final dissolution immediately denies new grants and durable provider cleanup completes
17. an old upload capability cannot leave resurrected media after final cleanup
18. later partnership cannot render, reference, fetch, or replay prior media
19. account switch/logout purges M3 local drafts/jobs for the prior account
20. service-worker update does not replay media under incompatible local schema

## Acceptance boundary

M3 is DONE only when:

- M2 is already verified and merged
- the accepted M3 architecture is implemented
- planned M3 migrations are materialized and verified without rewriting 0001 through 0014
- all M3 API, persistence, M1, R1, M2, lifecycle, deletion, security, browser, and storage-provider gates pass
- physical Android media/voice evidence passes
- repository health and audit are green
- documentation is reconciled against executed evidence

M3 completion does not mean S1 is complete.

Stable release remains blocked until S1 replaces the development media-key escrow and the product has verified reviewed E2EE.
