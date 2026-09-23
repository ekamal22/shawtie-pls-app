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

- Status: pending

### Scenario 3: offline message retry

- Status: pending

### Scenario 4: offline edit/delete/reaction authority replay

- Status: pending

### Scenario 5: duplicate/out-of-order realtime hints

- Status: pending

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
