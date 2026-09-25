# Shawtie pls

Shawtie pls is a privacy-focused two-person communication platform built around one active partnership at a time.

The verified mainline includes M2, M3, C1, and C2 as DONE and merged. C2 Video Calling is fast-forward merged to `main @ fed2db7853c52ce87964dd351dd89b9a3879cd2f`. Its final executable SHA is `ecbb2e1877fbc8ee7bbeac0c15674a66683e8143` (`ecbb2e1`), where `npm run test:c2:closure` passed with `C2_AUTOMATED_INTEGRATED_PASS reserved=0` and every mandatory Redmi Note 9S scenario (1 through 31 and 33 through 36) passed with `C2_ANDROID_ACCEPTANCE_PASS` and `C2_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`. The discovery sweep found and fixed two physical-only defects before the final run: `e6576e9` (callee duplicate video transceiver) and `ecbb2e1` (frozen remote last frame). The canonical migration chain remains real 0001 through 0018 with `reserved=0`. Evidence: `docs/testing/C2_ANDROID_ACCEPTANCE_EVIDENCE.md`. The next product-experience program is UX0 through UX8, governed by `docs/design/ROMANTIC_UX_DIRECTION.md`; S1 E2EE remains a required stable-release milestone and the UX program must not claim E2EE before S1 is implemented and verified.

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
- `docs/design/ROMANTIC_UX_DIRECTION.md` for the accepted romantic UX direction, implementation boundaries, and UX0 through UX8 program
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
- `docs/testing/C2_ANDROID_ACCEPTANCE.md` for mandatory physical Android C2 closure (complete; evidence in `docs/testing/C2_ANDROID_ACCEPTANCE_EVIDENCE.md`)
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
