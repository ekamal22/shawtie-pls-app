# Shawtie pls

Shawtie pls is a privacy-focused two-person communication platform built around one active partnership at a time.

The verified combined technical baseline is `5db7a94183bca153d142389d7188e3887653a9ec`, with the completed M1/R1 baseline contained in `main @ 9f4237e90c4d289f8b316e5d8dd2bba41609c95d`. Architecture Baseline 1.0 is frozen; F0, F1, F2, A1, P1, P2, P3, M1 Messaging Core, and R1 Relationship Space are DONE with executed local evidence. M1 runtime closure remains anchored at `aa40a2c`, R1 source head is `9bc9ba4`, and combined technical validation remains anchored at `5db7a94`. M2 Realtime and Offline Reliability is IN_PROGRESS on `feat/m2-realtime-offline`, but its feature and architecture implementation is complete through the pre-documentation source head `6e3c019371edd96a081c71ff178b6ee82f406566`. That implementation includes authenticated realtime transport, durable cross-feature invalidations, immediate account-routed partnership scope refresh, browser synchronization, IndexedDB/offline queues, conflict recovery, service-worker safety, revocation-safe local purge ordering, offline sync suppression, account and partnership isolation, expanded real-Chromium reconnect/replay/idempotency/cold-start coverage, and the automated `npm run test:m2:closure` gate. No known M2 implementation slice remains open. What remains is execution and acceptance: the current head must pass the full local Docker/PostgreSQL/Chromium closure, repository health and audit checks, and the mandatory physical Android scenarios. M2 is therefore implementation-complete but not yet DONE or merge-ready. Hosted GitHub Actions verification remains separate under V1.

## Product direction

The product combines:

- private one-to-one messaging
- media and voice messages
- voice and video calls
- a private relationship space
- breakup and account-deletion lifecycle rules
- strong partnership isolation
- PWA-first delivery
- reviewed end-to-end encryption before stable release

## Architecture

The selected architecture is:

- React and TypeScript PWA
- Fastify and TypeScript modular monolith
- separate durable worker
- PostgreSQL as the authoritative transactional state store
- transactional outbox
- durable scheduled actions
- capability-based domain authorization
- partnership-scoped local storage
- client-side encrypted media
- WebSockets for realtime synchronization and call signaling
- WebRTC with relay-first TURN support
- reviewed E2EE with per-device and per-partnership cryptographic state

## Documentation

Start with:

- `docs/README.md` for document authority and navigation
- `docs/PROJECT_STATE.md` for verified current implementation state
- `docs/ROADMAP.md` for the regenerated milestone-by-milestone execution sequence
- `docs/architecture/A1_ACCOUNTS_DEVICES_DESIGN.md` for the completed A1 implementation design
- `docs/architecture/P1_DISCOVERY_REQUESTS_DESIGN.md` for the completed, verified P1 implementation design
- `docs/architecture/P2_PARTNERSHIP_FORMATION_DESIGN.md` for the completed, locally verified P2 implementation design
- `docs/architecture/P3_PARTNERSHIP_LIFECYCLE_DESIGN.md` for the completed, locally verified P3 implementation design
- `docs/architecture/M1_MESSAGING_CORE_DESIGN.md` for the refined M1 Messaging Core architecture and implementation plan
- `docs/api/M1_MESSAGING_API.md` for the implemented M1 HTTP and synchronization contract
- `docs/architecture/M2_REALTIME_OFFLINE_DESIGN.md` for the implemented M2 realtime/offline architecture and closure boundary
- `docs/api/M2_REALTIME_PROTOCOL.md` for the M2 WebSocket protocol and invalidation contract
- `docs/architecture/R1_RELATIONSHIP_SPACE_DESIGN.md` for the completed R1 architecture and implementation design
- `docs/api/R1_RELATIONSHIP_SPACE_API.md` for the implemented R1 HTTP contract
- `docs/api/P2_PARTNERSHIP_API.md` for the implemented and locally verified P2 HTTP contract and replay/privacy semantics
- `docs/ROADMAP_EPICS.md` for epic status and acceptance gates
- `docs/product/PRD.md` for product requirements
- `docs/architecture/ARCHITECTURE_BASELINE.md` for the frozen architecture baseline
- `docs/architecture/ARCHITECTURE_GOVERNANCE.md` for structural change control
- `docs/security/THREAT_MODEL.md` and `docs/security/DATA_CLASSIFICATION.md` for security boundaries
- `docs/testing/TEST_STRATEGY.md` for verification requirements
- `docs/testing/M2_ANDROID_ACCEPTANCE.md` for the mandatory physical Android M2 procedure
- `docs/testing/CI_AND_REPOSITORY_HEALTH.md` for current CI and repository-health status
- `docs/database/MIGRATIONS.md` for PostgreSQL migration policy and verification

Architecture and product documents describe intended rules and design. `PROJECT_STATE.md` and `ROADMAP_EPICS.md` are the living sources for what is actually implemented and what remains.

## Canonical bootstrap

Use Node.js 22.18.0 or newer.

From a clean clone, the canonical dependency bootstrap command is:

```text
npm ci
```

After bootstrap, run the complete local repository baseline:

```text
npm run health
```

`npm ci` is the supported clean-install path because the repository commits `package-lock.json`.

## Repository rule

Every committed byte should be treated as permanently public.

Do not commit:

- real private messages
- real relationship data
- private user media
- secrets
- credentials
- private cryptographic material
- production database exports
- personal operational notes

Use synthetic data only.


## Architecture governance

Architecture Baseline 1.0 is frozen.

Implementation should follow the accepted baseline. Structural changes require evidence and an accepted ADR before implementation, except for emergency security mitigation.

See `docs/architecture/ARCHITECTURE_GOVERNANCE.md`.
