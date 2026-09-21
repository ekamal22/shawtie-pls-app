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

These documents describe current planning state and execution order. They do not override accepted ADRs, the PRD, source code, or migrations.

`ROADMAP_EPICS.md` is the canonical implementation epic and acceptance-gate catalog.

`ROADMAP.md` is the canonical milestone execution sequence and explicitly identifies physical-device requirements. `architecture/A1_ACCOUNTS_DEVICES_DESIGN.md` is the completed, verified implementation design for A1 Accounts and Devices; P1 is the active feature epic.

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
