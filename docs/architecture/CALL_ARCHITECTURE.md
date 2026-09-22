# Call Architecture

## Status

PLANNED.

Calling is split into two implementation milestones:

- C1 Voice Calling
- C2 Video Calling

C1 depends on verified M2 Realtime and Offline Reliability.

C2 depends on verified C1 and extends the same call core with camera/video media.

Voice and video calls both remain part of MVP. The milestone split changes implementation and acceptance sequencing only; it does not remove video calling from stable-release scope.

Built-in call recording is deferred beyond the first stable release and beyond the initial post-stable maturity period.

## Milestone ownership

### C1 Voice Calling

C1 owns the shared calling substrate and proves it first with audio-only calls.

C1 owns:

- authenticated call signaling
- call-state lifecycle
- caller/callee authorization
- voice calls
- microphone permission and audio capture
- accept, reject, and cancel
- ringing, connected, ended, missed, rejected, cancelled, and failed state
- call history foundation
- short-lived TURN credential issuance
- relay-first privacy behavior
- restrictive-network TURN fallback
- breakup-pending explicit acceptance
- account-deletion calling denial
- interruption and reconnect behavior
- physical-device voice acceptance

C1 must not require camera permission or video capture for closure.

### C2 Video Calling

C2 extends the verified C1 call substrate.

C2 owns:

- video calls
- camera permission and video capture
- video-track negotiation over the C1 WebRTC connection model
- video-call projection/history type
- video-specific reconnect and interruption behavior
- physical-device camera/video acceptance

C2 reuses rather than duplicates:

- C1 signaling contracts
- C1 authorization
- C1 call-state lifecycle
- C1 TURN issuance
- C1 relay policy
- C1 call-history persistence
- C1 breakup consent
- C1 deletion behavior
- C1 reconnect model

C2 must not create a second video-specific call authority, signaling system, or state machine.

## Transport

Use WebRTC for call media.

Use the authenticated WebSocket channel for call signaling.

C1 introduces the signaling and audio-media path.

C2 reuses that signaling path and adds video media negotiation.

The WebSocket never carries audio or video media.

## Media path

Preferred privacy behavior:

```text
caller
  |
encrypted WebRTC
  |
TURN relay
  |
encrypted WebRTC
  |
callee
```

Use relay-first behavior where supported to reduce direct peer IP exposure.

TURN should support practical fallbacks such as:

- UDP
- TCP
- TLS on port 443

The final provider choice may be self-hosted or managed.

## TURN credentials

TURN credentials must be short-lived.

The PWA must never contain a permanent TURN username and password.

The authenticated API issues temporary TURN credentials only after:

- validating the caller session
- validating partnership membership
- evaluating call capability
- applying signaling and abuse rate limits

Expired credentials cannot be refreshed without new authorization.

C2 inherits this exact TURN authority from C1.

## Encryption

WebRTC transport encryption is required.

The E2EE architecture must ensure the selected call design does not expose plaintext call media to application servers or media relay infrastructure.

If a future architecture introduces an SFU, the encryption model must be reviewed again before deployment.

C1 must close the audio path under this requirement.

C2 must close the video path under the same requirement rather than defining a weaker video-specific privacy model.

## Shared signaling state

Persist or transmit only what is needed for call state.

Logical states include:

```text
ringing
accepted
connected
ended
missed
rejected
cancelled
failed
```

The state model is shared by C1 and C2.

Call type is a bounded attribute:

```text
voice
video
```

C2 adds the `video` media behavior to the existing call model. It does not add a second call lifecycle.

## Partnership authorization

A call may be initiated only inside an authorized partnership.

During `breakup_pending`, every call still requires explicit acceptance by the other partner before media begins.

Calls never auto-answer.

During account-deletion recovery from an active partnership, calls are disabled because the partnership is view-only and one account has no access.

These rules are implemented first for C1 voice calls and must remain unchanged for C2 video calls.

## Call history

Store partnership-scoped metadata:

- voice or video
- incoming or outgoing
- start time
- end time or duration
- missed status
- partnership ID

C1 establishes the call-history persistence and deletion model with voice calls.

C2 reuses it for video calls.

Call history is deleted with the partnership.

## C1 microphone boundary

C1 requests microphone permission only after an explicit voice-call action.

A denied microphone permission must fail safely.

C1 must prove:

- no camera permission is required for voice-call closure
- audio capture begins only after the intended call flow authorizes it
- no call auto-answers
- audio media stops when the call ends or authorization is lost
- physical-device microphone behavior matches the browser contract

## C2 camera boundary

C2 requests camera permission only after an explicit video-call action.

A denied camera permission must fail safely.

C2 must prove:

- camera capture is not required for C1 voice calling
- video capture begins only inside an authorized accepted video call
- video media stops when the call ends or authorization is lost
- camera/video behavior remains safe across Android foreground/background transitions
- C1 microphone, signaling, TURN, history, and lifecycle regressions remain green

## Network privacy

TURN relay reduces peer IP exposure but the relay necessarily observes connection metadata.

The privacy policy and E2EE documentation must distinguish encrypted call content from network metadata.

## Relay policy

Relay-first behavior is preferred for privacy.

If the implementation ever permits direct peer connectivity, the privacy impact must be documented explicitly and user expectations must not imply that peer IP addresses are always hidden.

This policy is shared by C1 and C2.

## Failure handling

The shared client must handle:

- unavailable TURN
- network change
- signaling reconnect
- unanswered call
- call rejection
- peer disconnect
- app backgrounding where browser behavior permits

C1 additionally proves denied microphone permission and audio interruption behavior.

C2 additionally proves denied camera permission and video interruption behavior.

## Realtime protocol ownership

M2 owns the current content-free synchronization protocol and leaves call signaling as a later extension point.

C1 owns the first reviewed call-signaling extension.

C2 should reuse the C1 signaling contract where video can be represented as a bounded call/media type extension.

If video requires incompatible realtime semantics, C2 must introduce an explicitly reviewed protocol-version transition rather than silently changing an established C1 contract.

## Physical-device boundary

Both calling milestones require real Android acceptance.

C1 must prove real voice calls.

C2 must prove real video calls while C1 voice acceptance remains green.

Desktop browser automation alone cannot close either milestone.

## S1 handoff

S1 begins only after the product has stable semantics for:

- M3 media and voice messages
- C1 voice calls
- C2 video calls

S1 must review the privacy and cryptographic properties of both call-media types.

The C1/C2 split must not result in different stable-release cryptographic standards for voice and video.

## Deferred post-stable call recording

Call recording is not an automatic post-release milestone.

Before implementation, post-stable production evidence must justify the storage and bandwidth cost, retention model, deletion and backup-expiry obligations, legal and privacy burden, user demand, and E2EE-compatible recording architecture.

The chosen design may be cloud-hosted, quota-limited, paid, local-only, audio-only, short-retention export, or omitted entirely if the economics or privacy model are not acceptable.

Call recording remains outside MVP and stable release.

Future recording requires:

- explicit consent from both participants for every recording session
- clear recording indicator
- E2EE-compatible recording design
- both-partner access
- partnership-scoped authorization
- deletion at final partnership dissolution
- deletion when permanent account deletion destroys partnership data
- separate privacy, legal, security, retention, export, and consent review

Consent from a previous recording session must never carry over automatically.
