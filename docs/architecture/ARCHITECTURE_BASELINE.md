# Architecture Baseline

## Status

FROZEN

## Baseline version

1.0

## Effective date

2026-09-20

## Purpose

This document identifies the architecture decisions that are considered the implementation baseline for Shawtie pls.

Frozen does not mean immutable forever.

Frozen means implementation should proceed against this baseline unless concrete evidence shows that a change is necessary.

Architecture changes must follow the process in `ARCHITECTURE_GOVERNANCE.md`.

## Frozen core decisions

The following decisions are part of Architecture Baseline 1.0:

1. React and TypeScript PWA as the primary client.
2. Fastify and TypeScript modular monolith for the application API.
3. Separate durable worker application.
4. PostgreSQL as the authoritative transactional state store.
5. Database-enforced one-partnership occupancy.
6. Centralized capability engine in `packages/domain`.
7. Transactional outbox for durable side effects.
8. PostgreSQL-backed scheduled actions for deadlines and retries.
9. Expected-generation guards for lifecycle-sensitive scheduled jobs.
10. Append-only non-content lifecycle event ledger.
11. Durable deletion manifests for cross-system deletion.
12. Deterministic account lock ordering for multi-account transactions.
13. WebSockets for realtime synchronization and call signaling.
14. IndexedDB partitioned by account, partnership, conversation, and crypto epoch.
15. WebRTC for voice and video calls.
16. Relay-first TURN behavior for privacy.
17. Short-lived TURN credentials.
18. Private object storage for encrypted media.
19. Reviewed E2EE before stable release.
20. Separate account recovery and cryptographic-history recovery.
21. First-class device identity and device revocation.
22. New cryptographic context for every new partnership.
23. Explicit cryptographic epochs inside a partnership.
24. Explicit client, API, crypto protocol, realtime, and local-schema versioning where applicable.
25. Strict trusted-origin browser execution policy.
26. No Redis in the initial architecture unless measured production needs justify it.
27. No microservices in the initial architecture unless measured production needs justify service extraction.
28. Runtime validation at external trust boundaries.
29. Server-authoritative time for product deadlines and eligibility.
30. Synthetic data only in the public repository.

## Frozen security boundaries

The following security principles are part of the baseline:

- client capability state is advisory only
- API authorization is authoritative
- protected resource access is partnership-scoped
- E2EE protected plaintext is not available to the server in stable release
- email recovery does not automatically recover historical E2EE keys
- final dissolution revokes access before asynchronous physical cleanup finishes
- revoked devices do not receive future protected content
- old partnership data and keys do not carry into a future partnership
- application logs never intentionally contain private content or secrets
- push and email providers receive minimal data
- browser hardening is part of the E2EE security boundary

## Frozen product-to-architecture boundaries

The architecture must preserve product rules defined in the PRD.

An architecture change cannot silently redefine:

- one active partner
- partner-request consent
- breakup timing
- restoration behavior
- cooldown behavior
- account deletion behavior
- message mutation rules
- relationship-space lifecycle
- E2EE stable-release requirement

Changing one of those rules requires a product decision and PRD change before architecture can adapt.

## Not frozen

The following are intentionally not frozen implementation choices.

Some may already have a current implementation or configured default. They may change without a new architecture baseline when the change preserves accepted boundaries and does not introduce a new major trust assumption:

- exact PostgreSQL schema details that preserve the accepted invariants
- exact ORM or query builder
- exact hosting provider
- exact PostgreSQL provider
- exact object-storage provider
- exact email provider
- exact TURN provider or deployment
- exact reviewed E2EE protocol and library
- exact logging or error-reporting provider
- exact CI runner configuration
- exact frontend component library
- exact emoji picker implementation
- exact bounded retention durations that have not yet been selected

These choices may be selected or changed without updating the frozen architecture baseline if they preserve all accepted boundaries and do not create new major trust assumptions.

## Baseline change rule

A change to any frozen decision requires:

1. concrete problem statement
2. evidence that the current baseline is insufficient
3. proposed replacement or modification
4. alternatives considered
5. migration impact
6. security and privacy impact
7. data-classification impact
8. testing impact
9. deployment and rollback impact
10. accepted ADR before implementation, except for emergency security mitigation

## Emergency exception

A security emergency may require an immediate protective change before the full ADR process is completed.

In that case:

- choose the smallest safe change
- document the emergency reason
- preserve evidence
- create a retrospective ADR before the temporary change becomes permanent
- update the baseline only after the decision is accepted

## Baseline verification

Implementation reviews should ask:

- does this change preserve the frozen architecture?
- does it preserve product invariants?
- does it preserve security boundaries?
- does it require an ADR?
- does it require a PRD change?
- does it create a new provider or trust boundary?
- does it change data handling?
- does it require migration or compatibility handling?

If any answer implies structural change, follow architecture governance before continuing.

## C1 accepted refinements

Architecture Baseline 1.0 remains the historical frozen baseline. Accepted ADRs may refine it without rewriting the original numbered decisions.

- ADR-013 isolates accepted-call SDP/ICE into dedicated `shawtie.call.v1` and keeps M2 realtime content-free.
- ADR-014 refines baseline item 16 from relay-first to relay-only for C1 voice calling. C1 must fail closed when TURN relay is unavailable rather than silently use a direct peer path.

C2 inherits these C1 call-platform refinements unless a later accepted ADR changes them.

- ADR-015 defines C2 camera/transceiver privacy: one stable video transceiver, local-only camera state, generation-fenced async camera work, and stop-on-background capture.
