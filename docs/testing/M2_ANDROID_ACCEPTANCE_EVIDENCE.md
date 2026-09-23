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

- SHA: `fc25c6c` (`feat/m2-realtime-offline`)
- UTC timestamp: 2026-09-23T09:07Z
- Result: **PASS**
- Setup: identified the API's own PostgreSQL `LISTEN "shawtie_realtime_v1"`
  backend connection via `pg_stat_activity` on the disposable database
  (matched to the running API process by its connection start time),
  distinct from the connection pool used for ordinary queries. Alice's
  physical Android WebSocket remained connected throughout.
- Action: ran `SELECT pg_terminate_backend(<pid>)` against only that one
  LISTEN connection, forcing the API's internal notification listener to
  error out and reconnect, without touching the API process, the HTTP
  server, or Alice's WebSocket connection.
- Observed behavior: the API's listener reconnected (its internal
  generation counter advanced past 1) and broadcast a content-free
  `{"v":1,"type":"control.resync_required","payload":{"scope":"account","reason":"listener_reset"}}`
  frame to Alice's still-open socket. This forced a full canonical
  reconciliation pass, observed as real HTTP calls to
  `/api/v1/relationship-space`, `/api/v1/relationship-space/items`,
  `/api/v1/conversations/:id/changes`, `/api/v1/conversations/current`, and
  `/api/v1/auth/session`, all within about 300ms of the reset. The Android
  browser session and WebSocket were never dropped, and the app remained
  fully functional afterward, confirming the listener-reset path forces
  reconciliation rather than silently continuing with potentially missed
  invalidations.
- Evidence: `validation-logs/screenshots/scenario6-listener-reset.png`

### Scenario 7: breakup while offline

- SHA before fix: `fc25c6c`; SHA after fix: recorded in the commit that
  follows this evidence update on `feat/m2-realtime-offline`
- UTC timestamp: 2026-09-23T09:09Z
- Result: **PASS** (after fixing one real defect)
- Setup: Alice disconnected (`adb reverse --remove tcp:4174`) and, through
  the real chat UI, queued an edit (via the native `Edit` prompt, answered
  through CDP) on a message she had sent before the breakup, with
  `expectedContentVersion` matching its pre-breakup version.
- Action: while Alice remained offline, Bob initiated breakup through the
  real `POST /api/v1/partnerships/:id/breakup` endpoint
  (`lifecycleState` became `breakup_pending`, partnership `generation`
  advanced to 2). Connectivity was then restored.
- Observed behavior (mutation authority): the queued edit was not blindly
  applied. It transitioned to
  `status: "blocked", lastErrorCode: "PRE_BREAKUP_MESSAGE_LOCKED"`, the
  server-side message content was confirmed unchanged, and the real app UI
  surfaced the block with a Retry/Discard notice, correctly reflecting
  M1/P3's rule that pre-breakup messages cannot be edited once the
  partnership enters `breakup_pending`.
- First observed behavior (defect): the Partnership panel did not reflect
  the new breakup state after reconnecting. It kept showing the stale
  pre-breakup view (an active-looking "Start breakup" affordance) alongside
  a generic "Something went wrong." error banner, and only recovered after
  an unrelated `window` `focus` event was dispatched. Root cause:
  `PartnershipPanel` refreshed only on mount, on a `partnership-changed`
  realtime event (which requires having been connected at broadcast time),
  or on window focus; a plain reconnect triggered none of those, and a
  transient failed load during the reconnect burst left a generic error
  banner that was never cleared by a later successful load.
- Fix applied: registered `PartnershipPanel`'s refresh as a reconcile-phase
  synchronizer with the same `SyncCoordinator` the messaging and
  relationship-space panels already use, so it participates in the
  resilient, auto-retrying resync pass on every reconnect; and cleared the
  error state on a successful load so a transient failure does not leave a
  permanently stale banner. A focused regression test was added to
  `apps/web/tests/m2.browser.test.ts` asserting the registration and the
  error-clearing order.
- Final retest on the physical Redmi Note 9S: after rebuilding and
  reloading, the Partnership panel correctly showed "Breakup in progress"
  with the real initiator, timestamp, and final deadline immediately on
  reconnect, with no error banner and no manual focus event required.
- Evidence: `validation-logs/screenshots/scenario7-breakup-offline.png`

### Scenario 8: final dissolution while offline

- SHA before fix: `d87d7c8`; SHA after fix: recorded in the commit that
  follows this evidence update on `feat/m2-realtime-offline`
- UTC timestamp: 2026-09-23T09:24Z
- Result: **PASS** (after fixing one real defect and one test-harness
  timestamp-precision issue)
- Setup: Alice disconnected and, through the real UI, queued a new message
  send while offline (a stale mutation whose authority is fully revoked by
  termination, not merely restricted like scenario 7's edit). Verified
  IndexedDB row counts across all seven protected stores beforehand
  (`namespaceMeta:1, conversationSync:1, messages:7, relationshipItems:0,
  relationshipMeta:1, chatOutbox:1, relationshipOutbox:0`).
- Action: advanced the real `breakup_processes` row's `initiated_at` (not
  `final_deadline` directly, which is a generated-equivalent column
  enforced by an exact-equality `CHECK` constraint tied to `initiated_at`)
  seven days into the past and made the real `partnership_breakup_finalize`
  `scheduled_actions` row due, then let the actual running worker claim and
  execute it on its normal poll loop. Did not delete or hand-edit
  partnership rows directly.
- Test-harness defect found and fixed in the test SQL itself, not
  production code: the first attempt used raw `now()`, which has
  microsecond precision, but the API always produces millisecond-precision
  timestamps, so when the worker read back `final_deadline` and wrote it
  as `dissolved_at`, the sub-millisecond remainder was lost in the
  Node/pg round trip and the write violated the exact-equality
  `breakup_processes_dissolve_timing` check constraint
  (confirmed by temporarily adding one diagnostic `console.error` in
  `apps/worker/src/scheduled/scheduled-consumer.ts`, capturing the real
  constraint-violation error, then reverting that diagnostic change
  entirely). Re-running with `date_trunc('milliseconds', ...)` on the
  snapshot timestamp let the real worker finalize successfully on its next
  poll, with `scheduled_actions.status` ending `completed`.
- Observed behavior (server): `partnerships.lifecycle_state` became
  `terminated`; `GET /api/v1/partnerships/current` returned
  `{"partnership": null}` for both accounts; the dissolved conversation's
  own `GET .../messages` returned `404 CONVERSATION_NOT_FOUND` even to the
  former partner, and the stale queued message was never created
  server-side.
- Observed behavior (client, before fix): after reconnecting, IndexedDB was
  correctly and fully purged across all seven stores (all row counts
  dropped to 0, confirming the queued stale message never replayed), the
  Partnership panel correctly showed "No active partnership yet." with the
  dissolved relationship under Former Partnerships. However, the Messaging
  panel kept showing the entire old conversation (all prior scenario
  messages, the edit/delete from scenario 4, a "Send failed" banner) and an
  active composer, because its coordinator-registered "messaging"
  reconciler kept receiving `CONVERSATION_NOT_FOUND` from the server (the
  stale `conversationId` still held in component state) and let it
  propagate into the coordinator's generic retry loop forever, never
  reaching the existing `CONVERSATION_NOT_FOUND` recovery path
  (`handleSyncFailure` -> `loadInitial()`) that only the separate,
  rarely-active polling-interval error handler used.
- Fix applied: the coordinator-registered "messaging" synchronizer in
  `apps/web/src/features/messaging/MessagingPanel.tsx` now catches
  `CONVERSATION_NOT_FOUND` specifically and routes it through the same
  `handleSyncFailure` recovery path the polling interval already used,
  clearing the stale conversation/messages state. A focused regression
  test was added to `apps/web/tests/m2.browser.test.ts`.
- Final retest on the physical Redmi Note 9S: after rebuilding and
  reloading, the Messages panel correctly shows "Your private conversation
  appears after a partnership is formed." with no trace of the dissolved
  conversation, alongside the already-correct Partnership/Former
  Partnerships views and the fully purged IndexedDB stores.
- Evidence: `validation-logs/screenshots/scenario8-dissolution-clean.png`

### Scenario 9: later-partnership isolation

- SHA: `83331de` (`feat/m2-realtime-offline`)
- UTC timestamp: 2026-09-23T09:30Z
- Result: **PASS**
- Setup: after scenario 8's real dissolution, Alice's real 3-month
  post-breakup `account_partner_eligibility` cooldown row was accelerated
  by moving its `created_at` back (recomputing `eligible_at` from the same
  snapshot, preserving the exact-equality check constraint) rather than
  deleting or bypassing the eligibility check. Alice then formed a genuine
  new partnership with the third synthetic account, `m2_android_charlie`,
  through the real partner-request/accept API.
- Action: Charlie sent one real message in the new conversation, then
  Alice's already-running physical Android session was reconnected to pick
  up the new partnership.
- Observed behavior (visible): the UI showed only the new partnership with
  Charlie as active, the new message, and an empty Relationship Space
  ("Nothing here yet."). The dissolved Bob partnership correctly appears
  only under Former Partnerships (an intentional, documented P3 feature for
  blocking purposes, not a leak) with no old messages or relationship
  content rendered anywhere.
- Observed behavior (physical storage, not just visible rendering): queried
  every row in all seven protected IndexedDB stores directly and searched
  their serialized contents for the old (dissolved) partnership id. It
  appears in zero rows across all stores. All populated stores
  (`namespaceMeta`, `conversationSync`, `messages`, `relationshipMeta`,
  each with exactly one row) contain only the new partnership id, and the
  outbox stores are empty, confirming no dormant old-partnership data or
  queued work survives in the account's local storage after later
  pairing.
- Evidence: `validation-logs/screenshots/scenario9-later-partnership-isolation.png`

### Scenario 10: device/session revocation

- SHA: `f1bafcf` (`feat/m2-realtime-offline`)
- UTC timestamp: 2026-09-23T13:02Z
- Result: **PASS**
- Setup: confirmed the physical phone's own device row (`displayName:
  "Browser"`, matching the device id the phone itself reports under
  Settings) via `GET /api/v1/me/devices` from a second, independent Alice
  session. Confirmed beforehand that the phone's account IndexedDB database
  (`shawtie-local-v1:<accountId>`) existed via `indexedDB.databases()`.
- Action: called the real `DELETE /api/v1/me/devices/:deviceId` endpoint
  from the second session, targeting the phone's device id, while watching
  the phone's live WebSocket and network traffic.
- Observed behavior, verified independently rather than inferred from any
  single signal per the specific risks flagged for this scenario:
  - the phone's socket received a real content-free
    `{"type":"account.security_changed"}` frame, then closed
  - the next requests from the phone (`/api/v1/auth/session`,
    `/api/v1/partnerships/current`) both returned `401`
  - `indexedDB.databases()` on the phone afterward returned an **empty
    list** - the account's local database was actually deleted, not merely
    emptied or left behind after a best-effort purge failure
  - the authenticated UI fully disappeared and the real sign-in screen
    rendered
  - a fresh, independent fetch to `/api/v1/auth/session` with the phone's
    still-present cookies returned `401 AUTH_REQUIRED`, confirming the
    revoked session cannot regain authority merely by making another
    request or reconnecting
- Evidence: `validation-logs/screenshots/scenario10-revoked-login-screen.png`

### Scenario 11: protected offline cold start

- SHA: `26c080c` (`feat/m2-realtime-offline`)
- UTC timestamp: 2026-09-23T13:04Z
- Result: **PASS**
- Setup: signed Alice back into the real app on the physical phone and let
  it load protected data (the Charlie partnership, one message,
  relationship metadata), confirmed present in IndexedDB.
- Action: performed a genuine cold start rather than a background/foreground
  cycle, per the specific concern that Android can restore an existing live
  DOM on simple backgrounding: ran `adb shell am force-stop
  com.android.chrome` to fully kill the Chrome process (confirmed via
  `dumpsys window` that the launcher, not Chrome, was foreground
  afterward), removed the USB-forwarded connectivity
  (`adb reverse --remove tcp:4174`), then launched a fresh Chrome process
  directly to the app URL via `am start` while still offline.
- Observed behavior: captured five rapid native `adb screencap` frames
  immediately after the fresh launch. Every one showed only the locked
  "Offline / Connect once so Shawtie pls can verify this private session
  before opening locally cached content. / Try again" shell; no partnership,
  message, or relationship content appeared even momentarily before it.
  Restoring connectivity and pressing "Try again" correctly proceeded past
  the lock once the session could be verified.
- Evidence: `validation-logs/screenshots/scenario11-cold-start-locked.png`

### Scenario 12: service-worker update with queued work

- SHA before fix: `e790c32`; SHA after fix: recorded in the commit that
  follows this evidence update on `feat/m2-realtime-offline`
- UTC timestamp: 2026-09-23T09:39Z
- Result: **PASS** (after fixing one real defect)
- Setup: made a trivial, harmless one-line change to `apps/web/public/sw.js`
  (a comment, reverted before every commit) to produce a genuinely new
  service-worker byte content, rebuilt, and called
  `registration.update()` from the real page. The physical app correctly
  reached a real waiting-worker state and showed the real "App update
  available / Offline replay is paused while the app switches to a
  compatible version." banner.
- First observed behavior (defect): with the update banner visible and
  **not yet acted on**, a message was composed and sent through the real
  offline-queue UI while disconnected, then connectivity was restored.
  The queued mutation drained and reached the real server within about a
  second, while the banner was still visible and unclicked, directly
  contradicting the banner's own claim that replay is paused. Reproduced
  twice independently (once incidentally on a stale cached build from an
  earlier scenario, then cleanly on a freshly confirmed build) with the
  same result both times.
- Root cause: `SyncCoordinator.markUpdateRequired()` was only ever called
  from `activateWaitingM2ServiceWorker()`, itself only invoked from the
  "Update and reload" button's `onClick` handler in `M2UpdateBanner`
  (`apps/web/src/lib/realtime/runtime-context.tsx`). A waiting worker
  detected earlier, while the banner is visible but the user has not yet
  pressed the button, left the coordinator in its normal live state,
  so replay proceeded through the outgoing (about to be superseded)
  client version.
- Fix applied: `M2UpdateBanner` now calls
  `runtime.coordinator.markUpdateRequired()` as soon as its `waiting` state
  becomes true, covering both a worker already waiting at mount and one
  detected later, not only on the button click. A focused regression test
  was added to `apps/web/tests/m2.browser.test.ts`.
- Final retest on the physical Redmi Note 9S: with the fix in place and a
  fresh waiting-worker state established, a message queued while offline
  and reconnected stayed `status: "queued"` for the full observation
  window while the update sat unactivated. After activating the update
  (the physical device owner tapped "Update and reload" directly on the
  phone once a scripted click did not register), the banner cleared, the
  service worker reported no waiting worker, the queue drained, and the
  message reached the server exactly once immediately afterward.
- Evidence: `validation-logs/screenshots/scenario12-update-pause-fixed.png`

### Scenario 13: local persistence/quota failure

- Status: pending

### Scenario 14: two-tab claim fencing

- Status: pending
