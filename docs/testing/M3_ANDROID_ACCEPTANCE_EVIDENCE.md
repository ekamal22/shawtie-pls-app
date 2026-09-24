# M3 Physical Android Acceptance Evidence

This document records executed pass/fail evidence for the 20 mandatory physical
Android scenarios defined in `docs/testing/M3_ANDROID_ACCEPTANCE.md`, plus the
supplemental media, lifecycle and privacy checks run alongside them.
`M3_ANDROID_ACCEPTANCE.md` remains the canonical procedure and closure-rule
document.

## Result

All 20 of 20 mandatory physical Android scenarios are recorded PASS on a
physical Xiaomi Redmi Note 9S. Final physical acceptance code SHA:
`ee59850` on `feat/m3-media-voice` (initial tested SHA
`305891f3537187eb193fa4b3e0539f9361c400b8`). Executing the scenarios found and
fixed three real defects that the automated and local closure did not catch,
each with a focused regression test:

1. D1: a failed chat upload left a stale "prepared" draft chip and a stuck
   "Sending..." status (found in scenario 2, fixed in `98b4c90`, verified in
   scenario 8).
2. D2: the microphone kept capturing while the page was hidden (found in
   scenario 7, fixed in `98b4c90`, re-verified in scenario 7 and by a screen
   lock test).
3. D3: an object-store outage during upload completion surfaced as a generic
   500 `INTERNAL_ERROR` instead of a fail-closed 503 `MEDIA_UNAVAILABLE` (found
   in scenario 20, fixed in `ee59850`, re-verified in scenario 20).

M3 was subsequently fast-forward merged to `main @ 1d3535f1c4d2d16e66c3bfa4c9c8cef42a95822a` after this acceptance evidence closed.

## Test environment

- Physical device: Xiaomi Redmi Note 9S, Android 12, API 31
- ADB serial: `bf4b0dc9`
- Chrome version: 153.0.8010.52
- Isolated local runtime, separate from the ports used by other work on this
  machine (ports 3000 and 5432 and the private repository container were not
  touched):
  - API: `127.0.0.1:3001`, worker: separate process
  - Web: `vite preview` of a `--mode m3device` build on `127.0.0.1:4174`. The
    build sets `VITE_M3_TEST_CRYPTO=1`. `MODE` is not `production`, so the
    test-only crypto adapter is enabled, while `import.meta.env.PROD` is still
    true so the real service worker registers.
  - Disposable PostgreSQL: `127.0.0.1:55432` (`postgres:16-alpine`, all 16
    migrations applied from zero)
  - Private object store: disposable MinIO on `127.0.0.1:59000`, bucket
    `shawtie-m3-test`, reached from the phone through `adb reverse`
  - CDP forward: local `9223` to device `chrome_devtools_remote`
  - A temporary untracked `vite.config.m3-android.local.ts` proxied `/api` to
    port 3001 and was deleted afterwards.
- Synthetic accounts: `m3_android_alice` (on the phone), `m3_android_bob`,
  `m3_android_charlie` and `m3_android_dave` (driven through the real HTTP API
  or a desktop browser as the other side), created through the real
  registration endpoints with the email code derived locally from the test
  `AUTH_HMAC_KEYS` root key, the same technique the repository tests use.
- Synthetic media only: generated PNG, a short screen-recorded MP4, small PDF,
  a 24 MiB zip and live microphone recordings. Fixtures lived in a dedicated
  device folder that was deleted at the end.

No secrets, cookies, signed URLs, tokens or real media are recorded here. Raw
screenshots and logs are under the uncommitted `validation-logs/` directory.

## Automated preflight (before any device work)

`npm run test:m3:closure` passed at `305891f3537187eb193fa4b3e0539f9361c400b8`
(`M3_AUTOMATED_CLOSURE_PASS`): migrations 0001 to 0016 with `reserved=0`,
database invariants, PostgreSQL/API/worker integration, MinIO storage
integration, real Chromium 4/4, full `npm run health`, high-severity audit with
0 vulnerabilities, and `git diff --check`.

## Scenario evidence

Times are approximate UTC (device local time is UTC+6). Every scenario ran on
the device above with Chrome 153.0.8010.52.

### Scenario 1: image send and receive

- SHA: `305891f` UTC 09:12 Result: **PASS**
- Picked a synthetic PNG through the real Android document picker. The client
  re-encoded it to WebP, encrypted it and stored a draft; no server row existed
  before send. After Send, the media row was `bound` to a message, role
  `attachment`. The partner (desktop browser) authorized, downloaded, decrypted
  and rendered it.

### Scenario 2: interrupted image upload

- SHA: `305891f` UTC 09:13 Result: **PASS** (defect D1 found)
- The object-store link was cut before the PUT. The upload row stayed
  `uploading`, no message existed. After restoring the link, retry reused the
  same media ID (generation 1 to 2) and produced exactly one message and one
  bound media object.
- D1: after the failure the chip still read "prepared" and the status stayed
  "Sending...". Fixed in `98b4c90`, see scenario 8.

### Scenario 3: short video

- SHA: `305891f` UTC 09:14 Result: **PASS**
- A short MP4 uploaded, bound and played to the end on the phone.

### Scenario 4: general file

- SHA: `305891f` UTC 09:15 Result: **PASS**
- A PDF chosen through the real picker rendered only as a download link. The
  decrypted bytes started with `%PDF`.

### Scenario 5: voice message

- SHA: `305891f` UTC 09:17 Result: **PASS**
- Real microphone recording, preview, discard, re-record, send. One voice media
  row (`webm_opus`, role `voice_message`, position 0) and one message. Play,
  pause and resume worked on the phone and on the partner side.

### Scenario 6: microphone permission denial

- SHA: `305891f` UTC 09:16 Result: **PASS**
- "Never allow" produced "Permission denied", zero media rows, zero drafts and
  zero messages. After resetting the site permission in Chrome and allowing
  it, recording worked.

### Scenario 7: recording background interruption

- SHA: `305891f` then `98b4c90` UTC 09:20 to 09:22 Result: **PASS after fix**
- D2: with `305891f`, pressing Home during a recording left the track live and
  Android reported microphone access still running.
- With `98b4c90`, Home and screen lock stopped the recording immediately,
  released the track, showed "Nothing was saved.", and created no draft or
  server row. If the page is hidden while the permission request is pending,
  Chrome itself denies the request, so no capture starts.

### Scenario 8: connectivity loss during finalize, lost response

- SHA: `98b4c90` UTC 09:23 Result: **PASS**
- The `/complete` response was failed at the network layer after the server had
  committed it. The server row was `ready_unbound`; the client showed a failed
  chip with Retry and an honest message. Retry probed completion, kept
  generation 1 and did not re-upload; one Send then produced one message.

### Scenario 9: local quota failure

- SHA: `98b4c90` UTC 09:24 Result: **PASS**
- A simulated `QuotaExceededError` on the draft store showed an error, created
  no chip and no server row, disabled Send, and left nothing after reload.

### Scenario 10: breakup during upload

- SHA: `98b4c90` UTC 09:24 Result: **PASS**
- A breakup was initiated by the partner while the completion request was
  held. Completion and send succeeded under `breakup_pending`, which the PRD
  allows for chat media. Authority was re-evaluated by the server, not the
  stale client view.

### Scenario 11: account-deletion overlay during upload

- SHA: `98b4c90` UTC 09:34 Result: **PASS**
- The partner requested account deletion while completion was held. Completion
  failed closed (row stayed `uploading`, no message), refresh and new uploads
  returned `ACCOUNT_LOCKED`, and chat showed view-only banners. After the
  partner recovered the account, Retry completed and the send succeeded.

### Scenario 12: final dissolution with bound and partial media

- SHA: `98b4c90` UTC 09:36 Result: **PASS**
- With bound, `ready_unbound` and partial uploads present, a breakup was
  finalized by the real worker. Access to bound and unbound media returned
  404, refresh and new uploads returned `NO_CURRENT_PARTNERSHIP`, object-store
  objects went from 16 to 0 and media rows from 17 to 0. On the phone the
  local media drafts were purged and the UI showed no partnership.

### Scenario 13: previously issued signed URL

- SHA: `98b4c90` UTC 09:36 Result: **PASS**
- Three signed URLs issued before dissolution returned 200 right after it
  (bearer capability within its 60 s TTL, cleanup being asynchronous) and 403
  after 70 s. No new grant was issued after dissolution.

### Scenario 14: later-partnership isolation

- SHA: `98b4c90` UTC 09:38 Result: **PASS**
- A new partnership and a concurrent second partnership were formed. Old media
  IDs returned 404 for both former partners and could not be re-bound. Media
  IDs from one live partnership could not be read or bound by another. Members
  of the owning partnership could read bound media. Random IDs returned the
  same 404. The old partnership ID appeared in zero rows of every phone store.

### Scenario 15: device and session revocation

- SHA: `98b4c90` UTC 09:42 Result: **PASS**
- Revoking the phone's device from another session removed every local
  IndexedDB database (including encrypted drafts), showed the sign-in screen,
  left no media or blob elements, and made media access, refresh-upload and
  upload creation return 401.

### Scenario 16: Voice Letter visibility

- SHA: `98b4c90` UTC 09:26 Result: **PASS**
- A Voice Letter recorded on the phone and attached to a "recipient opens"
  item was bound as `relationship_item` / `voice_letter`. The partner got 404
  for metadata and access while it was locked, the creator could access it,
  and after the partner released the item it decrypted and rendered.

### Scenario 17: service-worker update

- SHA: `98b4c90` UTC 09:28 Result: **PASS**
- The Cache API held only static shell assets: no `/api` response, media
  response or signed URL, before and after use. A staged service-worker update
  with a pending encrypted draft showed the update banner, applied through a
  real tap on "Update and reload", and the draft survived intact. The
  temporary `sw.js` change was reverted.

### Scenario 18: two-tab safety

- SHA: `98b4c90` UTC 09:30 Result: **PASS**
- Tab A was held at a generation 1 refresh while tab B retried fully
  (generation 2, `ready_unbound`). The stale refresh was rejected
  (`MEDIA_NOT_READY`), no state was overwritten server side, both tabs
  converged, and one Send produced one message with the media bound once.
  Observation: the stale tab briefly wrote a `failed` state over its local
  draft record, which self-heals on the next retry through the completion
  probe.

### Scenario 19: whole-object retry identity

- SHA: `98b4c90` UTC 09:33 Result: **PASS**
- A 24 MiB zip (25,165,970 encrypted bytes) chosen through the real picker had
  its PUT failed at the network layer. Retry refreshed the grant (generation 1
  to 2) and the ciphertext digest was identical in the local draft and on the
  server. One media object and one message resulted.

### Scenario 20: provider outage and degraded mode

- SHA: `98b4c90` then `ee59850` UTC 09:40 and 09:50 Result: **PASS after fix**
- With the object store stopped: existing media rendered "Protected media
  unavailable." without claiming deletion, a text message sent normally, and
  a new media send made only a metadata request to the API (about 212 bytes)
  and a direct PUT to the store that failed. No plaintext or ciphertext went
  through the API, no message was created, and the draft stayed failed with
  Retry.
- D3: completion during the outage returned 500 `INTERNAL_ERROR`. Fixed in
  `ee59850` to return 503 `MEDIA_UNAVAILABLE` with the row unchanged and
  retryable, verified again against the outage.

## Supplemental checks

- Size and type: the client rejected a 26 MB zip ("media policy violation")
  and an undecodable PNG. The server rejected zero-byte, kind or format
  mismatch, unknown format, bad digest, an extra filename field, video over
  120 s, voice over 600 s, one byte over each ciphertext cap (image 12 MB,
  file 27 MB, video 52 MB, voice 17 MB) and 11 attachments in one message.
  Original filenames never leave the device. Any string other than `test-*`
  is accepted as a crypto protocol label outside production, which is by
  design until S1 defines the production protocol.
- Deletion: deleting a media message showed the tombstone, removed the row and
  the stored object within seconds, and both members then got 404.
- Offline: with the network emulated offline, a picked attachment stayed a
  local encrypted draft, Send said "Connect before sending" and made no API
  call; after reconnect the send succeeded. Nothing is queued offline for
  media, as designed.
- Playback: voice replay after completion worked; audio kept playing in the
  background per Chrome's media behavior; the media renders coherently after
  Home and return, and after orientation change.
- Rapid record start and stop (four cycles) released every track and created no
  rows.
- Privacy scan: localStorage, sessionStorage, page-readable cookies, Cache API
  and every IndexedDB store had no signed URL or storage endpoint. Browser
  console messages contained no URLs.

## Platform limits and harness notes (not product defects)

- Chrome's DevTools file-input path cannot read non-media files from shared
  storage (NotReadableError), so PDFs and zips were chosen through the real
  Android picker.
- Chrome remembers "Never allow" for the microphone per site until the site
  permission is reset in site settings.
- Established keep-alive connections survive `adb reverse --remove`, so
  interruptions were injected at the request layer where needed.
- A green Android microphone indicator was seen after the microphone tests. It
  persisted after every app tab had been closed and a fresh tab had not
  requested the microphone, and a later access started while the app was
  idle, so it was not attributed to the app under test.
- Orientation was tested by toggling the device's auto-rotate and rotation
  settings, then setting auto-rotate back on.

## Closure

Automated closure re-run after the fixes and the repository state are recorded
in `docs/PROJECT_STATE.md`. M3 source, automated and physical acceptance are
complete. M3 is ready for an explicit merge decision and has not been merged.
