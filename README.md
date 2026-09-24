# Shawtie pls

Shawtie pls is a privacy-focused two-person communication platform built around one active partnership at a time.

The verified mainline includes M2, M3, and C1 as DONE and merged. C1 Voice Calling is merged to `main @ d44c595cd6ea5107d8c33e11b4bb04f39a5c8185`, with final executable baseline `b29aaa1dc62c9e3419c41084cddf4016a4f1bad8` and full Redmi acceptance complete. C2 Video Calling architecture and implementation design is now complete on `feat/c2-video-calling` from verified post-C1 `main @ 5323d7be21e8776b45f507ec4cf60b9582544621`; source implementation has not started. C2 reuses the C1 call aggregate, keeps voice on `shawtie.call.v1`, introduces `shawtie.call.v2` for video multi-m-line ICE association, requires a coarse `video-v1` compatibility profile for video create/accept, and expects no PostgreSQL migration.

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
- WebRTC with relay-only TURN for C1/C2 calls; no direct peer fallback
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
- `docs/architecture/M3_MEDIA_VOICE_DESIGN.md` for the completed M3 media/voice architecture and implementation plan
- `docs/architecture/C1_VOICE_CALLING_DESIGN.md` for the verified and merged C1 voice-call architecture
- `docs/api/C1_SIGNALING_PROTOCOL.md` for the frozen voice `shawtie.call.v1` signaling contract
- `docs/architecture/C2_VIDEO_CALLING_DESIGN.md` for the completed C2 architecture and implementation design
- `docs/api/C2_VIDEO_CALLING_API.md` for the C2 HTTP compatibility delta
- `docs/api/C2_VIDEO_SIGNALING_PROTOCOL.md` for video `shawtie.call.v2`
- `docs/testing/C2_ANDROID_ACCEPTANCE.md` for mandatory physical Android C2 closure
- `docs/api/M3_MEDIA_API.md` for the implemented M3 upload, retrieval, storage, and binding contract
- `docs/testing/M3_ANDROID_ACCEPTANCE.md` for the M3 physical Android acceptance procedure (20 of 20 executed; evidence in `docs/testing/M3_ANDROID_ACCEPTANCE_EVIDENCE.md`)
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
