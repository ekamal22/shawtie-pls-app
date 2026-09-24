# ADR-015: C2 Video Signaling and Camera Privacy

## Status

Accepted for C2 design.

## Context

C1 is verified and merged with voice-only `shawtie.call.v1`, one audio m-line, relay-only TURN, generation-fenced media ownership, and strict signaling validation.

C2 must add video without weakening C1 compatibility or camera privacy.

The finished C1 ICE payload assumes one media description. Video introduces a second m-line and requires correct candidate association.

Camera capture also introduces a high-privacy local capability whose transient state does not belong in durable server authority.

## Decision

C2 SHALL:

- reuse the C1 durable call aggregate
- require no PostgreSQL migration by default
- keep voice on `shawtie.call.v1`
- use `shawtie.call.v2` for video
- require `video-v1` client media profile on video create and accept
- keep one audio plus one stable video transceiver for video-call lifetime
- use `RTCRtpSender.replaceTrack()` for routine camera attach, detach, and switch
- fence asynchronous camera operations with local monotonic generation
- stop camera on document hidden/background
- require explicit local action to restart camera
- keep camera state transient and non-durable
- preserve relay-only ICE with no direct fallback
- preserve C1 voice wire compatibility and retained closure

## Why v2 instead of extending v1

The C1 v1 candidate payload lacks media-description location metadata and the C1 receiver assumes m-line index 0.

Adding video candidate semantics to strict v1 would risk stale clients and would silently redefine a verified protocol.

A separate negotiated v2 for video provides a clear compatibility boundary while keeping the same WebSocket route and call authority.

## Camera privacy decision

The remote peer cannot activate local camera.

The server does not receive or persist:

- camera label
- camera device ID
- facing mode
- camera permission state
- camera on/off history
- local preview
- captured frames

Backgrounding stops camera locally.

Foregrounding does not silently reacquire it.

## Stable transceiver decision

Video calls create one video transceiver during initial negotiation.

Camera on/off/switch changes the sender track rather than repeatedly adding/removing media sections.

This minimizes negotiation churn and keeps audio stable.

## Alternatives rejected

### Extend shawtie.call.v1 with video candidate semantics

Rejected because v1 is verified voice-only and strict old clients assume one audio m-line.

### Create a second video-call aggregate

Rejected because call identity, lifecycle, endpoint selection, history, deletion and deadlines are media-kind independent.

### Persist camera state

Rejected because it is transient, privacy-sensitive and unnecessary for authorization.

### Keep camera capture alive while visually hiding it

Rejected as primary off behavior because hidden UI is not equivalent to releasing capture.

### Upgrade accepted voice calls to video

Rejected for C2 because it introduces a second bilateral consent state inside an existing call.

## Security impact

Positive.

C2 gains two independent compatibility boundaries:

- HTTP `video-v1`
- signaling `shawtie.call.v2`

Relay-only privacy remains unchanged.

## Data classification

Video plaintext: HIGHLY_SENSITIVE transient endpoint media.

Camera device metadata: SENSITIVE local metadata.

Neither enters durable application-server state.

## Migration impact

None expected.

C2 reserves no migration number.

## Rollout

1. implement C2 behind `C2_VIDEO_ENABLED`
2. keep production default off
3. close automated/local C2 gates with retained C1 closure
4. close Redmi physical acceptance
5. only then allow production video enablement

## Rollback

Disable `C2_VIDEO_ENABLED`.

Voice C1 remains available.

Do not downgrade video to direct ICE or silently reinterpret video as voice.
