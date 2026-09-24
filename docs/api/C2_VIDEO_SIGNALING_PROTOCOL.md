# C2 Video Signaling Protocol

## Status

DESIGN COMPLETE. SOURCE IMPLEMENTATION NOT STARTED.

C2 adds a dedicated negotiated subprotocol for video calls:

`shawtie.call.v2`

Voice calls continue to use the verified:

`shawtie.call.v1`

## 1. Why v2 is required

C1 v1 was intentionally designed for exactly one audio m-line.

Its ICE application payload carries only the raw candidate string, and the C1 client reconstructs remote candidates against m-line index 0.

Video calls require at least:

- one audio m-line
- one video m-line
- correct candidate association to media descriptions

C2 MUST NOT silently redefine the strict C1 v1 candidate payload.

Therefore video uses v2.

## 2. Transport route

C2 reuses the same authenticated route:

`/api/v1/calls/:callId/signal`

Protocol selection is call-kind aware:

- voice call: server accepts `shawtie.call.v1`
- video call: server accepts `shawtie.call.v2`
- wrong protocol for durable call kind fails closed

No second WebSocket endpoint is required.

## 3. Frame envelope

C2 v2 remains generation-fenced and text-only.

Recommended frame shape:

```json
{
  "v": 2,
  "type": "signal.description",
  "generation": 4,
  "payload": {}
}
```

Control semantics remain equivalent to C1:

- `control.ready`
- `control.superseded`
- `signal.description`
- `signal.ice_candidate`
- `signal.end_of_candidates`
- `signal.restart`

No camera-state frame is introduced.

## 4. SDP frame

Description payload:

```json
{
  "descriptionType": "offer",
  "sdp": "candidate-free SDP"
}
```

Video v2 validator requires:

- one audio media section
- one video media section
- no application/data media section
- no additional media section
- no candidate lines
- no end-of-candidates lines
- bounded byte and line limits

Server validation is based on durable call kind.

## 5. ICE candidate frame

Video v2 candidate payload:

```json
{
  "candidate": "candidate:...",
  "sdpMid": "1",
  "sdpMLineIndex": 1
}
```

Rules:

- `candidate` remains bounded
- `sdpMid` may be null
- `sdpMLineIndex` may be null
- at least one media locator must be present
- m-line index must be in the expected video-call range
- candidate text must independently pass existing relay-only parser
- raw peer candidate/IP evidence is not persisted or logged

The client reconstructs:

```text
RTCIceCandidateInit {
  candidate,
  sdpMid,
  sdpMLineIndex
}
```

Do not hardcode index 0 for video.

## 6. End of candidates

End-of-candidates should retain enough media association to be applied safely when browser behavior requires it.

If browser evidence shows one global end marker is sufficient under BUNDLE, keep the contract minimal.

If separate media association is required, use the same bounded locator shape as candidate frames.

This must be settled by automated Chromium plus Redmi evidence before closure.

## 7. Relay-only privacy

C2 inherits the C1 relay parser without relaxation.

Reject:

- host
- srflx
- prflx
- unknown candidate types
- malformed relay candidates
- relay candidate related/base address leakage

Video never enables direct fallback.

## 8. Perfect negotiation

C2 reuses C1 polite/impolite roles and signaling generation.

Stable video transceiver creation occurs before initial offer/answer.

Routine camera on/off/switch SHOULD use `replaceTrack` and avoid negotiation.

If a supported browser requires renegotiation, it uses the same perfect-negotiation path and current v2 generation.

## 9. Signaling reconnect

A lost signaling socket does not end healthy media by itself.

Reconnect:

- revalidates session/device/call authority
- uses a fresh signaling generation
- video call reconnect negotiates v2
- voice call reconnect remains v1
- relay-only ICE restart may occur

## 10. Compatibility

C1 voice client and server behavior remains frozen.

A C2-capable client:

- uses v1 for voice
- uses v2 for video

A C1-only client offering only v1 for a video call is rejected.

Video acceptance is already protected by the HTTP `video-v1` media-profile gate, so signaling is a second compatibility boundary.

## 11. No camera-state signaling

C2 does not send:

- camera permission
- camera device
- facing mode
- on/off history

Remote UI derives transient video availability from WebRTC tracks/rendering.

If a future product requirement truly needs explicit camera state, review a later protocol change rather than smuggling it into v2.
