# C1 Voice Calling Architecture and Implementation Design

## Status

**DESIGN COMPLETE, IMPLEMENTATION NOT STARTED.**

Branch:

`feat/c1-voice-calling`

Required base:

`main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`

Prior design branch `design/c1-voice-calling` is historical input only and is not the implementation base.

C1 is voice calling only. Video calling is C2 so call authority, consent, signaling, TURN privacy, push reachability, multi-device behavior, and recovery can close before camera-specific complexity is added.

M3 may proceed in parallel. The current M3 design branch `feat/m3-media-voice @ 4553be22` owns planned migrations 0015 and 0016. C1 owns planned migrations 0017 and 0018. Isolated C1 database validation uses the repository's proven reservation mechanism `SHAWTIE_MIGRATION_RESERVATIONS=0015,0016` rather than copying or fabricating M3 SQL. Final integrated C1 closure must run the real contiguous 0001 through 0018 chain with `reserved=0`.

Canonical API contract: `docs/api/C1_CALLING_API.md`.

Canonical signaling protocol: `docs/api/C1_SIGNALING_PROTOCOL.md`.

Canonical physical Android procedure: `docs/testing/C1_ANDROID_ACCEPTANCE.md`.

Accepted architecture refinements:

- `docs/adr/ADR-013-call-signaling-transport.md`
- `docs/adr/ADR-014-relay-only-call-privacy.md`

## Purpose

C1 adds private one-to-one voice calls for the current partnership while preserving the authority model already verified by P3, M1, R1, and M2.

C1 must solve:

- durable call authority and history
- explicit accept, reject, cancel, end, and missed behavior
- secure WebRTC signaling
- relay-only network privacy for stable C1 behavior
- short-lived TURN authorization
- multi-device ringing with one winning callee device
- background incoming-call reachability through Web Push
- reconnect and network-change recovery
- breakup, account-deletion, session-revocation, and final-dissolution behavior
- physical Android acceptance

C1 must not weaken M2 by turning the existing content-free realtime protocol into an SDP or ICE transport.

## Product scope

C1 implements:

- voice-only one-to-one calls
- outgoing call initiation
- incoming ringing
- explicit acceptance
- rejection
- caller cancellation before acceptance
- missed-call timeout
- explicit hangup
- connection state
- partnership-scoped call history
- authenticated call signaling
- WebRTC audio
- TURN-only candidate use
- TURN over UDP with TCP and TLS fallbacks where deployed
- short-lived TURN credentials
- Web Push incoming-call wakeup
- first-accept-wins multi-device handling
- safe signaling reconnect
- ICE restart support
- lifecycle termination and deletion integration

C1 does not implement:

- video
- group calls
- screen sharing
- call recording
- voicemail
- media-server recording
- an SFU or MCU
- public calling
- calls outside the current partnership
- offline queued call initiation
- direct peer-to-peer fallback
- a second partnership authority
- a second durable notification system
- production S1 cryptographic identity or recovery

C2 later enables video over the same call authority and signaling substrate.

## Inherited authority

PostgreSQL remains authoritative for:

- authenticated account and device identity
- current partnership membership
- partnership lifecycle
- whether calling is currently permitted
- durable call identity
- which account initiated the call
- which callee device accepted
- call terminal outcome
- trusted call-history timestamps
- final-dissolution deletion

M2 remains authoritative for:

- current authenticated realtime account scope
- content-free call invalidation delivery
- session and partnership scope refresh
- namespace revocation
- ordinary reconnect and anti-entropy behavior

The dedicated C1 signaling transport is transient. It does not create durable call authority.

WebRTC peer state is transient. It does not create durable product authority.

TURN proves permission to use relay resources for a bounded time. It does not prove partnership authorization.

Web Push wakes a client and hints that call state may exist. It is not authoritative call state.

## Core architecture

~~~text
                         PostgreSQL
                  authoritative call state
                         |
            +------------+------------+
            |                         |
         HTTP API                 M2 realtime
     durable call actions       call.changed hint
            |                         |
            +------------+------------+
                         |
                 C1 signaling hub
        /api/v1/calls/:callId/signal
                  shawtie.call.v1
                         |
                 WebRTC negotiation
                    /           \
             caller device    callee device
                    \           /
                     TURN relay
                  encrypted media
~~~

Durable user actions use authenticated HTTP.

M2 tells authorized clients that call state changed.

A separate call WebSocket carries SDP, ICE, and negotiation control only after the call has been accepted.

Media flows between WebRTC endpoints through TURN relays. Application servers and the signaling hub do not proxy voice packets.

## Architectural decisions

### Voice and video are separate milestones

C1 proves the call platform with voice only.

C2 later adds camera permission, video tracks, video-specific device switching, rendering, bandwidth adaptation, and video physical-device acceptance.

The persistence model may reserve call kind values for voice and video, but C1 API policy accepts voice only.

### M2 realtime remains content-free

The M2 protocol has strict content-free invalidation semantics and small bounded frames.

C1 does not put these values into shawtie.realtime.v1:

- SDP
- ICE candidates
- TURN username
- TURN credential
- DTLS fingerprints
- media device labels
- IP addresses
- codec descriptions

C1 adds `call.changed` only through explicitly negotiated `shawtie.realtime.v2`; M2 `shawtie.realtime.v1` remains unchanged. The invalidation contains only opaque call identity and version information sufficient to trigger canonical HTTP refresh.

### Dedicated call signaling transport

C1 uses:

/api/v1/calls/:callId/signal

Subprotocol:

shawtie.call.v1

The signaling socket authenticates through the existing HttpOnly session cookie and exact trusted Origin checks.

The server derives:

- account
- device
- partnership
- call role
- selected endpoint authorization

The client cannot choose an arbitrary target account or target device.

ADR-013 records this decision.

### No negotiation before explicit acceptance

Call initiation creates durable ringing state and notifies the partner.

Before acceptance:

- no SDP offer is sent
- no ICE candidate is exchanged
- no TURN credential is issued
- no peer connection is required
- no remote media can begin

After a callee device wins the acceptance transaction, the caller and accepted callee device may open signaling sockets and negotiate.

This rule makes explicit acceptance a hard media-session boundary.

### Relay-only privacy

C1 stable behavior uses RTCPeerConnection with iceTransportPolicy set to relay.

No direct host or server-reflexive candidate is sent to the partner as a usable media path.

TURN service supports the deployed subset of:

- TURN/UDP
- TURN/TCP
- TURN/TLS, normally on 443 when infrastructure supports it

If relay service is unavailable, the call fails closed instead of silently exposing peer IP addresses through direct connectivity.

ADR-014 records this stronger privacy refinement over the earlier generic relay-first baseline.

### Short-lived TURN authorization

The browser never contains permanent TURN credentials.

The API issues temporary credentials only when:

- session is current
- device is current
- partnership is current
- call is accepted and non-terminal
- current device is one of the two selected call endpoints
- lifecycle still permits the call
- rate and abuse policy allows issuance

Credentials are short-lived and refreshable only while the same call remains authorized.

A credential expiry does not become call authority. New allocations and ICE restarts must obtain current authorized credentials.

The provider shared secret or API credential is SECRET and remains server-side.

### One non-terminal call per partnership

The database enforces at most one non-terminal call for one partnership.

If both partners initiate concurrently, one authoritative transaction wins. The losing request receives a deterministic call_in_progress result and refreshes canonical call state.

This avoids two independent overlapping one-to-one call sessions.

### Multi-device ringing, one accepting device

Incoming call notification may reach every current authorized device for the callee account.

Acceptance is serialized transactionally.

The first eligible device to commit acceptance becomes accepted_callee_device_id.

Later acceptance attempts return call_already_answered.

After acceptance:

- other callee devices stop ringing
- those devices cannot open an authorized signaling socket
- TURN credentials are denied to them
- only the caller device and winning callee device are media endpoints

C1 does not implement call handoff between devices.

### Caller endpoint is fixed

The device that creates the call becomes caller_device_id.

Another caller device may observe call history or current state but cannot take over the media session.

A future device-handoff feature requires a separate design.

### Background ringing uses Web Push

A suspended or closed PWA cannot rely on a live WebSocket.

C1 therefore introduces a minimal reusable Web Push subscription and delivery substrate.

Push payloads are opaque and privacy-minimized. They do not include:

- partner display name
- username
- message content
- relationship content
- SDP
- ICE
- TURN credentials
- call duration
- lifecycle reason

A call push may contain only an event kind plus opaque event or call retrieval identifier as required by the implementation.

The service worker displays generic incoming-call text. The push payload does not need a call ID: notification click opens the trusted application, validates the session, and fetches `/api/v1/calls/current` before rendering actionable state.

Foreground calling does not require push permission because realtime v2 supplies call.changed. If Web Push is unsupported or the user denies notification permission, foreground calls still work, while background incoming-call reachability is explicitly degraded and the UI must not pretend otherwise.

Push endpoints and subscription keys are SENSITIVE capability data and are never logged.

### Call actions are online-only

Call initiation, acceptance, rejection, cancellation, and end are not M2 offline-queue operations.

When offline, the UI shows calling as unavailable.

This prevents a delayed queued operation from creating a call after its consent or lifecycle context is stale.

## Durable call model

The planned calls aggregate contains at least:

- id
- partnership_id
- caller_account_id
- callee_account_id
- caller_device_id
- accepted_callee_device_id, nullable until accepted
- call_kind
- state
- version
- initiated_at
- ring_expires_at
- accepted_at, nullable
- caller_connected_at, nullable
- callee_connected_at, nullable
- connected_at, nullable
- ended_at, nullable
- terminal_reason, nullable
- created_at
- updated_at

call_kind supports the forward-compatible vocabulary voice and video, but C1 service policy rejects video creation until C2.

The durable state vocabulary is:

~~~text
ringing
accepted
connected
ended
~~~

Terminal_reason distinguishes:

- rejected
- cancelled
- missed
- completed
- failed
- authorization_revoked
- partnership_terminated
- account_deletion
- session_revoked where appropriate for endpoint loss

A terminal call has state ended.

The model intentionally avoids storing a large state vocabulary when the terminal reason carries the durable outcome.

## State transitions

~~~text
                     +--> ended: rejected
                     |
ringing --accept--> accepted --media confirmed--> connected
   |                    |                             |
   +--> ended: missed   +--> ended: failed           +--> ended: completed
   +--> ended: cancel   +--> ended: auth revoked     +--> ended: auth revoked
   +--> ended: auth revoked
~~~

Every transition:

- locks the call row
- verifies current account and device
- verifies partnership membership
- evaluates current lifecycle capability
- checks expectedVersion where the action is not an exact lost-response replay
- writes authoritative server timestamps
- increments version
- writes a content-free outbox invalidation

## Connected evidence

The server cannot inspect whether voice packets actually flowed.

For trustworthy history, both selected endpoint devices report WebRTC connectionState connected through an authenticated HTTP command.

The server records caller_connected_at and callee_connected_at using trusted server time.

connected_at is set only when both selected endpoints have reported connected for the current accepted call.

If only one endpoint reports connected before the call ends, the call remains accepted and history does not invent a connected duration.

This makes call duration conservative rather than client-asserted.

## Ring timeout

A ringing call has a server-created ring_expires_at.

The initial timeout is configurable rather than embedded as a protocol constant.

The worker owns timeout finalization. It changes an unanswered ringing call to ended with terminal_reason missed only when the expected call version and state still match.

A stale timeout job becomes a safe no-op after accept, reject, cancel, or lifecycle termination.

## Idempotency

Every durable call mutation uses Idempotency-Key under the repository's existing private-request fingerprint rules.

Lost-response replay must return the original authorized result.

Reusing an idempotency key with a different request body fails deterministically.

Call initiation idempotency prevents a retry from producing two calls.

## Optimistic concurrency

Call commands use expectedVersion where a later command could race with another endpoint or lifecycle mutation.

Examples:

- accept versus reject
- accept versus ring timeout
- cancel versus accept
- end versus lifecycle revocation
- duplicate endpoint connected reports

The database remains the final serialization boundary.

## Signaling lifecycle

The signaling socket may open only after accepted_callee_device_id is set.

Upgrade authorization verifies that the current device is either:

- caller_device_id for caller_account_id
- accepted_callee_device_id for callee_account_id

One call signaling connection per selected device is active at a time.

A newer signaling connection for the same call and device supersedes the old one.

When one endpoint reconnects, the hub may force both signaling endpoints into a fresh signaling generation so stale callbacks and stale offers cannot cross generations.

Signaling generations are transient negotiation fencing. They do not replace durable call version.

## Signaling deployment without Redis

C1 does not add Redis.

The initial signaling hub is in-memory inside the API process.

The first stable C1 deployment may run one API signaling replica. For more than one API instance, the deployment must provide verified deterministic affinity for the signaling path so both endpoints for one call reach the same process, keyed by the opaque call ID.

This is an explicit deployment requirement, not an authorization mechanism.

If the production platform cannot provide reliable call-path affinity, a shared ephemeral signaling broker requires a new architecture review and ADR before scale-out. SDP and ICE must not be forced through PostgreSQL NOTIFY.

## WebRTC negotiation

The browser uses the standard perfect-negotiation pattern.

Initial roles:

- caller is the initial offerer
- callee is the polite peer
- caller is the impolite peer for collision handling

The implementation must still tolerate negotiationneeded glare and ICE restarts.

The peer connection is audio-only in C1.

Recommended audio constraints are hints, not authorization rules:

- echo cancellation
- noise suppression
- automatic gain control where supported

Device permission denial is handled as a local failure and may terminate the call with a bounded generic reason.

Raw local media device labels are not persisted by the server.

## Candidate privacy enforcement

Relay-only privacy must be enforceable at the signaling boundary rather than relying only on honest browser configuration.

C1 therefore uses candidate-free SDP descriptions:

1. the browser configures `iceTransportPolicy: "relay"`
2. before forwarding an SDP offer/answer, the client removes ICE candidate and end-of-candidates lines
3. the signaling server rejects any SDP frame that still contains candidate lines
4. candidates are sent only through `signal.ice_candidate`
5. the signaling server parses every candidate and accepts only `typ relay`
6. host, srflx, prflx, malformed, or unknown candidate types fail the current signaling generation

Candidate strings remain SENSITIVE transient data and are never persisted or logged.

This prevents a modified/stale client from smuggling direct peer candidates through the SDP path.

## Connection and stale-call bounds

C1 has three independent trusted deadlines:

- `ring_expires_at`: unanswered call becomes missed
- `connect_expires_at`: accepted call that never gets both selected endpoints connected becomes failed
- `hard_expires_at`: bounded operational maximum so a crashed/disappeared pair cannot leave one non-terminal call blocking the partnership forever

All are server-generated configuration, not client timestamps.

Ring/connect timeout work is generation/version fenced. A stale scheduled action is a no-op after a newer state transition.

The hard maximum is an operational safety ceiling, not a product duration promise, and should be set generously. Normal end time remains explicit client end/failure or authoritative lifecycle termination.

## ICE and network changes

The client observes:

- iceConnectionState
- connectionState
- signalingState

Transient disconnected state does not immediately end a call.

If failed or a bounded disconnect policy is reached:

1. confirm the call is still authoritative and non-terminal
2. refresh TURN credentials if required
3. reconnect signaling if needed
4. perform an ICE restart using a fresh signaling generation
5. fail closed if relay-only connectivity cannot be restored

The browser never falls back from relay-only to direct connectivity.

## Signaling restart and process loss

WebRTC media may continue even when the signaling socket disconnects.

The client therefore separates:

- signaling health
- media health
- durable call state

If media remains connected, a signaling reconnect does not tear down voice solely because the WebSocket changed.

If renegotiation is required after signaling loss, both endpoints establish a fresh signaling generation before exchanging new SDP or ICE.

If API process loss destroys in-memory signaling state, both clients reconnect and renegotiate from canonical call authority.

## M2 realtime integration

C1 does not place SDP, ICE, TURN credentials, call-control mutations, or call media into M2 realtime.

C1 introduces `shawtie.realtime.v2` as an explicitly reviewed successor to M2 `shawtie.realtime.v1`.

Realtime v2 preserves every v1 frame and adds one content-free server invalidation:

~~~text
call.changed
  eventId
  partnershipId
  callId
  callVersion
~~~

The frame contains no call state, partner display name, SDP, ICE, device network data, TURN secret, push capability, or media metadata.

The client responds by fetching canonical call state through HTTP.

Rollout rules:

- server supports v1 and v2 during transition
- C1 UI/call initiation is enabled only when the browser negotiated v2
- a v1 client continues receiving the original M2 behavior but cannot advertise C1 calling support
- the service-worker/update compatibility boundary must prevent a stale v1 bundle from being treated as C1-capable
- final namespace revocation and account security change remain authoritative independently of call.changed delivery

This avoids silently changing the closed v1 schema while preserving the M2 content-free authority model.

## Lifecycle behavior

### Active partnership

Either partner may initiate a voice call when calling capability is available.

Every incoming call still requires explicit user acceptance.

Calls never auto-answer.

### breakup_pending

A new call remains possible only when current capability allows it.

Every call still requires a fresh explicit accept action by the recipient.

A prior call, prior acceptance, prior restore intent, or prior relationship consent cannot auto-accept a new call.

A call already connected before the lifecycle moves to breakup_pending is not silently reclassified as a new call. It may continue unless another authoritative rule terminates it. Any later new call requires its own acceptance.

### account_deletion_pending

Calling is disabled.

A call that is still ringing or accepted but not connected is terminated.

An already connected call is terminated because one account is entering the account-deletion lockout state.

### final dissolution

Final dissolution:

- makes the call terminal immediately
- closes call signaling sockets
- prevents new TURN credential issuance
- prevents new push routing for the old partnership
- removes call authorization
- schedules or performs call-history deletion through the existing partnership deletion architecture
- prevents any old call ID from being accessible in a future partnership

Authorization revocation does not wait for media transport to notice failure.

## Session and device revocation

A revoked session loses signaling authorization immediately when detected.

A selected endpoint device that is revoked can no longer:

- reconnect signaling
- obtain TURN credentials
- send authoritative call commands

If the active selected endpoint loses authorization, the call ends rather than moving silently to another device.

## Push architecture

C1 adds reusable push subscription persistence associated with account and device identity.

A subscription record stores:

- opaque ID
- account_id
- device_id
- endpoint capability URL
- p256dh key
- auth key
- expiration time when provided
- created_at
- last_success_at
- failure_count
- disabled_at

Subscription endpoint and keys are SENSITIVE.

The worker sends push after an authoritative outbox event and only to subscriptions whose device/account still has current authorization. A stale subscription is not sufficient evidence that the device is logged in.

Permanent provider failure disables or removes the subscription idempotently.

Push delivery failure never changes call authority.

Payload version 1 is generic and privacy-minimized, conceptually only `{ v: 1, type: "incoming_call" }`. Caller identity and call state are fetched from canonical HTTP after the app opens.

Explicit logout, device revocation, account lockout, and permanent subscription-provider invalidation disable routing. Provider 404/410-style permanent failures are idempotent subscription cleanup.

Foreground delivery still uses M2 realtime.

## TURN provider boundary

The API depends on a TurnCredentialProvider interface.

The provider returns:

- urls
- username
- credential
- expiresAt

The server owns provider secrets.

TURN credential responses use Cache-Control: private, no-store and are never stored in IndexedDB.

The provider abstraction allows self-hosted coturn or a managed service without changing call domain rules.

## Privacy and cryptographic boundary

WebRTC provides encrypted media transport using its standard secure media stack, and TURN relays forward encrypted traffic.

C1 does not claim the full reviewed S1 end-to-end identity model.

Before stable release, S1 must review how call endpoint identity and DTLS fingerprint negotiation are bound to the partnership cryptographic identity so a compromised signaling service cannot silently impersonate an endpoint.

C1 therefore exposes a versioned future call-authentication seam but does not invent a custom cryptographic protocol.

No custom media cipher is added in C1.

## Observability

Allowed operational metrics include:

- call initiation count
- accept/reject/missed terminal counts
- signaling upgrade success/failure category
- TURN issuance success/failure category
- relay transport category
- connection setup latency buckets
- reconnect and ICE-restart counts
- generic terminal category

Do not log:

- SDP
- ICE candidate values
- peer IP addresses from application frames
- TURN credentials
- push endpoint URLs
- microphone device labels
- partner display names
- call notification payload bodies
- private call identifiers in third-party analytics

Operational logs may use bounded opaque internal IDs where required for debugging under the data-classification policy.

## Abuse and resource controls

C1 requires:

- per-account call initiation rate limits
- per-partnership ringing rate limits
- concurrent non-terminal call invariant
- signaling frame byte limits
- signaling frame rate limits
- ICE candidate count limits
- one active signaling socket per selected call device
- TURN credential issuance limits
- TURN provider allocation quotas
- call ring timeout
- bounded reconnect backoff

Abuse controls must not reveal whether a guessed foreign call ID exists.

## Migration plan

C1 owns two forward-only migration numbers coordinated with parallel M3 ownership:

- `0017_calling_runtime.sql`
- `0018_push_runtime.sql`

M3 owns 0015 and 0016 on its parallel design/implementation path.

Before the real M3 migrations are integrated, isolated C1 database tests may set:

~~~text
SHAWTIE_MIGRATION_RESERVATIONS=0015,0016
~~~

This is the same proven mechanism previously used for isolated R1 validation. C1 must never copy M3 SQL and must never add placeholder reservation migration files.

Final C1 integration and merge require the real canonical chain:

~~~text
0001 ... 0014
0015 M3
0016 M3
0017 C1 calling
0018 C1 push
~~~

with `reserved=0`.

### 0017 calling runtime

Refine the existing `call_sessions`, `call_participants`, and `call_events` foundations rather than creating a second call model.

Planned durable additions include:

- call `version`
- `ring_expires_at`
- `connect_expires_at`
- `connected_at`
- `terminal_reason`
- `hard_expires_at`
- trusted `updated_at`
- participant role
- selected endpoint device ID
- participant accepted/connected timestamps
- one non-terminal call per partnership partial uniqueness
- one caller and one callee participant per call
- selected-device/account integrity
- indexes for current call and history
- generation-fenced timeout work

The existing `started_at`/status compatibility substrate may be retained during migration, but C1 canonical projections use the refined state/terminal-reason model.

### 0018 push runtime

Add reusable device-bound Web Push subscription persistence for incoming-call reachability.

Persist only the capability data required by Web Push:

- opaque subscription ID
- account ID
- device ID
- endpoint capability URL
- keyed endpoint fingerprint for uniqueness
- p256dh key
- auth key
- provider expiration when present
- created/updated/last-success timestamps
- failure count
- disabled timestamp

Subscription capability data is SENSITIVE/SECRET-like operational material and is never logged.

Push delivery remains outbox/worker driven. No second durable notification authority is introduced.

## Planned implementation slices

### C1-A Domain and contracts

- call type and state vocabulary
- terminal reasons
- call capability predicates
- state transitions
- timeout policy
- first-accept-wins rules
- version and idempotency contracts
- history projection contracts
- push and TURN response schemas

### C1-B Persistence and deletion integration

- refine existing call_sessions/call_participants/call_events aggregate
- one non-terminal call per partnership invariant
- selected-device integrity
- trusted timestamps
- ring/connect/hard-timeout durable work
- call history indexes
- push subscription persistence
- final-dissolution cleanup target

### C1-C HTTP call API

- initiate
- current call
- history
- accept
- reject
- cancel
- endpoint-connected report
- end
- TURN credentials
- exact idempotency and expectedVersion behavior

### C1-D Signaling transport

- shawtie.call.v1
- exact Origin and session authentication
- selected-device authorization
- bounded candidate-free SDP and relay-only ICE frames
- perfect-negotiation forwarding
- reconnect generation fencing
- backpressure and rate limits
- no payload logging

### C1-E Browser voice engine

- microphone permission
- audio-only RTCPeerConnection
- relay-only configuration
- perfect negotiation
- candidate buffering
- audio element lifecycle
- mute control
- connection state
- safe teardown

### C1-F Multi-device and realtime integration

- ring all authorized callee devices
- first accept wins
- supersede other ringing devices
- `shawtie.realtime.v2` call.changed invalidation and v1/v2 rollout
- account/session revocation
- namespace change handling

### C1-G Web Push reachability

- browser subscription lifecycle
- worker delivery
- opaque incoming-call push
- notification click routing
- stale call suppression after canonical fetch
- provider failure cleanup

### C1-H Reliability and lifecycle hardening

- call versus timeout
- accept versus reject
- accept versus cancel
- double initiation
- session revocation
- device revocation
- breakup transition
- account deletion
- final dissolution
- signaling process loss
- network change
- ICE restart
- TURN expiry

### C1-I Closure harness and device acceptance

Planned command surface:

~~~text
npm run test:c1
npm run test:c1:security
npm run test:c1:postgres
npm run test:c1:browser
npm run test:c1:local
npm run test:c1:closure
npm run health
npm audit --audit-level=high
~~~

These are design targets until implemented.

## Acceptance boundary

C1 is DONE only when:

- all canonical C1 gates in ROADMAP_EPICS are green
- isolated C1 migration validation uses only documented 0015/0016 reservations and final integrated migrations 0001 through 0018 pass with `reserved=0`
- call authorization and cross-partnership denial are proven
- first-accept-wins is proven under concurrency
- calls never auto-answer
- pre-accept signaling and TURN issuance are impossible
- SDP, ICE, TURN secrets, and push endpoints are absent from logs
- realtime v1 is not silently mutated; C1 requires negotiated realtime v2
- SDP carries no ICE candidate lines and only parsed relay candidates are forwarded
- direct peer connectivity is not used
- TURN UDP and at least one restricted-network fallback are proven where the deployment supports them
- signaling reconnect and process-loss recovery are safe
- lifecycle and deletion races pass
- Web Push stale-call behavior is safe and push-denied foreground calling still works
- ring, connect, and hard-expiry scheduled actions cannot strand or resurrect calls
- physical Android voice calling passes
- full repository health passes
- high-severity dependency audit passes

C1 design completion is not C1 implementation completion.

## C2 handoff

C2 reuses:

- call table and history
- call lifecycle
- selected-device semantics
- signaling transport
- TURN authorization
- relay-only policy
- push reachability
- lifecycle and deletion integration

C2 adds:

- video call initiation policy
- camera permission
- video transceivers
- camera switching
- video rendering
- background/foreground camera behavior
- bandwidth adaptation
- video-specific Android acceptance

C2 must not create a second call authority system.
