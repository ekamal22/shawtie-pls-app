# C1 Call Signaling Protocol

## Status

DESIGN COMPLETE. SOURCE IMPLEMENTATION AND FINAL INTEGRATED AUTOMATED/LOCAL CLOSURE COMPLETE ON BRANCH. PHYSICAL ACCEPTANCE PENDING.

Branch: `feat/c1-voice-calling`

Required base: `main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`

Protocol identifier:

shawtie.call.v1

Endpoint:

/api/v1/calls/:callId/signal

Final integrated automated/local signaling verification passed at `9b5c255b5e8c60cbe8da4bcd2b6f7596c56687a0` against real migrations 0001 through 0018 with `reserved=0`. Physical relay-path and Android acceptance remain open.

Purpose:

Transient WebRTC negotiation for one already-accepted call.

Durable call actions stay on HTTP.

M2 realtime stays content-free and does not carry SDP or ICE.

## Security boundary

The signaling WebSocket is accepted only when:

- Origin exactly matches the trusted application origin
- existing HttpOnly session cookie is present and valid
- session is not expired or revoked
- device is current
- call exists in the current partnership
- call is accepted or connected
- current device matches the selected `endpoint_device_id` on its caller/callee participant role row
- the client offered exactly one WebSocket application subprotocol and it is `shawtie.call.v1`
- the call route verifies the negotiated socket protocol is exactly `shawtie.call.v1`
- connection and abuse policy allow the upgrade
- per-message compression is disabled

The callId path parameter is lookup input only. It is not authorization.

## Transport properties

- text JSON application frames only
- binary application frames rejected
- per-message compression disabled
- strict closed runtime schemas
- bounded frame sizes
- bounded frame rate
- bounded ICE candidate count
- no application-frame logging
- privacy-safe close reasons
- one active signaling socket per call and selected device

Initial whole-frame ceiling: 65536 bytes. Initial SDP payload ceiling: 49152 bytes. Initial ICE candidate ceiling: 256 candidates per signaling generation. These are server policy values and may be reduced without changing the protocol.

If the shared WebSocket transport maxPayload rises above M2's 4 KiB ceiling for C1 SDP, M2 v1/v2 still enforce the existing 4 KiB application-frame check before JSON interpretation. The global selector rejects zero, multiple, and unknown application subprotocol offers; each route rechecks the exact protocol it owns.

## Envelope

Every frame has v, type, and a closed type-specific payload.

Unknown critical types fail the signaling generation.

Raw frame bodies are never logged.

## Server-derived connection context

The server binds each socket to:

- connectionId
- callId
- callVersion observed at upgrade
- accountId
- deviceId
- role: caller or callee
- signalingGeneration
- connectedAt

The browser does not choose a target account or device.

## Signaling generation

signalingGeneration fences transient negotiation state.

It is not a database capability token.

When a newer socket supersedes an older socket for either endpoint, the hub begins a new signaling generation and invalidates stale frame callbacks.

If one endpoint reconnect requires a new generation, the server notifies or closes the peer signaling socket so both sides converge on the same generation.

A process restart loses in-memory generations. Both clients reconnect and establish a fresh generation from durable call authority.

## control.ready

Server to client:

~~~json
{
  "v": 1,
  "type": "control.ready",
  "payload": {
    "connectionId": "uuid",
    "callId": "uuid",
    "callVersion": 6,
    "role": "caller",
    "signalingGeneration": "opaque-string",
    "peerPresent": false
  }
}
~~~

Receiving ready does not mean media is connected.

## control.peer_joined

Server to client:

~~~json
{
  "v": 1,
  "type": "control.peer_joined",
  "payload": {
    "signalingGeneration": "opaque-string"
  }
}
~~~

The caller may create the initial offer after the accepted callee endpoint has joined the same generation.

## control.peer_left

Server to client:

~~~json
{
  "v": 1,
  "type": "control.peer_left",
  "payload": {
    "signalingGeneration": "opaque-string",
    "reason": "reconnect|socket_closed|authorization_changed"
  }
}
~~~

The client refreshes canonical call state before deciding whether the call ended.

## Candidate and SDP privacy rule

SDP is candidate-free: candidate/end-of-candidates lines are stripped client-side and rejected server-side. ICE travels only through `signal.ice_candidate`.

C1 SDP contains exactly one audio media section. Video, application/data-channel, and unexpected extra media sections are rejected and bounded by line/media-section/byte limits.

Every trickle candidate is parsed before forwarding: type must be `relay`; host/srflx/prflx/malformed/unknown types fail; `raddr`, `rport`, or equivalent related/base-address fields may not disclose a non-relay peer address. Candidate count/bytes are bounded per signaling generation.

This is defense in depth above `iceTransportPolicy: "relay"`.

## signal.description

Bidirectional forwarded frame:

~~~json
{
  "v": 1,
  "type": "signal.description",
  "payload": {
    "signalingGeneration": "opaque-string",
    "descriptionType": "offer",
    "sdp": "..."
  }
}
~~~

descriptionType is offer or answer.

SDP is transient, never persisted, never logged, contains no ICE candidate lines, satisfies the C1 single-audio-media policy, and is forwarded only to the authorized peer.

## signal.ice_candidate

Bidirectional forwarded frame:

~~~json
{
  "v": 1,
  "type": "signal.ice_candidate",
  "payload": {
    "signalingGeneration": "opaque-string",
    "candidate": {
      "candidate": "candidate:...",
      "sdpMid": "0",
      "sdpMLineIndex": 0,
      "usernameFragment": "optional"
    }
  }
}
~~~

Candidates are transient and never persisted or logged.

Count and byte limits apply. The server requires `typ relay` and rejects privacy-unsafe related/base-address serialization before forwarding.

The browser is configured relay-only.

## signal.ice_complete

Bidirectional:

~~~json
{
  "v": 1,
  "type": "signal.ice_complete",
  "payload": {
    "signalingGeneration": "opaque-string"
  }
}
~~~

## control.resignal_required

Server to client:

~~~json
{
  "v": 1,
  "type": "control.resignal_required",
  "payload": {
    "signalingGeneration": "opaque-string",
    "reason": "peer_reconnected|hub_reset|ice_restart|unknown_state"
  }
}
~~~

Clients discard stale pending negotiation work and use the perfect-negotiation flow for the new generation.

## control.call_ended

Server to client:

~~~json
{
  "v": 1,
  "type": "control.call_ended",
  "payload": {
    "callVersion": 9
  }
}
~~~

The browser fetches canonical call state over HTTP and the socket closes.

## Perfect negotiation rules

C1 uses the perfect-negotiation pattern.

Initial deterministic roles:

- callee is polite
- caller is impolite

The implementation must handle simultaneous negotiationneeded events and ICE restarts without invalid signaling state.

## Candidate buffering

An ICE candidate can arrive before the corresponding remote description is installed.

The client buffers candidates per signaling generation until the remote description is ready.

Buffered candidates from an old generation are discarded.

## ICE restart

Either selected endpoint may detect relay failure or a network transition.

Recovery flow:

1. confirm canonical call remains non-terminal
2. obtain fresh TURN credentials when needed
3. ensure signaling socket is current
4. establish a fresh signaling generation if required
5. perform offer with ICE restart
6. apply perfect-negotiation collision handling
7. fail closed if relay connectivity cannot be restored

The browser does not remove iceTransportPolicy relay during recovery.

## Durable and transient boundaries

Durable HTTP owns initiate, accept, reject, cancel, endpoint connected reports, end, call timeout, call history, and lifecycle termination.

Transient signaling owns SDP, ICE candidates, peer signaling presence, and negotiation restart hints.

A signaling frame can never accept, reject, cancel, or end a call by itself.

## Reconnect semantics

If signaling is lost while media is healthy, the call does not end solely because the socket changed.

If media needs negotiation, both endpoints reconnect into a fresh signaling generation.

If an API process restarts, durable call state remains and both endpoints rebuild transient signaling state.

## Same-device multi-tab ownership

Only one browser tab may own C1 media for one `callId + deviceId`. It owns microphone, peer connection, and signaling. Observer tabs do not negotiate. A persisted owner generation fences stale callbacks; takeover after release/lease expiry increments generation, re-fetches canonical state, and opens a fresh signaling generation. Server one-active-socket-per-call/device remains the backstop.

## Multi-instance routing

The initial design does not add Redis.

When more than one API instance serves signaling, infrastructure must route the same callId signaling path to the same API instance for both endpoints.

This is an operational affinity requirement, not authorization.

If reliable affinity is unavailable, a shared signaling transport requires a new ADR.

PostgreSQL NOTIFY is not used for SDP.

## Backpressure and rate limits

Bound:

- signaling upgrades
- descriptions per generation
- ICE candidates per generation
- total bytes per generation
- reconnect attempts
- ping/pong abuse

Excessive frames fail closed without revealing foreign-call state.

## Logging

Allowed:

- opaque connection ID
- bounded first-party call reference where policy permits
- frame type
- byte count
- generic validation category
- close category

Forbidden:

- SDP
- ICE candidate text
- parsed candidate IP
- TURN credential
- push subscription endpoint
- media device label
- raw WebSocket frame

## Compatibility

`shawtie.call.v1` versions independently from both `shawtie.realtime.v1` and `shawtie.realtime.v2`.

C2 should reuse v1 if video is compatible.

S1 call-authentication changes must be versioned and reviewed rather than silently changing v1 semantics.

## Test obligations

Test:

- foreign and random call upgrade denial
- unaccepted call cannot signal
- non-winning callee device cannot signal
- revoked device cannot reconnect
- wrong Origin and subprotocol denial
- binary and oversized frame denial
- stale generation denial
- SDP and ICE absent from persistence and logs
- exactly one audio media section; video and application/data-channel SDP rejection
- privacy-unsafe relay related/base-address rejection
- rate and candidate limits
- perfect-negotiation collision
- candidate-before-description buffering
- signaling reconnect with live media
- same-device multi-tab single media owner and generation-fenced takeover
- process-loss reconnect
- ICE restart after network change
- call termination closes signaling
