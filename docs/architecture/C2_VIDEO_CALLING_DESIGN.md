# C2 Video Calling Architecture and Implementation Design

## Status

**DESIGN COMPLETE ON CURRENT POST-C1 MAINLINE. SOURCE IMPLEMENTATION NOT STARTED.**

Implementation branch:

`feat/c2-video-calling`

Verified design base:

`main @ 5323d7be21e8776b45f507ec4cf60b9582544621`

Verified C1 executable baseline inherited by C2:

`b29aaa1dc62c9e3419c41084cddf4016a4f1bad8`

C1 is DONE and merged. C2 may now implement directly on top of the verified call substrate.

Canonical HTTP/API delta:

`docs/api/C2_VIDEO_CALLING_API.md`

Canonical video signaling protocol:

`docs/api/C2_VIDEO_SIGNALING_PROTOCOL.md`

Canonical physical Android acceptance:

`docs/testing/C2_ANDROID_ACCEPTANCE.md`

Accepted C2 architecture refinement:

`docs/adr/ADR-015-c2-video-signaling-and-camera-privacy.md`

## 1. Goal

Add private one-to-one video calling without creating a second call aggregate, a second lifecycle model, a second push system, a second deletion path, or any direct-connect privacy fallback.

C2 extends the verified C1 call platform with:

- video call creation and acceptance
- explicit local camera consent
- local preview
- remote video rendering
- camera on/off
- front/back camera switching where supported
- video-specific signaling and ICE metadata
- privacy-safe background behavior
- video network/resource handling
- stale camera-operation fencing
- Android physical acceptance

C2 does not reopen C1 call authority.

## 2. Non-goals

C2 does not implement:

- voice-to-video upgrade of an already accepted voice call
- group calling
- screen sharing
- call recording
- server-side video proxying or transcoding
- SFU or MCU infrastructure
- virtual backgrounds
- beauty filters
- face analysis or recognition
- server-side thumbnails
- durable camera state
- camera device persistence
- direct peer ICE fallback

Call recording remains post-stable and requires a separate reviewed design.

## 3. Inherited C1 authority

C2 reuses unchanged:

- `call_sessions` as the durable call aggregate
- `call_participants` as the sole caller/callee endpoint authority
- one non-terminal call per partnership
- fixed caller endpoint
- first-accept-wins callee endpoint
- authenticated HTTP call actions
- call versioning and idempotency
- ring/connect/hard deadline generation fencing
- `shawtie.realtime.v2` content-free `call.changed`
- generic Web Push reachability
- relay-only TURN
- short-lived TURN credentials
- revocation and lifecycle termination
- final dissolution cleanup
- privacy-safe call history

C2 MUST NOT duplicate any of these concepts.

## 4. Persistence and migration decision

C2 requires no PostgreSQL migration by design.

The existing schema already supports:

- `call_type IN ('voice','video')`
- video in domain and contract call-kind vocabularies
- video in call history
- the same participant/endpoint authority for both kinds

C2 therefore reserves no migration number.

If implementation proves a new durable field is actually required, architecture and migration ownership must be amended before adding a forward-only migration. C2 must not speculatively claim `0019`.

The following remain transient and MUST NOT be persisted:

- camera on/off
- camera label
- camera device ID
- facing mode
- resolution
- frame rate
- codec choice
- RTP statistics
- remote video dimensions
- video sender/receiver state
- SDP
- ICE
- TURN credentials

## 5. Compatibility boundary

The finished C1 client already understands `kind: "video"` in the projection vocabulary but does not implement video media.

That means C2 needs a hard server boundary so a stale C1 bundle cannot accept a video call as an audio-only call by accident.

C2 introduces the client media profile:

`video-v1`

For `kind = video`:

- create MUST include `clientMediaProfile: "video-v1"`
- accept MUST include `clientMediaProfile: "video-v1"`
- signaling MUST negotiate `shawtie.call.v2`

For `kind = voice`:

- existing C1 requests remain valid without a media profile
- signaling remains `shawtie.call.v1`
- existing C1 candidate payloads remain unchanged

A stale C1 client may still fetch, display, reject, or let a video call expire, but it cannot become the selected accepted video endpoint.

No server path silently reinterprets video as voice.

## 6. Why video uses shawtie.call.v2

C1 has exactly one audio m-line and reconstructs trickled candidates with `sdpMLineIndex: 0`.

A C2 video call has one audio m-line and one video m-line. A raw candidate string alone is not a sufficient robust application contract for associating a candidate with the correct media description.

C2 therefore keeps C1 voice signaling frozen and introduces:

`shawtie.call.v2`

The v2 frame envelope retains the same generation-fenced signaling model but extends ICE candidate payloads with bounded media-description location metadata:

- `candidate`
- `sdpMid` nullable
- `sdpMLineIndex` nullable

At least one of `sdpMid` or `sdpMLineIndex` must be present.

The server still validates the candidate text itself as relay-only and privacy-safe.

C2 v2 does not add camera-state signaling.

## 7. Video SDP policy

Voice v1 remains:

- exactly one `m=audio`
- no video
- no application/data channel
- no candidate lines in SDP

Video v2 requires:

- exactly one `m=audio`
- exactly one `m=video`
- no `m=application`
- no additional media sections
- no candidate lines
- no end-of-candidates lines
- bounded SDP size and line count

The server validates SDP against the durable call kind before forwarding.

A video SDP sent for a voice call fails closed.

A voice-only SDP sent for a video call fails closed during initial C2 negotiation.

## 8. Call creation and local consent

### Caller

The caller explicitly selects **Video call**.

That action may request microphone and front-camera access locally before durable call creation, just as C1 already pre-acquires microphone on explicit Call.

No SDP, ICE, TURN authorization, or remote media begins before the callee accepts.

If microphone acquisition fails, no call is created.

If camera acquisition fails:

- do not silently create a voice call
- show a bounded local error
- offer explicit retry
- optionally offer an explicit user choice to continue the video-kind call with camera off
- optionally offer a separate explicit Voice call action

A video call remains `kind = video` even if one or both cameras are off.

### Callee

Ringing never activates microphone or camera.

The callee sees **Incoming video call** before acceptance.

C2 provides explicit choices:

- **Accept video**, which attempts microphone plus camera
- **Accept with camera off**, which acquires microphone only and still accepts the durable video-kind call

Both actions send the required `video-v1` media profile.

Camera permission alone never accepts the call.

## 9. Camera privacy state machine

Camera state is local only:

```text
off
 |
 | explicit local action
 v
acquiring
 | \
 |  \ failure
 |   v
 v  unavailable
on
 |
 +--> switching --> on
 |
 +--> explicit off --> off
 |
 +--> hidden/background --> off
 |
 +--> track ended --> off
 |
 +--> authority lost --> off
```

Every asynchronous camera operation is fenced by a monotonic in-memory `cameraGeneration`.

Increment generation when:

- starting camera acquisition
- switching camera
- turning camera off
- document becomes hidden
- call ends
- media ownership is lost
- selected endpoint/session is revoked
- partnership authority changes

A stale `getUserMedia()` result MUST immediately stop its returned tracks and MUST NOT attach to sender or preview.

## 10. Camera acquisition policy

Initial preferred capture:

- facing mode: `user`
- width: ideal 1280, max 1280
- height: ideal 720, max 720
- frame rate: ideal 24, max 30

If constraints fail with `OverconstrainedError`, retry through a deterministic lower tier without looping permission prompts.

Do not enumerate camera labels before permission.

Server APIs never receive camera labels or device IDs.

## 11. Stable media topology

Voice call:

- existing C1 audio topology only
- `shawtie.call.v1`

Video call:

- one audio sender/receiver
- one stable video transceiver for the call lifetime
- `shawtie.call.v2`

Create the video transceiver during initial accepted-call negotiation even when the local camera is currently off.

The video transceiver remains present for the call lifetime.

Routine camera operations MUST NOT add/remove m-lines.

## 12. Camera on/off and switch

### Camera on

1. verify canonical call is accepted or connected
2. verify current device still owns the selected endpoint
3. capture `cameraGeneration`
4. acquire one video track
5. discard immediately if generation became stale
6. attach with `RTCRtpSender.replaceTrack(videoTrack)`
7. attach same track to muted local preview
8. stop any superseded track
9. update local camera state

### Camera off

1. increment `cameraGeneration`
2. `replaceTrack(null)`
3. stop local camera track
4. clear local preview
5. retain video transceiver
6. keep audio and durable call state unchanged

### Camera switch

Prefer:

1. acquire replacement camera track
2. generation-check it
3. replace existing video sender track
4. update preview only after successful replacement
5. stop old track

On mobile browsers that cannot open both cameras at once, stop the old track first, enter a bounded switching state, then acquire the requested facing mode.

A failed switch never ends the audio call and never silently chooses an unrelated camera.

## 13. Media controller structure

Do not turn the existing C1 `CallingPanel` into a monolith.

Refactor calling media into:

- shared call session controller
- audio controller inherited from C1
- C2 camera controller
- rendering state exposed to React

Recommended files:

- `apps/web/src/features/calling/media-controller.ts`: shared peer/signaling/ICE ownership
- `apps/web/src/features/calling/camera-controller.ts`: camera generation, constraints, switch/off lifecycle
- `apps/web/src/features/calling/CallingPanel.tsx`: call action/UI state
- optional `VideoSurface.tsx`: local/remote rendering only

The C1 voice path MUST remain covered by existing tests after refactor.

## 14. Audio and video rendering

Keep remote audio on the verified C1 audio path.

Remote video uses a separate muted `<video autoplay playsInline>` element containing video only.

Local preview is:

- muted
- `playsInline`
- never recorded
- never uploaded
- cleared as soon as camera turns off or authority is lost

Separate rendering avoids coupling remote-audio autoplay recovery to remote-video rendering.

If remote video `play()` is blocked or fails, audio remains authoritative and UI may offer **Tap to show video** without a durable call mutation.

## 15. Remote video availability

C2 does not send a durable camera-state flag.

The remote UI derives availability from WebRTC track state and rendering progress.

Use neutral wording such as:

- Video unavailable
- Camera is off

Do not claim why the remote video stopped unless the local endpoint actually knows.

If implementation evidence proves a dedicated transient camera-state frame is necessary, that requires an explicit follow-up protocol review instead of silently adding a critical frame.

## 16. Background and foreground privacy

When the document becomes hidden:

- increment `cameraGeneration`
- detach/stop local camera
- clear local preview
- keep audio according to verified C1/platform behavior
- keep durable call authority unchanged

On foreground:

- refetch/reconcile canonical call state
- verify endpoint ownership
- do not silently reacquire camera
- require explicit **Turn camera on**

This gives deterministic privacy behavior across mobile browser differences.

## 17. Network and quality policy

Relay-only privacy remains non-negotiable:

`iceTransportPolicy = relay`

C2 does not change TURN authorization.

Baseline video capture is bounded to 720p and 30 fps.

Browser congestion control remains the primary adaptation mechanism.

Where supported and verified, the video sender may apply a conservative maximum bitrate through `RTCRtpSender.setParameters()`. Failure to set a bitrate cap MUST NOT break the call.

Audio continuity has priority over preserving video quality.

On network transition:

- reuse C1 signaling reconnect
- use relay-only ICE restart
- never fall back to host or srflx connectivity
- video may temporarily freeze/degrade while audio remains active

## 18. Permissions Policy

C1 currently serves:

`camera=(), microphone=(self)`

C2 implementation changes same-origin policy to:

`camera=(self), microphone=(self)`

Do not use `camera=*`.

The policy only makes same-origin camera access possible. Actual capture still requires browser permission and explicit local product action.

## 19. Operational controls

C2 adds:

`C2_VIDEO_ENABLED`

Rules:

- defaults off in production until C2 acceptance closes
- video create fails closed when disabled
- video accept fails closed when disabled
- voice calls remain governed by existing C1 controls
- `C1_TRANSPORT_ENABLED` still controls signaling/TURN for both voice and video
- disabling C2 never rewrites an existing video call into voice

Existing accepted/connected video calls may be allowed to finish when only new-video creation is disabled. A separate emergency transport disable still uses the C1 transport kill switch.

## 20. Realtime and push

No new realtime event family is needed.

C2 continues to use:

- `shawtie.realtime.v2`
- content-free `call.changed`
- canonical HTTP refetch
- generic call Web Push

Push payload remains privacy-minimized and does not need video metadata.

The authenticated app learns `kind = video` after canonical fetch.

## 21. Lifecycle behavior

C2 inherits C1 exactly:

- active: normal initiation/acceptance
- `breakup_pending`: each new video call requires fresh explicit acceptance
- `account_deletion_pending`: new calls denied and active calls terminate per C1 policy
- session/device revocation: selected endpoint authority ends
- final dissolution: call terminates, TURN refresh denied, history deleted with partnership

Camera and microphone tracks stop immediately when local authority is lost.

Stale camera promises remain generation-fenced after revocation.

## 22. Security and privacy

Captured video is HIGHLY_SENSITIVE transient endpoint media.

Application servers MUST NOT receive plaintext video.

TURN relays carry encrypted WebRTC traffic, not application plaintext.

Never persist or routinely log:

- video frames
- screenshots
- camera device labels
- camera device IDs
- SDP
- ICE candidates
- TURN credentials
- RTP packet/header dumps
- detailed per-user codec capability inventories

Camera labels and device IDs remain local even after permission.

## 23. No voice regression

C2 MUST preserve:

- C1 voice create/accept request compatibility
- `shawtie.call.v1`
- one-audio-m-line validation
- legacy C1 candidate payload
- C1 physical privacy properties
- C1 multi-tab ownership generation fencing
- C1 stale-owner fix at `b29aaa1`

Every C2 closure run includes the retained C1 closure.

## 24. Implementation slices

### C2-A Contracts, compatibility, and feature gate

Files:

- `packages/contracts/src/calls/http.ts`
- new `packages/contracts/src/calls/signaling-v2.ts`
- `packages/contracts/src/index.ts`
- `apps/api/src/config.ts`

Implement:

- `clientMediaProfile: "video-v1"`
- video-specific accept schema
- `shawtie.call.v2` schemas
- candidate m-line locator fields
- `C2_VIDEO_ENABLED`

### C2-B Server video enablement

Files:

- `apps/api/src/modules/calls/calling-service.ts`
- `apps/api/src/modules/calls/routes.ts`
- `packages/db/src/repositories/calls.ts`

Implement:

- stop hardcoding `kind: "voice"`
- pass validated `input.kind`
- require media profile for video create/accept
- return update-required/unsupported error for stale clients
- extend endpoint authorization result with call kind
- no schema migration

### C2-C Signaling v2

Files:

- `apps/api/src/modules/calls/signaling-validation.ts`
- `apps/api/src/modules/calls/signaling-hub.ts`
- calling WebSocket route

Implement:

- select v1 for voice and v2 for video
- kind-aware SDP validation
- v2 candidate `sdpMid/sdpMLineIndex`
- relay candidate validation unchanged
- generation fencing unchanged
- backlog/rate/backpressure unchanged

### C2-D Browser media engine

Files:

- `media-controller.ts`
- new `camera-controller.ts`
- browser harness

Implement:

- call-kind aware signaling
- v2 ICE candidate metadata
- stable video transceiver
- camera generation fencing
- replaceTrack on/off/switch
- separate audio/video rendering
- stop-on-hidden behavior
- no camera metadata server transmission

### C2-E Product UI

Files:

- `CallingPanel.tsx`
- optional `VideoSurface.tsx`
- styles
- `vite.config.ts`

Implement:

- Voice call and Video call actions
- Incoming video call wording
- Accept video / Accept with camera off
- local preview
- remote video
- camera on/off
- switch camera
- video unavailable states
- responsive portrait-first controls
- Permissions Policy camera self only

### C2-F Reliability and security closure

Add:

- contract/domain tests
- API/security integration
- signaling v1 regression
- signaling v2 tests
- stale old-client acceptance denial
- camera stale-promise tests
- camera leak tests
- network/ICE restart tests
- lifecycle/revocation tests
- log/privacy scans

### C2-G Automated local closure

Planned commands:

```text
npm run test:c2
npm run test:c2:postgres
npm run test:c2:local
npm run test:c2:browser:e2e
npm run test:c2:closure
```

C2 closure MUST run retained C1 closure first or as an integrated dependency.

No migration reservation is permitted.

### C2-H Physical Android closure

Planned commands:

```text
npm run test:c2:device:prepare
npm run test:c2:device:cleanup
```

C2 is not DONE until the canonical physical Android matrix passes on the Redmi Note 9S.

## 25. Closure boundary

C2 is DONE only when:

- video create/accept compatibility gate works
- stale C1 clients cannot accept video
- voice C1 behavior remains green
- video uses `shawtie.call.v2`
- video SDP is exactly audio + video and candidate-free
- v2 trickle candidates retain correct m-line association
- selected connection remains relay-only
- camera never starts from remote action or notification
- camera off releases local capture
- background stops camera and foreground does not silently restart it
- front/back switching is generation-safe
- audio survives routine camera operations
- lifecycle/revocation stops all local tracks
- no camera metadata or media enters durable server state
- automated/local closure is green
- physical Android acceptance is green
- documentation and exact tested SHA are recorded
- all commits retain `[skip ci]` while hosted Actions capacity is unavailable

Until those gates execute, C2 remains implementation-in-progress even if source code is complete.
