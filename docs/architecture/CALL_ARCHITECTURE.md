# Call Architecture

## Milestone split

C1 source implementation and final integrated automated/local closure for voice calling are complete on `feat/c1-voice-calling`; the integrated closure passed at `9b5c255b5e8c60cbe8da4bcd2b6f7596c56687a0` against real migrations 0001 through 0018 with `reserved=0`. Mandatory physical Android acceptance is the only remaining C1 closure item. C1 implements voice calling only.

C2 later adds video on top of the verified C1 call authority, signaling, TURN, push, history, and lifecycle substrate.

Built-in call recording remains deferred beyond stable release.

Canonical C1 design: `C1_VOICE_CALLING_DESIGN.md`.

Canonical C1 API: `../api/C1_CALLING_API.md`.

Canonical signaling protocol: `../api/C1_SIGNALING_PROTOCOL.md`.

Accepted call ADRs:

- `../adr/ADR-013-call-signaling-transport.md`
- `../adr/ADR-014-relay-only-call-privacy.md`

## Authority

PostgreSQL owns durable call identity, partnership scope, participant-role endpoint devices, call state/version, independent deadline generation, trusted timestamps, internal terminal cause, and history.

HTTP owns durable user call actions.

`shawtie.realtime.v2` adds only a content-free `call.changed` refresh hint.

`shawtie.call.v1` is a separate authenticated transient WebSocket for accepted-call SDP/ICE negotiation.

WebRTC owns transient endpoint media state.

TURN credentials authorize bounded relay use but are never partnership authorization.

Web Push is a generic `call_state_changed` reconciliation hint, not call authority.

## Consent boundary

Calls never auto-answer.

Before explicit callee acceptance:

- no signaling socket is authorized
- no SDP or ICE is exchanged
- no TURN credential is issued
- no remote media session begins

Every call during `breakup_pending` still requires fresh explicit acceptance exactly like active-state calls.

Caller microphone access begins only from the explicit Call gesture. Callee microphone access begins only from the explicit Accept gesture. Pre-acquired tracks stop if authoritative create/accept fails or loses a race. C1 never requests camera permission.

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

SDP is candidate-free, contains exactly one audio media section, and cannot negotiate video or data channels. The signaling server forwards only parsed privacy-safe `typ relay` trickle candidates and rejects related/base-address forms that disclose a non-relay peer address.

TURN should support UDP and, where deployed, TCP/TLS fallbacks for restrictive networks.

TURN provider secrets never enter the PWA. Credentials are short-lived and issued only to the two selected endpoint devices of one accepted non-terminal call. Authorization loss denies refresh immediately; any already-issued allocation is a bounded residual network window until teardown/provider expiry.

## Multi-device model

The initiating device is the fixed caller endpoint.

Endpoint role/device authority lives on `call_participants`, not duplicated `call_sessions` columns. All currently authorized callee devices may ring, but first committed acceptance fills the sole callee participant endpoint. Later accepts, signaling upgrades, and TURN requests from other callee devices fail.

C1 does not implement device handoff.

For one selected device, only one browser tab owns microphone, peer connection, signaling, and endpoint-connected reporting. A persisted local owner generation fences stale tab callbacks; server endpoint authorization remains the backstop.

## Reachability

Foreground incoming calls use realtime v2 plus canonical HTTP fetch.

Background reachability uses a minimal reusable Web Push substrate. Every generic `call_state_changed` delivery reconciles `/api/v1/calls/current`; only canonical incoming/ringing state may show the generic notification, and later canonical state dismisses stale ringing UI. Payloads contain no caller identity, call ID, or terminal state.

If notifications are denied or Web Push is unsupported, foreground calling remains available while background reachability is explicitly degraded.

## Failure and timeout model

Server-generated deadlines bound:

- ringing
- accepted-but-never-connected negotiation
- stranded long-running non-terminal calls

Scheduled finalizers use independent `deadline_generation` rather than call `version`. A first endpoint-connected attestation does not advance the generation, so accepted-call connect timeout remains live until the second endpoint connects or another authoritative transition replaces it.

Signaling loss alone does not end a healthy media path. If renegotiation is required, endpoints reconnect into a fresh transient signaling generation and may perform relay-only ICE restart.

## Scale-out

C1 does not add Redis.

The initial deployment may run one signaling API replica. Multiple replicas require verified call-ID affinity so both selected endpoints land on the same signaling process. A shared signaling broker requires a later ADR.

## Cryptographic boundary

WebRTC transport encryption is required, but C1 does not claim the full S1 endpoint-identity/E2EE model.

S1 must review how call endpoint identity and DTLS fingerprints are bound to partnership cryptographic identity before sensitive stable-release use. C1 adds no custom media cipher.

## Call history

History is partnership-scoped and records only bounded metadata required by the PRD, including voice/video kind, direction, trusted timestamps/duration after both endpoints attest connected, and a privacy-safe public outcome. Internal session/device/deletion/lifecycle terminal causes are not exposed verbatim.

Final dissolution deletes call history through the existing partnership deletion architecture.

## C2

C2 enables `video` creation and adds camera permission, camera switching, video track/rendering policy, bandwidth behavior, and video-specific physical acceptance without creating a second call-state/history/signaling model.
