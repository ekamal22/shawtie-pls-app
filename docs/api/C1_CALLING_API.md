# C1 Voice Calling API

## Status

DESIGN COMPLETE. SOURCE IMPLEMENTATION COMPLETE ON BRANCH. VERIFICATION PENDING.

Branch: `feat/c1-voice-calling`

Required base: `main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`

Architecture: `docs/architecture/C1_VOICE_CALLING_DESIGN.md`

Signaling: `docs/api/C1_SIGNALING_PROTOCOL.md`

This contract is subordinate to the PRD and C1 architecture design.

API namespace:

/api/v1

Durable call mutations use authenticated HTTP.

Transient SDP and ICE signaling use the separate shawtie.call.v1 WebSocket protocol.

## General rules

- the server derives the current account and device from the session
- the server derives current partnership and partner identity
- clients never submit a target account ID
- calls are partnership-scoped
- all private responses use Cache-Control: private, no-store
- durable mutations require Idempotency-Key
- expectedVersion is required where concurrent state changes can conflict
- foreign and random call IDs fail with privacy-safe not-found behavior
- video creation is rejected until C2
- call actions are online-only
- request and response schemas are runtime validated

## Call projection

A canonical call projection contains only authorized metadata:

~~~json
{
  "id": "uuid",
  "partnershipId": "uuid",
  "kind": "voice",
  "direction": "incoming",
  "state": "ringing",
  "version": 3,
  "initiatedAt": "2026-09-23T00:00:00.000Z",
  "ringExpiresAt": "2026-09-23T00:01:00.000Z",
  "acceptedAt": null,
  "connectedAt": null,
  "endedAt": null,
  "outcome": null,
  "isThisDeviceSelectedEndpoint": false
}
~~~

The API does not return the other partner's device ID.

The API does not return SDP, ICE, IP addresses, TURN credentials, push endpoints, or media device labels in call projections.

`outcome` is a privacy-safe public value such as `rejected`, `cancelled`, `missed`, `completed`, `failed`, or generic `unavailable`. Internal session/device/account-deletion/partnership terminal causes are never returned verbatim.

Selected endpoints resolve through `call_participants.role` and `endpoint_device_id`; there are no duplicate caller/callee endpoint-device columns on `call_sessions`.

## POST /api/v1/calls

Create one outgoing call.

Headers:

- Idempotency-Key
- normal CSRF and authenticated-session headers

Request:

~~~json
{
  "expectedPartnershipId": "uuid",
  "kind": "voice"
}
~~~

Rules:

- current account must belong to expectedPartnershipId
- expectedPartnershipId is a stale-namespace guard, not authorization input
- the current authenticated device is persisted as the caller participant's fixed `endpoint_device_id`
- server derives the callee account
- current lifecycle must permit calling
- no other non-terminal call may exist for the partnership
- kind video returns feature_not_available until C2
- the server creates ring_expires_at from configured server policy
- a content-free call.changed outbox event is written in the same transaction
- incoming-call push work is produced after commit

Response:

201 with canonical call projection.

Possible stable errors:

- no_current_partnership
- partnership_changed
- calling_not_allowed
- call_in_progress
- feature_not_available
- rate_limited

A lost-response replay with the same Idempotency-Key returns the original authorized result.

## GET /api/v1/calls/current

Return the current non-terminal call for the current partnership, or null.

This endpoint is used after:

- realtime v2 `call.changed`
- notification click
- app resume
- signaling reconnect
- visibility change
- push wakeup
## GET /api/v1/calls/:callId

Returns one authorized call projection only when the call belongs to the current partnership and is visible to the authenticated account.

Random, foreign-partnership, deleted-old-partnership, and otherwise inaccessible IDs converge on the same privacy-safe response.

The path ID is lookup input only and never authorization.

## GET /api/v1/calls

Return bounded partnership-scoped call history.

Query parameters:

- cursor, optional opaque keyed cursor
- limit, bounded

History never crosses partnership boundaries.

A future partnership between the same accounts cannot read old history.

Suggested item fields:

- call ID
- voice or video kind
- incoming or outgoing direction
- initiatedAt
- connectedAt
- endedAt
- privacy-safe outcome
- durationSeconds only when connectedAt and endedAt are both authoritative

No device/network/signaling fields appear in history.

## POST /api/v1/calls/:callId/accept

First eligible callee device wins.

Headers:

- Idempotency-Key

Request:

~~~json
{
  "expectedVersion": 3
}
~~~

Rules:

- caller cannot accept own call
- current account must be callee
- current authenticated device must be active and eligible
- call must still be ringing and unexpired
- lifecycle capability is re-evaluated
- the callee participant's `endpoint_device_id` is set atomically and only once
- accepted_at uses trusted server time
- version increments
- ring-timeout work becomes stale through state/version checks
- other callee devices are invalidated and may no longer signal

Stable errors include call_not_found, call_expired, call_already_answered, call_not_ringing, calling_not_allowed, and version_conflict.

## POST /api/v1/calls/:callId/reject

Callee rejects a ringing call.

Headers:

- Idempotency-Key

Request:

~~~json
{
  "expectedVersion": 3
}
~~~

The server transitions the call to ended with internal terminal reason `rejected`; the public projection exposes outcome `rejected`.

## POST /api/v1/calls/:callId/cancel

Caller cancels before the callee accepts.

Headers:

- Idempotency-Key

Request:

~~~json
{
  "expectedVersion": 3
}
~~~

Allowed only for the caller while state is ringing.

The terminal reason is cancelled.

If acceptance wins first, cancellation fails with state_conflict and the client refreshes canonical state.

## Timeout authority

Three server-generated deadlines bound call lifecycle:

- `ringExpiresAt`: unanswered ringing call becomes `missed`
- `connectExpiresAt`: accepted call that never gets both selected endpoints connected becomes `failed`
- `hardExpiresAt`: generous operational maximum for a connected/non-terminal call so crashed clients cannot block the partnership forever

Clients never submit these timestamps.

Each scheduled finalizer is fenced by expected call version/generation and becomes a no-op after a newer transition.
## POST /api/v1/calls/:callId/endpoint-connected

Record monotonic selected-endpoint attestation of WebRTC `connectionState === "connected"`.

Headers:

- Idempotency-Key

Request:

~~~json
{}
~~~

`expectedVersion` is intentionally not required because caller/callee may report concurrently from the same accepted version.

Under the call row lock, participant `connected_at` is written at most once. The first distinct report leaves aggregate state, call `version`, and `deadline_generation` unchanged. The second distinct report transitions to connected, sets aggregate `connectedAt`, increments call version once, advances `deadline_generation`, and schedules hard expiry. Duplicate same-device reports are no-ops. Client timestamps are never accepted.

This is endpoint attestation, not cryptographic proof of audible media.

## POST /api/v1/calls/:callId/end

End an accepted or connected call.

Headers:

- Idempotency-Key

Request:

~~~json
{
  "expectedVersion": 7
}
~~~

Either selected endpoint may end.

The server uses trusted endedAt.

Terminal reason is completed for ordinary user hangup.

If the call never reached connected state, history does not invent a duration.

## POST /api/v1/calls/:callId/fail

Implemented endpoint for a selected endpoint to report an unrecoverable setup or transport failure.

Headers:

- Idempotency-Key

Request:

~~~json
{
  "expectedVersion": 6,
  "category": "media_permission|relay_unavailable|negotiation_failed|network_failed"
}
~~~

The category is deliberately coarse.

No SDP, ICE, IP, device label, provider exception text, or browser stack trace is accepted.

## POST /api/v1/calls/:callId/turn-credentials

Issue short-lived TURN authorization.

This request is not a durable user mutation and does not use the offline queue.

Authorization requires:

- current session
- current device
- current partnership
- accepted non-terminal call
- current device resolves through the caller/callee participant role row as one of the two selected endpoints
- lifecycle still permits continuation
- issuance rate limit permits request

Response:

~~~json
{
  "urls": [
    "turn:turn.example.invalid:3478?transport=udp",
    "turn:turn.example.invalid:3478?transport=tcp",
    "turns:turn.example.invalid:443?transport=tcp"
  ],
  "username": "temporary",
  "credential": "temporary-secret",
  "expiresAt": "timestamp",
  "iceTransportPolicy": "relay"
}
~~~

Response headers include Cache-Control: private, no-store.

The credential is never written to IndexedDB or application logs.

Authorization loss denies later TURN issue/refresh immediately. An already issued credential/allocation may survive only for the provider's bounded configured lifetime.

## Signaling upgrade

Endpoint:

/api/v1/calls/:callId/signal

Subprotocol:

shawtie.call.v1

Opening signaling requires an already accepted call.

No signaling connection is permitted while a call is merely ringing.

## Push subscription API

C1 introduces a reusable device-bound Web Push substrate.

### POST /api/v1/push/subscriptions

Headers:

- Idempotency-Key

Request:

~~~json
{
  "endpoint": "https://push-provider.example/opaque-capability",
  "expirationTime": null,
  "keys": {
    "p256dh": "base64url",
    "auth": "base64url"
  }
}
~~~

Rules:

- current account and device come from the session
- endpoint and keys are SENSITIVE
- the same device may replace an obsolete subscription safely
- a keyed endpoint fingerprint, not a raw unkeyed hash, is used for uniqueness/indexing
- push routing requires current account/device authorization; a stale subscription row is not sufficient evidence of login
- request size is tightly bounded
- values are never logged

Response exposes only an opaque subscription ID and non-secret status.

### DELETE /api/v1/push/subscriptions/:subscriptionId

Remove the current account/device subscription.

A foreign subscription ID fails privacy-safely.

Explicit logout/device revocation/account lockout must stop future push routing even if provider-side unsubscription cannot be confirmed.

## Web Push payload

~~~json
{
  "v": 1,
  "type": "call_state_changed"
}
~~~

No caller identity, call ID, partnership ID, terminal state, SDP, ICE, TURN data, or lifecycle reason is sent to the provider.

Each delivery causes a same-origin credentialed no-store `GET /api/v1/calls/current` under a bounded timeout. Canonical incoming/ringing shows or replaces one generic notification; any other state closes it. Fetch/auth failure exposes no accept/reject action and does not claim a call is ringing. Delayed, duplicate, or reordered pushes therefore converge on canonical state.

Notification click opens/focuses the PWA, validates session, fetches current call again, and never auto-accepts.

## Realtime invalidation

C1 introduces `shawtie.realtime.v2`, preserving all M2 v1 frames and adding a content-free `call.changed` event containing only `eventId`, `partnershipId`, `callId`, and `callVersion`.

C1 calling UI is enabled only after v2 negotiation. Realtime v1 remains supported during rollout and is not silently changed.

The frame is only a refresh hint; canonical state comes from HTTP.

For v2, `call.changed` increments the M2 dirty counter. Initial sync, reconnect repair, listener-reset repair, and visible anti-entropy include `GET /api/v1/calls/current`; invalidation during sync forces another pass before live mode.

## Operational availability policy

Server policy may independently disable new call creation, call transport (accept/signaling/TURN), or background push.

- create-disabled returns a bounded service-unavailable/calling-unavailable result for new calls
- transport-disabled denies new accept, signaling upgrade, and TURN issue/refresh
- push-disabled suppresses background wakeup only; foreground realtime remains available

None of these controls permit direct ICE fallback or reinterpret a voice call through another transport.

## Local media consent contract

Caller microphone capture starts only from explicit Call gesture; callee capture only from explicit Accept gesture. A pre-acquired track is stopped if authoritative create/accept fails or loses a race. Signaling/TURN remain unavailable before durable acceptance. C1 never requests camera access. Permissions Policy keeps camera disabled until C2.

Only the current generation-fenced media-owner tab may capture, signal, own the peer connection, or report endpoint-connected.

## Browser audio playback contract

Remote audio autoplay success is not a server state transition. If `HTMLMediaElement.play()` is rejected by browser policy, the client keeps canonical call state intact and presents an explicit user-gesture playback recovery action.

Audio sink selection is optional local UX only where browser `setSinkId()` support exists. Output device identifiers are never part of this API.

## Push subscription reconciliation

`POST /api/v1/push/subscriptions` is an authenticated device-level upsert/replace operation. A device may replace an old endpoint/key tuple without creating duplicate active routing.

Clients should reconcile an already-granted browser subscription on startup/foreground and after best-effort `pushsubscriptionchange`. Permission denial is not retried through repeated prompts.

## Cache policy

Private call API responses use Cache-Control: private, no-store.

Service workers must not cache:

- call state
- call history
- TURN credentials
- signaling traffic
- push subscription responses

## Error privacy

Identifier-based routes must not distinguish random, foreign, deleted-old-partnership, or otherwise inaccessible call IDs unless the current authenticated partnership already authorizes the distinction.

Provider failures return bounded stable application codes rather than raw provider text.

## Rate limits

Implementation must define bounded, privacy-safe limits for:

- call create
- call accept/reject/cancel/end
- TURN credential issuance
- push subscription replacement
- signaling upgrades
- signaling frames
- ICE candidates
- signaling reconnect attempts
- TURN credential refresh frequency
- push deliveries per authoritative incoming-call event

## C2 compatibility

C2 should reuse these routes where possible.

C2 enables kind video and extends client media behavior without creating a second call-history model.
