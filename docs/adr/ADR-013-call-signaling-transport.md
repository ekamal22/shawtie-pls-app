# ADR-013: Dedicated Call Signaling Transport

## Status

Accepted and implemented on `feat/c1-voice-calling`. Final integrated automated/local verification passed at `9b5c255`, and mandatory physical Android acceptance passed 25/25 on the Redmi Note 9S.

## Context

M2 implements shawtie.realtime.v1 as a content-free invalidation and transient presence/typing protocol.

C1 requires WebRTC negotiation data including SDP and ICE candidates.

These payloads have different size, privacy, rate, reconnect, backpressure, and authorization characteristics.

## Decision

Use a dedicated authenticated WebSocket endpoint for each accepted call:

/api/v1/calls/:callId/signal

Protocol:

shawtie.call.v1

Durable call actions remain HTTP.

M2 v1 remains unchanged. C1 adds `shawtie.realtime.v2`, which preserves M2 frames and adds only content-free `call.changed` invalidations.

The signaling socket:

- authenticates through the existing HttpOnly session
- enforces exact trusted Origin
- derives account and device from the session
- derives partnership and call role from PostgreSQL
- opens only after explicit call acceptance
- authorizes only the endpoint device resolved from the caller or accepted-callee `call_participants` role row
- never persists SDP or ICE
- never logs frame bodies
- uses bounded frames and rate limits
- uses transient signaling generations for reconnect fencing

## Scale-out decision

The initial implementation does not add Redis.

The first C1 deployment may use one signaling API replica. For multiple API instances, signaling requires verified deterministic affinity by opaque call ID so both endpoints reach the same API process.

If production cannot provide reliable affinity, a shared ephemeral signaling broker requires a new ADR.

SDP is not transported through PostgreSQL NOTIFY.

## Alternatives considered

### Reuse shawtie.realtime.v1

Rejected because it would mix content-free invalidations with sensitive larger negotiation payloads.

### Send signaling through HTTP polling

Rejected because interactive negotiation and ICE trickle require bidirectional low-latency delivery.

### Persist SDP and ICE in PostgreSQL

Rejected because they are transient sensitive network metadata and do not belong in durable history.

### Add Redis immediately

Rejected because current evidence does not justify another stateful infrastructure dependency.

## Security and privacy impact

Positive.

Sensitive negotiation is isolated to selected call endpoints and excluded from ordinary realtime, durable queues, logs, and backups.

## Data classification impact

SDP and ICE are SENSITIVE transient data.

## Migration impact

No database migration is required solely for the signaling transport.

## Compatibility impact

shawtie.call.v1 versions independently from shawtie.realtime.v1.

## Testing impact

Dedicated signaling security, reconnect, frame-bound, process-loss, and privacy tests are required before implementation acceptance.

## Evidence

- M2 v1 is intentionally content-free and rejects call signaling mutations
- SDP/ICE are larger, more sensitive, and have different rate/backpressure semantics from M2 invalidations
- accepted-call negotiation needs bidirectional low-latency delivery but does not need durable persistence
- the initial deployment does not justify Redis or another shared signaling broker

## Rollout plan

1. implement `shawtie.realtime.v2` only for content-free call invalidation
2. implement `shawtie.call.v1` behind C1 feature availability
3. authorize signaling only after durable accept and selected-device selection
4. run one signaling API replica initially or verify call-ID affinity before adding replicas
5. close security/browser/physical acceptance before enabling C1 generally

## Rollback and recovery

If signaling correctness or affinity is not trustworthy, disable C1 call initiation/signaling and leave the existing M2 messaging/realtime substrate untouched. Do not move SDP/ICE into M2 v1 or PostgreSQL as an emergency fallback.

## Documents amended

- `docs/architecture/CALL_ARCHITECTURE.md`
- `docs/architecture/REALTIME_ARCHITECTURE.md`
- `docs/architecture/VERSIONING_AND_COMPATIBILITY.md`
- `docs/api/C1_SIGNALING_PROTOCOL.md`
