# C2 Video Signaling Compatibility

## Status

DESIGN COMPLETE. C2 REUSES VERIFIED `shawtie.call.v1`; IMPLEMENTATION IS BLOCKED ON C1 CLOSURE.

C2 reuses:

`shawtie.call.v1`

from the verified C1 implementation. C2 does not fork a parallel signaling socket.

from C1.

## Why no new protocol is required

C1 signaling already transports standard WebRTC:

- candidate-free SDP offers
- candidate-free SDP answers
- separately trickled, server-validated relay ICE candidates
- negotiation generations
- reconnect/resignal control

Standard SDP can negotiate audio and video media sections.

C2 therefore does not create:

- shawtie.video.v1
- a second WebSocket
- a separate ICE channel
- durable video negotiation state

## Video-call negotiation

After durable video-call acceptance:

1. caller and accepted callee open authorized shawtie.call.v1 sockets
2. both join the same signaling generation
3. each creates the C2 peer connection
4. audio transceiver is configured
5. one stable video transceiver is configured as `sendrecv`
6. local tracks are attached only when locally authorized and available
7. perfect negotiation produces the initial SDP
8. ICE trickles through existing C1 frames and the server forwards only parsed `typ relay` candidates
9. relay-only TURN establishes media

No SDP or ICE is exchanged before acceptance.

## Stable video transceiver

A video call keeps one video transceiver for the call lifetime.

Routine camera operations use the existing sender:

- camera on: `replaceTrack(videoTrack)`
- camera off: `replaceTrack(null)` and stop local track
- camera switch: `replaceTrack(newVideoTrack)`

This avoids creating a new m-line for every camera toggle.

If a browser requires renegotiation for a replacement, C1 perfect negotiation handles that within the same signaling protocol and a current signaling generation.

## No voice-call upgrade

A C1 voice call has no C2 video contract.

C2 does not dynamically add video to an existing voice call.

This means a voice call never needs to interpret unexpected video negotiation.

## Track receipt

Remote video is handled through RTCPeerConnection track events.

The remote UI treats video availability as transient.

Loss of the video track does not by itself end the call.

## Camera state

C2 does not add a durable or trusted camera-state signaling frame.

Remote UI should derive media availability from WebRTC state.

C2 v1 deliberately adds no camera-state frame. Remote UI derives video availability from WebRTC media/track behavior and uses neutral `video unavailable` wording when intent cannot be known.

If implementation evidence proves an application camera-state frame is required for reliable interoperability, that is a protocol change. Introduce a reviewed `shawtie.call.v2`; do not silently add a new critical frame type to v1.

## Perfect-negotiation inheritance

All C1 rules remain:

- polite and impolite peer roles
- making-offer collision handling
- signaling-generation fencing
- candidate buffering until remote description
- stale generation rejection
- process-loss recovery
- signaling reconnect while media may remain alive

C2 tests add video-track changes and camera switches to the same matrix.

## ICE and TURN inheritance

C2 preserves:

`iceTransportPolicy = relay`

Video does not permit direct candidates as a fallback.

TURN credentials use the same C1 endpoint and expiry rules.

Camera switching cannot cause a change to direct connectivity.

## Frame privacy

Existing signaling privacy rules remain.

Never persist or log:

- video SDP, which remains candidate-free
- video ICE candidate text
- codec list extracted from SDP
- resolution negotiated through SDP
- RTP header detail tied to a user
- camera label or device ID

## Compatibility

A C1-only client must not attempt to answer a C2 video call as if it were voice.

A C2-compatible client may reuse shawtie.call.v1 because the wire primitives are unchanged.

If actual implementation needs an incompatible frame or semantic change, introduce a reviewed protocol version rather than overloading v1.

## Camera-operation generation

`cameraGeneration` is entirely local and is not a signaling field.

A stale asynchronous camera acquisition/switch result is stopped locally and never forwarded as a signaling state change. This prevents signaling from becoming a substitute for local camera authority.

## Backgrounding

Backgrounding does not create a signaling message. The local endpoint removes/stops its camera track. If that track replacement requires renegotiation on a supported browser, the existing perfect-negotiation path may run while the call/signaling session remains authorized; no new C2 message type is introduced.

## Realtime compatibility

C2 continues to use C1's negotiated `shawtie.realtime.v2` only for content-free `call.changed` canonical refresh hints. Camera on/off/switch state never enters realtime v2.
