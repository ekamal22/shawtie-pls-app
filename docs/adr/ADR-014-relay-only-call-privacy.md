# ADR-014: Relay-Only Call Network Privacy

## Status

Accepted and implemented for C1 on `feat/c1-voice-calling`. This refines Architecture Baseline 1.0 relay-first behavior to relay-only for C1 voice calling. Automated/local privacy and signaling verification passed at `439b09f`; physical relay-path/Android acceptance and final M3-integrated closure remain open.

## Context

The original generic call baseline preferred TURN relay while allowing possible direct WebRTC connectivity.

Direct ICE paths can disclose peer network addresses to the other endpoint.

Shawtie pls is a private two-person communication product. Avoiding unnecessary peer IP disclosure is worth additional TURN bandwidth cost.

## Decision

C1 configures WebRTC with relay-only ICE policy.

The client uses:

iceTransportPolicy = relay

TURN is required for C1 calls.

Supported provider transports should include, where deployed:

- UDP
- TCP
- TLS, normally on 443 for restrictive networks

There is no silent direct-connect fallback.

C1 additionally uses candidate-free SDP and server validation that forwarded trickle candidates are `typ relay`, so relay-only is enforced at the signaling boundary rather than trusted only to browser configuration.

If TURN cannot establish a relay path, the call fails with a bounded connectivity error.

TURN credentials are short-lived and issued only to the two selected authorized call endpoints.

Permanent TURN credentials are never embedded in the client.

## Alternatives considered

### Relay-first with direct fallback

Rejected for C1 because it may expose peer network addresses.

### Direct peer-to-peer only

Rejected because it exposes peer network information and performs poorly in restrictive networks.

### Application media proxy

Rejected because application servers should not terminate or proxy voice media.

### SFU

Rejected for one-to-one C1 because it adds unnecessary media infrastructure and changes the encryption trust model.

## Security and privacy impact

Positive for peer network privacy.

TURN becomes availability-critical, so abuse controls, quotas, monitoring, and fallback transports are required.

TURN infrastructure still observes network metadata such as source address, timing, and traffic volume.

Relay-only does not provide network anonymity.

Call media remains protected by WebRTC secure transport, but S1 still owns reviewed endpoint cryptographic identity binding before stable release.

## Data-classification impact

TURN credentials are SECRET while valid.

TURN operational connection metadata is SENSITIVE.

## Cost impact

TURN bandwidth cost is higher than direct peer connectivity.

This is accepted for C1 privacy and simplicity. X1 should measure relay cost.

## Migration impact

None.

## Compatibility impact

Networks that cannot establish TURN relay cannot complete a C1 call.

The product must fail clearly rather than downgrade privacy.

## Testing impact

Physical acceptance must inspect selected ICE paths and prove relay use.

Restricted-network testing must exercise TURN/TCP or TURN/TLS where deployment supports them.

Expired credentials and unauthorized credential issuance must fail.

## Evidence

- direct host/srflx ICE paths can reveal peer network addresses
- Shawtie pls is explicitly privacy-focused and one-to-one, so TURN cost is preferable to silent peer-IP exposure
- C1 does not need an SFU for one-to-one voice
- TURN UDP plus TCP/TLS fallback provides a practical privacy-preserving connectivity strategy for the initial deployment

## Rollout plan

1. deploy TURN with short-lived REST/provider credentials
2. configure C1 peer connections with `iceTransportPolicy: relay`
3. send candidate-free SDP
4. reject non-relay trickle candidates at signaling
5. verify relay candidate pair physically and test restrictive-network fallback
6. monitor TURN bandwidth/cost without logging call content

## Rollback and recovery

If TURN availability, cost, or privacy enforcement is not acceptable, disable C1 calling until the relay path is corrected. Do not roll back to direct peer connectivity without a new accepted ADR and explicit privacy review.

## Documents amended

- Architecture Baseline 1.0 item 16 for C1 behavior
- `docs/architecture/CALL_ARCHITECTURE.md`
- `docs/security/SECURITY_MODEL.md`
- `docs/security/THREAT_MODEL.md`
- `docs/testing/C1_ANDROID_ACCEPTANCE.md`
