# ADR-015: Stable Video Transceiver and Camera Privacy

## Status

Accepted for C2 design. Implementation-blocking until verified C1 is the runtime base.

## Context

C2 must support camera on, camera off, and front/rear switching without introducing a second call authority or unnecessary renegotiation.

Camera capture is also a high-privacy browser capability.

A design that repeatedly adds and removes video transceivers would complicate SDP state and perfect negotiation.

A design that persists camera identifiers or automatically reacquires camera after interruption would weaken privacy.

## Decision

For calls created as kind video:

- create one video RTCRtpTransceiver during initial post-accept negotiation
- keep that transceiver for the call lifetime
- use an RTCRtpSender to attach or replace local video tracks
- prefer replaceTrack for front/rear switching
- turn camera off by removing/stopping the local sender track while retaining the transceiver
- do not upgrade an existing voice call to video in C2
- do not persist camera state or device identity
- do not access camera before explicit local video action and browser permission
- do not silently reacquire camera after an unexpected track-ended event
- stop local camera capture when the app becomes hidden/backgrounded and require explicit re-enable on foreground
- fence asynchronous camera acquisition/switch work with an in-memory generation so stale promises cannot reactivate capture
- preserve audio while video state changes whenever possible

## Camera privacy rules

The server must not receive or persist:

- camera label
- camera device ID
- facing mode
- local preview frames
- captured video frames
- camera permission state
- camera on/off history

If device enumeration is required, it occurs only on the client after permission where browser policy permits.

## Alternatives considered

### Add and remove video transceivers for camera toggles

Rejected because it creates unnecessary SDP churn and increases negotiation collision risk.

### Convert voice calls to video dynamically

Rejected for C2 because it requires a new bilateral consent state inside an existing accepted call.

### Persist camera state on the server

Rejected because camera state is transient, privacy-sensitive, and unnecessary for authorization.

### Keep camera track alive but hide preview when camera is off

Rejected as the primary behavior because hiding UI is not equivalent to releasing camera capture.

## Security impact

Positive.

Local camera use remains explicit and remote users cannot activate it.

Fewer renegotiations reduce signaling complexity.

## Privacy impact

Positive.

Camera hardware is released on explicit off where browser behavior permits, and unexpected track loss does not cause silent reacquisition.

## Data-classification impact

Camera device IDs and labels are SENSITIVE local metadata and are not persisted.

Captured video frames are HIGHLY_SENSITIVE transient media and never enter application servers.

## Migration impact

None expected. C2 reserves no migration number. If final verified C1 lacks a safe forward-compatible `video` call kind, C2 must add the next forward-only migration from the then-current integrated mainline rather than rewriting C1.

## Compatibility impact

C2 requires supported browser behavior for RTCRtpTransceiver and RTCRtpSender.replaceTrack.

Unsupported clients fail safely.

## Testing impact

C2 must test:

- camera never starts before acceptance
- front/rear switch
- camera on/off
- track-ended behavior
- audio continuity
- no device metadata persistence
- no unexpected renegotiation loop
- physical Android camera switching

## Evidence

- stable transceivers avoid repeated m-line churn during routine camera on/off/switch operations
- `RTCRtpSender.replaceTrack()` is designed for track replacement without changing the durable call model
- camera labels/device IDs are unnecessary for server authorization
- delayed `getUserMedia()` promises can otherwise race camera-off/background/end and reattach capture after user intent changed
- mobile background camera behavior is inconsistent, so proactive stop provides a deterministic privacy boundary

## Rollout plan

1. enable video call creation only after verified C1 is merged
2. create one stable video transceiver during initial accepted-call negotiation
3. implement generation-fenced camera acquisition/off/switch
4. enforce stop-on-hidden privacy behavior
5. verify audio continuity and relay-only transport in browser tests
6. close the full physical Android video matrix before general enablement

## Rollback and recovery

If C2 video behavior is unsafe or incompatible, disable creation/acceptance of `kind = video` while leaving verified C1 voice calling unchanged. Never fall back to hidden camera capture, direct peer ICE, server video proxying, or a silent video-to-voice reinterpretation.

## Documents amended

- `docs/architecture/CALL_ARCHITECTURE.md`
- `docs/architecture/SYSTEM_ARCHITECTURE.md`
- `docs/security/SECURITY_MODEL.md`
- `docs/security/THREAT_MODEL.md`
- `docs/testing/C2_ANDROID_ACCEPTANCE.md`
