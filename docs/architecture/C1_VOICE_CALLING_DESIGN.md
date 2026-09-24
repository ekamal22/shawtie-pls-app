# C1 Voice Calling Architecture and Implementation Design

## Status

**DESIGN COMPLETE, SOURCE IMPLEMENTATION COMPLETE ON BRANCH, VERIFICATION PENDING.**

Branch:

`feat/c1-voice-calling`

Required base:

`main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`

Prior design branch `design/c1-voice-calling` is historical input only and is not the implementation base. C1-A through C1-I source work is implemented on this branch, including API, persistence, worker, realtime v2, signaling, browser voice engine, push reachability, lifecycle integration, local/PostgreSQL closure runners, Android preflight, and a focused real-Chromium ownership harness. Automated closure still requires execution, mandatory physical Android acceptance is still open, and final integrated closure still waits for real M3 migrations 0015/0016.

C1 is voice calling only. Video calling is C2 so call authority, consent, signaling, TURN privacy, push reachability, multi-device behavior, and recovery can close before camera-specific complexity is added.

M3 proceeded in parallel. The current M3 implementation branch `feat/m3-media-voice @ 305891f` owns implemented but unmerged migrations 0015 and 0016. C1 owns implemented migrations 0017 and 0018. Isolated C1 database validation uses the repository's proven reservation mechanism `SHAWTIE_MIGRATION_RESERVATIONS=0015,0016` rather than copying or fabricating M3 SQL. Final integrated C1 closure must run the real contiguous 0001 through 0018 chain with `reserved=0`.

Canonical API contract: `docs/api/C1_CALLING_API.md`.

Canonical signaling protocol: `docs/api/C1_SIGNALING_PROTOCOL.md`.

Canonical physical Android procedure: `docs/testing/C1_ANDROID_ACCEPTANCE.md`.

Accepted architecture refinements:

- `docs/adr/ADR-013-call-signaling-transport.md`
- `docs/adr/ADR-014-relay-only-call-privacy.md`

Third-pass hardening closes implementation seams found by tracing this design against the merged M2 runtime:

- `call_participants` is the sole durable endpoint-role/device authority; C1 does not add duplicate caller/callee endpoint columns to `call_sessions`
- timeout work is fenced by an independent `deadline_generation`, so a first endpoint-connected attestation cannot accidentally invalidate the accepted-call connect timeout
- endpoint-connected attestation is monotonic and does not require `expectedVersion`; concurrent endpoint reports converge under the call row lock
- one browser tab owns microphone capture, peer connection, and signaling for one call/device at a time, with generation-fenced local failover
- C1 SDP is voice-only: exactly one audio media section and no video or application/data-channel section
- relay candidate validation also rejects related/base-address forms that would disclose non-relay peer network metadata
- already-issued TURN allocation lifetime is treated as a bounded residual transport window after app authorization revocation
- generic `call_state_changed` Web Push performs canonical reconciliation, so delayed or reordered pushes cannot resurrect stale ringing UI
- `call.changed` participates in M2's dirty-counter synchronization barrier and visible anti-entropy
- the existing global Fastify WebSocket plugin is refactored for protocol separation without weakening M2's 4 KiB application-frame limit
- internal terminal causes are mapped to a bounded public outcome vocabulary instead of exposing session, device, deletion, or lifecycle security state

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

The first eligible device to commit acceptance atomically fills the callee participant's `endpoint_device_id`.

Later acceptance attempts return call_already_answered.

After acceptance:

- other callee devices stop ringing
- those devices cannot open an authorized signaling socket
- TURN credentials are denied to them
- only the caller device and winning callee device are media endpoints

C1 does not implement call handoff between devices.

### Caller endpoint is fixed

The authenticated device that creates the call is persisted as the caller participant's `endpoint_device_id`.

Another caller device may observe call history or current state but cannot take over the media session.

A future device-handoff feature requires a separate design.

### Participant rows are the endpoint authority

C1 keeps one durable endpoint model. `call_sessions` owns aggregate call state, lifecycle deadlines, versioning, terminal reason, and trusted timestamps. `call_participants` owns exactly two role rows:

- caller: initiating account plus fixed initiating `endpoint_device_id`
- callee: partner account plus nullable `endpoint_device_id` until first successful acceptance

The existing `call_sessions.initiated_by_account_id` remains compatibility/initiator metadata and must match the caller participant account. C1 does not add duplicate caller/callee account or endpoint-device authority columns to `call_sessions`.

Every endpoint authorization query resolves through the participant role row and current account-device ownership.

### Background ringing uses Web Push

A suspended or closed PWA cannot rely on a live WebSocket.

C1 uses a minimal reusable Web Push subscription and delivery substrate. Payloads do not include partner identity, call identity, partnership identity, terminal state, SDP, ICE, TURN credentials, call duration, or lifecycle reason.

~~~json
{
  "v": 1,
  "type": "call_state_changed"
}
~~~

The same event shape covers ringing and later state changes. The service worker never infers call state from delivery order.

On every call-state push, the service worker performs a same-origin, credentialed, no-store `GET /api/v1/calls/current` under a bounded timeout:

1. incoming + ringing shows or replaces one generic notification with a fixed non-identifying tag
2. any other canonical state closes the generic call notification
3. canonical fetch/auth failure exposes no accept/reject action and does not claim a call is still ringing
4. notification click opens/focuses the trusted app and canonical state is fetched again before actions render

Delayed, duplicate, or reordered push deliveries therefore converge on PostgreSQL authority. Foreground calling remains available without push permission through realtime v2.

Push endpoints and subscription keys are SENSITIVE capability data and are never logged.

### Call actions are online-only

Call initiation, acceptance, rejection, cancellation, and end are not M2 offline-queue operations.

When offline, the UI shows calling as unavailable.

This prevents a delayed queued operation from creating a call after its consent or lifecycle context is stale.

### Same-device multi-tab media ownership

M2 allows several tabs to hold ordinary realtime sockets. C1 does not allow those tabs to compete for one device's microphone and selected call endpoint.

For each `callId + deviceId`:

- one tab owns microphone capture, `RTCPeerConnection`, `shawtie.call.v1`, and endpoint-connected reporting
- `navigator.locks`, where available, is an outer efficiency lock
- IndexedDB stores `ownerTabId`, monotonic `ownerGeneration`, and lease expiry/heartbeat
- `BroadcastChannel` distributes observation/takeover hints only
- observer tabs render canonical state but do not capture, signal, or report connection
- takeover occurs only after explicit release or lease expiry, increments `ownerGeneration`, re-fetches canonical state, and opens a fresh signaling generation
- callbacks from an older owner generation are ignored and tear down their tracks/sockets

The local lease is not server authority. Selected-device authorization and one active signaling socket per call/device remain the security backstop.

## Durable call model

C1 refines the existing `call_sessions`, `call_participants`, and `call_events` aggregate.

`call_sessions` runtime fields include:

- id
- partnership_id
- initiated_by_account_id
- call_type
- status
- version
- deadline_generation
- ring_expires_at
- connect_expires_at
- hard_expires_at
- connected_at
- ended_at
- terminal_reason
- created_at
- updated_at

`call_participants` runtime fields include:

- call_session_id
- partnership_id
- account_id
- role: caller or callee
- endpoint_device_id, non-null for caller and nullable for callee until acceptance
- accepted_at
- connected_at
- left_at

`call_type` keeps the forward-compatible voice/video vocabulary, but C1 rejects video creation until C2.

Durable states are `ringing`, `accepted`, `connected`, and terminal `ended`.

Internal `terminal_reason` may distinguish rejected, cancelled, missed, completed, failed, authorization_revoked, partnership_terminated, account_deletion, and session_revoked.

Internal terminal reasons are not a public projection. The API maps them to a smaller privacy-safe outcome vocabulary.

## State transitions

Canonical durable states are `ringing`, `accepted`, `connected`, and terminal `ended`.

| Current | Event | Authorized actor | Next | Terminal reason / note |
| --- | --- | --- | --- | --- |
| none | create | authenticated caller on current initiating device | ringing | caller device fixed; one-non-terminal-call invariant checked |
| ringing | accept | callee account on first eligible device that wins row lock | accepted | winning callee device becomes fixed selected endpoint |
| ringing | reject | callee account on an eligible current device | ended | `rejected`; rejection ends the call for all callee devices |
| ringing | cancel | fixed caller device | ended | `cancelled` |
| ringing | ring timeout | durable worker | ended | `missed`; fenced by expected version/generation |
| ringing | lifecycle/device authorization loss | server lifecycle/revocation path | ended | bounded authorization/partnership terminal reason |
| accepted | first endpoint-connected attestation | one selected endpoint | accepted | record participant timestamp; version and deadline generation unchanged |
| accepted | second endpoint-connected attestation | other selected endpoint | connected | set server `connectedAt`; increment version and deadline generation; set hard expiry |
| accepted | end | either selected endpoint | ended | `completed`; duration remains absent if never connected |
| accepted | fail | either selected endpoint | ended | `failed` with coarse category only |
| accepted | connect timeout | durable worker | ended | `failed`; fenced by expected version/generation |
| accepted | lifecycle/device authorization loss | server lifecycle/revocation path | ended | authorization/partnership terminal reason |
| connected | end | either selected endpoint | ended | `completed` |
| connected | fail | either selected endpoint | ended | `failed` |
| connected | hard timeout | durable worker | ended | `failed`; prevents permanently stranded non-terminal call |
| connected | lifecycle/device authorization loss | server lifecycle/revocation path | ended | authorization/partnership terminal reason |
| ended | any mutation | none | ended | immutable terminal state; exact replay may return prior result |

Every aggregate state-changing transition locks the call row, verifies account/device/lifecycle authority, checks `expectedVersion` unless it is an exact replay or endpoint-connected attestation, uses trusted server time, increments call version once, and emits bounded history/invalidation metadata.

Endpoint-connected attestation is a monotonic selected-participant fact, not an optimistic aggregate command. It does not require `expectedVersion`. Under the call row lock, participant `connected_at` is set once. The first report leaves call `version` and `deadline_generation` unchanged. The second distinct selected endpoint transitions to `connected`, increments `version` once, advances `deadline_generation`, and emits invalidation.

Timeout workers reload the call and verify expected state, deadline, and `deadline_generation`.

## Connected evidence

Each selected endpoint may attest that its browser reached WebRTC `connectionState === "connected"`.

The server records participant `connected_at` with trusted server time and sets aggregate `connected_at` only after both selected endpoint rows are attested.

This is trusted server receipt time, not cryptographic proof that audible media flowed. A malicious authorized endpoint can lie about its local state. History therefore means "both endpoints reported connected".

If only one endpoint attests before the connect deadline, the call remains `accepted` and no connected duration is invented.

## Deadline generation and timeout fencing

Server deadlines:

- `ring_expires_at`: unanswered ringing becomes missed
- `connect_expires_at`: accepted without both endpoint attestations becomes failed
- `hard_expires_at`: generous operational ceiling for connected state

C1 adds monotonic `deadline_generation`, independent from call `version`.

1. create schedules ring timeout with current deadline generation
2. accept advances generation and schedules connect timeout
3. first endpoint-connected attestation does not advance generation, so connect timeout remains valid
4. second endpoint attestation advances generation and schedules hard expiry
5. terminal transitions advance generation or otherwise invalidate the old state/generation
6. workers re-read state/deadline/trusted time under lock

This prevents a first endpoint report from accidentally stranding an accepted call by fencing out its connect timeout.

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

The signaling socket may open only after the callee participant's `endpoint_device_id` is selected.

Upgrade authorization verifies that the current device is either:

- caller participant `endpoint_device_id` for the caller account
- callee participant `endpoint_device_id` for the callee account

One call signaling connection per selected device is active at a time.

A newer signaling connection for the same call and device supersedes the old one.

When one endpoint reconnects, the hub may force both signaling endpoints into a fresh signaling generation so stale callbacks and stale offers cannot cross generations.

Signaling generations are transient negotiation fencing. They do not replace durable call version.

## Signaling deployment without Redis

C1 does not add Redis. The initial signaling hub remains in-memory inside the API process.

The first stable deployment may run one signaling API replica. Multi-replica deployment requires verified call-ID affinity so both endpoints reach the same process. Affinity is deployment routing, not authorization. A shared ephemeral broker requires a later ADR; SDP/ICE are not forced through PostgreSQL NOTIFY.

### Shared Fastify WebSocket upgrade policy

Before C1, the merged M2 API installed one global `@fastify/websocket` server with a 4 KiB transport `maxPayload` and a global `handleProtocols` accepting only `shawtie.realtime.v1`.

The C1 implementation refactors that shared transport seam as follows:

- supported subprotocol constants are `shawtie.realtime.v1`, `shawtie.realtime.v2`, and `shawtie.call.v1`
- each connection offers exactly one application subprotocol; zero, multiple, or unknown offers fail
- each route asserts the exact negotiated protocol it owns
- the transport ceiling may rise if required for C1 SDP, but M2 v1/v2 still enforce their 4 KiB application-frame bound before JSON interpretation
- call signaling separately enforces whole-frame, SDP, candidate, rate, and generation ceilings
- per-message compression stays disabled

Tests prove cross-protocol offers fail closed and C1 cannot weaken M2 frame limits.

## WebRTC negotiation

The browser uses standard perfect negotiation. Caller is the initial offerer and impolite peer; callee is polite.

C1 is voice-only:

- one audio transceiver/media section
- exactly one audio `m=` section in transmitted SDP
- `m=video` rejected
- `m=application` and data channels rejected
- unexpected extra media sections rejected
- candidate/end-of-candidates lines prohibited in SDP

C2 must explicitly relax this policy.

Local media consent:

- caller microphone capture only from explicit Call gesture
- callee microphone capture only from explicit Accept gesture
- pre-acquired local track may exist while HTTP completes, but signaling/TURN/remote path remains unavailable until server acceptance
- failed or raced create/accept stops the track immediately
- C1 never requests camera permission
- browser Permissions Policy limits microphone to trusted origin and disables camera until C2

Audio processing constraints remain hints. Device permission denial is a local failure with bounded generic outcome. Device labels are not persisted.

## Browser audio playback and output routing

C1 keeps remote audio rendering separate from call authority.

Remote audio uses a dedicated audio element owned by the C1 call controller. The client attempts `play()` after canonical acceptance/connection setup.

If browser autoplay policy rejects playback:

- the durable call remains accepted/connected
- the UI shows a clear `Tap to hear` recovery action
- the next user gesture retries `play()`
- autoplay failure is not reported as partner/network failure
- no repeated permission/prompt loop is created

Microphone mute is local transient state implemented by disabling the local audio track where supported. Mute/unmute is not durable history and is not sent through ordinary realtime.

Audio output routing:

- C1 relies on the browser/OS default route on platforms without explicit sink selection
- `setSinkId()` may be offered only where supported and user-initiated
- selected output device IDs/labels are never persisted server-side
- lack of `setSinkId()` support is not a call failure

## Operational feature controls

C1 defines server-side operational controls that fail closed without weakening privacy:

- `C1_CALLING_ENABLED`: blocks new call creation while existing calls may continue according to their current authority
- `C1_TRANSPORT_ENABLED`: blocks new acceptance, signaling upgrade, and TURN issuance/refresh; no direct-connect fallback is allowed
- Web Push availability is configuration-driven through the C1 VAPID public/private configuration; if push is unavailable, foreground realtime calling remains available

These are operator controls, not browser authority. Disabling a control never rewrites a call to another transport and never enables direct peer ICE.

## Push subscription rotation and reconciliation

Web Push subscription state is device-bound and replaceable.

The browser reconciles its current PushSubscription:

- after successful login/device registration
- on application foreground/startup when notification permission is already granted
- after a best-effort service-worker `pushsubscriptionchange` event where supported

Replacement upserts the current endpoint/keys for the authenticated device and disables the superseded subscription transactionally.

Provider permanent-invalid responses remove/disable the stored subscription idempotently.

Do not repeatedly prompt after notification permission is denied. Foreground calling remains available through realtime v2.

## TURN/signaling resource budgets

Policy must bound provider abuse/cost without exposing call existence:

- at most one active signaling socket per selected endpoint/call generation
- bounded signaling reconnect rate/backoff
- bounded signaling frame and ICE candidate rate/count
- bounded TURN credential issuance/refresh frequency
- short TURN credential TTL
- per-account/network/partnership call-create limits, plus separate signaling, TURN, and push registration/delivery bounds
- bounded Web Push delivery attempts per authoritative incoming-call event

Operational metrics may aggregate call outcomes, setup latency, signaling reconnects, TURN issuance/failure, push delivery category, and relay transport class. Never record SDP, raw ICE, peer IP, TURN secrets, push endpoint, device label, or partner identity in analytics.

## Cross-milestone integration choreography

C1 source work proceeded in parallel with M3. C1 cannot perform final integrated closure or merge while 0015/0016 are only reservations on the C1 branch.

Required order:

1. M3 lands real migrations 0015/0016 on main
2. C1 reconciles onto that mainline without rewriting its own 0017/0018
3. reservation-only C1 tests are replaced by the real contiguous migration chain
4. C1 final closure runs 0001-0018 with `reserved=0`
5. only after C1 source, browser, physical Android, and documentation closure merge may C2 implementation begin

If M3 changes a seam C1 depends on, C1 adapts forward; it never copies or pins private M3 migration SQL.

## Candidate privacy enforcement

Relay-only privacy must be enforceable at the signaling boundary rather than relying only on honest browser configuration.

C1 therefore uses candidate-free SDP descriptions:

1. the browser configures `iceTransportPolicy: "relay"`
2. before forwarding an SDP offer/answer, the client removes ICE candidate and end-of-candidates lines
3. the signaling server rejects any SDP frame that still contains candidate lines
4. candidates are sent only through `signal.ice_candidate`
5. the signaling server parses every candidate and accepts only `typ relay`
6. relay candidate serialization exposing a non-relay related/base address through `raddr`, `rport`, or an equivalent reviewed extension is rejected
7. host, srflx, prflx, malformed, unknown, or privacy-unsafe relay candidates fail the signaling generation

Candidate strings remain SENSITIVE transient data and are never persisted or logged.

This blocks direct-candidate smuggling and avoidable peer-network metadata disclosure through nominal relay candidates. Physical-browser acceptance must prove the supported Chrome candidate form still passes.

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

For v2, `call.changed` increments the same M2 dirty counter used by the race-free live barrier. Initial sync, reconnect repair, listener-reset repair, and visible anti-entropy include `GET /api/v1/calls/current`. An invalidation arriving during sync changes the dirty counter and forces another pass before live mode.

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

- device_id as the durable row identity
- account_id
- endpoint capability URL
- keyed endpoint fingerprint
- endpoint fingerprint key version
- p256dh key
- auth key
- expiration time when provided
- created_at
- updated_at
- last_success_at
- last_failure_at
- failure_count
- revoked_at

Subscription endpoint and keys are SENSITIVE.

The worker sends push after an authoritative outbox event and only to subscriptions whose device/account still has current authorization. A stale subscription is not sufficient evidence that the device is logged in.

Permanent provider failure disables or removes the subscription idempotently.

Push delivery failure never changes call authority.

Payload version 1 is generic and privacy-minimized: `{ v: 1, type: "call_state_changed" }`. Caller identity, call identity, and call state are fetched from canonical HTTP. The same payload shape can also dismiss stale ringing state, so push delivery order is never product order.

Explicit logout, device revocation, account lockout, and permanent subscription-provider invalidation disable routing. Provider 404/410-style permanent failures are idempotent subscription cleanup.

Foreground delivery still uses M2 realtime.

## TURN provider boundary

The API depends on a `TurnCredentialProvider` interface.

The provider returns:

- urls
- username
- credential
- expiresAt

The server owns provider secrets.

TURN credential responses use Cache-Control: private, no-store and are never stored in IndexedDB.

The provider abstraction allows self-hosted coturn or a managed service without changing call domain rules.

Application authorization revocation is synchronous, but an already issued TURN credential or established allocation may remain usable until client teardown or provider expiry. C1 does not claim instant network-layer revocation.

Deployment requires short credential TTL, bounded allocation lifetime/refresh, no refresh after authorization loss, best-effort provider revoke when supported, and immediate honest-client teardown on canonical terminal/revoked state. Correctness does not depend on provider-specific active revocation.

The residual relay window is measured in disposable acceptance using accelerated policy.

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

M3 owns implemented 0015 and 0016 on its still-unmerged parallel implementation branch.

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

Implemented durable additions include:

- call `version`
- independent `deadline_generation`
- `ring_expires_at`
- `connect_expires_at`
- `connected_at`
- `terminal_reason`
- `hard_expires_at`
- trusted `updated_at`
- participant role as the sole caller/callee endpoint authority
- participant `endpoint_device_id`; no duplicate endpoint-device columns on `call_sessions`
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

- account ID
- device ID, which is the row identity
- endpoint capability URL
- keyed endpoint fingerprint for active-route uniqueness
- endpoint fingerprint key version
- p256dh key
- auth key
- provider expiration when present
- created/updated/last-success/last-failure timestamps
- failure count
- revoked timestamp

Subscription capability data is SENSITIVE/SECRET-like operational material and is never logged.

Push delivery remains outbox/worker driven. No second durable notification authority is introduced.

## Concrete implementation target map

~~~text
packages/domain/src/call/
packages/contracts/src/calls/
packages/db/src/repositories/calls.ts
packages/db/src/repositories/push-subscriptions.ts
packages/db/migrations/0017_calling_runtime.sql
packages/db/migrations/0018_push_runtime.sql
apps/api/src/modules/calls/
apps/api/src/modules/notifications/   extend existing push boundary
apps/worker/src/calls/
apps/web/src/features/calling/
apps/web/public/sw.js                 add canonical call-state push reconciliation
~~~

Pure rules stay in domain, wire schemas in contracts, transaction-aware SQL in db, HTTP/signaling orchestration in API, durable timeout/push side effects in the existing worker, and media/tab ownership in web. No provider SDK enters domain packages.

The shared `apps/api/src/application.ts` WebSocket registration seam is implemented with explicit protocol-family negotiation, route-level exact-protocol rechecks, compression disabled, and M2's application-level 4 KiB frame bound preserved.

## Implemented source slices

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
- participant-role endpoint authority with no duplicate session endpoint columns
- one non-terminal call per partnership invariant
- selected-device integrity
- trusted timestamps
- independent deadline_generation fencing for ring/connect/hard-timeout durable work
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
- monotonic endpoint-connected attestation without expectedVersion
- end
- TURN credentials
- exact idempotency and expectedVersion behavior

### C1-D Signaling transport

- shawtie.call.v1
- exact Origin and session authentication
- shared Fastify upgrade-policy refactor with route-owned exact protocol checks
- selected-device authorization
- bounded candidate-free, voice-only SDP and privacy-safe relay-only ICE frames
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
- audio element lifecycle including autoplay-blocked `Tap to hear` recovery
- default OS/browser output routing with optional local `setSinkId()` only where supported
- mute control
- same-device multi-tab media-owner lease and owner-generation fencing
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

- browser subscription lifecycle, replacement, startup reconciliation, and best-effort `pushsubscriptionchange`
- worker delivery
- generic call_state_changed push
- service-worker canonical current-call reconciliation and notification replacement/dismissal
- notification click routing
- stale and reordered push suppression through canonical fetch
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
- TURN expiry and bounded post-revocation residual allocation lifetime
- operational call-create/transport/push controls
- remote-audio autoplay recovery

### C1-I Closure harness and device acceptance

Implemented command surface:

~~~text
npm run test:c1
npm run test:c1:postgres
npm run test:c1:local
npm run test:c1:browser:e2e
npm run test:c1:closure
npm run test:c1:device:prepare
npm run test:c1:device:cleanup
npm run health
npm audit --audit-level=high
~~~

The commands and harnesses are present in source. Their presence is not a PASS claim: automated/local closure still requires execution, physical Android acceptance is still mandatory, and final integrated migration closure still waits for real M3 0015/0016 on main.

## Acceptance boundary

C1 is DONE only when:

- all canonical C1 gates in ROADMAP_EPICS are green
- isolated C1 migration validation uses only documented 0015/0016 reservations and final integrated migrations 0001 through 0018 pass with `reserved=0`
- call authorization and cross-partnership denial are proven
- first-accept-wins is proven under concurrency
- participant rows are the single durable endpoint authority and no duplicate call-session endpoint columns exist
- concurrent endpoint-connected attestations converge without expectedVersion conflicts
- one endpoint attestation does not invalidate the accepted-call connect timeout
- calls never auto-answer
- pre-accept signaling and TURN issuance are impossible
- SDP, ICE, TURN secrets, and push endpoints are absent from logs
- realtime v1 is not silently mutated; C1 requires negotiated realtime v2
- SDP carries no ICE candidate lines, contains exactly one audio media section, and cannot negotiate video or data channels
- only privacy-safe parsed relay candidates are forwarded; related/base-address leakage is rejected
- direct peer connectivity is not used
- TURN UDP and at least one restricted-network fallback are proven where the deployment supports them
- signaling reconnect and process-loss recovery are safe
- lifecycle and deletion races pass
- Web Push uses order-independent call_state_changed canonical reconciliation; stale or reordered delivery cannot resurrect ringing UI
- push-denied foreground calling still works
- call.changed participates in M2 dirty-barrier and visible anti-entropy repair
- same-device multi-tab behavior has one media/signaling owner and generation-fenced takeover
- internal terminal causes are not exposed through public outcome projections
- ring/connect/hard-expiry actions use deadline_generation
- authorization loss denies new TURN refresh immediately and any existing allocation is bounded by provider lifetime
- physical Android voice calling passes
- full repository health passes
- high-severity dependency audit passes

C1 source implementation completion is not C1 acceptance completion or DONE.

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
