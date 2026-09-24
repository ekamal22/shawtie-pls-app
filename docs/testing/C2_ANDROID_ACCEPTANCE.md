# C2 Android Video Calling Acceptance

## Status

SOURCE IMPLEMENTATION AND DEVICE PREFLIGHT TOOLING COMPLETE. EXECUTE THE PHYSICAL MATRIX ONLY AFTER C2 AUTOMATED/LOCAL CLOSURE IS GREEN. NO PHYSICAL C2 SCENARIO IS YET RECORDED AS PASS.

At least one endpoint MUST be the physical Xiaomi Redmi Note 9S.

Use synthetic accounts and synthetic/non-private visual scenes.

## Evidence rules

Record:

- exact executable SHA
- Android version/API
- browser version
- peer endpoint
- network condition
- TURN transport
- relevant safe observation
- PASS/FAIL/BLOCKED

Never commit:

- video frames containing private people/content
- raw SDP
- ICE candidate text
- peer IP addresses
- TURN credentials
- camera device IDs or labels
- auth secrets

## Mandatory scenarios

### 1. Basic outgoing video call

- explicit Video call action
- caller microphone MUST be pre-acquired exactly as C1 before durable create
- caller camera remains unopened while ringing
- incoming UI identifies video
- explicit callee acceptance
- signaling only after acceptance
- camera request happens only after acceptance plus selected-endpoint/media-owner confirmation
- bidirectional audio
- bidirectional video when both cameras enabled
- relay-only selected pair
- clean hangup and track teardown

### 2. Incoming accept with camera off

- accept a video-kind call with microphone only
- call connects
- remote video can still be received
- durable kind remains video
- camera can later be enabled explicitly

### 3. Caller camera permission denied

- no crash or retry loop
- no silent voice reinterpretation
- explicit retry/continue-camera-off path only
- no camera metadata reaches server

### 4. Callee camera permission denied

Same privacy properties as caller denial.

### 5. No camera before authoritative acceptance

- outgoing ringing never requests caller camera
- incoming ringing never requests callee camera
- notification tap does not request camera
- remote peer cannot request local camera
- losing tab/device never requests camera after losing acceptance
- stale UI cannot activate camera

### 6. Camera off

- local capture stops
- camera indicator/hardware is released where observable
- local preview clears
- audio continues
- durable call version does not change because of camera off

### 7. Camera on again

- explicit local action
- current endpoint authority rechecked
- track attaches to existing sender
- audio remains stable

### 8. Front/back switch

On Redmi:

- user camera to environment camera
- environment back to user
- remote video follows
- superseded tracks stop
- audio uninterrupted

### 9. Constraint fallback

- preferred tier is forced to overconstrain
- deterministic lower tier succeeds where available
- denial does not cause repeated prompts
- no unbounded retry loop

### 10. Stale camera acquisition fencing

- delay camera acquisition
- turn camera off/background/end/revoke before completion
- release delayed result
- stale track stops immediately
- stale track never attaches to preview/sender

### 11. Camera switch race

- begin switch
- issue camera-off or newer switch
- older result cannot win
- one live local video track maximum

### 12. Multi-tab media ownership

- only selected owner tab holds camera/peer/signaling
- observer does not prompt for camera
- caller camera intent remains transient until accepted ownership
- callee losing accept tab stops its pre-acquired microphone and never requests camera
- takeover increments media-owner generation
- old owner cannot regain audio/video/signaling authority

### 13. Old C1 client compatibility

- C1-only client receives video projection safely
- video accept without `video-v1` is rejected
- v1 signaling for video is rejected
- it never silently joins as voice
- another C2-capable device can accept

### 14. Video SDP policy

- candidate-free SDP
- exactly one audio m-line
- exactly one video m-line
- data channel/application rejected
- duplicate/extra media rejected

### 15. Multi-m-line ICE association

- video v2 candidate carries safe media locator
- remote addIceCandidate succeeds for audio/video paths
- no hardcoded index-0 behavior
- host/srflx/prflx remain rejected

### 16. TURN UDP

- video connects over relay UDP where available
- audio and video both flow

### 17. Restricted-network TURN fallback

- disable UDP in disposable environment
- connect over TURN TCP or TLS
- no direct fallback

### 18. Wi-Fi to mobile transition

- transition mid-video-call
- relay-only ICE restart/recovery or safe failure
- audio prioritized
- camera state coherent
- no direct pair selected

### 19. Signaling interruption

- interrupt v2 signaling while media healthy
- media does not end solely from signaling loss
- reconnect into fresh generation
- later camera switch still works

### 20. Background privacy

- active camera
- background/hide PWA
- local camera detaches/stops
- preview clears
- no hidden capture remains

### 21. Foreground no silent camera restart

- return foreground
- canonical call refresh
- camera remains off
- explicit Turn camera on required

### 22. Remote video rendering recovery

- force video element play/render failure once
- remote audio continues
- user gesture can restore video rendering
- no durable call mutation

### 23. Camera track unexpectedly ends

- simulate/revoke/end track
- preview clears
- no silent reacquisition
- audio continues if healthy
- explicit retry required

### 24. Mute independence

- microphone mute/unmute does not toggle camera
- camera off/on does not toggle microphone
- call remains coherent

### 25. breakup_pending

- new video call still needs fresh accept
- no previous call consent carries forward
- camera remains locally explicit

### 26. account_deletion_pending

- new video calls denied
- active call terminates
- mic/camera tracks stop
- stale camera promises cannot reattach

### 27. Session/device revocation

- revoke selected endpoint
- signaling and TURN refresh fail
- audio/video tracks stop
- stale local operations fenced

### 28. Final partnership dissolution

- ringing and connected cases
- authorization removed
- TURN refresh denied
- local tracks stop
- history/authorization cleanup follows C1/P3 rules

### 29. Transport kill switch

- disable C1 transport
- video accept/signaling/TURN fail closed
- no direct fallback
- restore transport
- fresh video call succeeds

### 30. Repeated camera-cycle leak test

- many on/off/switch cycles
- no duplicate live tracks
- no duplicate peer connections
- no duplicate signaling sockets
- browser remains responsive

### 31. Video feature kill switch

- `C2_VIDEO_ENABLED=0`
- new video creation is disabled
- ringing video acceptance is disabled
- existing C1 voice call creation and signaling still work
- no video-to-voice reinterpretation
- an already accepted/connected video call is not killed solely by this product flag
- disabling `C1_TRANSPORT_ENABLED` still fails closed for accepted video signaling/TURN

### 33. Caller intent lost before answer

- start an outgoing video call
- reload/background or transfer media ownership before the callee accepts
- after acceptance, camera remains off
- no delayed permission prompt or silent camera acquisition occurs
- explicit Turn camera on is required

### 34. Two callee devices race to accept video

- both devices receive the ringing video call
- both explicitly accepting devices MUST pre-acquire microphone before their accept request
- first committed accept wins
- losing device stops microphone
- losing device never requests camera
- winning device alone requests camera after selected-endpoint/media-owner confirmation when Accept video intent remains current

### 35. Video flag disabled after acceptance

- establish an accepted/connected video call
- set `C2_VIDEO_ENABLED=0`
- existing media/signaling/TURN refresh can continue
- new video calls and new ringing-video accepts fail
- voice remains healthy
- setting `C1_TRANSPORT_ENABLED=0` then fails closed for transport

### 36. Log/privacy audit

Verify no first-party application log/database contains:

- camera label/device ID
- raw SDP
- ICE candidates
- TURN credentials
- video frames
- sensitive RTP dumps

## C1 retained regression

C2 closure MUST rerun the retained C1 integrated closure or an explicitly equivalent integrated dependency gate.

Voice must remain:

- `shawtie.call.v1`
- one audio m-line
- relay-only
- physically/privacy behavior unchanged

## Closure marker

Record:

`C2_ANDROID_ACCEPTANCE_PASS`

only after every mandatory scenario is evidenced, exact tested SHA is recorded, sensitive material is absent, and local/remote parity is verified.
