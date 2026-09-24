# Shawtie pls

Shawtie pls is a privacy-focused two-person communication platform built around one active partnership at a time.

The verified combined technical baseline is `5db7a94183bca153d142389d7188e3887653a9ec`, with the completed M1/R1 baseline contained in `main @ 9f4237e90c4d289f8b316e5d8dd2bba41609c95d`. Architecture Baseline 1.0 is frozen; F0, F1, F2, A1, P1, P2, P3, M1 Messaging Core, and R1 Relationship Space are DONE with executed local evidence. M2 Realtime and Offline Reliability is DONE and merged to `main` at fast-forward anchor `b6183158dcc916589cef415b42fa9e9d2b8cc2fd` from `feat/m2-realtime-offline`. Automated/local closure passed at `4bbffdfbcd70bd4160e50c52bb14048cf3339dc0`: migrations 0001 through 0014 with `reserved=0`, database invariants, PostgreSQL/API/worker 100/100, real Chromium 7/7, full health, a zero-vulnerability high-severity audit, and git hygiene, ending with `M2_AUTOMATED_CLOSURE_PASS`. All 14 mandatory physical Android acceptance scenarios have since executed and passed on a physical Xiaomi Redmi Note 9S, with recorded evidence at `docs/testing/M2_ANDROID_ACCEPTANCE_EVIDENCE.md` and final physical acceptance SHA `b83102f`; that acceptance run found and fixed seven real M2 defects, each with a focused regression test. Hosted GitHub Actions verification remains separate under V1. M3 Media and Voice Messages source implementation, automated/local verification, and mandatory physical Android acceptance are complete on `feat/m3-media-voice` (final physical acceptance code SHA `ee59850`, initial tested SHA `305891f`). Automated closure passed at `305891f` before device work, and its every step passed again after the physical fixes. The 20 mandatory physical scenarios all passed on a physical Xiaomi Redmi Note 9S, with evidence in `docs/testing/M3_ANDROID_ACCEPTANCE_EVIDENCE.md`. That run found and fixed three real defects, each with a regression test. M3 is DONE and fast-forward merged to `main` at anchor `1d3535f1c4d2d16e66c3bfa4c9c8cef42a95822a`. C1 Voice Calling has completed source implementation and final integrated automated/local closure on `feat/c1-voice-calling`. The canonical integrated closure passed at `9b5c255b5e8c60cbe8da4bcd2b6f7596c56687a0` against real migrations 0001 through 0018 with `reserved=0`, including M3 PostgreSQL/API/worker 63/63, MinIO 1/1, M3 Chromium 4/4, C1 focused 21/21, integrated PostgreSQL/API/worker 111/111, C1 Chromium 2/2, full health, and a zero-vulnerability high-severity audit. Mandatory physical Android acceptance on the Redmi Note 9S then passed 25/25 (evidence in `docs/testing/C1_ANDROID_ACCEPTANCE_EVIDENCE.md`, tested SHA `9cbc2f8`, executable code identical to `9b5c255`), so C1 is DONE on `feat/c1-voice-calling` and is not merged to `main`; it awaits independent verification and an explicit merge decision. C2 Video Calling remains separate and is not started.

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
- `docs/architecture/M3_MEDIA_VOICE_DESIGN.md` for the completed M3 media/voice architecture and implementation plan
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
