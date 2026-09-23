# C2 Android Video Calling Acceptance

## Status

DESIGN COMPLETE. Execute only after C1 closure is verified and C2 automated/local closure is green.

C2 requires verified C1 voice calling and physical Android video acceptance. Design branch: `feat/c2-video-calling`, based on C1 design checkpoint `489661e3`; runtime implementation must be reconciled onto the final verified C1 mainline first.

At least one endpoint must be the supported Redmi Android device. Final public-release acceptance should include mobile-to-mobile video when two physical mobile endpoints are available.

## Evidence rules

Record:

- exact commit SHA
- device and OS version
- browser/PWA mode
- peer device/browser
- network type
- TURN transport family
- orientation
- scenario result

Do not record or commit:

- video frames
- screenshots containing private partner video unless deliberately synthetic
- SDP
- ICE candidate text
- peer IP addresses
- TURN credentials
- camera device IDs
- camera labels

Use synthetic test accounts and non-private visual scenes for reproducible evidence.

## Mandatory scenarios

Every scenario uses synthetic test accounts and scenes. No private partner video is acceptable as evidence.

### Basic video call

- caller selects Video call
- no camera opens merely from durable ringing creation
- callee sees Video call before accepting
- callee explicitly accepts
- signaling starts only after acceptance
- both endpoints establish audio
- camera activation follows local intent and browser permission
- remote video renders
- hangup performs full track cleanup

### Caller camera permission denied

- deny caller camera
- call does not crash
- audio can continue if microphone succeeds
- remote endpoint sees camera unavailable/off
- no retry loop
- later explicit camera retry is possible

### Callee camera permission denied

Same guarantees as caller denial.

### Camera off

- turn camera off during connected video call
- remote video stops or shows camera-off state
- audio remains connected
- camera track stops locally
- no durable API mutation is required

### Camera on again

- after explicit off, select Turn camera on
- permission and browser state are respected
- track attaches to existing video sender
- audio remains stable

### Front/rear switch

On Redmi:

- start with user-facing camera
- switch to environment-facing camera
- switch back
- verify local preview changes correctly
- verify remote video follows
- verify audio is uninterrupted
- verify old camera track is released

### Stale acquisition fencing

- begin a delayed/simulated camera acquisition or switch
- before it resolves, turn camera off or background/end/revoke the call
- let the old acquisition resolve
- returned stale track is immediately stopped
- it never attaches to sender or preview
- camera remains off

### Switch failure

Force or simulate camera acquisition failure where possible.

- keep existing camera when safe or end local video cleanly
- never select a surprising camera silently
- call audio survives

### Unexpected camera track end

- revoke permission or otherwise end camera track where possible
- local preview clears
- app shows camera off/unavailable
- camera is not silently reacquired
- explicit user action is required to turn camera back on

### Orientation

During connected video:

- portrait to landscape
- landscape to portrait
- no call-state mutation
- controls remain usable
- no renegotiation loop
- remote media remains coherent

### Background privacy stop

- begin with local camera active
- background the PWA or make the document hidden
- local camera sender detaches/stops
- local preview clears
- audio follows C1/platform behavior and call authority remains canonical
- no hidden local camera capture continues

### Foreground no silent reacquisition

- return to foreground
- canonical call/selected-device authority refreshes
- local camera remains off
- camera does not restart automatically
- explicit Turn camera on is required

### Background and foreground

- background the PWA during connected video
- observe platform behavior
- foreground again
- canonical call state is refreshed
- if camera track survived, state reflects reality
- if track ended, camera remains off until explicit action
- no hidden camera reacquisition

### Wi-Fi to mobile network

- connected video over Wi-Fi
- transition to mobile data
- recover through relay-only ICE restart or fail safely
- no direct fallback
- camera state remains coherent

### Constrained network

Where practical:

- limit or degrade network
- audio remains prioritized
- video quality may reduce
- call does not switch to direct ICE
- user can turn camera off to preserve call

### TURN fallback

Where deployment supports it:

- video over TURN/UDP
- force UDP failure
- verify TURN/TCP or TURN/TLS
- selected path remains relay

### TURN unavailable fail-closed

- make relay allocation unavailable
- verify the video call does not establish through host/srflx/direct ICE
- verify no direct candidate is forwarded
- call fails/degrades according to C1 policy without privacy downgrade

### Signaling reconnect

- interrupt signaling while video media is healthy
- media should not end solely due signaling socket loss
- reconnect signaling
- camera and audio state remain coherent
- subsequent camera switch still works

### Breakup pending

- initiate a new video call in breakup_pending
- explicit accept remains required
- prior video call has no consent effect
- camera does not open before local action

### Device/session revocation

- revoke the currently selected video endpoint device/session from the other authorized session
- signaling continuation/refresh fails
- TURN refresh fails
- local camera and microphone tracks stop
- no stale camera operation reattaches after revocation

### Account deletion

- enter account_deletion_pending during connected video
- call authority ends
- camera and microphone tracks stop
- media elements detach

### Final dissolution

- dissolve partnership during video call
- signaling closes
- TURN refresh fails
- local camera stops
- remote video detaches
- old call is inaccessible after cleanup
- future partnership cannot restore it

### One-sided and zero-camera continuity

- establish a video-kind call with one endpoint camera off
- verify remote/other audio remains usable
- then turn both cameras off
- call remains the same durable video-kind call
- no server downgrade to voice occurs
- re-enable one camera explicitly and verify video resumes

### Repeated camera-cycle leak test

- repeat camera on/off and front/rear switching many times
- verify only the expected current track remains live
- superseded tracks are stopped
- no duplicate preview streams accumulate
- browser remains responsive

### Old client

Where a C1-only build can be exercised:

- receive a C2 video call
- client does not attempt video signaling
- shows update-required state
- does not silently answer as voice
- another compatible device can still answer if available

## Privacy assertions

Verify through first-party test instrumentation:

- no camera label in server logs
- no camera device ID in server logs
- no camera metadata in PostgreSQL
- no captured frame in application logs
- no SDP or ICE in logs
- selected ICE path is relay
- camera is physically released after off/teardown where browser exposes evidence
- no camera starts before acceptance

## Additional signaling/privacy assertions

- captured SDP evidence, if instrumented, contains no ICE candidate lines
- deliberately injected host/srflx/prflx candidate is rejected before peer forwarding
- selected candidate pair remains relay-only without committing raw peer IPs/candidate strings
- camera on/off/switch never enters realtime v2 or durable call history
- no new application signaling frame is used for camera state

## Resource assertions

During a sustained synthetic call:

- no duplicate camera streams accumulate
- camera switching releases superseded tracks
- repeated on/off does not leak tracks
- thermal/battery behavior is observed for obvious regressions
- browser remains responsive

## Closure marker

C2_ANDROID_ACCEPTANCE_PASS may be recorded only after every mandatory scenario above has documented evidence, C1 voice regressions remain green, the exact tested SHA is recorded, sensitive video/signaling/TURN/device material is absent from committed artifacts, and local/remote SHA parity is verified.
