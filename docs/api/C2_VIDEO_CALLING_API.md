# C2 Video Calling API Contract

## Status

DESIGN COMPLETE. SOURCE IMPLEMENTATION NOT STARTED.

Architecture: `docs/architecture/C2_VIDEO_CALLING_DESIGN.md`

C2 reuses the existing `/api/v1/calls` HTTP surface. It does not create a separate video-call aggregate or namespace.

## 1. Existing call kinds

The canonical call kind vocabulary already contains:

- `voice`
- `video`

C2 enables durable creation of `video` under a separate feature gate.

## 2. Client media profile

C2 introduces a compatibility token:

`video-v1`

This is not security authority. It is a protocol compatibility requirement preventing a stale C1 bundle from becoming an accepted video endpoint.

For video create and video accept, the request MUST include:

```json
{
  "clientMediaProfile": "video-v1"
}
```

For voice, the field remains optional and existing C1 clients remain valid.

## 3. Create call

`POST /api/v1/calls`

Video request:

```json
{
  "expectedPartnershipId": "uuid",
  "kind": "video",
  "clientMediaProfile": "video-v1"
}
```

Voice request remains backward-compatible:

```json
{
  "expectedPartnershipId": "uuid",
  "kind": "voice"
}
```

Server rules:

- normal C1 authentication, lifecycle, idempotency and one-call invariant remain
- `C2_VIDEO_ENABLED` must be true for video
- video without `video-v1` fails closed
- caller device/session remains server-derived
- callee remains server-derived
- server persists the requested kind
- no camera information is accepted

Recommended public error for missing/unsupported video profile:

`CALL_MEDIA_PROFILE_UNSUPPORTED`

Recommended status: 409.

Disabled video feature returns a bounded unavailable/feature-disabled error without affecting voice.

## 4. Projection

No new durable projection fields are required.

Existing projection remains:

- id
- partnershipId
- kind
- direction
- state
- version
- trusted timestamps
- outcome
- isThisDeviceSelectedEndpoint

Do not add:

- cameraOn
- selectedCamera
- cameraDeviceId
- facingMode
- resolution
- frameRate
- videoConnected

## 5. Accept call

C2 SHOULD split the accept boundary from the generic C1 mutation schema so video compatibility can be verified explicitly.

Recommended video accept:

`POST /api/v1/calls/:callId/accept`

```json
{
  "expectedVersion": 3,
  "clientMediaProfile": "video-v1"
}
```

For voice calls:

```json
{
  "expectedVersion": 3
}
```

Rules:

- if call kind is video, `video-v1` is mandatory
- if call kind is voice, old C1 body remains valid
- capability token does not replace account/device/session/call authorization
- no camera permission or camera ID is sent
- first committed callee accept still wins
- a stale C1 client may reject, but cannot accept a video call

## 6. Reject, cancel, end and fail

Existing C1 endpoints remain unchanged.

Camera failure alone is not whole-call failure when audio remains healthy.

A user turning camera off is not a server mutation.

## 7. Endpoint connected

Existing endpoint-connected reporting remains unchanged.

Connected means the selected endpoint peer connection reached the C1 connected criterion.

It does not assert:

- camera active
- video frames flowing
- specific video quality

## 8. TURN

Existing TURN credential endpoint is reused.

Video gets no broader authorization.

The response remains relay-only.

## 9. Push and realtime

No new durable or push API is added.

Generic call push wakes the app.

`call.changed` causes canonical refetch.

The authenticated projection reveals `kind = video`.

## 10. History

Existing history already exposes kind.

A video-kind call remains video in history even if both cameras were off for part or all of the connected call.

History does not record camera usage duration.

## 11. Old client behavior

A stale C1 client:

- may fetch a video call projection
- may display a bounded update-required state
- may reject the call
- may let it expire
- MUST NOT accept it
- MUST NOT open video signaling
- MUST NOT cause the server to reinterpret it as voice

Another C2-compatible device may still win acceptance.

## 12. Caching and logs

Existing private no-store policy remains.

Never cache or routinely log:

- media profile with hardware detail
- camera information
- SDP
- ICE
- TURN credentials
- video stats

The only client capability token is the coarse constant `video-v1`.
