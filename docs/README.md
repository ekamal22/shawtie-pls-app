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

The selected architecture is:

- React and TypeScript PWA in `apps/web`
- Fastify and TypeScript modular monolith in `apps/api`
- separate durable worker in `apps/worker`
- PostgreSQL as the authoritative transactional state store
- transactional outbox for reliable side effects
- PostgreSQL-backed scheduled actions for deadlines and retries
- WebSockets for realtime invalidation and signaling
- IndexedDB for partnership-scoped local cache and offline queues
- private object storage for encrypted media
- WebRTC for voice and video calls
- TURN relay support, with relay-first privacy behavior
- reviewed E2EE design with client-side encryption for protected content

## Core architecture documents

- `architecture/SYSTEM_ARCHITECTURE.md`
- `architecture/DATA_MODEL.md`
- `architecture/PARTNERSHIP_STATE_MACHINE.md`
- `architecture/REALTIME_ARCHITECTURE.md`
- `architecture/OFFLINE_ARCHITECTURE.md`
- `architecture/CALL_ARCHITECTURE.md`
- `security/SECURITY_MODEL.md`
- `security/E2EE_ARCHITECTURE.md`
- `testing/TEST_STRATEGY.md`

## Product source of truth

Product rules remain in:

- `product/PRD.md`

Architecture work must preserve the defining invariant:

> An account can occupy at most one partnership slot, and every partnership is an isolated private space whose data and cryptographic state must never leak into another partnership.
