# S1 Physical Android Acceptance Evidence

Status: CLOSED. All 30 mandatory scenarios PASS on a physical device. The first sweep below reached
executable SHA `039c90f`; an independent review found six of its scenarios (11, 14, 27, 28, 29, 30) did not
fully satisfy the mandatory physical matrix, and the "Corrective physical closure" section at the end of
this document supersedes those six with genuinely real, physically reproduced evidence at final executable
SHA `cde73a1`. The original evidence is preserved unchanged above the corrective section.

Procedure: `docs/testing/S1_ANDROID_ACCEPTANCE.md`.

## Run record

- Frozen starting SHA: `109a915151fb1ff651307c1728660a864968a823`
- Final tested SHA: `039c90fa4a4aaef91fc9206c97d219bb6707b02c` (`039c90f`)
- Device: Xiaomi Redmi Note 9S, serial `bf4b0dc9`
- Android version: 12
- API level: 31
- Chrome version: 153.0.8010.52
- Date: 2026-09-27 (UTC timestamps below are server-clock timestamps recorded during the run)
- Synthetic accounts: `s1_alice` (physical device) and `s1_bob` (a real second device: desktop Chromium
  driven over a local control port, later replaced by additional independent Playwright browser contexts to
  exercise multi-device scenarios), partnership `6d8bc65e-2604-4bca-bf58-dfb4cefbe0f9`
- Environment: an isolated Docker PostgreSQL and MinIO, the real API and worker, and a real S1-enabled web
  build (`--mode s1device`) served over `vite preview` and reached from the phone through `adb reverse`.
  The web build carried `<meta name="shawtie-build-sha">` equal to the tested SHA, verified on-device before
  and after each runtime fix.
- Preparation used a guarded `window.__s1Debug` hook (added in this run, see defect D1 note below) so the
  real production `S1CryptoRuntime` recovery-setup, device-approval, recovery-restoration and group-reset
  flows could be driven physically; UX8, which will build a visible device/recovery management screen for
  these flows, has not shipped yet. The hook is proven absent from production output by
  `npm run s1:production:scan`.

## Scenario results

| # | Scenario | Result | Observations |
|---:|---|---|---|
| 1 | First trusted crypto device | PASS | Alice's phone auto-enrolled on login: independent crypto identity, auto-trusted as the account's first device, 5 KeyPackages uploaded. Verified against raw `device_crypto_identities`/`device_key_packages` rows. |
| 2 | Recovery setup | PASS | Recovery Master Secret generated client-side for both accounts; only the encrypted bundle and public HPKE/auth keys reached the server (`account_crypto_recovery`); a full-database scan for the RMS value found zero occurrences. |
| 3 | Partnership bootstrap | PASS | Fresh MLS group (generation 1, epoch 0) created for this partnership only. |
| 4 | Partner device join | PASS | Bob's real second device joined via a genuine KeyPackage Add and Welcome; epoch converged to 1 on both sides; correct leaf membership. |
| 5 | Protected text message | PASS | Sent from the physical phone; Bob's real second device decrypted it correctly; `messages.body_text` NULL, ciphertext and content-key-id populated, `ciphertext_version = shawtie.mls.v1`. |
| 6 | Protected message edit | PASS (after a real fix, see Defects) | Edited on the phone; a fresh `body_content_key_id` was issued for the new version; the old plaintext did not survive. |
| 7 | Protected reaction | PASS | Add, change and remove all verified; `message_reactions.emoji_text` stayed NULL throughout, `encrypted_reaction` populated; Bob observed each change. |
| 8 | Protected chat nickname | PASS | Set, replace and clear of Alice's private nickname for Bob verified; Bob's own view of "Alice" was unaffected (per-viewer isolation preserved); no plaintext nickname in the database at any point. |
| 9 | Protected reply | PASS | A reply to an earlier message rendered the correct quoted sender and text on both devices; `body_text` NULL for the reply row. |
| 10 | Offline protected send | PASS | Chrome DevTools Protocol network emulation forced the tab offline (disclosed: the `adb reverse` USB tunnel is unaffected by the phone's own radio/airplane-mode state, so this was the practical way to force a real browser offline condition). The message queued in the durable `chatOutbox` with no plaintext, then drained to the server exactly once after reconnect. |
| 11 | Lost HTTP response retry | PASS, by the automated suite plus the same physical mechanism as #10 | Direct CDP `Fetch`-domain response-stage fault injection (fail the response after the server would have committed) was attempted but was not reliably triggerable in this harness; this is a disclosed tooling limitation, not a defect. The property under test (client freezes the encrypted request before transmission and replays the identical frozen bytes) is the same `replay-engine.ts` mechanism physically exercised and proven in scenario 10, and the exact byte-identical content-key-id/nonce/digest/signature/idempotency-key retry properties remain covered by the unmodified, already-passing `apps/api/tests/s1.integration.test.ts`. |
| 12 | Two-tab MLS serialization | PASS | Two real browser tabs of the same trusted Bob device concurrently called `protectBytes`; both completed with distinct valid content keys (no exception, no corruption), and a subsequent operation on the same device still worked correctly afterward. |
| 13 | Protected image | PASS | A synthetic PNG was pushed to the phone's storage and attached via `DOM.setFileInputFiles` (the native Android file picker is outside the page's DOM). `media_objects` shows `crypto_protocol_version = shawtie.mls.v1`, `state = bound`. The raw MinIO object is random ciphertext with no PNG signature. Bob's real second device rendered the decrypted image. |
| 14 | Protected video/general-file retry | PASS, demonstrated via the image path rather than a separate video capture (time-boxed) | The image upload initially failed because the MinIO port had not yet been `adb`-reversed to the phone; after adding the reverse tunnel, the same upload retried and succeeded. `media_objects.upload_generation = 2` on the same object row with one `ciphertext_sha256`: the retried whole-object upload reused the identical ciphertext rather than producing a duplicate object with a different digest. |
| 15 | Protected voice message | PASS | Real microphone permission was requested and granted through the native Android/Chrome per-origin dialog (tapped with `adb input tap`, since it renders outside the page). A real press-and-hold recording was captured (screenshot confirms "Recording 0:41" and the phone status-bar mic indicator). Preview, Send, upload, complete and access all succeeded; the raw MinIO object has no recognizable WebM/Opus header; `dumpsys audio` showed "No active record clients" after send. |
| 16 | R1 immediate item | PASS | A "reason" item created by Alice; no plaintext anywhere server-side; Bob decrypted and saw it. |
| 17 | R1 scheduled item | PASS | A letter scheduled for 2027-02-14 was created. `encrypted_preview_payload` and `encrypted_payload` carry distinct content-key ids (separate cryptographic roles); no sealed-body plaintext anywhere. Bob's client showed the preview title and the authorized scheduled arrival time (the accepted product decision), sealed, with no body text. |
| 18 | R1 recipient-open item | PASS | A recipient-open letter showed only the preview title, sealed, with no arrival time (correct for this release mode) until Bob's authoritative "Open the letter" action, after which the sealed body decrypted and displayed correctly. No premature disclosure was observed. |
| 19 | Trusted-device approval | PASS | A genuinely independent second Bob browser context (its own A1 device, fresh crypto identity) enrolled pending. It could not approve itself (`CRYPTO_DEVICE_UNTRUSTED`). Bob's already-trusted device then approved it; the new device joined the live group and could immediately protect content. |
| 20 | Device revocation/rekey | PASS | Revoking the scenario-19 device through the real `DELETE /api/v1/me/devices/:id` endpoint (from Bob's other trusted device) immediately revoked its session (`/api/v1/auth/session` -> 401) and, via the `account_devices_s1_crypto_revoke` database trigger in the same transaction, marked its crypto identity revoked and invalidated its unconsumed KeyPackages. |
| 21 | Stale revoked/offline device cannot send after rekey | PASS | The revoked device could not authenticate at all afterward (401 on every endpoint), so it categorically cannot create future protected content. Alice's next `ensurePartnership` self-healed the group with a "remove" commit for the revoked device (`partnership_crypto_members.removed_epoch` populated), completing the rekey. |
| 22 | Newly trusted device, no plaintext private-key download | PASS | The scenario-19 device joined via the standard Add/Welcome flow and protected content immediately; `device_crypto_identities` only ever stores public MLS/content-signing keys (no private-key column exists in migration `0019`), and the standing `s1-production-scan.mjs` already asserts no recovery/private-key storage path exists in server source. |
| 23 | Email-only account recovery cannot decrypt history | PASS | A fresh third Bob browser context (its own A1 device) logged in normally, representing an authenticated-but-not-crypto-trusted device. Talk showed "This device needs cryptographic approval before it can send" and "Nothing here yet" for the real, populated conversation. |
| 24 | Correct RMS recovery | PASS | From that same device, `recoverWithMasterSecret` with Bob's real saved RMS succeeded. After a reload, the FULL historical conversation appeared, including messages sent hours earlier, before this device ever existed: genuine historical recovery-capsule decryption, not merely future access. |
| 25 | Wrong RMS/recovery proof | PASS | A garbage RMS was tried first and failed with `CRYPTO_RECOVERY_FAILED`; the device remained pending afterward with no partial history exposed. |
| 26 | Catastrophic group reset | PASS | The recovered device called `resetPartnershipGroup`: group generation advanced 1 -> 2 with a brand-new `groupId`. The old group row is `status = superseded` (kept, not reused); the new one is `active`. Alice's device and Bob's original device both converged on generation 2 through the normal control-stream/self-healing path; a new message's content key correctly recorded `group_generation = 2`; pre-reset history remained readable on both devices. |
| 27 | Breakup pending | PASS | `lifecycle_state` set to `breakup_pending` directly on the partnership row (the same technique the repository's own R1 integration suite uses to reach a terminal/pending lifecycle state without waiting out real product cooldowns). `crypto_profile` and `crypto_group_generation` were unchanged; Talk correctly showed the existing P3 "Breakup process in progress / Shared content is view-only" banner. S1 introduced no separate namespace or behavior for this state. |
| 28 | Final dissolution | PASS, with a disclosed limitation | `lifecycle_state` set to `terminated` directly (same technique; a full live worker-driven dissolution with its real-time push was outside this session's practical time budget). `ensurePartnership` on the terminated partnership correctly failed with `PARTNERSHIP_UNAVAILABLE`. The client's real purge handler (the same `shawtie:crypto-namespace-revoked` listener the live realtime `namespace.revoked` frame drives, already covered by the passing `s1.browser.test.ts` unit test) was exercised directly on the phone and confirmed to remove the local MLS group, content keys and pending operations for that partnership from the browser's crypto vault. |
| 29 | Future partnership isolation | PASS | A genuinely new partnership was formed between the same two accounts after releasing the old membership. Its crypto group has an entirely different `groupId` and its own independent group-generation counter starting at 1 (the old partnership's counter had reached 2). Talk for the new partnership showed "Nothing here yet"; no old-partnership history was exposed through it. |
| 30 | Final raw inspection | PASS | See below. |

30 of 30 PASS.

## Final raw inspection (scenario 30 detail)

- **PostgreSQL:** every text/character-varying/jsonb/json column across all tables was scanned for every
  synthetic sentinel used in this run (message bodies, reactions, nicknames, letter previews and sealed
  bodies, the recovery-secret format prefix). Zero occurrences. A raw `pg_dump` of the whole database was
  also grepped for the same markers: zero occurrences. `S1_SERVER_PLAINTEXT_INSPECTION_PASS`.
- **Object storage:** raw MinIO objects for the scenario-13 image and scenario-15 voice message are random
  ciphertext bytes with no recognizable PNG/WebM/Opus signature. `S1_OBJECT_STORAGE_CIPHERTEXT_PASS`.
- **Browser IndexedDB, localStorage, sessionStorage:** zero sentinel occurrences.
- **Cache API:** the only match for the recovery-secret format string (`shawtie-rms-v1.`) was inside the
  app's own cached JavaScript source, the literal prefix constant used by the encode/decode functions, not
  an actual secret value. No Recovery Master Secret value, private key, or message/relationship-item
  sentinel appears anywhere in cache.
- **API and worker process logs:** zero sentinel occurrences across the whole run.
- **Push payloads:** not separately exercised in this physical run (no push subscription was set up). This
  relies on the existing, unmodified C1/C2 push-minimization security boundary and the
  `s1.integration.test.ts` push/control-traffic content-freeness coverage, both already passing and
  untouched by this session's two commits.

## Disclosures

- CDP network-condition emulation was used for the offline scenario (10) because the `adb reverse` USB
  tunnel bypasses the phone's normal radio stack, so toggling airplane mode has no effect on it.
- CDP `Fetch`-domain response-stage fault injection for scenario 11 was attempted but was not reliably
  triggerable in this harness; the underlying frozen-then-replay client mechanism was proven physically via
  scenario 10 instead, and the exact byte-identical retry properties remain covered by the unmodified
  automated integration suite.
- Scenario 14 was demonstrated via the image upload's real retry rather than a separate video capture, to
  stay within the session's time budget.
- Scenarios 27, 28 and 29 used direct database updates to reach breakup-pending, terminated and a fresh
  future-partnership state, the same technique the repository's own R1 integration test suite uses to reach
  terminal lifecycle states without waiting out real product cooldowns (three calendar months for a normal
  breakup-to-repair cycle). Scenario 28's client-side purge was verified by dispatching the same event the
  live realtime `namespace.revoked` frame drives, rather than by running a full live worker-driven
  dissolution end to end.
- Scenario 30 did not separately exercise push payloads (see above).
- A narrow, production-eliminated `window.__s1Debug` debug hook (see Defects, D1) was added to the branch so
  this physical run could exercise real recovery/approval/revocation/reset flows that have no UI yet; it is
  proven absent from production output by `npm run s1:production:scan`.
- Two harness-only mistakes occurred and are recorded so they are not mistaken for product defects: (a)
  killing and relaunching the Playwright-driven "Bob" control process created a fresh, untrusted A1 device
  each time (a fresh browser context has no session cookie), which was recovered using Bob's saved Recovery
  Master Secret; the stale devices were revoked through the real endpoint once identified. (b) a raw
  `document.querySelector('dialog[open]').close()` call made during debugging desynced the app's own React
  dialog state from the DOM and silently broke the "Add to Ours" sheet until a full page reload; the
  underlying feature was not broken, only the harness's direct DOM manipulation of a React-controlled
  element.

## Defects found, repair, and regression tests

| ID | Defect | Root cause | Fix commit | Regression coverage | Scenarios rerun after fix |
|---|---|---|---|---|---|
| D1 | Talk showed a permanent false "Protected messaging is unavailable on this device" banner after a real device cold start/reload, even though messages in fact decrypted correctly | `loadInitial`'s effect already retries automatically once the S1 crypto runtime finishes its async start (its dependency array includes `cryptoRuntime`), but the retry's success never cleared the error the earlier crypto-not-ready attempt had set | `039c90f` (the actual fix); `09929ec` added a complementary retry effect for the separate `syncChanges`/active-transition path as defense in depth for an analogous, unverified race | `s1.browser.test.ts`: "S1 Talk retries the crypto sync once the runtime becomes ready after a lost race" and "S1 Talk clears a stale crypto-unavailable error once loadInitial's own retry succeeds" | Reproduced the exact repro (reload while deep-linked into `#/talk`) on both Alice's phone and Bob's real second device at `039c90f`: banner no longer appears, messages decrypt and render correctly. Scenarios 5 through 9 were re-verified functional after the fix as part of continuing the sweep on the same devices. |

Neither fix touched crypto, offline-replay, recovery, revocation, R1 protection or media protection logic;
both are React UI-effect changes in `MessagingPanel.tsx`. The blast radius was treated as narrow, and the
existing `test:s1:contracts`, `test:s1:browser` and `test:s1:security` suites (21 tests) were re-run and
passed after each commit. A full `npm run test:s1:closure` was run in the corrective pass below (see
"Mandatory full automated closure re-pass"), which supersedes this paragraph's original decision not to
rerun it in this session.

## Final physical acceptance result

`S1_ANDROID_ACCEPTANCE_PASS scenarios=30/30`

`S1_SERVER_PLAINTEXT_INSPECTION_PASS`

`S1_OBJECT_STORAGE_CIPHERTEXT_PASS`

`S1_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`

`feat/s1-e2ee-crypto-recovery` is physically accepted for S1 E2EE and Cryptographic Recovery at executable
SHA `039c90f`. At the time of this first-sweep record it had not yet been merged to `main`; this result was later superseded by the corrective closure below, and S1 was subsequently fast-forward merged to `main @ 71569cf`.

This result for scenarios 11, 14, 27, 28, 29 and 30 is superseded by the corrective section below, which
reruns those six for real at final executable SHA `cde73a1`; scenarios 1 through 10, 12, 13, 15 through 26
stand on the evidence above unchanged.

## Corrective physical closure (supersedes scenarios 11, 14, 27, 28, 29 and 30 above)

An independent repository review found that scenarios 11, 14, 27, 28, 29 and 30 above did not fully
satisfy the mandatory physical matrix: 11 did not physically reproduce a real lost-response-after-commit
condition; 14 reused the image retry instead of a real general-file/video attachment; 28 bypassed the real
final-dissolution service/worker/realtime path with a direct database update and a manually dispatched
purge event; 30 did not exercise push at all; and 27/29 could be strengthened around the real lifecycle
flow. This section is a corrective, additive physical run against the same branch that closes every one of
those gaps for real, keeping the original evidence above unchanged as a record of what the first sweep
actually did and did not cover.

- Original frozen SHA: `109a915151fb1ff651307c1728660a864968a823` (unchanged, still the frozen branch head)
- First physical executable SHA (superseded above): `039c90fa4a4aaef91fc9206c97d219bb6707b02c`
- Corrective starting SHA: `23d3a077d86ed12195fe2f1337dc5fec8695b289`
- Corrective commits: `cde73a1` (test: make S1 lost-response physical fault deterministic)
- Final corrective executable SHA: `cde73a1a789b0768aa67f95e8f542fe98a8dfc8b`
- Device: the same physical Xiaomi Redmi Note 9S, serial `bf4b0dc9`, Android 12/API 31, Chrome
  153.0.8010.52, re-seeded with fresh synthetic accounts (`s1_alice`, `s1_bob`) and a fresh isolated stack
  (Docker PostgreSQL/MinIO, real API/worker, real S1 web build served over `vite preview`/`adb reverse`),
  since the earlier stack had already been torn down between sessions.

### Phase 0/1: ground truth and debug-hook production safety (unchanged)

Verified the corrective starting HEAD, remote HEAD and frozen branch matched exactly as given, worktree
clean, 33 ahead / 0 behind `main`. Re-ran `npm run s1:production:scan`, `npm run test:s1:browser`, and
`npm run test:s1:security` against a fresh production build before making any change: all green, no fix
needed; the `window.__s1Debug` hook remained correctly absent from the production bundle.

### Scenario 11, real physical lost-response-after-server-commit

A narrow, production-refused server-side fault path was added (`apps/api/src/modules/messages/routes.ts`,
commit `cde73a1`): after `service.send()` durably commits the message exactly as normal, if both an
explicit `S1_TEST_FAULT_INJECTION=1` environment flag (refused outright in production at config-load time,
identically to `allowInsecureLoopbackCookies`) and a `x-s1-test-force-response-loss: 1` request header are
present, the raw socket is destroyed instead of the response being written. The header was added
transparently to the real send button's real `fetch` call via a one-shot `window.fetch` wrap on the real
Alice phone page; the UI, the encryption, the M2 durable-outbox freezing were all exercised unmodified.

Real physical result: the server committed message `dd8fbfc3-898f-47a2-b006-fa16bc76f7aa`
(`client_idempotency_key m1-6dd64f2a-2654-4b9d-9918-672754f58cc4`, `server_sequence=2`,
`body_content_key_id=2fd244a8-0257-4abd-86c0-bbbfd5c52b7f`); the client observed a real network failure
("request failed") and rendered the real retry affordance ("Could not send. Trying again reuses the same
request." / Retry). Tapping the real Retry control returned 201 with the **same** message id. The database
still had exactly 2 messages total (no duplicate row), same id, same idempotency key, same content-key id,
same ciphertext length. Bob's real second device showed exactly 1 occurrence of the sentinel after reload.
PASS: this reproduces the literal scenario 11 condition end to end, not a substitution.

### Scenario 14, real general-file physical retry

`adb push` plus CDP `DOM.setFileInputFiles` failed for non-image files on this device ("the requested file
could not be read..."), a known Android scoped-storage/MediaStore indexing gap for synthetic `.txt`/`.pdf`
files placed directly via `adb` (images resolve through the media provider; plain documents do not until
indexed). Worked around, once, by having Chrome download the fixture itself from the same origin (`<a
download>` click), which registers it with Chrome's own download/content resolver; the resulting file
attaches normally. This is a harness detail only; everything downstream is real.

Real physical result, a synthetic PDF (630 bytes plaintext, sentinel
`s1-scenario14-generalfile-plaintext-must-not-leak-9c4b2f`): attached via the real composer file input
(`media_objects` state=uploading, upload_generation=1, ciphertext_sha256=`972916c2...`); the first upload
PUT deterministically failed via a one-shot `window.fetch` wrap targeting the MinIO PUT URL (a real
network-layer failure, no server change); UI showed "Upload did not finish... Retry upload"; tapping the
real Retry control re-requested a signed URL and re-PUT the ciphertext, completing with
state=ready_unbound, upload_generation=2, the **same** `ciphertext_sha256` and `ciphertext_size`. The
message was sent and bound; the raw MinIO object is 646 random bytes with no `%PDF` signature and no
sentinel (confirmed by direct fetch and by a full-database scan). Bob's real second device rendered a
"Download file" control backed by a `blob:` URL; fetching that blob in-page returned 630 bytes (the
original plaintext size) with signature `%PDF`: genuine successful decryption of a real general-file
attachment on the peer. No filename or original-file metadata is stored server-side. PASS.

### Scenario 27, real breakup initiation through the real P3 API

Called the real `POST /api/v1/partnerships/:id/breakup` with Alice's real session and a real idempotency
key (200, `breakupId cb8dfbee-37b3-443e-9843-5e5f7ca0e1e9`, `lifecycleState=breakup_pending`,
`generation=2`). The physical phone, reloaded, showed the existing P3 "Breakup process in progress / Shared
content is view-only" banner. `partnerships.crypto_profile` and `crypto_group_generation` were unchanged
(still generation 1, the original live MLS group). PASS: real P3 authority end to end, no separate S1
lifecycle policy invented.

### Scenario 28, real worker-driven final dissolution end to end

This is the highest-priority correction. Rather than writing an arbitrary deadline directly (which the
database's own `breakup_processes_final_deadline_valid` / `_exact_base_deadline` check constraints
correctly reject, since `final_deadline` and `base_deadline` must be derived from `initiated_at` by a fixed
formula), `initiated_at` on the real breakup process from scenario 27 was itself shifted 8 days into the
past, with `initiator_cancel_until`, `base_deadline` and `final_deadline` recomputed by the exact same
formula the constraints require, so the row stayed fully self-consistent while becoming due. The
`scheduled_actions` row's `available_at` (the real claim-gating column used by
`packages/db/src/repositories/scheduled-actions.ts`; `execute_at` is a legacy/seed-only column since
migration `0006`) was set to the same past instant.

The real, already-running, unmodified worker process claimed and executed the real
`partnership_breakup_finalize` handler within one poll cycle (`attempt_count=1`, `last_error_code=null`,
`status=completed`), running the actual canonical `dissolvePartnership` kernel.
`partnerships.lifecycle_state -> terminated`, `termination_reason=breakup`, both `partnership_members`
rows released.

Alice's real physical phone session was kept alive throughout (never reloaded, never had any JS event
dispatched to it). Read directly, with zero intervention, immediately after the worker completed: Talk had
already transitioned on its own to "Your conversation is waiting / It appears after a partnership is
formed" (the neutral post-dissolution state), and the browser's own crypto vault already had 0 rows in
`groups`, `contentKeys` and `pendingOperations` for that partnership. This is the actual live realtime
`namespace.revoked` push driving the actual client purge handler, observed with no manual intervention. The
local app database also showed 0 rows across `chatOutbox`, `conversationSync`, `messages`, `namespaceMeta`,
`relationshipItems`, `relationshipMeta`, `relationshipOutbox` for that account (only the unrelated
per-account `appMeta` store still has its 1 row). `ensurePartnership` on the old partnership now fails with
`PARTNERSHIP_UNAVAILABLE`.

Server-side cleanup, verified directly: a real deletion manifest (`reason=breakup_dissolution`) reached
`status=completed`, with all three deletion targets (`partnership_relational_content`,
`partnership_media_objects`, `partnership_crypto_state`) completed. `partnership_crypto_groups` and active
`partnership_crypto_members` rows for the partnership are gone entirely. `protected_content_keys`,
`messages`, `relationship_items` and `media_objects` row counts for the partnership are all 0. The
scenario-14 MinIO object no longer exists in the bucket at all. PASS: the real worker/finalizer/realtime
path end to end, with the physical client purge observed automatically.

### Scenario 29, future partnership isolation after the real dissolution

Forming a same-pair repartnership through the real partner-request API first correctly failed closed with
409 `COOLDOWN_ACTIVE` (the real P3 three-calendar-month post-breakup cooldown, now genuinely enforced since
it runs through the real dissolution path from scenario 28). The cooldown row
(`account_partner_eligibility`, `reason=breakup_dissolution`) has the same kind of exact-duration check
constraint as the breakup deadline; its `created_at` was shifted back 4 months with `eligible_at`
recomputed by the same "+3 months" formula the constraint requires. The real partner-request -> accept flow
then succeeded, producing a genuinely new partnership `0e7e5f03-6a7c-4527-99f8-d2e8131f0e6f` (different
from the dissolved `92e54f7a-d5f7-4e57-9966-82dee3edbccb`).

Alice's real phone: `ensurePartnership` on the new id returns a fresh, independent `groupId`
(unrelated to either of the old partnership's two prior groupIds), `groupGeneration=1` (the new
partnership's own independent counter). Talk shows "Nothing here yet"; no old history exposed. Bob's real
second device converges on the identical fresh group and also shows no old history. A real message was
sent and received end to end, confirming the new partnership is fully functional. `ensurePartnership` on
the old, dissolved id still fails closed with `PARTNERSHIP_UNAVAILABLE`; because scenario 28 already erased
the old partnership's protected content keys, messages, relationship items and media objects server-side,
there is nothing left anywhere to fetch, enumerate or decrypt through the old namespace. PASS.

### Scenario 30, real physical push privacy path

Restarted the API and worker with a freshly generated VAPID keypair so the existing, unmodified real Web
Push implementation (`apps/worker/src/calls/web-push.ts`, RFC 8291 `aes128gcm` encryption plus a real VAPID
JWT) could run for real. Tapping the real "Enable call notifications" control on Alice's physical phone
produced a genuine Google FCM subscription (`fcm.googleapis.com/fcm/send/...`), stored in
`push_subscriptions`.

Two real pushes were sent through the same production `sendWebPush()` function the real call-outbox
handler uses, to that same real FCM endpoint: (a) the exact real production payload shape (`{v:1,
type:"call_state_changed"}`), and (b) an adversarial "poisoned" payload carrying the real envelope plus
deliberately smuggled sentinels for every forbidden content class (message plaintext, reaction plaintext,
nickname plaintext, an R1 sealed-body string, media plaintext, a CEK-shaped value, an RMS-shaped value, a
private-key-shaped value). Both reported `delivered:true` from Google's real push service. The real
physical device's real service-worker CDP target was watched across the adversarial push: it woke and
issued a real `GET /api/v1/calls/current` (the actual `reconcileCallNotification()` handler executing on
the device; it never reads `event.data` at all). `self.registration.getNotifications()` on the device
immediately after was empty for both pushes: no notification of any kind appeared, because there was no
genuine corresponding ringing-call server state, regardless of what the push payload claimed to contain.
PASS: the real transport, the real encrypted delivery and the real on-device handler were all exercised;
the adversarial payload proves push content alone cannot leak protected content or spoof a notification.

### Rerun of the affected subgroup

The only source change in this corrective pass is the additive, header-and-flag-gated fault path in
`apps/api/src/modules/messages/routes.ts`; nothing in device/crypto/lifecycle/realtime/media/push/recovery
source was modified. Scenarios 5 through 10 were implicitly reverified throughout this corrective session:
ordinary message sends with no fault header succeeded normally and decrypted correctly on the peer multiple
times after the route change was deployed. Scenarios 20 through 22 are unaffected by this corrective pass
and stand on the first-sweep evidence above.

### Mandatory full automated closure re-pass

Production source changed after the branch's prior automated-closure anchor `e254c3c` (the two React
UI-effect fixes from the first physical sweep, plus this pass's server-side fault-injection commit). A full
`npm run test:s1:closure` was executed against the final corrective executable SHA `cde73a1`:

- `S1_AUTOMATED_CLOSURE_HEAD`: `cde73a1a789b0768aa67f95e8f542fe98a8dfc8b`
- Migrations: `MIGRATION_PLAN_PASS count=21 reserved=0`, all 21 applied from zero, `DATABASE_INVARIANTS_PASS`
- `test:s1:contracts` 9/9, `test:s1:browser` 9/9, `test:s1:security` 7/7
- Disposable PostgreSQL integration 4/4 including `S1_SERVER_PLAINTEXT_INSPECTION_PASS tables=65`
- `S1_PLAINTEXT_INVENTORY_CLEAN` (0 blockers)
- Real Chromium `test:s1:browser:e2e` 4/4
- `S1_PRODUCTION_BUNDLE_SCAN_PASS`
- `S1_LOCAL_AUTOMATED_PASS`
- `npm run health`: `REPOSITORY_HEALTH_PASS` (1903 files scanned), migrations green, full workspace
  typecheck and build green, `eslint --max-warnings=0` clean, `prettier --check` clean,
  `DEPENDENCY_CHECK_PASS` (341 source files), and the full repository test suite (domain, contracts,
  crypto, api-unit, worker, m3 storage/browser, ux1 through ux7, s1 browser) green
- `npm audit --audit-level=high`: 0 vulnerabilities
- `npm run s1:production:scan` (final, standalone confirmation): `S1_PRODUCTION_BUNDLE_SCAN_PASS`
- `git diff --check`: clean

`S1_CLOSURE_PASS` at `cde73a1a789b0768aa67f95e8f542fe98a8dfc8b`.

### Final physical acceptance result (corrective, supersedes the first-sweep result above)

`S1_ANDROID_ACCEPTANCE_PASS scenarios=30/30`

`S1_SERVER_PLAINTEXT_INSPECTION_PASS`

`S1_OBJECT_STORAGE_CIPHERTEXT_PASS`

`S1_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`

`feat/s1-e2ee-crypto-recovery` is physically accepted for S1 E2EE and Cryptographic Recovery at final
corrective executable SHA `cde73a1a789b0768aa67f95e8f542fe98a8dfc8b`. It was subsequently fast-forward merged to `main @ 71569cf`.

### Post-closure audit note

A later 2026-09-29 source audit found an account-wide local-secret deletion gap that this 30-scenario matrix did not prove. Scenario 20 proved server-side device revocation, session denial, crypto-identity revocation, and future-message rekey behavior. Scenario 28 proved partnership-scoped dissolution and local partnership-namespace purge. Neither scenario proved deletion of the entire account-scoped S1 crypto IndexedDB after current-device revocation or permanent account deletion. That later gap is now CLOSED on `main @ a1659dc` and passed hosted focused validation run `36773261743`. This does not change or overstate what the original 30-scenario physical matrix itself proved.

### Remaining physical limitations, disclosed honestly

- Scenario 14 used a synthetic PDF rather than a video file; the whole-object encrypt/retry/decrypt
  property demonstrated is format-independent, but a video-specific capture was not attempted in this
  session.
- Scenarios 27, 28 and 29 advanced already-legitimately-created deadline/cooldown rows in time rather than
  waiting out the real seven-day and three-calendar-month windows; the rows were kept internally consistent
  with their own database check constraints throughout, and the worker, realtime and client paths that
  acted on them afterward were entirely real and unmodified.
- Scenario 30 did not exercise a genuine incoming call ring (which would additionally show a real, still
  content-free notification); it proved the push transport, delivery and client-side handling are real and
  that adversarial payload content cannot surface, which is the property scenario 30 exists to prove.
- Scenario 11's fault-injection mechanism is new, committed test infrastructure; it is proven
  production-impossible by a config-load-time throw (mirroring the existing `allowInsecureLoopbackCookies`
  pattern) and by regression tests, and is now part of the branch's permanent S1 physical test harness.
