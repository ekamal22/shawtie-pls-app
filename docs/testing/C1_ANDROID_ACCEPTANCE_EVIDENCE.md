# C1 Physical Android Acceptance Evidence

This document records executed pass/fail evidence for the mandatory physical
Android voice-calling scenarios defined in
`docs/testing/C1_ANDROID_ACCEPTANCE.md`, plus the supplemental privacy and
lifecycle checks run alongside them. `C1_ANDROID_ACCEPTANCE.md` remains the
canonical procedure and closure-rule document.

## Result

All 25 mandatory scenarios in the canonical acceptance document are recorded
PASS on a physical Xiaomi Redmi Note 9S (Android 12, API 31) that took part in
every call, with the exceptions and honest limits listed in "Limits and
observations". The tested executable code is `feat/c1-voice-calling` at
`9cbc2f8194591e95752eb3a7a9f771e340974b19`. That commit differs from the last
code and test commit `9b5c255b5e8c60cbe8da4bcd2b6f7596c56687a0` only in
documentation, so the executable code under test is the code the integrated
automated closure passed against. The 25-scenario run itself changed no code.

A later follow-up check of two evidence gaps (rejected-call notification
cleanup and physical stale-owner fencing) found one real defect in the
multi-tab media-owner code. It was fixed at
`b29aaa1dc62c9e3419c41084cddf4016a4f1bad8` with real-Chromium regression tests,
and `npm run test:c1:closure` re-passed at that SHA
(`C1_AUTOMATED_INTEGRATED_PASS reserved=0`), so `b29aaa1` is now the final
executable SHA and the latest integrated automated closure. The scenarios the
fix logically affects (multi-tab ownership and signaling interruption with
reconnect) were rerun physically on the fixed build; the full 25-scenario
suite was not rerun. The last evidence item, audible desktop-to-phone audio,
was then confirmed by ear on the fixed build (see "Follow-up: audible audio
confirmation"). All physical acceptance evidence is now complete.

The final documentation and evidence HEAD is the tip of `feat/c1-voice-calling`
after the evidence commit, which contains only documentation. C1 was subsequently fast-forward merged to `main @ d44c595`
to `main`.

## Test environment

- Physical device: Xiaomi Redmi Note 9S (model reported as `Redmi Note 9S`),
  Android 12, API 31, Chrome 153.0.8010.52. Canonical preparation
  `npm run test:c1:device:prepare` passed (`C1_ANDROID_PREPARE_PASS`) and
  `npm run test:c1:device:cleanup` passed at the end
  (`C1_ANDROID_CLEANUP_PASS`).
- Peer endpoints: desktop headless Chromium 153.0.8010.12 driven through the
  DevTools protocol with a synthetic 440 Hz tone as its microphone, using the
  same web application build. A second desktop browser context served as a
  second eligible callee device for the first-accept-wins scenario. A second
  physical mobile device was not used; the acceptance document requires that
  mobile-to-mobile pass before the public stable release.
- Runtime, all disposable and separate from other work on the machine (ports
  3000 and 5432 and the private repository container were not touched):
  - API `127.0.0.1:3001`, worker as a separate process, web served by
    `vite preview` of a production build on `4174`, PostgreSQL 16.15 on `55432`
    with the real migrations 0001 to 0018 (`MIGRATION_PLAN_PASS count=18
    reserved=0`).
  - TURN: self-hosted coturn (Docker) using the ephemeral shared-secret
    credential scheme that the API issues. UDP plus TCP for the main run, TCP
    only with UDP disabled for the restricted-network scenario. No TLS
    listener was configured.
  - The phone reached the web server through `adb reverse`, and the TURN
    server either through the PC LAN address (Wi-Fi) or through an
    `adb reverse` TCP tunnel (mobile data). CDP was forwarded from the device
    Chrome.
  - Web build: the real application plus an untracked, test-only passive
    probe script (never committed). The probe records sanitized diagnostics
    only (candidate types, selected pair class, counts, close codes) and gives
    the harness fault seams (drop one realtime frame, reject one `play()`,
    hold one request). It never stores SDP text, candidate strings, addresses,
    TURN credentials, push endpoints or device labels. A temporary untracked
    Vite config injected it and was deleted afterwards.
  - Timing seams used, all supported configuration: `C1_RING_TIMEOUT_MS`,
    `C1_CONNECT_TIMEOUT_MS`, `C1_HARD_TIMEOUT_MS`,
    `C1_TURN_CREDENTIAL_TTL_MS`, `C1_TRANSPORT_ENABLED`. Web Push used the real
    provider path: a generated VAPID key pair, the worker's Web Push sender and
    Google's push service.
- Synthetic accounts only (`c1_alice` on the phone, `c1_bob`, `c1_carol`,
  `c1_dave`, `c1_erin` on the desktop), created through the real registration
  endpoints with the email code derived locally from the test key, the same
  technique the repository tests use. Real user gestures were used for calls,
  accepts, rejects, cancels, permission prompts and notification taps
  (`adb input tap` on the device); only account sign-in was filled through the
  DevTools protocol.

No cookies, tokens, SDP, candidate strings, addresses, TURN credentials, push
endpoints or private content are recorded here. Raw screenshots and logs stay
in the uncommitted `validation-logs/` directory and the phone screenshots that
showed unrelated personal notifications were deleted.

## Scenario evidence

Times are approximate UTC (device local time is UTC+6), 2026-09-24, between
roughly 13:15 and 15:55. Every row ran on the device above against the tested
SHA.

| # | Scenario | Network | Result |
| --- | --- | --- | --- |
| 1 | Basic outgoing voice call | LTE, TURN over TCP tunnel | PASS |
| 2 | Reject | LTE | PASS |
| 3 | Cancel | LTE | PASS |
| 4 | Missed | Wi-Fi | PASS |
| 5 | No auto-answer | LTE | PASS |
| 6 | Background push | LTE / Wi-Fi | PASS |
| 7 | First accept wins | LTE | PASS |
| 8 | Same-device multi-tab ownership | LTE | PASS |
| 9 | Wi-Fi to mobile network change | Wi-Fi then LTE | PASS |
| 10 | Realtime v2 compatibility | LTE / Wi-Fi | PASS |
| 11 | Candidate and SDP privacy enforcement | LTE | PASS |
| 12 | TURN UDP | Wi-Fi | PASS |
| 13 | Restricted-network fallback | Wi-Fi, UDP disabled | PASS |
| 14 | Push permission denied | Wi-Fi | PASS |
| 15 | Signaling socket interruption | LTE | PASS |
| 16 | Session revocation | Wi-Fi | PASS |
| 17 | account_deletion_pending | Wi-Fi | PASS |
| 18 | breakup_pending | Wi-Fi | PASS |
| 19 | Final dissolution | Wi-Fi | PASS |
| 20 | Accepted but never connected | Wi-Fi | PASS |
| 21 | Hard stale-call bound | Wi-Fi | PASS |
| 22 | Permission and local-consent boundary | Wi-Fi | PASS |
| 23 | Remote audio autoplay recovery | Wi-Fi | PASS |
| 24 | Push subscription replacement | Wi-Fi | PASS |
| 25 | Transport kill-switch fail-closed | Wi-Fi | PASS |

### 1. Basic outgoing voice call

- The phone user tapped Call (microphone requested from that gesture, audio
  only, `userActivation` true). The desktop callee saw ringing and tapped
  Accept. Before Accept the desktop had made no TURN or signaling request.
- Both endpoints reached `connected`. Selected pair on both sides was relay to
  relay; the phone's relay used TCP (mobile data through the tunnel) and the
  desktop's UDP.
- Audio: while the user spoke into the phone, the desktop's received audio
  energy rose by about 0.72 (peak level about 0.73) and the user heard their
  own voice come out of the desktop speakers. In the other direction the
  phone's decoded inbound audio energy rose steadily from the desktop tone
  (about 0.40 over the measured window). The user did not report hearing the
  desktop tone in that first run; that direction was confirmed by ear in the
  follow-up on the fixed build (see "Follow-up: audible audio confirmation").
- The desktop ended the call. History showed outcome `completed` with a
  duration; the history projection contains only `id`, `kind`, `direction`,
  `initiatedAt`, `connectedAt`, `endedAt`, `outcome`, `durationSeconds`.
- Harness note: the first attempt did not gather relay candidates because the
  TURN tunnel had not been created yet; after adding it the call connected.

### 2. Reject

- The desktop called; the phone rang; a real tap on Reject ended the call as
  `rejected` with no connected time. The phone made no accept request, no TURN
  request and opened no signaling socket for that call.
- While ringing, `turn-credentials` returned 404 `CALL_NOT_FOUND` for both the
  caller and the unaccepted callee, and the signaling upgrade returned 404 for
  both.
- Harness note: a first attempt hit Accept because the phone had rotated to
  landscape and the tap coordinates were wrong. That was a harness mapping
  error (a genuine tap on the wrong button), not an auto-answer. The tap
  helper was made rotation-aware and the scenario was repeated.

### 3. Cancel

- A phone Call tap made the desktop ring; a phone Cancel tap stopped the
  desktop's ringing UI and history showed `cancelled`. Stale-notification
  behavior is covered in scenario 6.

### 4. Missed

- With a 15 second ring timeout the phone left a ringing call unanswered. The
  worker finalized `missed` (server row version 2) after about 15.4 seconds,
  history showed `missed`, the phone UI showed "Call ended, missed" with no
  Accept, a late accept returned 409 `CALL_NOT_RINGING`, and a late TURN
  request returned 404. No microphone request occurred. A stale notification
  click resolving to the canonical ended state is shown in scenario 6.

### 5. No auto-answer

- With a call ringing on the phone, the app was sent to the background and
  brought back three times (visibility events hidden, visible, hidden,
  visible, hidden, visible). No microphone request and no accept or reject
  request occurred, and the canonical call stayed `ringing` with no accepted
  time. The service worker source contains no accept path, and a real
  notification tap (scenario 6) also produced no accept.

### 6. Background push

- Notification permission was granted by a real tap on Allow; the app
  subscribed through Google's push service (only the provider host was
  recorded) and stored one subscription for the device.
- With Chrome sent to the background, a desktop call caused the worker to
  deliver a generic `call_state_changed` push; the service worker woke and
  showed one generic "Incoming call" notification tagged for the current call.
  With the service worker inspected, each push caused exactly one canonical
  `GET /api/v1/calls/current` and the response was 200.
- Cancel removed the notification. Three duplicate pushes while ringing left
  one notification. Three delayed duplicate pushes after cancel created no
  incoming-call notification. Missed (25 second ring timeout) and answered on
  another device (second desktop device accepted) also removed the phone's
  notification.
- Rejected (follow-up check, run on a fresh secure test origin because Chrome
  had reset the notification permission of the earlier test origin): with the
  phone backgrounded, a desktop call produced the generic incoming
  notification and canonical state `ringing`. The app was then brought forward
  from the launcher, not from the notification, and a real tap on Reject
  rejected the call: canonical state ended with terminal reason rejected, the
  history projection reported outcome `rejected`, and the notification was
  removed about 2.5 seconds later by the state push. After rejection there was
  no accept request and no microphone request. With the worker stopped so no
  cleanup push was sent, a real Reject tap left the notification in the shade
  (stale); a real tap on that stale notification opened the app to "Call ended,
  rejected" with no Incoming or Accept controls, no accept request, no
  microphone request and canonical state with no call, and the notification was
  cleared.
- A push with an unknown version or unknown type triggered no canonical fetch
  (ignored); a valid one triggered exactly one.
- Notification click: a real tap on the notification opened Chrome on the app,
  which refetched canonical state and showed Incoming voice call with Accept
  and Reject; the call stayed ringing, with no accept request and no
  microphone request. With the worker stopped, a call was answered and
  cancelled without a cancel push; the stale notification remained, and a real
  tap on it opened the app to "Call ended, cancelled" with no Accept.
- Chrome behavior noted, not a defect: after many test notifications Chrome
  masked the notification title as "Possible spam ... from <test origin>"
  (an on-device Chrome heuristic that also applied to a fresh origin), and once
  reset the site notification permission to prompt. The notification still
  existed under the fixed tag and could be tapped. When the service worker
  correctly shows nothing for a non-ringing push, Chrome adds its own generic
  "site updated in the background" notification (userVisibleOnly rule).

### 7. First accept wins

- A desktop call rang the phone and a second desktop device of the same
  account. A real tap on the phone's Accept raced a click on the second
  device's Accept. The second device won. The phone showed "answered on
  another device", the loser's TURN request returned 404, the loser's
  signaling upgrade returned 404, a late accept returned 409
  `CALL_ANSWERED_ELSEWHERE`, the phone made no TURN request and opened no
  signaling socket, and its microphone track had ended. Both participants of
  the winning call had a selected device.

### 8. Same-device multi-tab ownership

- The owner tab (after a real Accept tap) held one microphone stream, one peer
  connection and one signaling socket. A second tab of the same origin showed
  "Resume audio here" and held none of them, with no second microphone prompt.
- The owner tab was closed. After the 8 second lease expired the observer did
  not take over on its own (no microphone, no peer, no socket) and the
  canonical call stayed connected. A real tap on Resume audio here in the
  observer then took over: one microphone stream, one peer connection, one
  socket, relay connected, and the lease generation rose from 1 to 2.
- With an owner alive, a Resume tap in an observer produced "This call is
  already active in another tab on this device", its acquired microphone track
  ended, it created no peer connection or socket, and the original owner kept
  its single connected peer and socket. Limit: the observer acquires the
  microphone on its explicit tap before the lease check, then stops it.
- Stale-owner completion (follow-up check, see the next subsection): a
  deliberately delayed generation-1 completion was fired after generation 2 was
  established. It exposed a defect that was fixed and physically re-verified.

#### Follow-up: stale-owner completion fencing (defect found and fixed)

- Mechanism: the test-only probe held the owner tab's TURN credential request
  so its `start()` was mid-flight under generation 1 (the call was accepted,
  the lease record showed generation 1). The owner tab's JavaScript was then
  frozen through the DevTools debugger, the equivalent of a frozen or
  throttled tab, so its heartbeat stopped. After 12 seconds (the lease is 8
  seconds) a second tab was opened and a real tap on Resume audio here took
  ownership at generation 2 and the call connected through it. The held
  generation-1 request was then released while the owner tab was still frozen
  and the tab was resumed, so the old work completed after generation 2 was
  authoritative. Two hold points were used: before the request (the
  completion is slower than the resumed heartbeat) and after the response (the
  completion is faster than the heartbeat).
- Before the fix: with the request-side hold the resumed heartbeat noticed the
  loss first and the completion arrived 31 ms after the old owner stopped, so
  the existing `stopped` flag fenced it (no peer connection, no socket, no
  endpoint-connected report, generation-2 owner intact). With the response-side
  hold the completion arrived 13 ms before the heartbeat noticed the loss. The
  old owner then created a peer connection and a signaling socket. That socket
  superseded the generation-2 owner's socket (server close code 1008
  "Superseded"), the generation-2 tab stopped its media, the old tab then
  stopped too, and the call stayed canonically connected with no media owner at
  all. That is a real defect: a superseded owner regained signaling authority.
- Root cause: `CallMediaSession.start()` re-checked only its own `stopped` flag
  after the awaited API calls. That flag is set by the heartbeat or the
  takeover hint, neither of which is ordered against the completion. The same
  pattern existed in the TURN refresh and the signaling reconnect timer.
- Fix (`b29aaa1`): `MediaOwnerLease.verifyOwnership()` verifies the shared lease
  record, and the session verifies it after the TURN credential request in
  `start()` and in the TURN refresh and before a signaling reconnect. A
  superseded owner now stops without creating media or signaling state.
- Regression tests: two new real-Chromium tests, one for lease verification of
  the current owner versus a superseded generation and one in which a
  generation-1 completion arrives after a generation-2 takeover and must create
  zero peer connections and zero sockets and leave generation 2 untouched, plus
  a control test that the current owner still creates exactly one peer
  connection and one socket. Both new stale tests fail on the old code and
  pass on the fix (real Chromium 5/5), and a source-level test was added.
- Physical result after the fix (rebuilt phone bundle, response-side hold):
  generation before takeover 1, after takeover 2. When the stale generation-1
  completion fired (the held request completed about 19 ms before the old owner
  released its lease) the old tab created no peer connection, no signaling
  socket and no endpoint-connected report, stopped with "Audio moved to another
  tab on this device", and did not touch generation-2 state. Counts across all
  phone tabs afterward: one microphone-owner tab with one live microphone
  track, one open peer connection and one open signaling socket. The
  generation-2 lease stayed current and was renewed, the desktop peer's
  signaling socket was not superseded and had no close events, and the
  canonical call stayed connected. The normal takeover (scenario 8) and the
  signaling interruption with reconnect (scenario 15) were rerun on the fixed
  build and passed.

### 9. Wi-Fi to mobile network change

- A call was connected over Wi-Fi (relay over UDP, network class wifi). The
  user turned Wi-Fi off. The peer connection went connecting, connected,
  disconnected, connected, and the selected pair became relay to relay over
  TCP with network class cellular. Inbound audio packets kept increasing
  (9,290 to 10,761 over the next 30 seconds), the canonical call stayed
  connected, and only relay candidates existed. No direct fallback occurred.

### 10. Realtime v2 compatibility

- The phone and desktop negotiated `shawtie.realtime.v2`. Visible incoming
  calls arrived through content-free `call.changed` frames (payload is only
  event id, call id and version).
- One real `call.changed` was dropped while visible: the call was ringing on
  the server, the UI did not show it after 4 seconds, and visible anti-entropy
  repaired it at 39 seconds with one canonical fetch (interval 60 seconds).
- With the phone's `/calls/current` held, a `call.changed` injected during the
  running sync caused a repeat pass before live mode (three fetches in total).
- A socket offering only `shawtie.realtime.v1` received `control.ready` and
  pings but no `call.changed`, while the v2 socket received it. Unknown or
  dual protocol offers were rejected with 400. A request with client
  compatibility version 0 or 2 returned 426 `CLIENT_UPDATE_REQUIRED`.
- Stale application code: at the start of the run the phone still held an
  older build's service worker, and the app correctly showed its compatibility
  banner ("App update available") until that stale test state was cleared.
  Pushes with unknown version or type are ignored by the service worker.

### 11. Candidate and SDP privacy enforcement

- SDP as sent by the phone and the desktop: exactly one audio section, no
  video, no application section, no candidate or end-of-candidates lines.
  Only relay candidates with zero related address were sent.
- Frames injected over the phone's live signaling socket (documentation-range
  addresses): a video section, an application/data-channel section and a
  candidate line inside SDP each closed the socket with 1008 "Invalid SDP";
  a host candidate, a server-reflexive candidate and a relay candidate with a
  non-zero related address each closed it with 1008 "Invalid ICE candidate".
  A valid relay candidate was accepted and the socket stayed open. The desktop
  received only the legitimate and the valid injected candidate frames, so the
  rejected ones were not forwarded. The selected pair stayed relay to relay.

### 12. TURN UDP

- On Wi-Fi the phone's selected local candidate was relay with relay protocol
  UDP (network class wifi) against a relay remote candidate, and the desktop
  also used UDP; audio counters grew on both sides.

### 13. Restricted-network fallback

- The TURN server was recreated with UDP disabled and only TCP published, and
  the phone's USB tunnel was removed so the only path was the Wi-Fi LAN. The
  phone's local relay candidate was TCP only and the selected pair was relay
  over TCP (network class wifi); the desktop also selected TCP. No direct
  fallback occurred. TURN over TLS was not exercised because no certificate
  was configured; TCP fallback is what was proven.

### 14. Push permission denied

- Through Chrome's real site permission UI (Reset permissions, then a tap on
  Block in the prompt) notification permission became denied. The UI showed
  "Background ringing is unavailable. Foreground calls still work." A desktop
  call still rang in the foreground through realtime, and after 5 seconds it
  was still ringing with no accept request and no microphone request. The
  denial itself created no call.

### 15. Signaling socket interruption

- The signaling socket was closed with code 4000 during a connected call. The
  peer connection stayed connected, inbound packets kept increasing (1,071 to
  1,481), a new signaling socket opened, and the canonical call stayed
  connected.

### 16. Session revocation

- The phone's device was revoked from another session of the same account
  during a connected call. The server ended the call (internal reason
  authorization revoked), the peer saw "Call ended, unavailable" and history
  showed outcome `unavailable` with a duration; the internal reason is not
  exposed. The revoked phone's TURN refresh returned 401, its call state
  request returned 401, its signaling upgrade returned 401, and the phone
  signed out with its peer connection closed.

### 17. account_deletion_pending

- Cycles for ringing, accepted-not-connected (TURN unreachable) and connected:
  the partner's account deletion request ended the call (internal reason
  account deletion; public outcome `unavailable`), the phone showed "Call
  ended, unavailable" with no Accept, Resume or End controls and its peer
  connection closed. A new call by the other member returned 409
  `CALLING_NOT_ALLOWED`; a stale Call tap on the phone showed "Calling is not
  available in the current relationship state" and created no call. The
  account was then recovered.

### 18. breakup_pending

- A call was connected, then the partner started a breakup: the connected
  call was not terminated or reclassified. After it ended, a new call during
  `breakup_pending` rang and stayed ringing for 8 seconds with no microphone
  request and no accept request (no auto-accept from the earlier acceptance).
  A real tap on Accept then connected it with exactly one accept request.

### 19. Final dissolution

- Connected call (two runs, real worker after accelerated breakup timing):
  dissolution completed in 0.5 to 1.0 seconds; the call row ended with the
  internal reason partnership terminated; new TURN requests returned 404;
  signaling upgrade returned 404; the old call returned 404 for both members;
  history was empty; the phone's peer connection closed with no socket and the
  UI showed "No active partnership yet".
- Residual bound (accelerated 30 second TURN credential TTL): credentials
  issued before dissolution still allocated one relay candidate 4 seconds
  after dissolution, and none 32 seconds after dissolution (after
  expiry), so the residual window is bounded by the credential TTL as
  documented.
- Ringing call: dissolution purged the call with the partnership; a late
  accept returned 409 `NO_CURRENT_PARTNERSHIP`, TURN returned 404, the old
  call returned 404 and the phone's ringing UI was replaced by "No active
  partnership yet".

### 20. Accepted but never connected

- With a 25 second connect timeout and an unreachable TURN address, the phone
  accepted; the caller (a selected endpoint) reported connected through the
  endpoint attestation. The call stayed `accepted` at version 2 and deadline
  generation 2 with an unchanged connect deadline, only the caller's
  participant row was marked connected, and the worker finalized `failed`
  about 25 seconds after accept. The phone showed "Call ended, failed".
- Stale timeout: a first call was accepted and ended, a second call was
  accepted and connected, and the first call's original connect deadline
  passed with the second call still connected (version 3) and the first still
  completed.

### 21. Hard stale-call bound

- With a 40 second hard bound the hard expiry was set to 40 seconds after
  connect. Both clients disappeared without ending the call; it stayed
  connected, then the worker finalized `failed` at 41 seconds. After the
  clients reopened, a new call rang immediately (not blocked) and the old call
  was unchanged.

### 22. Permission and local-consent boundary

- Caller microphone prompt appeared only from the real Call tap; a real tap on
  Never allow produced "Microphone permission was denied", created no call,
  and the page stayed usable. A callee Accept tap with the permission denied
  also showed the denial, made no accept request and left the call ringing.
- A forced network failure of the create request after the microphone was
  acquired left no server call and the microphone track ended. The lost
  first-accept race in scenario 7 also ended the acquired track.
- All microphone requests in the run were audio only with user activation; no
  video request was made (camera permission state stayed unrequested and
  Android's camera access time was from long before the run). Call API request
  bodies contained only `expectedPartnershipId` and `kind` (create) or
  `expectedVersion` (accept); no device label or other identifier was sent.

### 23. Remote audio autoplay recovery

- One `play()` rejection was injected on the phone during an accepted call.
  The canonical call stayed connected at version 3, the UI showed "Tap to
  hear", a real tap started playback, the button disappeared, the version was
  unchanged and inbound packets kept flowing.

### 24. Push subscription replacement

- The phone's push subscription was unsubscribed and the page reloaded: the
  same device kept exactly one active row with a new fingerprint and the old
  row was revoked. A push to the old endpoint returned gone. A new ring and
  cancel delivered only to the new subscription, and the service worker made
  exactly one canonical fetch per state push with no accept.

### 25. Transport kill-switch fail-closed

- With `C1_TRANSPORT_ENABLED=0` a call rang normally, but two real Accept taps
  returned 503; the phone showed "Private relay calling is temporarily
  unavailable", the call stayed ringing, the phone made no TURN request and
  opened no signaling socket, TURN issuance returned 503
  `CALL_TRANSPORT_UNAVAILABLE`, the signaling upgrade returned 503 and the
  acquired microphone track ended. After restoring the flag a fresh call
  connected over relay.

## Follow-up: audible audio confirmation

Run on the fixed executable code (`b29aaa1`) after the gap fixes, with the same
physical Redmi Note 9S and the desktop peer sending its synthetic 440 Hz tone.

- A real call was placed with a real tap on Call and the desktop accepted.
  Both sides reported `connected`, the phone's local candidates were relay only
  (relay protocol TCP through the USB tunnel on mobile data), the selected pair
  was relay to relay, and the peer connection policy was relay. No direct
  candidate existed. History later showed `completed`.
- Desktop to Redmi: the user held the Redmi to the ear and confirmed by ear
  that a steady beep came out of the Redmi ("Yes, steady beep"). The phone's
  decoded inbound audio energy also rose (about 0.43 over the window), as
  supporting evidence only.
- Redmi to desktop: the user spoke into the Redmi and confirmed by ear that the
  voice came out of the desktop ("Yes, hear my voice"). The desktop's received
  audio energy rose by about 1.36 with a peak level of about 0.58.
- Result: genuine bidirectional audible audio over a relay-only C1 call.
  `C1_PHYSICAL_GAP1_BIDIRECTIONAL_AUDIBLE_AUDIO_PASS`.

## Privacy assertions

| Assertion | Result |
| --- | --- |
| Selected ICE pair is relay | PASS, every connected call, both endpoints |
| No application log contains SDP | PASS, phone and desktop console/log entries were zero during connect, socket churn and end; API, worker and web logs contained none |
| No application log contains candidate text | PASS, same evidence |
| No application log contains a TURN credential or the shared secret | PASS |
| No push log contains an endpoint capability URL | PASS, no provider endpoint or key text in API, worker or web logs |
| No direct peer candidate is selected | PASS, local candidate types were relay only |
| Public history and projection expose no session, device, deletion or lifecycle cause | PASS, bounded outcomes (`completed`, `rejected`, `cancelled`, `missed`, `failed`, `unavailable`) |
| Provider failure becomes a bounded user-facing state | PASS, unreachable TURN ended `failed`; kill-switch showed a generic message |
| Camera is not requested | PASS |
| Raw device labels are not transmitted | PASS, request body keys only |

The coturn container's own log recorded one line naming an expired ephemeral
username (a timestamp and an opaque hash, no credential) during the residual
window test. That is the third-party TURN server's log, not an application log.

## Limits and observations

- Peer was a desktop headless browser with a synthetic microphone; a second
  physical mobile device was not available. Two-phone acceptance remains a
  pre-stable-release item per the canonical document.
- TURN over TLS was not exercised (no certificate); TCP fallback was.
- Chrome's on-device "Possible spam" notification masking and its generic
  fallback notification affect the visible notification wording on the test
  origins; the notification content and tap behavior were verified anyway.
- One phone tab briefly rendered the sign-in screen after a partly aborted
  harness step although its session was valid server-side; a reload fixed it
  and it did not recur in a four-tab reproduction attempt.
- The phone locked itself once (secure lock screen) and the user unlocked it
  and enabled Stay awake; the phone also rotated to landscape at times, which
  the tap helper handles.
- Wi-Fi was turned on and off by the user for the network scenarios and was
  left on. Chrome site data for the two test origins was cleared; the device's
  other data was not touched.

## Closure

C1 source implementation, final integrated automated/local closure and
physical Redmi Note 9S acceptance are complete on `feat/c1-voice-calling`,
including the follow-up results (rejected-call notification cleanup,
stale-owner fencing with its fix, and audible bidirectional audio). The final
executable SHA is `b29aaa1dc62c9e3419c41084cddf4016a4f1bad8`, whose integrated
closure passed with `reserved=0`. No physical acceptance evidence remains
open, so C1 is DONE. It was subsequently fast-forward merged to `main @ d44c595`
merged to `main`, and C2 has not been started.
