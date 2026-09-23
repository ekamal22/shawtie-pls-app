# C2 Video Calling Architecture and Implementation Design

## Status

**DESIGN COMPLETE. IMPLEMENTATION BLOCKED UNTIL C1 IS IMPLEMENTED, PHYSICALLY VERIFIED, AND MERGED.**

Design branch:

`feat/c2-video-calling`

Design parent:

`feat/c1-voice-calling @ 489661e3ac85400cc353a0ea673854c62f057030`

Current verified runtime base beneath C1:

`main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`

This branch is a design checkpoint, not yet a valid runtime implementation base. Before C2 source implementation begins, this branch must be reconciled with the final verified C1 mainline. C2 must never implement around unverified C1 behavior.

Canonical API/compatibility contract:

`docs/api/C2_VIDEO_CALLING_API.md`

Canonical signaling compatibility contract:

`docs/api/C2_VIDEO_SIGNALING_COMPATIBILITY.md`

Canonical physical Android procedure:

`docs/testing/C2_ANDROID_ACCEPTANCE.md`

Accepted C2 architecture refinement:

`docs/adr/ADR-015-stable-video-transceiver-and-camera-privacy.md`
## Dependency contract

C2 depends on C1 providing:

- durable calls aggregate
- call kind vocabulary containing voice and video
- one non-terminal call per partnership
- fixed caller device
- first-accept-wins callee device
- authenticated HTTP call actions
- shawtie.call.v1 signaling
- perfect-negotiation implementation
- candidate-free SDP, server-validated relay-only ICE candidates, and relay-only TURN policy
- short-lived TURN credentials
- negotiated `shawtie.realtime.v2` content-free `call.changed` invalidations while M2 v1 remains unchanged
- Web Push incoming-call reachability
- ring/connect/hard timeout fencing, call lifecycle, selected-device revocation, and final-dissolution cleanup
- physical voice-call closure

C2 must be implemented from a verified C1 mainline, not by copying C1 design assumptions onto an unverified runtime.

## Purpose

C2 enables private one-to-one video calls while keeping camera use explicit, local, reversible, and isolated from server persistence.

C2 must solve:

- video call creation and acceptance
- explicit camera permission and activation
- local preview
- remote rendering
- camera on and off
- front and rear camera switching
- stable audio when video changes
- video transceiver lifecycle
- mobile orientation and visibility changes
- constrained-network behavior
- camera removal or permission failure
- lifecycle and authorization revocation
- physical Android acceptance

## Product scope

C2 implements:

- calls initiated with kind video
- clear incoming Video call presentation
- audio plus optional local video after acceptance
- local camera preview when the local camera is active
- remote video rendering
- camera on and off controls
- front and rear camera switching where supported
- video transceiver negotiation over shawtie.call.v1
- browser WebRTC congestion control with audio-first degradation expectations
- safe camera reacquisition
- mobile foreground/background recovery
- camera-ended and camera-unavailable UI
- relay-only video transport
- physical Android video acceptance

C2 does not implement:

- converting an already accepted voice call into a video call
- group video
- screen sharing
- call recording
- server-side transcoding
- an SFU or MCU
- virtual backgrounds
- beauty filters
- server-side video thumbnails
- server-side video analysis
- face recognition
- background camera capture
- camera device persistence
- a second signaling protocol
- direct peer-to-peer fallback

## Consent model

### Video call initiation

The caller explicitly chooses Video call.

Creating a video call does not start WebRTC negotiation and does not access the caller camera.

The durable call enters ringing exactly as C1 defines.

### Incoming acceptance

The callee sees that the incoming call is a video call before accepting.

The callee must explicitly activate the Accept video action.

No camera or microphone capture starts merely because an incoming video call notification exists.

### Camera activation after acceptance

After the call is accepted, each endpoint independently requests microphone/camera permissions only when its local video intent permits it.

A local video intent is created only by an explicit local user action:

- caller selected Video call
- callee selected Accept video
- user later selected Turn camera on

The initiating/accepting action may authorize the client to attempt camera acquisition after canonical acceptance becomes visible, but never before acceptance. Browser permission remains an independent requirement. A platform that cannot safely continue from the earlier user action may require an additional local Start camera tap.

The remote peer can never activate the local camera.

### Camera off

Each user may stop sending video at any time without ending the call.

Turning the camera off:

- stops the local camera MediaStreamTrack
- releases camera hardware where browser behavior permits
- keeps audio active
- keeps the pre-negotiated video transceiver available
- does not change durable call kind
- does not require a durable server mutation

### No voice-to-video escalation

C2 deliberately does not add a mid-call Upgrade to video action to a voice call.

A voice call remains voice for its lifetime.

This avoids introducing a second consent state machine inside an accepted call.

A future voice-to-video upgrade requires an explicit design for bilateral video consent and compatibility.

## Durable authority

C2 changes almost no durable authority.

PostgreSQL continues to own:

- call ID
- partnership
- caller and callee
- selected endpoint devices
- call kind
- call state
- trusted call timestamps
- terminal reason
- deletion

For C2, call kind video means the call is video-capable.

It does not mean:

- either camera is currently active
- a video track exists
- the user granted camera permission
- the server may activate a camera
- video packets are currently flowing

Camera state is transient client state.

## Persistence and migrations

C2 is expected to require no PostgreSQL migration and reserves no migration number.

C1 is required to persist a forward-compatible call kind vocabulary containing voice and video even though C1 service policy permits creating voice only.

C2 enables video in policy and contracts after C1 closes.

C2 does not persist:

- camera device ID
- camera label
- facing mode
- resolution
- frame rate
- current camera on/off state
- remote video dimensions
- codec choice
- RTP statistics
- SDP
- ICE
- TURN credentials

If verified C1 runtime evidence shows that the durable call schema cannot safely represent `kind = video`, C2 must add a forward-only migration using the next number from the then-current integrated mainline. C2 must not rewrite C1 migrations and must not reserve a speculative migration number in advance.

## WebRTC media model

### Voice call

C1 voice call:

- one audio transceiver
- no video transceiver required
- cannot become video in C2

### Video call

C2 video call creates:

- one audio transceiver
- one video transceiver

The video transceiver is created during the initial post-accept negotiation on every C2-capable endpoint even when the local camera track is absent.

Direction is `sendrecv` for the life of the video call. The local sender may temporarily contain no track while the receiver remains capable of receiving remote video.

This provides a stable video m-line for the life of the video call and avoids adding and removing transceivers for routine camera toggles.

## Local camera-operation generation

Every asynchronous local camera operation is fenced by an in-memory monotonic `cameraGeneration`.

Increment the generation when:

- starting camera acquisition
- switching camera
- turning camera off
- document becomes hidden
- call ends
- selected-device/session authorization is lost
- partnership authority changes

A `getUserMedia()` result or switch result whose captured generation is stale must immediately stop every newly returned track and must not attach it to the sender or preview.

This prevents a slow camera permission/acquisition promise from reactivating video after the user turned the camera off, backgrounded the app, ended the call, or lost authorization.

The generation is transient and is never persisted or sent to the server.
## Camera track lifecycle

Local camera state is modeled as:

~~~text
off
  |
  | explicit user action plus permission
  v
acquiring
  |
  +--> unavailable
  |
  v
on
  |
  +--> switching --> on
  |
  +--> interrupted --> off
  |
  +--> explicit off --> off
~~~

This state is local and transient.

It is not stored in PostgreSQL.

### Enable camera

When enabling:

1. refresh/verify durable call is still accepted or connected
2. verify current device is still the selected endpoint
3. increment and capture `cameraGeneration`
4. request camera through `getUserMedia()` in the secure application context
5. if the generation is stale on resolution, stop the returned track and abort
6. validate exactly one usable video track
7. replace the existing video sender track with the new track
8. attach the same local track to the local preview
9. stop and discard superseded tracks
10. update local UI

`replaceTrack()` is the preferred path. If it fails because the replacement cannot be encoded within the negotiated sender envelope, first retry with compatible capture constraints. If a supported browser still requires renegotiation, reuse C1 perfect negotiation and the current signaling generation rather than creating a new signaling mechanism.

### Disable camera

When disabling:

1. increment `cameraGeneration`
2. replace the video sender track with `null` using the verified browser-compatible path
3. stop the local video track
4. clear local preview
5. retain the video transceiver
6. keep audio and durable call authority intact

The implementation must prefer releasing camera hardware rather than merely hiding the local video element.

### Switch camera

Camera switching uses a new local camera track and the existing video RTCRtpSender.

Preferred flow:

1. identify the next local facing preference
2. increment and capture `cameraGeneration`
3. acquire the replacement track using the narrowest required constraints
4. discard/stop it immediately if the generation became stale
5. `replaceTrack()` on the existing video sender
6. update local preview only after replacement succeeds
7. stop the old track after successful replacement

On mobile browsers that cannot acquire the second camera while the first remains open, stop the old track before requesting the replacement and show a bounded switching state.

A failed switch must not end the call or silently expose a different camera.

## Camera selection policy

The initial mobile preference is:

- user facing camera for normal video calls
- environment facing camera only after explicit Switch camera action

Use facingMode where practical.

Device enumeration is not required before first permission.

If enumerateDevices is used after permission:

- device labels remain local
- device IDs remain local
- values are not written to IndexedDB
- values are not sent to API, signaling, logs, analytics, or push
- values are discarded when no longer needed

C2 does not create a server-side camera preference and does not persist a camera preference to IndexedDB. A front/rear preference may live only in the current in-memory call session.

## Video constraints

Use preference constraints, not rigid product promises.

Initial recommended capture preferences:

- width ideal 1280
- height ideal 720
- frame rate ideal 24 to 30
- frame rate maximum 30
- aspect ratio left to device/browser when constraints cannot be satisfied

Do not fail a video call merely because 720p is unavailable.

The browser may select lower resolution or frame rate.

C2 does not require 1080p.

## Network adaptation

WebRTC congestion control remains the primary adaptation mechanism.

C2 may use sender parameters to place conservative upper bounds where runtime evidence shows a need, but should not implement custom bitrate adaptation before measurement.

Under constrained bandwidth:

- preserve audio first; video degradation must never intentionally sacrifice the audio sender merely to maintain video quality
- allow video quality or frame rate to degrade
- allow the user to turn camera off
- do not switch from relay-only to direct connectivity
- do not end the call solely because video quality becomes poor if audio remains usable

If video transport fails while audio remains healthy, the call may continue audio-only as the same durable video call with clear camera/video-unavailable UI.

## Signaling compatibility

C2 reuses:

shawtie.call.v1

No new signaling protocol version is required for ordinary C2 video because the existing signal.description frame already carries standard SDP and signal.ice_candidate already carries ICE.

C2 does not add a parallel video signaling channel.

The SDP for a video call contains both audio and video negotiation.

Existing refined C1 rules remain:

- signaling opens only after acceptance
- selected endpoints only
- perfect negotiation
- signaling-generation fencing
- candidate buffering
- candidate-free SDP
- signaling server forwards only parsed `typ relay` ICE candidates
- no SDP or ICE persistence
- no SDP or ICE logging
- `iceTransportPolicy: relay`
- reconnect recovery
- realtime v2 remains only canonical-state invalidation, never video signaling

If implementation evidence shows an incompatible signaling semantic is required, C2 must version the protocol through architecture governance rather than silently redefining shawtie.call.v1.

## Routine camera changes and signaling

Routine actions should not need a new application signaling message:

- camera on
- camera off
- front/rear switch

They operate on the already negotiated video transceiver.

The remote UI derives remote-media availability from WebRTC track `mute`/`unmute`/`ended` behavior and actual renderability. It must not infer the partner's intent from missing frames; when uncertain it says video unavailable rather than asserting that the partner deliberately turned the camera off.

C2 v1 adds no application camera-state signaling frame. If implementation evidence proves a dedicated ephemeral media-state frame is required for interoperable UX, that is a signaling-protocol change and must be reviewed/versioned before implementation rather than silently added to `shawtie.call.v1`.

## Audio continuity

Video operations must not unnecessarily replace or restart the audio sender.

Camera:

- enable
- disable
- switch
- permission failure
- track-ended

must leave the audio path intact whenever WebRTC remains healthy.

A camera failure is not automatically a call failure.

## Local preview

Local preview:

- is rendered only from the local camera track
- is muted
- uses playsInline
- may be mirrored for the user-facing camera as a presentation effect
- must not alter the transmitted pixels merely because the preview is mirrored
- disappears when the camera track stops
- is not captured by the application server

The UI must visibly distinguish local preview from remote video.

## Remote rendering

Remote video:

- renders from the remote WebRTC track
- uses playsInline
- must not be mirrored by default
- shows a neutral video-unavailable state when frames are absent unless reliable local media evidence distinguishes a camera-off state
- does not imply the call ended when video disappears
- must not trigger automatic local camera activation

## Permissions Policy and secure context

Camera and microphone capture require the trusted secure application context in production.

Deployment must use an explicit restrictive Permissions Policy allowing camera and microphone only to the trusted application origin.

Third-party embedded frames must not receive camera or microphone capability.

C2 does not support running call capture inside untrusted iframes.

## Camera permission denial

If camera permission is denied:

- do not retry in a loop
- do not navigate users into browser settings automatically
- explain that camera access is unavailable
- keep audio call behavior available when microphone permission succeeds
- allow an explicit later Try camera again action
- do not record the permission decision server-side

Permission error details sent to the server, if any, use only bounded generic categories.

## Track-ended behavior

A camera track may end because of:

- permission change
- hardware disconnect
- browser or OS interruption
- camera switch
- device resource contention

The app must:

- increment `cameraGeneration` so stale acquisition/switch work cannot attach later
- stop showing stale local preview
- stop representing camera as active
- keep audio running when possible
- require explicit user action to reacquire camera after an unexpected track end
- never silently reopen a camera after the operating system has stopped it

This is a privacy boundary.

## Visibility and background behavior

C2 stable privacy policy does not permit hidden local camera capture.

When the document becomes hidden or the PWA is backgrounded:

1. increment `cameraGeneration`
2. detach the local video sender track
3. stop the local camera track
4. clear local preview
5. keep audio according to C1/platform policy where possible
6. keep durable call authority unchanged unless C1 independently terminates it

The app must not reacquire camera while hidden.

When returning to foreground:

1. refresh canonical call authority
2. verify the current device is still the selected endpoint
3. inspect actual WebRTC/audio state
4. keep local camera off
5. require an explicit local Turn camera on action to reacquire video

This makes backgrounding a privacy boundary and avoids depending on inconsistent mobile-browser hidden-camera behavior.
## Orientation and layout

Orientation changes are presentation events, not call-state events.

The client should:

- avoid renegotiation solely for orientation
- allow responsive portrait and landscape remote video
- preserve call controls
- avoid persisting orientation
- use actual track dimensions for layout only in memory

Rotation metadata and browser rendering should be preferred over server-side transformation.

## Codec policy

C2 relies on browser WebRTC codec negotiation.

Do not implement a custom codec preference without compatibility evidence.

Do not log the full SDP codec list.

If a supported-browser matrix later requires codec restrictions, document them through compatibility governance and test both endpoints.

## Relay-only privacy

C2 inherits ADR-014.

All video media remains relay-only.

Video must not introduce:

- direct ICE fallback
- a second TURN provider bypass
- peer-selected transport policy
- server media proxy

TURN cost will increase substantially relative to voice. X1 should measure real video relay bandwidth before any later heavy call feature.

## S1 cryptographic boundary

C2 inherits C1 WebRTC transport encryption and the unresolved S1 endpoint-identity binding requirement.

C2 does not invent a custom video cipher.

Before stable release, S1 must review endpoint authentication for both audio and video so signaling compromise cannot silently substitute an endpoint.

## Privacy limitations

C2 protects transport and minimizes server knowledge, but it cannot prevent an authorized remote user from:

- taking a screenshot
- using external recording equipment
- recording through operating-system or third-party facilities

The product must not claim screenshot prevention or absolute capture prevention.

Built-in recording remains out of scope.

## Lifecycle behavior

C2 inherits C1 lifecycle rules.

### Active partnership

Video calls may be initiated.

Acceptance is explicit.

Camera access remains local and permission-gated.

### breakup_pending

A new video call requires fresh explicit acceptance exactly like voice.

Camera state from a previous call is irrelevant.

### account_deletion_pending

No new call or camera session is authorized.

Existing call authority ends under C1.

Local camera tracks are stopped during call teardown.

### final dissolution

C1 revokes durable call and signaling authority.

C2 additionally ensures:

- local camera tracks stop
- video elements detach
- no camera device state survives partnership teardown
- no old video call can be restored in a future partnership

## Local cleanup

On call end or authorization loss:

1. stop every local audio and video track
2. clear local and remote media element srcObject references
3. close RTCPeerConnection
4. close signaling socket
5. clear transient sender/transceiver references
6. clear camera preference and ephemeral device selection
7. release wake locks if later used
8. reconcile canonical call state

Cleanup must be idempotent.

## Browser compatibility strategy

C2 depends on:

- getUserMedia
- RTCPeerConnection
- RTCRtpTransceiver
- RTCRtpSender.replaceTrack
- track events
- media element playsInline support
- Page Visibility API

A supported browser that cannot meet required camera/WebRTC behavior must fail with an update/unsupported state rather than guessing.

No polyfill may weaken capture permissions or WebRTC security.

## Observability

Allowed aggregate or bounded metrics:

- video-call initiation count
- video-call accepted count
- camera-enable success/failure category
- camera-switch success/failure category
- video track interruption category
- coarse connection setup time
- relay transport family
- browser capability failure class

Do not log:

- camera label
- camera device ID
- exact capture resolution tied to account unless strictly needed for first-party debugging
- image frames
- video frames
- SDP
- ICE
- TURN credential
- peer IP
- screenshots
- face-derived data

No video analytics SDK is added.

## Performance and resource policy

C2 should minimize unnecessary camera work:

- no capture before acceptance
- stop camera when user turns it off
- stop camera on teardown
- use 720p as an ideal, not a minimum
- avoid duplicate capture streams
- use one local video track at a time
- release old track after successful camera switch
- do not run server-side video processing
- avoid per-account RTP-stat persistence; use only bounded aggregate diagnostics when needed
- treat TURN video bandwidth/cost as an operational budget monitored without call content

Battery and thermal behavior are part of Android acceptance.

## Planned implementation slices

### C2-A Contract and compatibility enablement

- enable `kind = video` in call-create policy after verified C1
- preserve the C1 HTTP projection and history model
- C2 browser capability checks
- update-required behavior for C1-only clients
- no detailed hardware capability persistence
- no new durable camera fields
- no speculative database migration

### C2-B Stable video-transceiver engine

- one audio transceiver plus one stable `sendrecv` video transceiver
- initial post-accept negotiation through `shawtie.call.v1`
- camera sender starts empty when local video is unavailable/off
- remote track/render lifecycle
- audio continuity
- candidate-free SDP and relay-only candidate inheritance
- perfect-negotiation compatibility

### C2-C Generation-fenced local camera controller

- explicit video intent
- `cameraGeneration` stale-operation fencing
- camera acquisition
- local preview
- camera off with track release
- camera re-enable
- unexpected track-ended behavior
- idempotent teardown

### C2-D Camera switching and device privacy

- user/environment facing preference
- `replaceTrack()` switch path
- compatible-constraint fallback
- renegotiation only where browser evidence requires it
- no camera label/device ID persistence or server transmission
- switch failure keeps audio safe

### C2-E Mobile visibility, orientation, and network hardening

- stop local camera on background/hidden
- no hidden reacquisition
- explicit foreground re-enable
- portrait/landscape layout without call mutation
- Wi-Fi/mobile transition
- relay-only ICE restart
- constrained-bandwidth audio-first behavior
- TURN UDP and restricted-network fallback

### C2-F Security, lifecycle, and compatibility hardening

- C1-only client update-required behavior
- no silent video-to-voice reinterpretation
- breakup/account-deletion/final-dissolution parity
- selected-device/session revocation
- service-worker/update compatibility
- no frame/device metadata in persistence/logging
- S1 endpoint-authentication handoff

### C2-G Browser and integration closure

- browser capability matrix
- camera permission denial
- repeated on/off/switch leak tests
- stale `getUserMedia()` completion fencing
- signaling restart/reconnect with video
- video-off audio-only continuity in a video-kind call
- no new protocol/database authority regressions
- C1 voice regression remains green

### C2-H Physical Android acceptance and documentation closure

- mandatory Redmi video matrix
- privacy assertions
- relay-path evidence without raw IP/candidate capture
- battery/thermal/track-leak observation
- exact SHA evidence
- full health/audit/diff/parity
- repo-wide status reconciliation
## Acceptance boundary

C2 is DONE only when:

- verified C1 remains green
- video call creation and explicit acceptance pass
- camera never starts before local explicit video action and permission
- remote peer cannot activate local camera
- video call can connect and remain usable when one or both endpoints have camera off
- camera off releases local capture where browser permits
- camera re-enable is explicit after unexpected track end
- front/rear switching passes on supported Android
- routine camera switching does not disrupt audio
- replaceTrack path is verified and renegotiation fallback is safe where required
- no durable camera identifiers exist
- no camera labels or frames appear in logs or analytics
- video SDP remains candidate-free and transient under C1 signaling rules
- only relay ICE candidates are forwarded and the selected media path remains relay-only
- relay-only selected path is verified
- TURN UDP and restricted-network fallback are verified where deployed
- video degradation does not cause direct-connect fallback
- backgrounding proactively stops local camera and foreground return never silently reacquires it
- stale camera acquisition/switch promises cannot reactivate video after off/background/end/revocation
- orientation changes do not corrupt call state
- lifecycle termination stops camera and tears down video
- C1-only clients fail with update-required behavior and never silently answer a video call as voice
- physical Android video acceptance passes
- full health and dependency audit pass

C2 design completion is not C2 runtime completion.
