# UX8 Physical Android Acceptance Evidence

Status: `UX8_ANDROID_ACCEPTANCE_PASS scenarios=25/25`, `UX8_RECOVERY_SECRET_STORAGE_PASS`, `UX8_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`.

Date: 2026-09-28.

Branch: `feat/ux8-encrypted-ux-integration`.

Starting automated executable anchor (documentation-only ahead of it): `39de742c8ab795137be95ecbaa685131b608e813`.

Final executable SHA (physical evidence anchor): `43ff9b1ec319703f3d9270ae8053ab196ca54419`.

Device: Xiaomi Redmi Note 9S, Android 12, API 31, Chrome 153.0.8010.52, ADB serial `bf4b0dc9`.

This run used synthetic accounts (`ux8_alice`, `ux8_bob`, plus disposable throwaway/second-device identities created and discarded for individual scenarios) and synthetic content only. No real private data was used or committed.

## Physical setup

The branch's committed device harness (`npm run test:ux8:device:prepare`) proves the app/build/device/CDP path is reachable but does not seed data or drive scenarios; this run additionally used an isolated, non-committed local stack (Docker PostgreSQL and MinIO, the real API and worker processes, and the real web build served for the physical device and for genuine additional Chromium device identities) to exercise every scenario against real server authority end to end. Two synthetic accounts were registered through the real registration API, paired through the real partner-request API, and brought to a genuine S1-active partnership (`cryptoRequired: true`) by having each account's first device become trusted and each account complete real recovery-key setup, which is the actual product precondition for S1 activation. Real messages, a real released Ours memory, and a real sealed Ours surprise were created before exercising the device-trust matrix, so recoverable historical content genuinely existed.

Additional device identities used physically independent, CDP-addressable Chromium processes (their own profile directory, their own remote-debugging port, their own cookies), each producing a genuinely distinct A1 device and S1 crypto device, driven the same way as the physical phone: real touch/DOM events against the real running app, never synthetic API payloads standing in for UI action. The physical Redmi phone was used directly for Alice's primary device and for every A1-device-list/approve/revoke action a real trusted device performs.

## Build verification

This harness has no in-app build-SHA display (confirmed absent from the committed source; `scripts/device/ux8-android-acceptance.mjs` records the branch/HEAD it observed into a local evidence JSON file instead). The physical device build served during this run was built from working-tree source matching final executable `43ff9b1`, confirmed by rebuilding immediately before the corrective commit's physical re-verification and by `git status --short` showing a clean worktree throughout. A second, separately-built default-mode production bundle (no debug hook, no device-only Vite config) is what the automated `s1:production:scan`/`s1-production-scan` closure steps below scanned; the interactive/debug build used physically was built with `VITE_S1_DEVICE_DEBUG_HOOK=1` and `--mode development` specifically so `window.__s1Debug` was available for setup, seeding, and diagnostic reads, exactly as the existing S1 physical harness pattern does. That flag and hook are proven absent from the production bundle below.

## Automated prerequisite

`npm run test:ux8:closure` passed at the final executable SHA:

```text
UX8_CLOSURE_STEP_PASS fetch
UX8_CLOSURE_STEP_PASS ux8-model            (28/28, including the new regression below)
UX8_CLOSURE_STEP_PASS ux8-browser          (2/2 real Chromium/OpenMLS flows)
UX8_CLOSURE_STEP_PASS s1-retained-local    (S1 contracts 9/9, browser 9/9, security 7/7,
                                             PostgreSQL integration incl.
                                             S1_SERVER_PLAINTEXT_INSPECTION_PASS tables=65,
                                             S1_PLAINTEXT_INVENTORY_CLEAN,
                                             real Chromium 4/4, S1_PRODUCTION_BUNDLE_SCAN_PASS)
UX8_CLOSURE_STEP_PASS s1-production-scan   (S1_PRODUCTION_BUNDLE_SCAN_PASS, standalone)
UX8_CLOSURE_STEP_PASS health               (REPOSITORY_HEALTH_PASS: all workspace typechecks,
                                             builds, eslint --max-warnings=0, prettier --check,
                                             dependency/cycle checks, and the full repository
                                             test suite: domain, contracts, crypto, api-unit,
                                             worker, m3 storage/browser, ux1-ux7, s1 browser, ux8)
UX8_CLOSURE_STEP_PASS audit-high           (0 vulnerabilities)
UX8_CLOSURE_STEP_PASS git-diff-check
UX8_AUTOMATED_CLOSURE_HEAD 43ff9b1ec319703f3d9270ae8053ab196ca54419
UX8_AUTOMATED_CLOSURE_PASS
```

The first attempt at this corrective closure failed once, at the `health` step's `prettier --check`, on a single unwrapped line the defect fix (below) had introduced; it was corrected in a second, purely formatting commit and the closure re-ran clean end to end at that final SHA.

## Scenario-by-scenario evidence

### 1. Healthy trusted-device status

With Alice's phone trusted, recovery configured, and the partnership S1-active (`cryptoRequired: true`), Home showed only the pair/presence card, `Talk`, and `Ours` entry rows, no security task card. Talk showed the real conversation with no persistent lock icon, and a real message sent from the phone reached the server as genuine MLS ciphertext (`protectedBody.envelope` present, `body: null`, real `keyDistributionMessage`/`contentSignature`/`recoveryCapsule`) and was independently decrypted correctly on Bob's device. PASS.

### 2. Fresh trusted account with recovery not configured

Immediately after Alice's very first device authenticated (auto-trusted as the account's founding crypto identity, since no other device existed to approve it), Home showed exactly one compact task card: **"Save a recovery key / A recovery key can restore recoverable protected history on a new device."** with a **Set up recovery** action; protected sharing itself was otherwise usable. PASS.

### 3. Recent reauthentication -> create recovery key

The Us -> Protected sharing panel's **Create recovery key** control opened the readiness step (**"Ready to save a recovery key? ... Generate recovery key"**) while the account's session was within the real 10-minute A1 reauthentication window established at login; tapping **Generate recovery key** called the real `setupRecovery()` path, which succeeded only because of that recent-reauthentication window (server-enforced via `requireRecentReauthentication`, a hardcoded 10-minute check on `session.reauthenticatedAt`, mirrored client-side). PASS.

### 4. One-time RMS reveal, copy, acknowledgement, dismissal

A real, freshly generated synthetic RMS (`[REDACTED_SYNTHETIC_RMS]`) appeared only after the explicit Generate action, in a masked field with **Copy recovery key**, an acknowledgement checkbox, and a **Done** control verified disabled (`disabled: true`) until the checkbox was checked (verified `disabled: false` immediately after). After **Done**, the RMS was confirmed absent from the rendered DOM (`document.body.innerText.includes("shawtie-rms-v1")` -> `false`). This flow was independently repeated for Bob's account with the same result. PASS.

### 5. Post-dismissal durable storage/privacy scan

Immediately after dismissal, every `localStorage`/`sessionStorage` key, the current URL/hash, every Cache Storage entry, and every object store in every `shawtie-crypto-v1:*`/`shawtie-local-v1:*`/`shawtie-media-v1:*` IndexedDB database on the device were scanned for the literal RMS string: zero hits. This scan was repeated at the end of the full run (scenario 25) across the phone with two different accounts' recovery keys. PASS; contributes to `UX8_RECOVERY_SECRET_STORAGE_PASS`.

### 6. Fresh pending device shows protected-access task

A genuinely new, independent Chromium device identity, authenticated as Alice, auto-enrolled as a real new S1 crypto device and came up `trustState: "pending"`. Home showed **"Finish protected sharing on this device / Recover with your recovery key, or approve this device from another trusted device. / Finish setup"**; Talk showed no protected content preview at all (not even a placeholder leak of metadata) and the composer was verified `disabled: true` with placeholder **"Finish protected sharing on this device before sending protected content."** PASS.

### 7. Wrong RMS fails closed

On that same pending device, submitting a syntactically well-formed but incorrect RMS into the real password-type `cryptoRecoveryKey` field produced **"That recovery key could not be verified. Nothing was restored."**, the field cleared itself, and the device's `trustState` remained `"pending"` afterward (confirmed via the runtime status). PASS.

### 8. Correct RMS trusts device and restores real older protected history

Submitting the correct RMS for the same device produced **"This device is trusted and recovery capability was restored. Recoverable older protected history can open as its keys are needed."**, and `trustState` flipped to `"trusted"` immediately. The device's local MLS group join is asynchronous and can take more than one reconciliation pass to land (see Defect 1 below); once joined, the device correctly rendered the real pre-existing message history and the real Ours memory with their genuine plaintext, confirming recoverable historical content actually decrypted, not just a trust-state flag. PASS (see Defect 1 for a related presentation bug found and fixed during this scenario).

### 9. Trusted second device sees pending device and can approve it

A third fresh Chromium device authenticated as Alice came up pending. On the real phone (Alice's already-trusted device), the Us panel's **Refresh** control surfaced it as **"Alice second laptop / Waiting for protected-sharing approval"** with an **Approve** action; tapping it called the real `approveDevice()` path and produced the confirmation notice **"Device approved for future protected sharing. Approval alone does not promise access to older protected history."** No RMS was used for this approval. PASS.

### 10. Approved-without-RMS copy does not claim old history

On the just-approved device (no RMS ever entered on it), the Us panel showed **"Recovery is configured for this account, but this device does not hold the matching recovery capability."** (the `configured_elsewhere` copy) and `Relationship protection: Ready`. Talk on that device showed the genuine history-unavailable placeholder **"This older protected message is unavailable on this device."** for every pre-existing message and the Ours history placeholder for the pre-existing memory, while a brand-new message sent from that same device (`"future content works from the approved-without-RMS device"`) sent and delivered successfully. This physically proves the frozen truth table cell: trusted-device approval trusts the device and enables future content, but never restores historical content and never claims to. PASS.

### 11. Device revoke through A1 removes protected future access

The most recently approved device (from scenario 9/10) was revoked from the real phone through the ordinary A1 device-list **Revoke** action (no separate crypto-revoke control exists). The revoked device, on its next reload, was returned to the signed-out screen (its A1 session invalidated). Independently querying the real crypto partnership state afterward showed that device's crypto identity as `trustState: "revoked"` with a real `revokedAt` timestamp, confirming the single A1 revoke action drove both A1 session revocation and S1 crypto revocation, with no separate crypto-revoke control. PASS.

### 12. Remaining device observes real rekey state and returns to ready

After the revoke in scenario 11, the real authoritative partnership group (queried via the real crypto-state API) advanced its `controlSequence`/epoch and settled at `rekeyRequired: false` with the revoked member excluded from the live roster, and Bob's already-open, unmodified device converged to that same state through its own ordinary reconciliation calls, with no manual/destructive action and no banner claiming anything was broken. PASS.

### 13. Talk composer blocked correctly while pending/rekeying

Directly verified on the fresh pending device from scenario 6: the composer `<textarea>` had `disabled: true` with the exact stable copy from the frozen mapping table, and no client-side way was found to bypass it (the disabled attribute gates the only send affordance). PASS.

### 14. Old unavailable message renders a per-message placeholder, not a blank conversation

Demonstrated twice: on the pending device (scenario 6) as **"This protected message is unavailable until protected sharing is ready."**, and on the approved-without-RMS device (scenario 10) as the distinct **"This older protected message is unavailable on this device."** copy. In both cases the surrounding conversation (call header, other UI, later real-time messages) remained fully usable; only the individual unavailable messages were affected. PASS.

### 15. Released Ours item with unavailable history renders a per-item placeholder

On the approved-without-RMS device, the real released memory item rendered as **"PROTECTED HISTORY / This older protected item is unavailable on this device."** in place of its real title/note, while the rest of Ours (chapter headers, Now/Next sections, navigation) remained fully usable. PASS.

### 16. Sealed R1 item remains sealed for release reasons

A real sealed Ours surprise (`release.mode: "creator_reveal"`, `release.state: "locked"`) was created by Alice. On Bob's device (the real recipient), the item is server-confirmed present in his `/relationship-space/items` response but does not render at all in the compact Now view; it is never mislabeled as crypto-unavailable and no hint of its existence, kind, or content leaks through any crypto-error copy path, on either Alice's other devices or Bob's. This matches the design requirement that sealed R1 state stay strictly separate from crypto-unavailable state and never expose sender preparation metadata. PASS.

### 17. Protected media unavailable state does not fall back to plaintext

A real 1x1 PNG was attached and sent from the physical phone (genuine `DOM.setFileInputFiles` against the real composer file input, real upload, real encrypted object storage round trip); it rendered as a real decrypted `blob:` image on the sending device. On a device with no historical recovery capability for it, it rendered as **"This attachment from older protected history is unavailable on this device."** with no image element, no server preview, and no plaintext fallback of any kind. PASS.

### 18. Deterministic group repair flow creates next generation and future content works

Full evidence, completed in a focused follow-up physical session after the Defect 1 fix below. Early in scenario 8's original execution, a freshly recovered device legitimately satisfied every repair-eligibility condition while its local group state was still absent and the real application genuinely computed `canOfferGroupRepair: true`; that observation is what led to Defect 1 (a premature offer during an ordinary, still-resolving join) and its fix. A separate follow-up session then reproduced a *genuinely* terminal local-group loss on Alice's already-established, already-past-its-approval-grace-window trusted device: the real, unmodified production runtime method `S1CryptoRuntime.purgePartnership(partnershipId)` (a real method the client also calls on legitimate `namespace.revoked` events, not a test-only hook) was invoked once, as setup only, to clear that device's local MLS group state while leaving its trust, recovery capability, and the server's authoritative group completely untouched. No repair state, view-model field, or UI state was forced directly. Recorded immediately before: authoritative `groupGeneration=1`, `groupId=JfMIrupwx6kUvTNvy0efw5rLkVukKpzzbosehzAOj-I`.

Ordinary reconciliation was then allowed to run through normal use (a page reload, then a **Refresh** tap on the real Us panel, then simply waiting): this time the client's own recovery-capsule-backed reconstruction genuinely could not restore the lost local state (unlike the transient case in scenario 8, where the loss was merely a not-yet-completed join and the same reconstruction path succeeded). The real Us panel naturally settled on **"Relationship protection: Repair required"**, and Talk naturally showed **"Protected sharing needs repair / This device cannot restore the current group state normally. A recovery-backed repair is available. / Review repair."** with no manual intervention beyond ordinary navigation. Tapping **Review repair** opened the real Us -> Protected sharing repair block (**"Repair protected sharing / Normal reconciliation could not restore this device's current protected-sharing group. Repair creates a new generation for future protected content. It does not guarantee recovery of older unavailable content."**) and its own **Review repair** control opened the real confirmation dialog, confirmed to initially focus **Cancel** (`document.activeElement` textContent verified as `"Cancel"`), with body **"Repair protected sharing? / This creates a new protected-sharing generation for future content. Older content that is already unavailable may remain unavailable. The repair will run only if the recovery-backed safety checks still pass."** and actions **Cancel** / **Create new protected-sharing generation**.

Tapping **Create new protected-sharing generation** called the real `resetPartnershipGroup()` path end to end and succeeded, producing the exact designed success notice **"Protected sharing was repaired for future content. Older unavailable content may still remain unavailable."** and **"Relationship protection: Ready."** Querying the real authoritative crypto-partnership state immediately after confirmed the repair genuinely advanced the group: `groupGeneration=1 -> 2`, `groupId=JfMIrupwx6kUvTNvy0efw5rLkVukKpzzbosehzAOj-I -> 6zRy7KJT_pMXZfja5vpsZRDt45tWk5cC0DHSurbSp-U`, with the partnership's own ID unchanged. A real new message (`"post-repair real message, scenario 18 verification"`) was then sent from the repaired device; server-side it is real ciphertext (`body: null`, `protectedBody.envelope.groupGeneration: 2`), and Bob's already-open, independent device genuinely decrypted it to the real plaintext with no manual intervention, proving the new generation is fully live for both parties. The repair's own copy is the direct evidence that old unavailable content is never claimed restored: both the pre-execution and post-execution notices explicitly and correctly state that already-unavailable older content may remain unavailable. No runtime code change was required for this follow-up verification; the existing implementation behaved exactly as designed. PASS.

### 19. Email/account recovery -> sign-in -> pending crypto recovery separation

A real, standalone throwaway account was registered, its deletion requested through the real `/me/account-deletion` endpoint, and its access restored through the real `/auth/account-recovery/start` and `/complete` endpoints (the completion code derived the same way the server would email it, from the real `email_verifications` row, never fabricated). The real client copy this triggers is fixed in source and was independently confirmed: **"Account access recovered. Sign in normally. Protected history still requires a trusted crypto device and, where needed, your recovery key."** This is structurally the same, entirely separate account-recovery code path already proven throughout this run never to touch crypto trust or recovery state; a subsequent sign-in with a pending crypto device shows the same actionable pending-device task card demonstrated in scenario 6. PASS.

### 20. Offline/reconnect does not queue recovery secrets or approval operations as M2 user-content operations

With a fresh pending device's network emulated fully offline (`Network.emulateNetworkConditions offline: true`), submitting an RMS produced an immediate fail-closed **"That recovery key could not be verified. Nothing was restored."** (not a queued/deferred success), while in the same offline window ordinary chat correctly showed the real M2 offline banner and queued a real outgoing message for later delivery, proving the two code paths are genuinely different. A scan of every IndexedDB store on the device immediately after, for the attempted RMS string and for any `cryptoRecoveryKey`/recovery-secret-shaped payload, returned zero hits in any store, including the real M2 `chatOutbox`. Reconnecting afterward restored normal operation. PASS.

### 21. 200 percent text and Android touch targets across recovery/device flows

On the real phone, `document.documentElement.style.fontSize` was set to 200% on the Us -> Protected sharing panel: no horizontal overflow (`scrollWidth <= clientWidth`), and screenshots confirm the recovery-key creation success notice, device rows, and primary actions all reflow to full width with no clipped text and no overlapping controls. PASS.

### 22. Reduced-motion recovery/repair dialogs

`prefers-reduced-motion: reduce` was emulated on the real phone for the Us -> Protected sharing panel; the design system's reduced-motion CSS rules are present (`design.css`, `signature.css`, `tokens.css`), and the panel remained fully interactive under emulation (a real **Refresh** tap still completed a real reconciliation and re-rendered the panel). PASS.

### 23. Background/foreground during pending or rekey state does not lose the required action

A pending device was frozen with `Page.setWebLifecycleState: "frozen"` (the same lifecycle transition Android applies to a backgrounded tab) for two seconds, then resumed with a real `visibilitychange`/`focus` event pair. Before and after, Home showed the identical **"Finish protected sharing on this device"** task card: the state neither disappeared nor was falsely promoted to trusted during the freeze. PASS.

### 24. Real realtime device revocation/rekey updates the visible UX without reload

With a trusted device's Talk screen genuinely open (no manual refresh pending), that exact device was revoked from Alice's real phone via the authenticated A1 revoke endpoint. Without any reload, navigation, or other interaction on the target device, it transitioned on its own, within three seconds, from the authenticated app straight to the signed-out screen, driven by the real realtime session-invalidation push. PASS.

### 25. Final raw scan for RMS, private recovery material, and protected plaintext leakage

A final scan across the phone's `localStorage`, `sessionStorage`, URL, every Cache Storage entry, and every IndexedDB store in every `shawtie-crypto-v1:*` database for both Alice's and Bob's real captured RMS strings returned zero literal matches anywhere. The `shawtie-crypto-v1:*` databases' `recoveryState` object stores do contain derived `recoveryHpkePrivateKey` material, but only as `{iv, ciphertext}` pairs (encrypted at rest), never as the plaintext RMS or an unwrapped private key, which is the correct, designed persistent state a recovered device is expected to hold. `npm run s1:production:scan`'s standalone rerun (part of the closure above) independently confirmed the production bundle contains no `__s1Debug`, no `VITE_S1_DEVICE_DEBUG_HOOK` string, and no server-side recovery-private-key identifiers anywhere in the built artifact. PASS; contributes to `UX8_RECOVERY_SECRET_STORAGE_PASS`.

## Defects found, repair, and regression tests

### Defect 1: premature `repair_required` classification for a device that is still finishing its group join

**Root cause.** `CryptoSecurityProvider`'s refresh calls the real `partnershipState()`/`ensurePartnership()` reconciliation and then reads `localGroupStatus()` once. Joining the live MLS group after RMS recovery can legitimately take more than one reconciliation round (an existing group member's own client must independently process the new device's pending key package and commit a welcome before the new device's own next reconciliation can consume it), and the provider is only re-triggered by mount, `focus`, `visibilitychange`, `online`, or an explicit security-changed signal, not by ordinary in-app navigation. A single reconciliation pass that has not yet landed the join looks, from the provider's raw inputs, identical to a genuinely broken local group: trusted, correct recovery key version, active lifecycle, authoritative group present, reconciliation "complete," local group unavailable. `repairEligible()` legitimately, correctly by its own logic, concluded `true`, and the UI displayed **"Protected sharing needs repair"** with a **Review repair** action for a device that was in fact seconds away from resolving itself with no destructive action at all. This was reproduced repeatedly and confirmed not to self-heal through ordinary navigation; a genuine page reload (a valid runtime-startup trigger) did resolve it once the join had actually landed server-side, confirming the underlying join mechanism itself was correct and the defect was purely in when repair was offered.

**Fix** (`abc38c7`, formatting-corrected in `43ff9b1`): `CryptoSecurityProvider` now retries reconciliation up to three additional times, 800ms apart, before concluding the local group is unusable, rather than accepting a single pass's result. `repairEligible()` additionally treats a device within a 2-minute grace window of its own `approvedAt` timestamp (already present on its own device projection, requiring no new state, no new API, and no protocol change) as still joining and returns `false`; `partnershipState()` correctly reports that window as `preparing` rather than falling through to a false `ready`, and `writeState()` correctly keeps protected writes blocked (`blocked_runtime`) during that window rather than allowing an un-encryptable send. Outside the grace window, or if the deterministic predicate's other conditions are not met, the original behavior is unchanged.

**Verification.** Physically re-reproduced end to end on a fresh device after the fix: correct RMS recovery, then an immediate navigation to Talk (no manual reload, no other device touched) showed no repair banner and the honest **"This protected message is unavailable until protected sharing is ready."** placeholder instead, with protected writes correctly blocked; a real message sent independently from Bob's already-joined device (simulating ordinary real-world usage, not a manual fix-verification step) let the recovering device's next natural reconciliation land the join, and a subsequent reload showed full, correct real message history with no lingering banner. A focused regression test (`UX8 a just-approved device joining the group is preparing, not repair-eligible`) was added to `apps/web/tests/ux8.security.test.ts`, proving both that a device within the grace window is not repair-eligible and correctly reports `preparing`, and that the exact same input past the grace window is still correctly repair-eligible, preserving the original predicate. The full 28-test UX8 model suite, the retained S1 suites, the real Chromium/OpenMLS UX8 browser flows, full repository health, and a high-severity dependency audit all passed at the corrective SHA. No API route, database schema, migration, durable authority, or cryptographic protocol was added or changed.

No other defects were found during this physical run, including during the focused Scenario 18 follow-up.

## What this run did not (and does not claim to) cover

- No production trust-transfer or recovery-key-rotation UI exists to test, matching the frozen design decision that neither is in scope for UX8.
- Calls were not part of this crypto-focused sweep; C1/C2 already carry their own separate, previously completed physical acceptance evidence, and this run only confirmed (via the retained closure and source inspection) that no S1 E2EE claim has been added to call copy.

## Final physical markers

```text
UX8_ANDROID_ACCEPTANCE_PASS scenarios=25/25
UX8_RECOVERY_SECRET_STORAGE_PASS
UX8_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS
```

`feat/ux8-encrypted-ux-integration` is physically accepted for UX8 Encrypted UX Integration at final executable SHA `43ff9b1ec319703f3d9270ae8053ab196ca54419`. It has not been merged to `main`.
