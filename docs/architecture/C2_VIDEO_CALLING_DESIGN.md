# C2 Video Calling Architecture and Implementation Design

## Status

**DESIGN COMPLETE. SOURCE IMPLEMENTATION COMPLETE THROUGH `3538228`. AUTOMATED/LOCAL AND PHYSICAL VERIFICATION PENDING.**

Implementation branch:

`feat/c2-video-calling`

Verified design base:

`main @ 5323d7be21e8776b45f507ec4cf60b9582544621`

Verified C1 executable baseline inherited by C2:

`b29aaa1dc62c9e3419c41084cddf4016a4f1bad8`

C1 is DONE and merged. C2 source implementation now exists on top of that verified substrate. The branch remains IN_PROGRESS until automated/local closure and the mandatory Redmi Note 9S acceptance matrix pass.

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

## 5. Compatibility and request-contract boundary

The finished C1 client understands `kind: "video"` in the projection vocabulary but does not implement video media.

C2 therefore needs a hard server boundary so a stale C1 bundle cannot become an accepted video endpoint.

C2 introduces exactly one coarse client media profile:

`video-v1`

### Create schema

`callCreateSchema` becomes a strict discriminated union on `kind`:

```text
voice:
  expectedPartnershipId
  kind = "voice"

video:
  expectedPartnershipId
  kind = "video"
  clientMediaProfile = "video-v1"
```

A video create request without the exact profile fails with:

`409 CALL_MEDIA_PROFILE_UNSUPPORTED`

Voice create remains byte-for-byte compatible with the existing C1 body.

### Accept schema

The shared accept route uses a new strict `callAcceptMutationSchema`:

```text
expectedVersion: positive integer
clientMediaProfile?: "video-v1"
```

The service MUST lock/load the call first, then enforce:

- video requires `video-v1`
- voice does not require a profile
- compatibility validation happens before idempotency replay lookup or endpoint selection

The profile participates in the idempotency request fingerprint when present.

This ordering prevents a request that lacks C2 compatibility from receiving a previously stored video-accept response merely because an idempotency key is replayed.

A stale C1 client may fetch, display, reject, or let a video call expire, but it cannot accept it and cannot open video signaling.

No server path silently reinterprets video as voice.

## 6. Signaling protocol split

Voice remains frozen on:

`shawtie.call.v1`

Video uses:

`shawtie.call.v2`

The same WebSocket route is reused.

The global WebSocket selector accepts exactly one offered application subprotocol from the existing realtime families plus call v1/v2. The call route then compares the negotiated protocol with the durable call kind.

Wrong call protocol fails before the signaling hub accepts the socket.

The existing `CallSignalingHub` remains one shared hub. It is extended with a small protocol dialect selected from durable call kind rather than duplicated into a video-specific hub.

Each accepted signaling connection carries:

- call ID
- durable call kind
- negotiated call protocol
- role
- selected device/session
- signaling generation

## 7. Exact video signaling shape

C2 v2 retains the C1 generation-fenced frame types:

- `control.ready`
- `control.superseded`
- `signal.description`
- `signal.ice_candidate`
- `signal.end_of_candidates`
- `signal.restart`

### SDP

Voice v1 remains exactly one audio media section.

Video v2 requires this deterministic media order:

```text
m-line 0: audio
m-line 1: video
```

Video SDP MUST contain:

- exactly one `m=audio`
- exactly one `m=video`
- audio before video
- no application/data-channel media section
- no additional media section
- no candidate lines
- no end-of-candidates lines
- bounded SDP size and line count

The server validates SDP against the durable call kind before forwarding.

### ICE candidate

Video v2 candidate payload is exactly:

```text
candidate: bounded string
sdpMid: bounded token or null
sdpMLineIndex: 0 | 1 | null
```

At least one of `sdpMid` or `sdpMLineIndex` MUST be non-null.

`sdpMid` is a 1 to 32 character token using only letters, digits, underscore, dot, or hyphen.

`sdpMLineIndex` is limited to 0 or 1.

If both are supplied, the client forwards both unchanged to `addIceCandidate`.

The candidate string independently passes the existing relay-only C1 parser. Candidate text is never persisted or logged.

### End of candidates

C2 v2 keeps one global empty `signal.end_of_candidates` payload.

The receiver applies:

`addIceCandidate(null)`

Do not invent per-m-line end markers in C2.

## 8. Camera consent boundary

C2 adopts a stricter rule than the earlier draft:

**Camera capture is never requested while the durable call is only ringing.**

This avoids camera prompts/capture in a losing tab or losing callee device and keeps the privacy boundary aligned with authoritative acceptance.

### Caller flow

When the caller selects **Video call**:

1. verify live realtime/offline preconditions
2. acquire microphone exactly as C1 does
3. store an in-memory `cameraIntent = on` for this call attempt
4. create the durable video call with `video-v1`
5. keep camera closed while ringing
6. after canonical state becomes accepted on this selected caller endpoint, acquire the media-owner lease
7. only then request camera if the original camera intent is still current
8. if camera acquisition fails, keep the video-kind call alive with audio and show camera unavailable

If the tab reloads, loses media ownership, backgrounds before camera starts, or otherwise loses the transient intent, camera defaults to off. It never reconstructs camera intent from durable state.

If microphone acquisition fails, no outgoing call is created.

### Callee flow

Ringing never requests microphone or camera.

The incoming UI exposes:

- **Accept video**
- **Accept with camera off**
- **Reject**

For either accept action:

1. acquire microphone before the authoritative accept exactly as C1 does
2. send accept with `video-v1`
3. first committed accept still selects the callee endpoint
4. acquire the media-owner lease on the winning selected endpoint
5. only **Accept video** sets transient camera intent and requests camera after successful accept plus lease ownership
6. **Accept with camera off** never requests camera

A losing tab/device MUST stop its pre-acquired microphone and MUST NOT request camera.

Camera permission failure after a successful video accept is a local camera failure, not whole-call failure. Audio continues when its track and peer connection remain healthy, and durable kind remains `video`.

## 9. Camera privacy state machine

Camera state is local only:

```text
off
 |
 | accepted selected endpoint
 | + current local camera intent
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
 +--> authority/ownership lost --> off
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

A stale `getUserMedia()` result MUST immediately stop every returned track and MUST NOT attach to sender or preview.

Camera generation is never persisted or signaled.

## 10. Camera acquisition and switching policy

Initial camera request uses:

- facing mode `user`
- width ideal/max 1280
- height ideal/max 720
- frame rate ideal 24, max 30

Fallback is deterministic:

1. preferred 720p tier
2. same facing mode with width/height ideals removed
3. same facing mode with only a 30 fps maximum
4. fail camera acquisition

Only `OverconstrainedError` advances to the next constraint tier.

Permission denial, security errors, missing media devices, or arbitrary browser failures do not loop through tiers.

Do not enumerate camera labels before permission.

For explicit front/back switching:

- request the opposite facing mode explicitly
- never silently fall back to an unrelated camera
- if the browser cannot open both cameras simultaneously, stop the old camera first, then attempt the requested facing mode
- if that attempt fails, camera remains off and audio continues
- no automatic reacquisition of the old camera occurs without a new local action

Camera labels/device IDs remain local even after permission.

## 11. Stable media topology

Voice remains the verified C1 topology and protocol.

Video creates one peer connection with:

- one audio sender/receiver
- one stable video transceiver
- `shawtie.call.v2`
- `iceTransportPolicy: "relay"`
- `bundlePolicy: "max-bundle"`
- `iceCandidatePoolSize: 0`

For a video call, construct media in deterministic order:

1. add the local audio track first
2. add one `video` transceiver with direction `sendrecv`

That guarantees the expected initial media ordering: audio index 0, video index 1.

The video sender initially has no track unless camera acquisition has already completed after acceptance and ownership.

Routine camera on/off/switch MUST use the existing video sender and MUST NOT add/remove transceivers or media sections.

## 12. Camera on/off and switch

### Camera on

1. verify canonical call is accepted or connected
2. verify this device is still selected
3. verify this tab still owns the media lease
4. increment/capture `cameraGeneration`
5. acquire one requested video track
6. stop it immediately if generation or ownership became stale
7. attach with `RTCRtpSender.replaceTrack(videoTrack)`
8. attach the same track to muted local preview
9. stop any superseded track
10. update local camera state

### Camera off

1. increment `cameraGeneration`
2. `replaceTrack(null)`
3. stop local video track
4. clear preview
5. retain transceiver
6. retain audio and durable call state

Camera off never mutates call version and never calls a server camera endpoint.

### Camera switch

1. increment/capture generation
2. request the explicit opposite facing mode
3. validate generation and ownership
4. replace the video sender track
5. update preview only after replacement succeeds
6. stop superseded track

If old hardware must be released first and replacement fails, camera remains off.

Camera failure alone MUST NOT call the durable `/fail` endpoint while the peer connection and audio remain healthy.

## 13. Media-controller implementation boundary

Do not grow the existing `CallingPanel` into the WebRTC state machine.

Required structure:

- `media-controller.ts`: selected-endpoint lease, peer connection, audio, signaling, TURN, network recovery, endpoint-connected reporting
- new `camera-controller.ts`: camera intent, generation fencing, constraints, on/off/switch, local preview track
- new `VideoSurface.tsx`: rendering only
- `CallingPanel.tsx`: product actions and presentation state

`CallMediaSession` becomes call-kind aware.

The camera controller can operate only after the shared media session owns the C1 `MediaOwnerLease`.

Remote media is split into dedicated streams:

- audio tracks feed the existing remote audio element
- video tracks feed a video-only `MediaStream` bound to the muted `VideoSurface`

Never bind remote video audio to the video element.

Remote camera availability is inferred from WebRTC video-track/render state. C2 sends no camera-state frame.

The C1 voice path MUST remain behaviorally unchanged and covered after the refactor.

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

If remote video `play()` is blocked or fails, audio remains authoritative and the UI MUST expose **Tap to show video** retry without a durable call mutation.

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

C2 v1 does not implement application-driven bitrate adaptation or stats-based quality control. Browser WebRTC congestion control owns adaptation. This keeps the first video milestone out of fragile device-specific tuning and avoids collecting per-user RTP statistics.

Audio continuity has priority over preserving video quality. A user may explicitly turn camera off when bandwidth is constrained.

On network transition:

- reuse C1 signaling reconnect
- use relay-only ICE restart
- never fall back to host or srflx connectivity
- video may freeze/degrade while audio remains active

## 18. Permissions Policy

C1 currently serves:

`camera=(), microphone=(self)`

C2 changes the trusted application origin to:

`camera=(self), microphone=(self)`

Do not use `camera=*`.

This header only permits the trusted origin to request camera. It does not authorize capture.

Camera still requires:

- an accepted selected video endpoint
- current media-owner lease
- current local camera intent
- browser permission

## 19. Operational-control truth table

C2 adds `videoEnabled` to the shared calling configuration, sourced from:

`C2_VIDEO_ENABLED`

Default:

- production: false
- development/test: true

Exact behavior:

| Operation | C1_CALLING_ENABLED | C1_TRANSPORT_ENABLED | C2_VIDEO_ENABLED |
| --- | --- | --- | --- |
| create voice | required | not required until accept | ignored |
| create video | required | not required until accept | required |
| accept ringing voice | not rechecked after create | required | ignored |
| accept ringing video | not rechecked after create | required | required |
| reject/cancel/end/read/history | not required | not required | ignored |
| signaling/TURN for accepted voice | not required | required | ignored |
| signaling/TURN for accepted video | not required | required | ignored after acceptance |

If `C2_VIDEO_ENABLED` turns off while a video call is ringing, new acceptance fails closed. Reject, cancel and normal ring-timeout behavior remain available.

If it turns off after the call is already accepted/connected, the product flag does not kill the in-flight call. Existing selected endpoints continue to be eligible for signaling/TURN refresh while `C1_TRANSPORT_ENABLED` remains true and normal authorization still passes.

`C1_TRANSPORT_ENABLED` remains the emergency transport kill switch for both voice and video.

No flag ever rewrites a video call into voice.

## 20. Realtime, push, worker and durable identifiers

C2 does not fork the existing shared call delivery machinery.

Reuse unchanged:

- `shawtie.realtime.v2`
- content-free `call.changed`
- generic call Web Push
- `c1.call.changed` outbox event name
- `c1.call.push` outbox event name
- `c1.call.ringing_timeout`
- `c1.call.accepted_timeout`
- `c1.call.connected_timeout`

The historical `c1.` prefixes are stable internal identifiers for the shared call subsystem. Renaming them during C2 would create unnecessary durable compatibility risk and is explicitly out of scope.

The PWA synchronizer key remains `c1-call` internally for C2 to avoid unnecessary compatibility churn; user-visible labels become generic voice/video call language.

Push stays privacy-minimized. The authenticated canonical fetch reveals `kind = video`.

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

### C2-A Contracts and configuration

Files:

- `packages/contracts/src/calls/http.ts`
- new `packages/contracts/src/calls/signaling-v2.ts`
- `packages/contracts/src/index.ts`
- `apps/api/src/config.ts`
- `apps/api/src/application.ts`

Implement:

- strict voice/video create discriminated union
- new `callAcceptMutationSchema`
- `video-v1` profile
- `shawtie.call.v2` schemas and limits
- exact v2 candidate locator validation
- global empty end-of-candidates frame
- register v2 in the one-protocol global WebSocket selector
- `CallingConfig.videoEnabled` from `C2_VIDEO_ENABLED`

### C2-B API and durable authority

Files:

- `apps/api/src/modules/calls/calling-service.ts`
- `apps/api/src/modules/calls/routes.ts`
- `packages/db/src/repositories/calls.ts`

Route registration change:

- register `accept` separately with `callAcceptMutationSchema`
- keep only `reject`, `cancel`, and `end` in the existing generic version-mutation route loop

Implement in this order:

1. keep C1 voice request path unchanged
2. validate video feature/profile before idempotency replay
3. persist `input.kind` instead of hardcoded voice
4. expose durable call kind from endpoint authorization
5. use the existing participant endpoint-selection transaction
6. preserve existing `c1.call.*` outbox/deadline identifiers
7. add no migration

### C2-C Signaling v2

Files:

- `apps/api/src/modules/calls/signaling-validation.ts`
- `apps/api/src/modules/calls/signaling-hub.ts`
- calling WebSocket route

Implement:

- one hub, two strict call signaling dialects
- v1 only for voice
- v2 only for video
- audio index 0, video index 1
- candidate-free SDP
- exact v2 candidate locator
- global end-of-candidates
- existing relay candidate parser unchanged
- generation, rate, backlog and backpressure controls unchanged

### C2-D Browser media engine

Files:

- `media-controller.ts`
- new `camera-controller.ts`
- new `VideoSurface.tsx`
- browser harness

Implement:

- microphone pre-acquisition remains C1-derived
- no camera request while ringing
- camera intent is transient and in-memory
- media lease acquired before camera request
- call-kind aware signaling
- video peer configuration with max-bundle and zero candidate pool
- deterministic audio then video topology
- stable video transceiver
- camera generation fencing
- separate audio/video remote streams
- background camera stop
- no camera metadata server transmission

### C2-E Product UI

Files:

- `CallingPanel.tsx`
- `VideoSurface.tsx`
- styles
- `vite.config.ts`

Implement:

- separate Voice call and Video call actions
- Incoming video call wording
- Accept video
- Accept with camera off
- local preview
- remote video
- camera on/off
- explicit front/back switch
- camera unavailable/retry state
- responsive portrait-first controls
- Permissions Policy camera self only

### C2-F Reliability and security closure

Add:

- exact contract tests
- profile-before-idempotency tests
- feature-flag truth-table tests
- API/security integration
- signaling v1 regression
- signaling v2 tests
- wrong-kind protocol denial
- stale old-client acceptance denial
- no-camera-before-acceptance tests
- losing-device/tab never requests camera
- stale camera-promise tests
- camera leak tests
- network/ICE restart tests
- lifecycle/revocation tests
- existing accepted video continues after C2 product disable
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
