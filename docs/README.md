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

M3 Media and Voice Messages source implementation is complete on `feat/m3-media-voice @ afc73baf`, created from merged-M2 `main @ 54b8659a`. The committed implementation includes migrations 0015/0016, media contracts/repositories, private S3-compatible object storage, API/worker integration, M1/R1 binding, encrypted browser drafts, image/video/file/voice flows, cleanup, and the automated/local/device closure harnesses. Automated/local closure and mandatory 20-scenario physical Android acceptance remain pending execution. The canonical design is `architecture/M3_MEDIA_VOICE_DESIGN.md`, the API/storage contract is `api/M3_MEDIA_API.md`, and physical Android closure is defined in `testing/M3_ANDROID_ACCEPTANCE.md`.

This distinction is intentional: implementation-complete does not mean acceptance-complete or DONE.

Governance:

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
- reviewed E2EE design with client-side encryption for protected content
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
- `architecture/A1_ACCOUNTS_DEVICES_DESIGN.md`
- `architecture/P1_DISCOVERY_REQUESTS_DESIGN.md`
- `architecture/P2_PARTNERSHIP_FORMATION_DESIGN.md`
- `api/P2_PARTNERSHIP_API.md`
- `architecture/P3_PARTNERSHIP_LIFECYCLE_DESIGN.md`
- `architecture/M1_MESSAGING_CORE_DESIGN.md`
- `api/M1_MESSAGING_API.md`
- `architecture/M2_REALTIME_OFFLINE_DESIGN.md`
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
- `architecture/CAPABILITY_MODEL.md`
- `architecture/DELETION_ARCHITECTURE.md`
- `architecture/VERSIONING_AND_COMPATIBILITY.md`
- `architecture/ARCHITECTURE_BASELINE.md`
- `architecture/ARCHITECTURE_GOVERNANCE.md`
- `security/SECURITY_MODEL.md`
- `security/THREAT_MODEL.md`
- `security/DATA_CLASSIFICATION.md`
- `security/DEVICE_AND_RECOVERY.md`
- `security/E2EE_ARCHITECTURE.md`
- `testing/TEST_STRATEGY.md`
- `testing/M2_ANDROID_ACCEPTANCE.md`
- `testing/M3_ANDROID_ACCEPTANCE.md`
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

`ROADMAP.md` is the canonical milestone execution sequence and explicitly identifies physical-device requirements. The completed implementation designs include A1, P1, P2, P3, M1 Messaging Core, and R1 Relationship Space. M1 and R1 are combined, exhaustively validated, and merged into the current verified `main @ 9f4237e90c4d289f8b316e5d8dd2bba41609c95d`. The technical validation anchor remains `5db7a94183bca153d142389d7188e3887653a9ec`. M2 Realtime and Offline Reliability is DONE and merged to `main` at fast-forward anchor `b6183158dcc916589cef415b42fa9e9d2b8cc2fd`, with automated/local closure green at `4bbffdfbcd70bd4160e50c52bb14048cf3339dc0`. That run passed the canonical 0001 through 0014 migrations with `reserved=0`, database invariants, PostgreSQL/API/worker 100/100, real Chromium 7/7, full health, a zero-vulnerability high-severity audit, and git hygiene. All 14 mandatory physical Android acceptance scenarios subsequently passed, final physical acceptance SHA `b83102f`. Hosted GitHub Actions verification remains separate under V1.

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
