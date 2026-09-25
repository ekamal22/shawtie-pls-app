# C2 Video Signaling Protocol

## Status

SOURCE AND AUTOMATED/LOCAL VERIFICATION COMPLETE AT `94e0e9329e083cb3d9bcf4e3b13ad60d4af2e978`. PHYSICAL VERIFICATION PENDING.

Video uses:

`shawtie.call.v2`

Voice remains frozen on:

`shawtie.call.v1`

## 1. Route and negotiation

Both protocols use:

`/api/v1/calls/:callId/signal`

The global WebSocket transport accepts exactly one offered supported subprotocol.

After session/device authorization, the call route loads selected-endpoint authorization including durable call kind and requires:

| Call kind | Required protocol |
| --- | --- |
| voice | `shawtie.call.v1` |
| video | `shawtie.call.v2` |

Wrong protocol fails closed before the hub accepts the socket.

The server keeps one shared signaling hub with a strict protocol dialect per connection.

## 2. Limits

C2 v2 uses bounded limits no weaker than C1:

- frame: 64 KiB
- SDP: 48 KiB
- candidate string: 2048 bytes
- candidates per signaling connection: 256
- existing per-minute frame and buffered-byte limits remain

M2 realtime application-frame limits remain unchanged.

## 3. Frame envelope

Every v2 frame contains:

```json
{
  "v": 2,
  "type": "signal.description",
  "generation": 4,
  "payload": {}
}
```

Allowed types:

- `control.ready`
- `control.superseded`
- `signal.description`
- `signal.ice_candidate`
- `signal.end_of_candidates`
- `signal.restart`

No camera-state frame exists.

## 4. SDP description

Payload:

```json
{
  "descriptionType": "offer",
  "sdp": "candidate-free SDP"
}
```

Video v2 requires deterministic media order:

- m-line index 0 is audio
- m-line index 1 is video

Exactly two media sections are permitted:

1. one `m=audio`
2. one `m=video`

Reject:

- video-before-audio order
- duplicate audio/video sections
- application/data-channel sections
- any third media section
- candidate lines
- end-of-candidates lines
- oversized/over-line-limit SDP

The durable call kind is checked before forwarding.

## 5. ICE candidate payload

Exact payload:

```json
{
  "candidate": "candidate:...",
  "sdpMid": "1",
  "sdpMLineIndex": 1
}
```

Schema:

- `candidate`: non-empty, at most 2048 bytes
- `sdpMid`: null or 1 to 32 characters matching `[A-Za-z0-9_.-]+`
- `sdpMLineIndex`: null, 0, or 1
- at least one locator is non-null

If both locators exist, preserve both.

The server does not need to interpret the semantic MID value. It validates only its bounded safe-token shape and the bounded index.

Candidate text independently passes the existing C1 relay-only parser.

The receiver constructs:

```text
{
  candidate,
  sdpMid,
  sdpMLineIndex
}
```

and passes it to `addIceCandidate`.

Video code never hardcodes index 0.

## 6. End of candidates

Exact v2 frame:

```json
{
  "v": 2,
  "type": "signal.end_of_candidates",
  "generation": 4,
  "payload": {}
}
```

It is global for the current ICE generation.

The receiver calls:

`addIceCandidate(null)`

C2 does not add per-media end markers.

## 7. Peer configuration

Video peer connection uses:

```text
iceTransportPolicy = relay
bundlePolicy = max-bundle
iceCandidatePoolSize = 0
```

TURN servers and short-lived credentials come from the existing C1 endpoint.

Media construction order is:

1. add audio track
2. add one video transceiver with direction sendrecv

This produces the expected initial audio/video m-line order.

## 8. Stable video transceiver

The video transceiver exists for the video-call lifetime.

Routine camera operations use its sender:

- on: `replaceTrack(videoTrack)`
- off: `replaceTrack(null)`, then stop track
- switch: `replaceTrack(replacementTrack)`

Routine camera operations must not create another video transceiver.

If a routine `replaceTrack()` causes `negotiationneeded` on a supported browser, the existing v2 perfect-negotiation handler processes it. C2 does not create a camera-specific renegotiation channel.

## 9. Relay-only privacy

C2 inherits the C1 relay candidate parser without relaxation.

Reject:

- host
- srflx
- prflx
- unknown candidate types
- malformed relay candidates
- privacy-unsafe related/base address forms

No direct fallback exists.

## 10. Perfect negotiation and generation

C2 reuses:

- polite/impolite roles
- making-offer collision handling
- candidate buffering
- signaling generations
- socket supersession
- reconnect behavior
- relay-only ICE restart

A stale signaling generation is ignored/rejected exactly as C1 requires.

## 11. Signaling reconnect

Healthy media does not end solely because the signaling socket closes.

Reconnect:

- reauthenticates session/device
- rechecks selected endpoint authorization
- rechecks durable call kind
- negotiates v2 for video
- receives a fresh signaling generation
- signaling reconnect alone does not force ICE restart; relay-only ICE restart occurs only on the existing network-failure or TURN-refresh recovery path

## 12. Compatibility

A C2-capable client:

- uses v1 for voice
- uses v2 for video

A C1-only client offering v1 for video is rejected.

HTTP `video-v1` acceptance is the first compatibility boundary. Signaling v2 is the second.

Neither boundary is a substitute for account/device/call authorization.

## 13. Logging

Never persist or routinely log:

- SDP
- candidate text
- peer addresses
- MID values tied to raw candidate evidence
- TURN credentials
- raw signaling frames

## 14. Server implementation shape

Do not create a second signaling hub.

Extend the existing connection authorization record with:

```text
kind: "voice" | "video"
protocol: "shawtie.call.v1" | "shawtie.call.v2"
```

The protocol dialect owns only:

- client/server frame parser
- frame version constant
- SDP validator
- candidate payload normalization

Shared hub behavior remains common:

- endpoint/session revalidation
- one active socket per call/device
- generation assignment
- pending-frame buffering
- candidate count
- frame rate limit
- backpressure
- peer routing
- supersession

This prevents C2 from duplicating C1 authorization/recovery logic.
