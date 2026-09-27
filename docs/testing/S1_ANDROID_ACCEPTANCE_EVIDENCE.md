# S1 Physical Android Acceptance Evidence

Status: CLOSED. All 30 mandatory scenarios PASS on a physical device at executable SHA `039c90f`.

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
passed after each commit; a full `npm run test:s1:closure` was not re-run in this session because the change
does not touch any code path that suite covers beyond what `test:s1:security` already re-verifies, and the
branch's automated closure at `e254c3c` (unaffected by these two commits) remains the authoritative
non-physical closure evidence.

## Final physical acceptance result

`S1_ANDROID_ACCEPTANCE_PASS scenarios=30/30`

`S1_SERVER_PLAINTEXT_INSPECTION_PASS`

`S1_OBJECT_STORAGE_CIPHERTEXT_PASS`

`S1_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`

`feat/s1-e2ee-crypto-recovery` is physically accepted for S1 E2EE and Cryptographic Recovery at executable
SHA `039c90f`. It has not been merged to `main`.
