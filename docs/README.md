# Shawtie pls Documentation

This directory is the canonical engineering and product documentation for Shawtie pls.

## Document authority

Use this order when documents appear to conflict:

1. Accepted architecture decision records for decisions that have been formally adopted.
2. Source code and database migrations for behavior that already exists.
3. `docs/product/PRD.md` for intended product behavior and product rules.
4. Architecture and security documents for implementation boundaries and system design.
5. Testing documents for required verification and acceptance evidence.
6. Git history for implementation provenance.

The PRD defines what the product must do. Architecture documents define how the system is designed to satisfy those requirements. Architecture documents must not silently change product rules.

## Architecture baseline

Architecture Baseline 1.0 is frozen as of 2026-09-20.

Frozen means implementation should proceed against the accepted baseline unless concrete evidence justifies a controlled change.

## Current implementation frontier

M2 Realtime and Offline Reliability is DONE and merged to `main` at fast-forward anchor `b6183158dcc916589cef415b42fa9e9d2b8cc2fd` from `feat/m2-realtime-offline`. Automated/local closure passed at `4bbffdfbcd70bd4160e50c52bb14048cf3339dc0` with the Docker/PostgreSQL/API/worker/Chromium matrix, full health, audit, and git hygiene green. All 14 mandatory physical Android scenarios subsequently passed on a physical Xiaomi Redmi Note 9S, final physical acceptance SHA `b83102f`, recorded in `docs/testing/M2_ANDROID_ACCEPTANCE_EVIDENCE.md`. That physical run found and fixed seven real M2 defects not caught by the automated/local closure, each with a focused regression test.

M3 Media and Voice Messages is complete on `feat/m3-media-voice` (created from merged-M2 `main @ 54b8659a`) and is fast-forward merged to `main` at `1d3535f1c4d2d16e66c3bfa4c9c8cef42a95822a`. The implementation includes migrations 0015/0016, media contracts/repositories, private S3-compatible object storage, API/worker integration, M1/R1 binding, encrypted browser drafts, image/video/file/voice flows, and cleanup. Automated closure passed and all 20 mandatory physical Android scenarios passed on a Xiaomi Redmi Note 9S, final physical acceptance code SHA `ee59850`, recorded in `testing/M3_ANDROID_ACCEPTANCE_EVIDENCE.md`. That physical run found and fixed three real defects, each with a regression test. The canonical design is `architecture/M3_MEDIA_VOICE_DESIGN.md`, the API/storage contract is `api/M3_MEDIA_API.md`, and physical Android closure is defined in `testing/M3_ANDROID_ACCEPTANCE.md`.

C1 Voice Calling and C2 Video Calling are also DONE and merged to `main`. UX0 through UX7 are DONE, physically accepted at executable SHA `ca7cd35` with all 22 mandatory UX scenarios passing on the Xiaomi Redmi Note 9S, and fast-forward merged to `main` at merge anchor `9f0bea4`. S1 E2EE and Cryptographic Recovery is DONE and merged to `main @ 71569cf`. The final corrective executable SHA is `cde73a1`, where the full S1 automated closure re-passed after physical-run code changes, with migrations 0001 through 0021 and `reserved=0`, database invariants green, S1 contracts 9/9, browser 9/9, security 7/7, PostgreSQL integration 4/4, real Chromium 4/4, full health, production scan PASS, and 0 vulnerabilities. All 30 mandatory physical Android scenarios are closed in `testing/S1_ANDROID_ACCEPTANCE_EVIDENCE.md`, including the corrective reruns for lost-response retry, general-file retry, real worker-driven dissolution/realtime purge, future-partnership isolation, and real push delivery/privacy. Canonical architecture: `architecture/S1_E2EE_CRYPTO_RECOVERY_DESIGN.md`. UX8 Encrypted UX Integration is DONE on `feat/ux8-encrypted-ux-integration`. Automated closure re-passed at final corrective executable `43ff9b1ec319703f3d9270ae8053ab196ca54419` in `testing/UX8_AUTOMATED_CLOSURE_EVIDENCE.md`. Mandatory Redmi Note 9S acceptance closed 25/25, including a real device-trust presentation defect found and fixed during the physical run, recorded in `testing/UX8_ANDROID_ACCEPTANCE_EVIDENCE.md`. UX8 is fast-forward merged to `main` at `a029169`.

**SEC1 Pre-V1 Security Hardening is DONE and fast-forward merged to `main @ a2badf7a357f36c075d44e1378fc2d6c2d20e300`.** Final executable `91ca920d9a7cdfc4268f8c57425ed8dd7ef726d5` passed the complete local closure, including focused security 16/16, header/proxy/server 16/16, PostgreSQL/API/worker 36/36, Chromium 1/1, production scan, full health, zero vulnerabilities, and Git hygiene. The implementation preserves Argon2id verification/rehash independence, adds canonical server-only new-password admission over the pinned digest corpus, adds layered PostgreSQL reauthentication budgets with canonical network subjects, uses bounded replica-safe registration-intent maintenance without a new migration/action type, and owns the production static/API/WebSocket serving path with strict CSP/HSTS and explicit proxy trust. A 2026-09-29 follow-up audit found two post-SEC1 defects outside the original SEC1 closure scope. Both are now DONE on `main @ a1659dc` and passed hosted focused validation run `36773261743`: account-wide S1 local-crypto lifecycle cleanup and the S1 HTTP request-size/client-error boundary. SEC1 remains DONE. See `testing/SEC1_SECURITY_HARDENING_EVIDENCE.md`.

The 2026-09-29 follow-up audits found no new critical authentication bypass, cross-partnership authorization leak, E2EE plaintext exposure, or committed-secret defect. The two mandatory pre-V1 source repairs are DONE on `main @ a1659dc` and passed hosted focused validation run `36773261743`: account-wide S1 local-crypto lifecycle cleanup and the S1 Fastify request-size/client-error boundary. V1 Hosted CI Verification is also DONE at executable candidate `d28668b5`, with release run `36801613394` and normal Baseline CI run `36801613306` green. Remaining R2 gates include service-worker cache versioning, canonical network-prefix rate limiting, safe backend transport, dedicated secret scanning, signed release provenance, branch protection, licensing, obsolete M3 history, production operations, and review of the transitive `RUSTSEC-2026-0173` maintenance warning. See `PROJECT_STATE.md`, `ROADMAP.md`, `ROADMAP_EPICS.md`, `testing/CI_AND_REPOSITORY_HEALTH.md`, `security/DEVICE_AND_RECOVERY.md`, `security/THREAT_MODEL.md`, and `operations/PRODUCTION_WEB_SERVING.md`.

Governance:

- `testing/V1_HOSTED_CI_VERIFICATION_PLAN.md` for the implemented V1 release workflow design, exact-SHA integrity model, hosted job topology, failure policy, scope, and completion contract
- `testing/V1_HOSTED_VERIFICATION_EVIDENCE.md` for final V1 hosted closure evidence
- `architecture/ARCHITECTURE_BASELINE.md`
- `architecture/ARCHITECTURE_GOVERNANCE.md`
- `adr/ADR-011-architecture-freeze-and-change-control.md`
- `contributing/DEVELOPMENT_WORKFLOW.md`

The selected architecture is:

- React and TypeScript PWA in `apps/web`
- Fastify and TypeScript modular monolith in `apps/api`
- separate durable worker in `apps/worker`
- PostgreSQL as the authoritative transactional state store
- transactional outbox for reliable side effects
- PostgreSQL-backed scheduled actions for deadlines and retries, with locally verified recoverable leases, direct expired-claim reclaim, and claim-version fencing
- WebSockets for realtime invalidation and signaling
- IndexedDB for partnership-scoped local cache and offline queues
- private object storage for encrypted media
- WebRTC for voice and video calls
- TURN relay support, with relay-first privacy behavior
- frozen S1 RFC 9420 MLS architecture with OpenMLS WASM baseline and client-side protected-content encryption
- centralized domain capability engine
- explicit device model and device revocation
- account recovery separated from cryptographic history recovery
- per-partnership cryptographic epochs
- append-only lifecycle event ledger for sensitive state changes
- generation-checked scheduled lifecycle jobs
- durable deletion manifests for cross-system cleanup
- explicit client, API, crypto, local-schema, realtime, and durable-work payload versioning where applicable
- no Redis in the initial architecture unless measured need justifies it

## Core architecture documents

- `architecture/SYSTEM_ARCHITECTURE.md`
- `architecture/S1_E2EE_CRYPTO_RECOVERY_DESIGN.md`
- `testing/S1_ANDROID_ACCEPTANCE.md`
- `testing/S1_RAW_PRIVACY_INSPECTION_EVIDENCE.md`
- `testing/S1_SECURITY_REVIEW_EVIDENCE.md`
- `architecture/A1_ACCOUNTS_DEVICES_DESIGN.md`
- `architecture/P1_DISCOVERY_REQUESTS_DESIGN.md`
- `architecture/P2_PARTNERSHIP_FORMATION_DESIGN.md`
- `api/P2_PARTNERSHIP_API.md`
- `architecture/P3_PARTNERSHIP_LIFECYCLE_DESIGN.md`
- `architecture/M1_MESSAGING_CORE_DESIGN.md`
- `api/M1_MESSAGING_API.md`
- `architecture/M2_REALTIME_OFFLINE_DESIGN.md`
- `design/ROMANTIC_UX_DIRECTION.md`
- `design/UX8_ENCRYPTED_UX_INTEGRATION_DESIGN.md` - hardened frozen UX8 state, recovery, repair, race, accessibility, and closure design
- `testing/UX8_AUTOMATED_CLOSURE_EVIDENCE.md` - passing automated closure evidence anchored at final corrective executable `43ff9b1ec319703f3d9270ae8053ab196ca54419`
- `testing/UX8_ANDROID_ACCEPTANCE.md` - mandatory 25-scenario Redmi Note 9S UX8 physical acceptance procedure, closed 25/25
- `testing/UX8_ANDROID_ACCEPTANCE_EVIDENCE.md` - executed physical evidence, including the one defect found and fixed
- `api/M2_REALTIME_PROTOCOL.md`
- `architecture/M3_MEDIA_VOICE_DESIGN.md`
- `api/M3_MEDIA_API.md`
- `architecture/R1_RELATIONSHIP_SPACE_DESIGN.md`
- `api/R1_RELATIONSHIP_SPACE_API.md`
- `architecture/F2_PERSISTENCE_WORKER_DESIGN.md`
- `architecture/DATA_MODEL.md`
- `architecture/PARTNERSHIP_STATE_MACHINE.md`
- `architecture/REALTIME_ARCHITECTURE.md`
- `architecture/OFFLINE_ARCHITECTURE.md`
- `architecture/CALL_ARCHITECTURE.md`
- `architecture/C2_VIDEO_CALLING_DESIGN.md`
- `api/C2_VIDEO_CALLING_API.md`
- `api/C2_VIDEO_SIGNALING_PROTOCOL.md`
- `architecture/CAPABILITY_MODEL.md`
- `architecture/DELETION_ARCHITECTURE.md`
- `architecture/VERSIONING_AND_COMPATIBILITY.md`
- `architecture/ARCHITECTURE_BASELINE.md`
- `architecture/ARCHITECTURE_GOVERNANCE.md`
- `security/SECURITY_MODEL.md`
- `architecture/SEC1_PRE_V1_SECURITY_HARDENING_DESIGN.md` - frozen SEC1 implementation architecture
- `security/PRE_V1_SECURITY_HARDENING.md` - current SEC1 implementation/closure scope and acceptance gates
- `operations/PRODUCTION_WEB_SERVING.md` - production web adapter, environment, proxy, CSP/HSTS, and deployment verification contract
- `security/THREAT_MODEL.md`
- `security/DATA_CLASSIFICATION.md`
- `security/DEVICE_AND_RECOVERY.md`
- `security/E2EE_ARCHITECTURE.md`
- `testing/TEST_STRATEGY.md`
- `testing/M2_ANDROID_ACCEPTANCE.md`
- `testing/M3_ANDROID_ACCEPTANCE.md`
- `testing/M3_ANDROID_ACCEPTANCE_EVIDENCE.md`
- `testing/C2_ANDROID_ACCEPTANCE.md`
- `testing/C2_ANDROID_ACCEPTANCE_EVIDENCE.md`
- `testing/UX_ANDROID_ACCEPTANCE.md`
- `testing/UX_ANDROID_ACCEPTANCE_EVIDENCE.md`
- `testing/CI_AND_REPOSITORY_HEALTH.md`
- `database/MIGRATIONS.md`

## Product source of truth

Product rules remain in:

- `product/PRD.md`

Architecture work must preserve the defining invariant:

> An account can occupy at most one partnership slot, and every partnership is an isolated private space whose data and cryptographic state must never leak into another partnership.


## Living project documents

- `PROJECT_STATE.md`
- `ROADMAP.md`
- `ROADMAP_EPICS.md`
- `EXECUTION_GRAPH.md`

These documents describe current planning state and execution order. They do not override accepted ADRs, the PRD, source code, or migrations.

`ROADMAP_EPICS.md` is the canonical implementation epic and acceptance-gate catalog.

`EXECUTION_GRAPH.md` is the compact dependency and milestone branch-flow view.

`ROADMAP.md` is the canonical milestone execution sequence and explicitly identifies physical-device requirements. M3 Media and Voice Messages, C1 Voice Calling, and C2 Video Calling are DONE and merged. C2 is fast-forward merged to `main @ fed2db7853c52ce87964dd351dd89b9a3879cd2f`; final executable `ecbb2e1` passed `C2_AUTOMATED_INTEGRATED_PASS reserved=0` and every mandatory Redmi scenario (1 through 31 and 33 through 36). Canonical C2 documents are `architecture/C2_VIDEO_CALLING_DESIGN.md`, `api/C2_VIDEO_CALLING_API.md`, `api/C2_VIDEO_SIGNALING_PROTOCOL.md`, `testing/C2_ANDROID_ACCEPTANCE.md`, `testing/C2_ANDROID_ACCEPTANCE_EVIDENCE.md`, and ADR-015. UX0 through UX7 are DONE, physically accepted at `ca7cd35` with 22/22 Redmi Note 9S scenarios passing, and merged to `main` at `9f0bea4`. S1 is DONE and merged to `main @ 71569cf`; UX8 is DONE and merged to `main @ a029169`. SEC1 is DONE and fast-forward merged to `main @ a2badf7a357f36c075d44e1378fc2d6c2d20e300`; final executable `91ca920d9a7cdfc4268f8c57425ed8dd7ef726d5`. V1 Hosted CI Verification is DONE at executable candidate `d28668b5`; release run `36801613394` and normal Baseline CI run `36801613306` passed. The 2026-09-29 follow-up source defects and their focused hosted regression gate are also closed. R2 Public Readiness is the next active release milestone.

An epic is DONE only when its required gates are verified. Partial implementation must remain IN_PROGRESS.


## Documentation freshness model

Documentation has different freshness responsibilities:

- `PROJECT_STATE.md` is the canonical record of verified current implementation state.
- `ROADMAP_EPICS.md` is the canonical record of epic status and acceptance gates.
- `ROADMAP.md` is the high-level execution sequence.
- the PRD defines intended product behavior and is not a progress tracker.
- architecture and security documents define accepted design and security boundaries, even when parts are not implemented yet.
- accepted ADRs are historical decision records and should not be rewritten merely because implementation progresses. A later decision should supersede or amend them through a new ADR.
- CI status must distinguish configured, locally validated, hosted validated, integration validated, and release validated.

Any change that makes a current-state claim stale must update the affected living documents in the same change.

## Change control

Implementation details that preserve the baseline do not need an ADR.

A structural architecture change requires evidence and an accepted ADR before implementation, except for the documented emergency security exception.

A product-rule change must update the PRD first.

Use the repository pull-request template and architecture-change issue template for governed changes.
