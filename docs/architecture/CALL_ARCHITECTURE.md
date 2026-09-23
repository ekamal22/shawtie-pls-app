# Call Architecture

## Milestone split

C1 implements voice calling only.

C2 later adds video on top of the verified C1 call authority, signaling, TURN, push, history, and lifecycle substrate.

Built-in call recording remains deferred beyond stable release.

Canonical C1 design: `C1_VOICE_CALLING_DESIGN.md`.

Canonical C1 API: `../api/C1_CALLING_API.md`.

Canonical signaling protocol: `../api/C1_SIGNALING_PROTOCOL.md`.

Accepted call ADRs:

- `../adr/ADR-013-call-signaling-transport.md`
- `../adr/ADR-014-relay-only-call-privacy.md`

## Authority

PostgreSQL owns durable call identity, partnership scope, selected endpoint devices, call state/version, trusted timestamps, terminal outcome, timeout fencing, and history.

HTTP owns durable user call actions.

`shawtie.realtime.v2` adds only a content-free `call.changed` refresh hint.

`shawtie.call.v1` is a separate authenticated transient WebSocket for accepted-call SDP/ICE negotiation.

WebRTC owns transient endpoint media state.

TURN credentials authorize bounded relay use but are never partnership authorization.

Web Push is a generic wakeup hint, not call authority.

## Consent boundary

Calls never auto-answer.

Before explicit callee acceptance:

- no signaling socket is authorized
- no SDP or ICE is exchanged
- no TURN credential is issued
- no remote media session begins

Every call during `breakup_pending` still requires fresh explicit acceptance exactly like active-state calls.

## Media path

```text
caller browser
   |
WebRTC DTLS/SRTP
   |
TURN relay
   |
WebRTC DTLS/SRTP
   |
callee browser
```

C1 uses `iceTransportPolicy: relay` with no direct fallback.

SDP is candidate-free and the signaling server forwards only parsed `typ relay` trickle candidates.

TURN should support UDP and, where deployed, TCP/TLS fallbacks for restrictive networks.

TURN provider secrets never enter the PWA. Credentials are short-lived and issued only to the two selected endpoint devices of one accepted non-terminal call.

## Multi-device model

The initiating device is the fixed caller endpoint.

All currently authorized callee devices may ring, but the first eligible device to commit acceptance becomes the sole callee endpoint. Later accepts, signaling upgrades, and TURN requests from other callee devices fail.

C1 does not implement device handoff.

## Reachability

Foreground incoming calls use realtime v2 plus canonical HTTP fetch.

Background reachability uses a minimal reusable Web Push substrate. Payloads are generic and contain no caller identity or call ID; notification click validates the session and fetches `/api/v1/calls/current`.

If notifications are denied or Web Push is unsupported, foreground calling remains available while background reachability is explicitly degraded.

## Failure and timeout model

Server-generated deadlines bound:

- ringing
- accepted-but-never-connected negotiation
- stranded long-running non-terminal calls

Scheduled finalizers are version/generation fenced.

Signaling loss alone does not end a healthy media path. If renegotiation is required, endpoints reconnect into a fresh transient signaling generation and may perform relay-only ICE restart.

## Scale-out

C1 does not add Redis.

The initial deployment may run one signaling API replica. Multiple replicas require verified call-ID affinity so both selected endpoints land on the same signaling process. A shared signaling broker requires a later ADR.

## Cryptographic boundary

WebRTC transport encryption is required, but C1 does not claim the full S1 endpoint-identity/E2EE model.

S1 must review how call endpoint identity and DTLS fingerprints are bound to partnership cryptographic identity before sensitive stable-release use. C1 adds no custom media cipher.

## Call history

History is partnership-scoped and records only bounded metadata required by the PRD, including voice/video kind, direction, trusted timestamps/duration when connected, and terminal outcome.

Final dissolution deletes call history through the existing partnership deletion architecture.

## C2 video extension

Canonical C2 design: `C2_VIDEO_CALLING_DESIGN.md`.

Canonical C2 API/compatibility: `../api/C2_VIDEO_CALLING_API.md`.

Canonical signaling compatibility: `../api/C2_VIDEO_SIGNALING_COMPATIBILITY.md`.

Accepted C2 ADR: `../adr/ADR-015-stable-video-transceiver-and-camera-privacy.md`.

C2 enables `video` creation over the verified C1 substrate without creating a second call authority, signaling transport, TURN policy, push system, or history model.

A video-kind call has one stable `sendrecv` video transceiver. Camera state is local/transient, not durable call state.

Camera capture starts only after canonical acceptance plus explicit local video intent and browser permission. Backgrounding stops local camera capture, and foreground return never silently reacquires it.

C2 reuses candidate-free SDP, relay-only ICE candidate validation, `iceTransportPolicy: relay`, short-lived TURN credentials, selected-device authorization, realtime v2 invalidation, and `shawtie.call.v1`.

C2 v1 adds no camera-state signaling frame. If one proves necessary, a reviewed signaling protocol version change is required.

C1-only clients show update-required for a video call and never silently reinterpret it as voice.
