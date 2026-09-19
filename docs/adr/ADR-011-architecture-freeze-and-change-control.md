# ADR-011: Architecture Freeze and Change Control

## Status

Accepted.

## Context

The project now has:

- a detailed PRD
- accepted architecture decisions
- system, data, realtime, offline, call, deletion, and E2EE architecture
- a centralized capability model
- a threat model
- a data-classification matrix
- executable partnership state and capability tests

Continuing to redesign the foundation without implementation evidence would create churn and delay.

At the same time, a permanent architecture freeze would be unsafe because future evidence may require changes.

## Problem

The project needs a clear point where architecture becomes the implementation baseline while preserving a controlled path for legitimate changes.

## Evidence

The current architecture covers the known product requirements and major security boundaries.

The first executable domain milestone validates the core lifecycle direction with passing tests.

The remaining major work is implementation rather than unresolved architecture selection.

## Decision

Freeze Architecture Baseline 1.0.

Implementation must follow the baseline documented in:

`docs/architecture/ARCHITECTURE_BASELINE.md`

Architecture changes follow:

`docs/architecture/ARCHITECTURE_GOVERNANCE.md`

Class C architecture changes require an accepted ADR before implementation except for emergency security mitigation.

Product rule changes require a PRD update first.

## Alternatives considered

### Continue architecture iteration without a freeze

Rejected because it encourages design churn after the current architecture is sufficient to begin implementation.

### Make the architecture permanently immutable

Rejected because security findings, platform constraints, production measurements, or product changes may require legitimate evolution.

### Allow implementation to define architecture implicitly

Rejected because accidental code structure should not silently supersede accepted architecture.

## Consequences

Benefits:

- implementation can proceed with stable assumptions
- architectural drift becomes visible
- future changes require evidence
- security and migration impacts are reviewed consistently
- documentation remains authoritative

Costs:

- structural changes require additional documentation
- contributors must classify changes before large refactors
- temporary experiments may need explicit isolation

## Security and privacy impact

Positive.

Security-sensitive architecture changes must explicitly assess:

- threat-model impact
- data-classification impact
- trust-boundary changes
- provider exposure
- E2EE impact
- deletion impact
- device and recovery impact

## Data-classification impact

No new user data is introduced by this ADR.

Future architecture changes that alter data handling must update the classification matrix before or with implementation.

## Migration impact

No runtime data migration is required.

This ADR governs future migration decisions.

## Compatibility impact

No runtime compatibility change is introduced.

Future architecture changes must assess client, API, crypto, realtime, and local-schema compatibility.

## Testing impact

Architecture-changing pull requests must identify required tests and regression coverage.

Existing domain tests remain mandatory evidence for lifecycle-sensitive changes.

## Rollout plan

Effective immediately for new implementation work.

## Rollback or recovery plan

If this governance process blocks an urgent security fix, use the emergency exception in the governance document and complete a retrospective ADR before making the deviation permanent.

## Documents amended

- `docs/README.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/architecture/ARCHITECTURE_BASELINE.md`
- `docs/architecture/ARCHITECTURE_GOVERNANCE.md`
- contribution workflow and repository templates
