# C1 Android Voice Calling Acceptance

## Status

DESIGN COMPLETE. Execute only after automated/local C1 closure is green.

C1 requires physical-device acceptance. The canonical design branch is `feat/c1-voice-calling` from `main @ 54b8659a`.

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
- incoming push wakes service worker
- generic call notification is displayed
- notification click opens app
- canonical call state is fetched before actionable ringing state

### First accept wins

- callee account signed in on two eligible devices if available
- both ring
- first committed accept wins
- second device receives answered/superseded state
- second device cannot signal or receive TURN credentials

### Wi-Fi to mobile network change

- begin connected call
- change network
- call either recovers through relay-only ICE restart or fails safely
- no direct candidate fallback occurs
- call authority remains coherent

### Realtime v2 compatibility

- C1-capable build negotiates `shawtie.realtime.v2`
- foreground incoming call arrives through content-free `call.changed`
- a deliberately v1-only client is not treated as C1-capable
- stale service-worker/app code cannot silently interpret the new frame

### Candidate privacy enforcement

- capture signaling diagnostics without storing raw candidate values
- SDP frames contain no candidate lines
- relay candidates are accepted
- deliberately injected host/srflx candidate is rejected before peer forwarding
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
- new TURN credentials fail
- old call state becomes inaccessible after cleanup
- local UI purges current-partnership call state

### Accepted but never connected

- accept a call but prevent negotiation from reaching both-endpoint connected
- connect timeout finalizes the call safely
- stale connect-timeout job cannot end a later successful call

### Hard stale-call bound

- use accelerated disposable policy
- prove hard timeout ends an otherwise stranded non-terminal call
- new call is no longer blocked
- stale timeout cannot resurrect or mutate a newer call

### Permission denial

- deny microphone
- app does not crash
- no hidden fallback
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
- provider failure does not expose raw internal error text to UI

## Closure marker

C1_ANDROID_ACCEPTANCE_PASS may be recorded only after every mandatory scenario above, including autoplay recovery, push replacement, and transport fail-closed behavior, has documented evidence, the exact tested SHA is recorded, sensitive signaling/TURN/push material is absent from committed artifacts, and local/remote SHA parity is verified.
