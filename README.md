# Shawtie pls

Shawtie pls is a privacy-focused two-person communication platform built around one active partnership at a time.

The repository has completed its verified foundation milestones plus P1 Discovery and Partner Requests. Architecture Baseline 1.0 is frozen; F0, F1, F2, A1, and P1 are DONE locally. P1 is closed at all 14 acceptance gates: all eight migrations apply from zero, database invariants pass, the disposable P1 PostgreSQL/API/worker suite passes 16/16, the full `npm run health` regression passes with Domain 38/38, Contracts 8/8, API unit/security 11/11, and Worker 4/4, and `npm audit --audit-level=high` reports 0 vulnerabilities. P2 Partnership Formation and Relationship Date is now the active runtime milestone with a hardened design revalidated against the verified P1 coordinator seam.

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
- `docs/architecture/P2_PARTNERSHIP_FORMATION_DESIGN.md` for the active hardened P2 formation design
- `docs/ROADMAP_EPICS.md` for epic status and acceptance gates
- `docs/product/PRD.md` for product requirements
- `docs/architecture/ARCHITECTURE_BASELINE.md` for the frozen architecture baseline
- `docs/architecture/ARCHITECTURE_GOVERNANCE.md` for structural change control
- `docs/security/THREAT_MODEL.md` and `docs/security/DATA_CLASSIFICATION.md` for security boundaries
- `docs/testing/TEST_STRATEGY.md` for verification requirements
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
