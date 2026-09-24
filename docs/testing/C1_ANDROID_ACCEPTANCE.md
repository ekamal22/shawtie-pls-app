# C1 Android Voice Calling Acceptance

## Status

SOURCE IMPLEMENTATION AND FINAL INTEGRATED AUTOMATED/LOCAL CLOSURE COMPLETE. PHYSICAL ACCEPTANCE NOT EXECUTED. The prerequisite integrated closure is green at `9b5c255b5e8c60cbe8da4bcd2b6f7596c56687a0`; this document defines the only remaining C1 closure gate.

C1 requires physical-device acceptance. The canonical implementation branch is `feat/c1-voice-calling`; final integrated automated/local closure passed at `9b5c255` against real migrations 0001 through 0018 with `reserved=0`. A focused real-Chromium ownership/Permissions-Policy harness is also implemented, but it does not replace relay-path or physical Android acceptance.

At least one endpoint must be the supported Redmi Android device. The peer endpoint may be a second physical phone or a desktop browser for baseline scenarios. Final mobile-to-mobile acceptance should be completed before public stable release when two physical mobile devices are available.

## Evidence principles

Record:

- exact commit SHA
- Android device and OS version
- peer device/browser
- network type
- TURN transport observed
- scenario result
- bounded screenshots or logs that contain no SDP, ICE, TURN secrets, push endpoints, or private content

Never store raw SDP, candidate strings, peer IP addresses, or TURN credentials as test evidence.

## Mandatory scenarios

### Basic outgoing voice call

- caller initiates
- callee rings
- callee explicitly accepts
- signaling begins only after acceptance
- both endpoints reach connected
- bidirectional audio works
- either endpoint ends
- history records a completed call

### Reject

- callee rejects
- no peer negotiation begins
- no TURN credentials are issued to an unaccepted callee path
- history shows rejected

### Cancel

- caller cancels while ringing
- callee UI stops ringing
- stale push click does not resurrect the call
- history shows cancelled

### Missed

- do not answer
- server timeout finalizes missed
- late accept is rejected
- stale notification click fetches canonical ended state

### No auto-answer

- incoming call cannot begin media without explicit acceptance
- app foreground/background transitions do not auto-accept
- service-worker notification action does not auto-accept

### Background push

- suspend or close foreground PWA where platform permits
- incoming generic `call_state_changed` push wakes service worker
- service worker fetches canonical current call before actionable ringing state
- incoming/ringing shows or replaces one generic notification
- later cancelled/rejected/missed/answered state closes stale notification after canonical reconciliation
- deliberately delay/reorder duplicate state pushes and prove canonical state wins
- notification click fetches canonical call again before actions
- no push action auto-accepts

### First accept wins

- callee account signed in on two eligible devices if available
- both ring
- first committed accept wins
- second device receives answered/superseded state
- second device cannot signal or receive TURN credentials

### Same-device multi-tab ownership

- open two tabs/windows for the same selected endpoint where browser permits
- only one tab owns microphone, peer connection, signaling, and endpoint-connected reporting
- observer does not trigger second microphone prompt or signaling thrash
- close/crash owner, wait for bounded lease expiry, then prove one observer can take over
- stale callbacks from old owner generation cannot regain media/signaling ownership

### Wi-Fi to mobile network change

- begin connected call
- change network
- call either recovers through relay-only ICE restart or fails safely
- no direct candidate fallback occurs
- call authority remains coherent

### Realtime v2 compatibility

- C1-capable build negotiates `shawtie.realtime.v2`
- foreground incoming call arrives through content-free `call.changed`
- suppress one call.changed while visible and prove anti-entropy repairs state
- inject call.changed during canonical sync and prove dirty barrier repeats before live mode
- a deliberately v1-only client is not treated as C1-capable
- stale service-worker/app code cannot silently interpret the new frame

### Candidate and SDP privacy enforcement

- capture diagnostics without storing raw candidate values
- SDP contains no candidate lines and exactly one audio media section
- injected video or application/data-channel SDP is rejected
- relay candidates are accepted
- injected host/srflx candidate is rejected before peer forwarding
- injected privacy-unsafe relay related/base-address form is rejected
- no direct connectivity fallback occurs

### TURN UDP

- confirm selected pair uses relay
- confirm ordinary UDP relay path where network permits

### Restricted-network fallback

Where infrastructure permits forcing UDP failure:

- prove TURN/TCP or TURN/TLS establishes relay
- confirm no direct fallback

### Push permission denied

- deny Web Push permission
- foreground incoming calls still work through realtime v2
- background reachability is shown as degraded rather than falsely guaranteed
- no permission denial auto-accepts or mutates a call

### Signaling socket interruption

- interrupt signaling while media remains connected
- voice should not end solely because signaling WebSocket reconnects
- reconnect signaling
- canonical call state remains correct

### Session revocation

- revoke selected endpoint session
- signaling reconnect and TURN refresh fail
- active call terminates according to C1 policy
- other endpoint receives canonical ended state

### account_deletion_pending

- move one account into deletion-pending state
- new calls are denied
- ringing/accepted/connected call terminates
- stale UI cannot restart it

### breakup_pending

- initiate a new call
- explicit callee acceptance is still required
- no previous acceptance or state auto-accepts a later call

### Final dissolution

- terminate partnership during ringing and during connected call
- signaling authorization is removed
- new TURN credentials and refresh fail immediately
- honest client tears down media immediately after canonical revoked/terminal state
- with accelerated provider policy, prove already-issued TURN allocation cannot outlive documented residual bound
- old call state becomes inaccessible after cleanup
- local UI purges current-partnership call state

### Accepted but never connected

- accept a call but prevent both endpoints from reaching connected
- allow exactly one endpoint to report connected
- prove first report does not invalidate accepted-call connect timeout
- connect timeout finalizes safely
- stale connect-timeout job cannot end a later successful call

### Hard stale-call bound

- use accelerated disposable policy
- prove hard timeout ends an otherwise stranded non-terminal call
- new call is no longer blocked
- stale timeout cannot resurrect or mutate a newer call

### Permission and local-consent boundary

- caller microphone prompt occurs only from explicit Call gesture
- callee microphone prompt occurs only from explicit Accept gesture
- deny microphone and prove no crash/hidden fallback
- force create/accept race failure after local acquisition and prove track stops
- verify camera permission is never requested in C1
- call ends or fails with bounded generic state
- device label is not sent to server

### Remote audio autoplay recovery

- force/instrument one remote audio `play()` rejection
- call remains canonical and connected
- UI shows explicit tap-to-hear recovery
- user gesture starts remote audio without creating a new call transition

### Push subscription replacement

- register push for the physical device
- replace/rotate the subscription through the same authenticated device
- verify the old subscription no longer causes duplicate ringing
- verify the current subscription still opens canonical call state without auto-accept

### Transport kill-switch fail-closed

- in disposable configuration disable C1 transport while preserving the app
- new accept/signaling/TURN authorization fails honestly
- no host/srflx/direct fallback establishes media
- re-enable transport and verify a fresh call can proceed

## Privacy assertions

Verify:

- selected ICE candidate pair is relay
- no application log contains SDP
- no application log contains candidate text
- no application log contains TURN credential
- no push log contains endpoint capability URL
- no direct peer candidate is selected
- public call history/projection does not expose raw internal session/device/deletion/lifecycle cause
- provider failure does not expose raw internal error text to UI

## Closure marker

C1_ANDROID_ACCEPTANCE_PASS may be recorded only after every mandatory scenario above, including multi-tab ownership, anti-entropy repair, autoplay recovery, push reorder/replacement, timeout fencing, and transport fail-closed behavior, has documented evidence, the exact tested SHA is recorded, sensitive signaling/TURN/push material is absent from committed artifacts, and local/remote SHA parity is verified.
