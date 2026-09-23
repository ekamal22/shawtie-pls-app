# Architecture Decision Records

## Purpose

Architecture Decision Records document structural decisions that materially affect Shawtie pls.

Accepted ADRs are authoritative for architecture decisions.

## Status values

- Proposed
- Accepted
- Rejected
- Superseded
- Deprecated

## Current ADRs

- ADR-001: Modular Monolith and Durable Worker
- ADR-002: PostgreSQL Invariants, Outbox, and Durable Scheduling
- ADR-003: Realtime and Offline Consistency
- ADR-004: E2EE, Encrypted Media, and Call Privacy
- ADR-005: Centralized Capability Engine
- ADR-006: Device Identity and Cryptographic Recovery Separation
- ADR-007: Durable Deletion Manifests
- ADR-008: Lifecycle Ledger and Generation Guards
- ADR-009: Explicit Versioning and Trusted PWA Origin
- ADR-010: PostgreSQL First Without Redis
- ADR-011: Architecture Freeze and Change Control
- ADR-013: Dedicated Call Signaling Transport
- ADR-014: Relay-Only Call Network Privacy

## Creating a new ADR

Use the architecture governance rules in:

`../architecture/ARCHITECTURE_GOVERNANCE.md`

A new ADR should include:

- Status
- Context
- Problem
- Evidence
- Decision
- Alternatives considered
- Consequences
- Security and privacy impact
- Data-classification impact
- Migration impact
- Compatibility impact
- Testing impact
- Rollout plan
- Rollback or recovery plan
- Documents superseded or amended

Do not change an accepted architecture decision only by editing an older ADR.

Create a new ADR that explicitly supersedes or amends the earlier decision.
