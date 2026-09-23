# M2 Physical Android Acceptance Evidence

This document records executed pass/fail evidence for the 14 mandatory physical
Android scenarios defined in `docs/testing/M2_ANDROID_ACCEPTANCE.md`. It is the
acceptance-evidence record; `M2_ANDROID_ACCEPTANCE.md` remains the canonical
procedure and closure-rule document.

## Test environment

- Physical device: Xiaomi Redmi Note 9S, Android 12, API 31
- ADB serial: `bf4b0dc9`
- Chrome version: 153.0.8010.52
- M2 code under test, initial SHA: `87f3a4009fc64776b9eb80c8d0a0564cbdeb7505` (branch `feat/m2-realtime-offline`)
- Isolated local runtime for this acceptance run (separate from the shared dev
  ports used by other concurrent work on this machine):
  - API: `127.0.0.1:3001`
  - Web (Vite dev server): `127.0.0.1:4174`
  - Disposable PostgreSQL: `127.0.0.1:55432` (Docker `postgres:16-alpine`, all
    14 migrations applied from zero)
  - CDP forward: local `9223` -> device `chrome_devtools_remote`
  - ADB reverse: device `tcp:4174` -> host `tcp:4174`
  - A temporary, untracked `vite.config.m2-android.local.ts` proxies `/api`
    and the WebSocket upgrade to `127.0.0.1:3001` instead of the committed
    dev default of `127.0.0.1:3000`, because a separate concurrent session on
    this machine was using port 3000 for the unrelated private `Shawtie-pls`
    repository. This file is local test-environment isolation only and is not
    committed.
- Synthetic accounts: `m2_android_alice`, `m2_android_bob`, `m2_android_charlie`
  (emails under `shawtie-test.invalid`), created through the real
  `/api/v1/auth/registration/*` endpoints with the registration email code
  derived locally with the same `AUTH_HMAC_KEYS` root key the API was started
  with (the same technique the repository's own integration tests use; no
  real email delivery is configured or required).
- Alice's account is logged into the real app UI in physical Android Chrome
  on the Redmi via `adb reverse` + an `am start` Chrome intent. Bob (and
  later Charlie) are driven through the same real HTTP API as the "other
  session" side of each scenario, since the product's authorization and
  lifecycle rules are enforced server-side regardless of which HTTP client
  calls them.

No secrets, session cookie values, or real user data are recorded in this
document. Raw screenshots and JSON evidence live under `validation-logs/`
(not committed).

## Scenario evidence

### Scenario 1: foreground realtime

- SHA: `87f3a4009fc64776b9eb80c8d0a0564cbdeb7505`
- UTC timestamp: 2026-09-23T08:01Z
- Result: **PASS**
- Setup: Alice authenticated and foregrounded in physical Android Chrome with
  an active partnership with Bob. A CDP `Network`/`Runtime` session attached
  to the real page target to observe the live WebSocket without altering app
  behavior.
- Action: Bob sent one message through the real
  `POST /api/v1/conversations/:id/messages` endpoint (idempotency-keyed,
  `201 Created`).
- Observed behavior: the phone's open WebSocket received exactly one
  content-free invalidation frame,
  `{"v":1,"type":"message.changed","payload":{"conversationId":...,"messageId":...,"mutation":"created","changeSequence":1,"serverSequence":1,"contentVersion":1}}`
  (no message body/text in the frame). The app performed canonical resync and
  rendered the new message without any manual reload. The message text
  appeared exactly once in the DOM (no duplicate product mutation). No
  browser console errors were observed.
- Evidence: `validation-logs/screenshots/scenario1-foreground-realtime-chat.png`

### Scenario 2: background/suspend and recovery

- SHA: `87f3a4009fc64776b9eb80c8d0a0564cbdeb7505`
- UTC timestamp: 2026-09-23T08:02Z
- Result: **PASS**
- Setup: Alice foregrounded and connected, then sent to the background with
  a real `KEYCODE_HOME` event through ADB (the Android launcher became the
  foreground activity, confirmed via `dumpsys window`). While backgrounded,
  the USB-forwarded local connection was removed with
  `adb reverse --remove tcp:4174` to force a real loss of reachability, not
  just a simulated offline flag.
- Action: while Alice was backgrounded and disconnected, Bob sent a second
  message through the real HTTP API.
- Observed behavior: connectivity was restored
  (`adb reverse tcp:4174 tcp:4174`) and Chrome was foregrounded again with a
  real launcher intent (`monkey -c android.intent.category.LAUNCHER`),
  resuming the same tab rather than opening a new one. Within 2 seconds the
  app reconnected, resynced, and rendered the message that was sent while
  backgrounded, with no duplicate of the scenario 1 message and no stale
  state.
- Evidence: `validation-logs/screenshots/scenario2-background-recovery.png`

### Scenario 3: offline message retry

- SHA at defect discovery: `87f3a4009fc64776b9eb80c8d0a0564cbdeb7505`
- SHA after fix: `ac70dd4` (`feat/m2-realtime-offline`), plus one additional
  follow-up fix on top described below
- UTC timestamp of final passing evidence: 2026-09-23T08:54Z
- Result: **PASS** (after fixing three real production defects found by this
  scenario)
- Setup: Alice foregrounded, USB-forwarded connectivity removed with
  `adb reverse --remove tcp:4174`, then a message was composed and sent
  through the real chat UI (native input events into the message textarea
  and a real click on Send, not a direct API call).
- First observed behavior (defect): the message was correctly persisted into
  the real IndexedDB `chatOutbox` store with `status: "queued"`. After
  restoring connectivity, the queue did not drain: not after waiting past
  the 60 second anti-entropy interval, not after a live message from the
  partner was successfully delivered over the realtime socket, and not after
  a full page reload. The message stayed stuck with `retryCount: 0` and no
  claim ever attempted.
- Root cause investigation found three compounding real defects in
  `apps/web/src/lib/realtime/sync-coordinator.ts` and
  `apps/web/src/features/messaging/MessagingPanel.tsx`:
  1. `SyncCoordinator.stop()` permanently set an internal stopped flag with
     no way to reset it, and cleared the registered offline-replay
     replayer, which was only ever registered once in `M2Runtime`'s
     constructor. Any stop-then-start cycle on the same runtime instance
     (for example React StrictMode's development mount/cleanup/mount
     double-invoke) left every future sync request a silent no-op forever.
  2. The reconcile/replay pass loop had no error handling, so a single
     thrown error silently aborted a sync pass with no retry scheduled.
  3. The messaging reconciler unconditionally re-POSTed delivery/read
     receipts on every pass. Acknowledging a receipt broadcasts a
     `conversation.receipt_changed` realtime frame back to the acknowledging
     client's own socket, which requested another sync pass that
     acknowledged again, forever.
  4. After fixing 1 to 3, physical retesting still failed to drain the
     queue. Further investigation found a fourth, independent defect: the
     messaging reconciler function's `useCallback` dependencies included
     the `conversation`/`messages` state that the reconciler itself updates,
     so completing one reconcile pass re-rendered the owning component and
     caused it to unregister and re-register the same named synchronizer
     with a new closure. `SyncCoordinator` iterated its registered
     synchronizers directly off the live `Map`, and a `Map` iterator
     revisits keys that are deleted and reinserted during iteration, so the
     reconcile phase revisited the messaging reconciler indefinitely and
     never reached the replay phase.
- Fixes applied: added `SyncCoordinator.resume()` and had `M2Runtime.start()`
  call it and re-register the offline-replay replayer on every start; wrapped
  the reconcile/replay loop in a try/catch that schedules a backoff retry
  instead of stranding work; made receipt acknowledgment only POST when it
  actually advances past what the server has on record; and snapshotted the
  reconcilers/replayers collections before iterating each pass so
  registration churn during a pass cannot cause it to be revisited. Focused
  regression tests were added to `apps/web/tests/m2.sync.test.ts` covering
  the resume cycle, reconciler/replayer failure retry, and a reconciler that
  re-registers itself mid-pass (this test hangs forever without the fix,
  confirmed by reverting the fix locally and observing the test time out).
- Final retest on the physical Redmi Note 9S: a fresh offline-queued message
  drained automatically within 3 seconds of connectivity being restored,
  with exactly one durable message created server-side (no duplicates) and
  the UI converged to canonical state.
- Evidence: `validation-logs/screenshots/scenario3-offline-retry-clean.png`

### Scenario 4: offline edit/delete/reaction authority replay

- SHA: `fc25c6c` (`feat/m2-realtime-offline`)
- UTC timestamp: 2026-09-23T09:02Z
- Result: **PASS**
- Setup: Alice disconnected (`adb reverse --remove tcp:4174`). Through the
  real chat UI: reacted to Bob's message with a heart emoji, opened a
  second Alice message's Edit control (a native `prompt()` dialog,
  intercepted and answered through CDP `Page.handleJavaScriptDialog` rather
  than a raw API call) and changed its text, and deleted a third own
  message (a native `confirm()` dialog, likewise answered through CDP).
  All three were confirmed queued in IndexedDB `chatOutbox` with the
  correct operation types (`reaction.set`, `message.edit`,
  `message.delete`) and, for the edit, `expectedContentVersion: 1`.
- Conflict setup: while Alice's phone was still offline, a second Alice
  session (simulating another device, driven directly against the real
  API) edited the same message first, successfully bumping its
  `contentVersion` to 2. This made the phone's queued edit's
  `expectedContentVersion: 1` stale before it ever got a chance to replay.
- Action: connectivity restored (`adb reverse tcp:4174 tcp:4174`).
- Observed behavior: the reaction and delete replayed and drained
  immediately. The stale edit was not blindly applied: the server rejected
  it and the queued operation transitioned to
  `status: "blocked", lastErrorCode: "VERSION_CONFLICT"` rather than being
  retried forever or silently dropped. The real app UI surfaced this to the
  user with an explicit notice ("Offline changes / message.edit /
  VERSION_CONFLICT / Attempted text is still stored locally: ..." with
  Retry/Discard actions). Server-side state confirmed correctness: the
  reacted message carries Alice's heart reaction, the deleted message has
  `body: null` and a `deletedAt` timestamp (no plaintext retained), and the
  edited message's final content is the second device's edit
  ("EDITED-BY-OTHER-DEVICE"), not the stale offline edit, proving the
  authority/version recheck prevented an overwrite of newer canonical
  state.
- Evidence: `validation-logs/screenshots/scenario4-conflict-notice.png`

### Scenario 5: duplicate/out-of-order realtime hints

- SHA: `fc25c6c` (`feat/m2-realtime-offline`)
- UTC timestamp: 2026-09-23T09:05Z
- Result: **PASS**
- Setup: a CDP `Page.addScriptToEvaluateOnNewDocument` script wrapped the
  page's real `WebSocket` constructor before the app loaded, capturing a
  reference to the genuine `RealtimeClient` socket (`/api/v1/realtime`)
  without modifying any application source. This allowed dispatching real
  `MessageEvent`s directly on the actual open socket, exercising the exact
  same client-side frame-handling code the server's own frames use.
- Action: Bob sent one real message (`changeSequence: 10`), which rendered
  correctly once. The identical `message.changed` frame for that same
  message was then dispatched a second time directly on the real socket
  (a duplicate). A separate stale/out-of-order `message.changed` frame
  referencing `changeSequence: 1` and a nonexistent message id was then
  also dispatched.
- Observed behavior: the marker text appeared exactly once in the DOM
  before and after both injected frames (no duplicate product mutation from
  the duplicate frame, and no regression or corruption from the stale
  frame). The socket remained open and connected throughout, and no
  browser console errors occurred. All injected frames were constructed
  content-free (ids and sequence numbers only, matching the real M2
  invalidation shape), consistent with the product's requirement that
  realtime frames never carry private message bodies.
- Evidence: `validation-logs/screenshots/scenario5-dedup.png`

### Scenario 6: PostgreSQL LISTEN reset

- Status: pending

### Scenario 7: breakup while offline

- Status: pending

### Scenario 8: final dissolution while offline

- Status: pending

### Scenario 9: later-partnership isolation

- Status: pending

### Scenario 10: device/session revocation

- Status: pending

### Scenario 11: protected offline cold start

- Status: pending

### Scenario 12: service-worker update with queued work

- Status: pending

### Scenario 13: local persistence/quota failure

- Status: pending

### Scenario 14: two-tab claim fencing

- Status: pending
