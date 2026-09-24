# C2 Video Calling API Contract

## Status

DESIGN COMPLETE. SOURCE IMPLEMENTATION NOT STARTED.

Architecture: `docs/architecture/C2_VIDEO_CALLING_DESIGN.md`

C2 reuses the existing `/api/v1/calls` surface and call aggregate.

## 1. Media profile

C2 defines exactly one coarse compatibility token:

`video-v1`

It is not security authority and carries no hardware detail.

## 2. Create schema

`callCreateSchema` becomes a strict discriminated union.

Voice remains the existing C1 request:

```json
{
  "expectedPartnershipId": "uuid",
  "kind": "voice"
}
```

Video is:

```json
{
  "expectedPartnershipId": "uuid",
  "kind": "video",
  "clientMediaProfile": "video-v1"
}
```

Unknown fields fail normal boundary validation.

Video without the exact profile returns:

`409 CALL_MEDIA_PROFILE_UNSUPPORTED`

Video also requires both:

- `C1_CALLING_ENABLED`
- `C2_VIDEO_ENABLED`

Disabled video returns the existing bounded feature-unavailable behavior and never falls back to voice.

The server persists `input.kind` through the existing repository.

## 3. Accept schema

Introduce:

`callAcceptMutationSchema`

Shape:

```json
{
  "expectedVersion": 3,
  "clientMediaProfile": "video-v1"
}
```

`clientMediaProfile` is optional at schema level because voice uses the same route.

Service rules after locking the authoritative call:

- voice: existing C1 accept remains valid without the field
- video: exact `video-v1` is mandatory
- profile validation occurs before idempotency replay lookup and before callee endpoint selection
- the profile is included in the idempotency request fingerprint when present

A video accept without the profile returns:

`409 CALL_MEDIA_PROFILE_UNSUPPORTED`

A stale C1 client therefore cannot receive a stored successful video-accept response through an idempotency replay.

## 4. Feature-flag semantics

`C2_VIDEO_ENABLED` controls new video admission only.

It gates:

- video create
- acceptance of a ringing video call

It does not block:

- current/detail/history reads
- reject
- cancel
- end
- already accepted/connected video signaling
- already accepted/connected video TURN refresh

The shared `C1_TRANSPORT_ENABLED` flag remains the transport kill switch for accepted voice and video calls.

If C2 is disabled after video acceptance, the in-flight call may finish normally.

## 5. Call projection

No durable projection fields are added.

Existing projection remains authoritative:

- id
- partnershipId
- kind
- direction
- state
- version
- trusted timestamps
- outcome
- isThisDeviceSelectedEndpoint

Do not add camera/device/rendering state.

## 6. Media permission semantics

Microphone behavior remains C1-derived.

Camera permission is never requested by the API and is never represented in the request.

For video:

- caller camera is not requested while ringing
- callee camera is not requested while ringing
- camera request occurs only after authoritative acceptance, selected-endpoint confirmation and local media-owner lease
- camera failure does not mutate durable call state if audio/peer connection remain healthy

## 7. Reject, cancel, end and fail

Existing C1 endpoints remain unchanged.

Camera off, camera switch, camera permission denial, or camera track ending are not durable call mutations.

Do not invoke `/fail` for a local camera-only problem while the call can continue with audio.

## 8. Endpoint connected

Existing endpoint-connected semantics remain unchanged.

Connected means the selected endpoint peer connection reached the existing C1 connected criterion.

It does not assert camera activity or flowing video frames.

## 9. TURN

The existing TURN credential endpoint is reused.

Video gets no broader authorization.

Relay-only policy remains mandatory.

`C2_VIDEO_ENABLED` is not rechecked for an already accepted video call. `C1_TRANSPORT_ENABLED` is.

## 10. Push and realtime

No new API/event family is added.

Reuse:

- generic call Web Push
- `shawtie.realtime.v2`
- `call.changed`
- canonical HTTP reconciliation

The push provider does not need video-kind detail.

## 11. History

Existing history already carries `kind`.

A video call remains video history even if either camera was off.

No camera-usage duration is stored.

## 12. Stable internal durable identifiers

C2 reuses the existing durable identifiers:

- `c1.call.changed`
- `c1.call.push`
- `c1.call.ringing_timeout`
- `c1.call.accepted_timeout`
- `c1.call.connected_timeout`

The historical prefix is not renamed during C2.

## 13. Old client behavior

A stale C1 client:

- may fetch a video projection
- may display update-required state
- may reject
- may let it expire
- cannot accept without `video-v1`
- cannot signal with v1
- cannot cause server downgrade to voice

Another C2-capable device may still win acceptance.

## 14. Caching and logging

Existing private no-store policy remains.

Never cache or routinely log:

- camera permission or identity
- camera state
- SDP
- ICE
- TURN credentials
- RTP/video statistics

The coarse `video-v1` token may appear only as bounded compatibility metadata if operational logging explicitly needs it.
