# C2 Video Calling API and Compatibility

## Status

DESIGN COMPLETE. SECOND-PASS HARDENED. IMPLEMENTATION BLOCKED UNTIL VERIFIED C1 IS MERGED.

Design branch: `feat/c2-video-calling`

Design parent: `feat/c1-voice-calling @ 6a416a51ee76743ae7d7810ed14a58a0e9f12fdf`

Architecture: `docs/architecture/C2_VIDEO_CALLING_DESIGN.md`

Signaling compatibility: `docs/api/C2_VIDEO_SIGNALING_COMPATIBILITY.md`

C2 reuses the C1 Voice Calling API.

C2 does not create a second durable video-call API.

## API namespace

/api/v1

## Primary change

C1 already defines call kind vocabulary containing:

- voice
- video

During C1 runtime, `POST /api/v1/calls` rejects `video` with `feature_not_available`. C2 enables `video` only after verified C1 is the runtime base.

C2 changes policy so an authorized client may create:

~~~json
{
  "expectedPartnershipId": "uuid",
  "kind": "video"
}
~~~

All C1 create-call rules remain:

- authenticated current session
- server-derived current account and device
- server-derived callee
- expected partnership is only a stale-namespace guard
- one non-terminal call per partnership
- Idempotency-Key
- server-created ring timeout
- content-free `call.changed` outbox event consumed through negotiated `shawtie.realtime.v2`
- incoming-call push after commit
- lifecycle and abuse checks

## Call projection

The existing C1 call projection remains sufficient.

Example:

~~~json
{
  "id": "uuid",
  "partnershipId": "uuid",
  "kind": "video",
  "direction": "incoming",
  "state": "ringing",
  "version": 3,
  "initiatedAt": "timestamp",
  "ringExpiresAt": "timestamp",
  "acceptedAt": null,
  "connectedAt": null,
  "endedAt": null,
  "terminalReason": null,
  "isThisDeviceSelectedEndpoint": false
}
~~~

No durable fields are added for:

- camera on/off
- selected camera
- facing mode
- device label
- resolution
- frame rate
- video sender state
- video receiver state

Camera state is transient local WebRTC state.

## Acceptance

POST /api/v1/calls/:callId/accept is unchanged.

The UI must show **Video call** before the user accepts a video call. Acceptance remains explicit and must never be inferred from notification click, camera permission, or prior call history.

The request does not need to send a camera device ID or camera permission state.

Acceptance means the user accepts the durable video-capable call session. It does not assert that either camera is active.

Browser camera permission and actual camera activation remain local and independent.

The remote peer cannot cause camera permission to be requested.

## Connected reporting

POST /api/v1/calls/:callId/endpoint-connected is unchanged.

Connected means the selected endpoint's RTCPeerConnection reached the required connected state under C1 policy.

It does not prove:

- local camera active
- remote camera active
- video frames flowing
- any specific resolution

C2 does not add server-authoritative camera connected timestamps, camera-on flags, or camera-on duration.

## End, reject, cancel, fail

C1 routes are reused unchanged.

A camera failure should not report the entire call failed when audio remains healthy.

If a video call cannot establish any usable WebRTC session, the existing bounded C1 failure categories are used.

C2 may refine client-only camera error categories without persisting browser exception text.

## TURN credentials

C1 TURN credential endpoint is reused unchanged.

Video receives no broader TURN authorization than voice. Candidate-free SDP and server-side relay-candidate validation from C1 remain mandatory.

The response still requires:

iceTransportPolicy = relay

No alternate direct-video transport is allowed.

## Current call and history

GET /api/v1/calls/current and GET /api/v1/calls are reused.

History `kind` is `video`.

History does not record whether a camera was on for the whole call.

Duration is still derived from trusted connectedAt and endedAt only.

## No camera endpoints

C2 intentionally does not add API routes such as:

- /camera/on
- /camera/off
- /camera/switch
- /camera/devices
- /video/resolution

Those are local media operations.

The server does not need camera device inventory or transient camera state to authorize the call.

## Incoming push

C1 push subscription and delivery infrastructure is reused.

The push payload remains the same generic privacy-minimized incoming-call wakeup used by C1.

It may distinguish a generic incoming call event sufficiently for the app to fetch canonical state, but it does not need to expose Video call text to the push provider.

After wakeup, the PWA fetches current call and learns kind video from the authenticated API.

## Older client behavior

A C1-only client that does not implement C2 must fail safely when canonical call `kind` is `video`.

Expected behavior:

- parse the durable call without crashing where the C1 schema already recognizes video
- do not open signaling as a video endpoint
- do not claim camera support
- show an update-required state for answering this video call
- allow another compatible device on the same callee account to answer
- otherwise let the call remain ringing until normal reject/cancel/missed behavior

The server must not reinterpret a video call as voice simply because an old client connected.

## Client capability detection

C2 browser code checks required Web APIs before enabling video initiation or acceptance.

Capability detection is advisory for UX. C2 does not persist a detailed camera/browser hardware inventory and does not trust client capability claims as security authority.

Server authorization remains based on account, device, partnership, lifecycle, call state, selected endpoint, and the enabled C2 feature policy.

The client must not send detailed hardware inventory to the server.

## Compatibility versioning

C2 should not require a new HTTP namespace.

`shawtie.call.v1` remains the signaling protocol because C2 uses the existing description/candidate primitives, candidate-free SDP, and relay-only trickle candidates.

C2 v1 adds no camera-state signaling frame. If implementation requires any new application signaling frame or incompatible semantic, introduce a reviewed `shawtie.call.v2` rather than silently redefining v1.

## Caching

Existing C1 no-store policy applies.

Do not cache call state, camera state, TURN credentials, or video compatibility responses in the service-worker Cache API.

## Security properties

C2 API preserves:

- no target account IDs from client
- no target device IDs from client
- privacy-safe foreign call lookup
- exact Origin/CSRF rules on HTTP
- selected-device signaling authorization
- explicit acceptance
- no pre-accept TURN issuance
- final-dissolution isolation

Camera permissions are outside server API authority.

## No server hardware inventory

C2 intentionally does not add device-capability registration for camera count, camera labels, facing modes, maximum resolution, or codecs.

The server therefore does not guarantee that every callee device can answer a video call. A C1-only/incompatible device shows update-required while another compatible device on the same account may answer. If no compatible device answers, normal cancel/reject/missed behavior applies.

This avoids turning local camera hardware into durable account metadata.

## Background privacy

No API mutation represents camera background state. When the C2 browser becomes hidden it locally stops video capture while leaving durable call authority unchanged. Foreground return requires explicit local camera re-enable.

## No voice downgrade

The server never rewrites a durable `video` call into `voice` because one endpoint lacks camera permission, has camera off, or runs an incompatible client. A video-kind call may continue audio-only transiently while retaining `kind = video` in durable authority/history.

## Video operational policy

Server/deployment policy may disable new video-call creation without disabling C1 voice calls.

A C2 client may also receive deployment policy that disables camera capture/reacquisition. In that state a durable video-kind call may continue audio-only, but the client must not reinterpret history/kind as voice.

Policy disable never enables direct ICE or alternate signaling.

## Local rendering contract

C2 remote audio remains owned by the C1 audio element. Remote video uses a separate muted video-only element so video autoplay failure cannot silence audio.

Camera constraint tier, facing preference, wake-lock status, remote-video mute timer, and resource-downshift state are local only and are not accepted by this API.

## Implementation-line rule

This design branch is not the runtime implementation base. Before source implementation, C2 must be recreated/rebased onto the final merged/verified C1 mainline and the API compatibility assumptions rechecked.
