# M3 Physical Android Acceptance

## Status

DESIGN COMPLETE. PROCEDURE CATALOG DEFINED. NOT YET EXECUTABLE.

M3 Media and Voice Messages is still PLANNED. Runtime implementation must wait for verified M2 closure and merge.

This document defines the mandatory physical Android acceptance contract for the future `feat/m3-media-voice` implementation branch.

The command names referenced here are planned interfaces until M3 implementation creates them. Do not report them as runnable or passing yet.

## Purpose

M3 introduces device-sensitive behavior that desktop Chromium automation cannot fully prove:

- Android file and media selection
- Android image decoding and processing
- Android video metadata behavior
- microphone permission
- MediaRecorder codec support
- voice recording lifecycle
- large IndexedDB Blob persistence
- mobile storage pressure
- browser background and foreground behavior during direct uploads
- mobile network interruption and retry
- service-worker interaction with pending media work
- physical-device playback and download behavior

M3 therefore requires real Android acceptance in addition to PostgreSQL, API, worker, provider-adapter, unit, security, and desktop Chromium tests.

## Dependency gate

Do not begin M3 physical acceptance until:

1. M2 is verified and merged to `main`
2. `feat/m3-media-voice` exists from that verified mainline
3. M3 automated local closure is green on the exact implementation SHA being tested
4. the local API, web app, worker, PostgreSQL, and deterministic/private media-storage environment required by the scenario are running
5. the Android device is authorized over ADB

The documentation-only `design/m3-media-voice` branch is not eligible for device acceptance.

## Planned preparation commands

The M3 implementation should provide:

```powershell
npm run test:m3:device:prepare
npm run test:m3:device:cleanup
```

These commands do not exist yet unless and until M3 implementation adds them.

The future preparation harness should remain non-destructive by default.

It must not automatically:

- clear Chrome storage
- uninstall unrelated applications
- toggle Wi-Fi
- toggle mobile data
- toggle airplane mode
- delete user media
- change device security settings

Any destructive reset used for a specific acceptance scenario requires an explicit operator action.

## Device evidence header

Every recorded M3 physical-device run must capture:

- exact M3 commit SHA
- exact `main` base SHA used to create the M3 branch
- device model
- Android version
- Android API level where available
- Chrome version
- ADB serial or a redacted stable device label
- UTC timestamp
- local application URL or test environment identifier
- storage-provider adapter used
- whether the scenario used Wi-Fi, mobile data, USB reverse, or another test path
- scenario number
- pass or fail
- concise observed behavior
- screenshot, log, or recording filename where useful

Do not commit secrets, signed URLs, media keys, private test media, or production identifiers as evidence.

Synthetic media fixtures only.

## General acceptance rules

A scenario passes only when both product behavior and cleanup behavior are correct.

A scenario does not pass merely because:

- upload bytes reached object storage
- the UI displayed a success toast
- a message row exists
- the file can be opened locally
- retry eventually succeeded after creating duplicates
- a signed URL remained usable beyond the intended lifetime
- stale media survived a destructive lifecycle boundary
- a pre-release development key was described as E2EE

The device result must agree with server, database, object-storage, and local-cache evidence.

## Scenario A: Image send and receive

Prove:

1. select a supported image from Android
2. reject a source image above the configured source-size limit
3. process a valid image before upload
4. constrain the longest side to the configured maximum
5. strip EXIF and location metadata by default
6. encrypt locally before direct upload
7. create exactly one ready media asset
8. send it in an M1 message
9. receive and render it on the partner side
10. retrieve it only through an authorized short-lived access grant
11. leave no signed URL in service-worker Cache API
12. release any local Blob URL when the rendered media is discarded

Expected initial policy target:

- source image maximum 10 MB
- longest side maximum 4096 pixels
- target processed size approximately 2 MB or less when practical

## Scenario B: Image plus text and media-only message

Prove both:

- text plus image message
- image-only message

The message must receive one immutable server sequence in both cases.

The media attachment must not introduce a second realtime ordering authority.

## Scenario C: Short video

Prove:

1. select a supported short video
2. reject a source above 50 MB
3. reject duration above 2 minutes
4. accept a valid video without server-side plaintext transcoding
5. encrypt before upload
6. send and receive through a message attachment
7. play the decrypted result on Android
8. never expose exact MIME, filename, signed URL, or media key through realtime events

M3 v1 does not require browser video transcoding.

## Scenario D: General file attachment

Prove:

1. select an allowed file under 25 MB
2. reject a disallowed or oversized file according to current client policy
3. encrypt before upload
4. send through an M1 message
5. recipient must explicitly download or open the decrypted file
6. generic file content is not auto-executed
7. HTML, SVG, script-capable, or otherwise active content is not rendered inline as trusted application content
8. the decrypted filename is sanitized before use in the download UI

Do not claim malware scanning of encrypted attachments.

## Scenario E: Voice recording permission

Prove:

1. microphone permission is requested only after explicit record action
2. denying permission produces a recoverable user-facing state
3. no recording starts after denial
4. granting permission allows recording
5. no microphone capture starts during page load or passive navigation

## Scenario F: Voice record, preview, cancel

Prove:

1. start recording
2. observe active recording state
3. stop manually
4. preview locally
5. cancel before send
6. cancelled recording is not uploaded
7. cancelled recording does not create a durable ready media asset
8. temporary local recording data is released or cleaned according to the local draft policy

## Scenario G: Voice send and playback

Prove:

1. record a valid voice message
2. preview it
3. accept send
4. encrypt before direct upload
5. complete the ready media asset
6. bind it to one M1 message
7. partner receives the message
8. partner obtains authorized ciphertext access
9. decrypt locally
10. play successfully on Android
11. no audio plaintext transits the API or object store

Initial limits:

- maximum duration 10 minutes
- maximum stored upload size 15 MB

## Scenario H: Voice hard limits

Prove:

- recording auto-stops at the configured duration boundary
- a recording exceeding the configured stored-size limit is rejected
- the UI does not claim successful send after a limit rejection
- rejected recording does not become a referenced ready asset

## Scenario I: Network loss during direct upload

Begin a media upload, interrupt connectivity before the provider PUT completes, then restore connectivity.

Prove:

- local upload job survives when IndexedDB persistence succeeded
- upload resumes or safely retries
- exactly one media identity is retained
- no duplicate message is created
- stable parent-message idempotency remains unchanged

## Scenario J: Loss after provider PUT but before media completion

Allow provider upload to complete, then interrupt the app before `POST /media/:id/complete` succeeds.

After recovery prove:

- same media ID is reused
- API performs authoritative provider HEAD/stat
- exact ciphertext size is checked
- completion is idempotent
- one ready media asset results
- no second object or message is created

## Scenario K: Loss after media ready but before message send

Let media become ready, then lose connectivity before the parent M1 send commits.

Prove:

- ready unreferenced media remains protected by the orphan grace
- pending message bundle retains the stable eventual message idempotency key
- reconnect sends one message referencing the existing ready media
- successful parent binding cancels or fences stale orphan cleanup

## Scenario L: Offline media draft reload

While offline:

1. select or record media
2. persist the draft/job/bundle
3. reload or restart Chrome
4. reopen the app

Before S1, a cold start must remain locked until server session validation.

After authority validation prove:

- correct account namespace opens
- correct partnership draft is restored
- no other-account or old-partnership draft appears
- upload/replay resumes only after authoritative reconciliation

## Scenario M: Local quota or transaction failure

Where practical, force or simulate insufficient storage or IndexedDB transaction failure.

Prove:

- the draft is not labelled queued unless the required local transaction committed
- user receives a visible failure state
- unsent media is not silently dropped after the UI claims persistence
- existing queued work is not silently evicted by application code to make room

Browser or OS site-data eviction remains an external limitation and is not represented as guaranteed durability.

## Scenario N: Account switch and logout

With M3 drafts or jobs present:

1. logout or switch account
2. authenticate another account

Prove:

- previous account M3 drafts are not rendered
- previous account upload jobs do not replay
- previous account pending message bundles do not replay
- in-memory media keys and Blob URLs from the old account are released
- current account receives a distinct local namespace

## Scenario O: Breakup pending ordinary chat media

Initiate breakup so the partnership is `breakup_pending`.

Prove:

- ordinary chat image/file/video/voice send remains allowed under product rules
- upload reservation, grant, completion, and parent send all recheck lifecycle authority
- media belongs to the same partnership and remains subject to final dissolution deletion

## Scenario P: Breakup pending R1 mutation

While `breakup_pending`, attempt to attach new M3 media to an R1 item.

Prove:

- the user-driven R1 mutation is rejected because R1 remains view-only
- existing authorized R1 media remains viewable according to current visibility
- a scheduled R1 release configured before breakup may reveal an already-bound Voice Letter only when the existing R1 release rules allow it

## Scenario Q: Account-deletion overlay

Enter the account-deletion recovery state.

Prove:

Deleting account:

- session access is unavailable

Remaining partner:

- may view existing authorized media while shared content remains viewable
- cannot create new upload reservation
- cannot refresh new upload capability for new shared mutation
- cannot finalize new media
- cannot create a new message attachment
- cannot create a new R1 media reference

## Scenario R: Unreleased Voice Letter isolation

Create an R1 item with a Voice Letter while the item remains unreleased.

As recipient, prove:

- item visibility follows R1 preview rules
- media reference is not exposed when R1 withholds full references
- guessing or reusing the media ID does not produce an access grant
- same-partnership membership by itself is insufficient
- development media key is not returned
- provider URL is not returned

This scenario is mandatory because it proves reference-aware authorization rather than simple partnership membership.

## Scenario S: Voice Letter release

Release the same R1 item through its valid release mechanism.

Prove:

- media ownership does not change
- media object key does not change
- a new duplicate asset is not created
- recipient can now obtain access only because R1 parent visibility changed
- normal media read authorization succeeds through the now-visible parent

## Scenario T: Orphan cleanup versus re-reference

Create ready unreferenced media and let orphan cleanup become scheduled.

Before cleanup executes, create a valid new reference.

Prove:

- orphan generation advances
- stale cleanup work becomes a no-op
- referenced media remains available
- no provider object is deleted by the stale generation

## Scenario U: Delete one parent while another survives

Reference the same media through two valid visible parents.

Delete or remove one parent reference.

Prove:

- remaining parent still accesses the asset
- provider object is not deleted
- physical deletion begins only after the last live parent reference disappears and orphan policy permits cleanup

## Scenario V: Final dissolution immediate denial

With media already referenced, finalize partnership dissolution.

Immediately prove:

- application media read grant issuance stops
- upload grant issuance stops
- completion/mutation is rejected
- old partnership UI and local media namespace are purged before replay
- no future partnership can reference or fetch the old media

Provider physical deletion may still be retrying, but application authorization must already be closed.

## Scenario W: Outstanding signed upload capability at dissolution

Issue a short-lived upload grant, then dissolve the partnership before using it.

Where the provider allows the still-valid signed capability to be exercised, attempt the stale upload before its expiry.

Prove:

- application does not restore authorization
- the deletion target does not declare final provider cleanup complete before the recorded upload-grant expiry
- after expiry, the final provider sweep removes any late object
- deletion target completes only after no resurrected object remains

This is mandatory deletion-race evidence.

## Scenario X: Already-issued read capability

Obtain a short-lived authorized read capability, then revoke partnership authorization.

Prove:

- API stops issuing new capabilities immediately
- the already-issued provider capability may remain usable only until its bounded expiry
- documentation and UI do not claim those already-downloaded bytes can be technically recalled

## Scenario Y: Later partnership isolation

After final dissolution and eligibility rules permit a future partnership, form a later partnership.

Prove the new partnership cannot:

- render prior media metadata
- replay prior media drafts
- obtain prior access grants
- reference prior media IDs
- reuse prior provider object keys
- inherit prior development media keys
- inherit prior S1 attachment keys once S1 exists

A later partnership between the same two accounts is still a fresh namespace.

## Scenario Z: Service-worker compatibility with pending media

Create pending media work and trigger the supported service-worker update path.

Prove:

- media replay pauses before incompatible code/local-schema mixing
- pending state is checkpointed
- reload occurs
- local schema is validated
- session is validated
- partnership authority is validated
- canonical M2 reconciliation completes
- only then does media upload/replay resume
- service worker never caches media API responses or signed provider responses

## Optional stress scenarios

These are recommended where practical but do not replace the mandatory cases:

- several attachments in one message up to the configured maximum
- large valid video near the size ceiling
- repeated foreground/background transitions during upload
- Wi-Fi to mobile-network transition
- provider transient failure during delete
- browser process kill during encryption
- two tabs attempting to resume the same media job
- repeated access-grant requests under rate limiting

## Planned evidence artifacts

The future M3 device harness should write non-secret artifacts under an ignored directory such as:

`validation-logs/`

Recommended files:

- device preflight JSON
- scenario result JSON or CSV
- browser console log with private fields scrubbed
- API/worker correlation IDs only
- screenshots where they do not contain private user data
- object-store test adapter evidence containing opaque IDs only

Never record:

- signed provider URLs
- raw development media keys
- wrapped media key values
- original private filenames
- media plaintext
- ciphertext body
- cookies
- session tokens
- provider credentials

## Cleanup

The future cleanup command should remove only M3-owned ADB reverse/CDP forwarding and temporary test harness state.

It must not clear user browser storage unless a scenario explicitly requires and the operator confirms that destructive action.

## Closure rule

M3 remains PLANNED until M2 closes and the implementation branch is created.

After implementation begins, M3 remains IN_PROGRESS until:

- automated M3 closure is green on the exact current M3 implementation SHA
- M1, R1, M2, lifecycle, deletion, storage-provider, security, browser, and migration regressions are green
- every mandatory physical Android scenario in this document has recorded passing evidence or an explicitly reviewed not-applicable reason
- full repository health and high-severity dependency audit are green
- final documentation is reconciled against executed evidence
- no documentation claims S1 E2EE merely because M3 provider storage is encrypted

M3 device acceptance does not close S1.

Stable release remains blocked until S1 replaces the development media-key escrow and R2 verifies that no retained stable-release media depends on server-recoverable development keys.
