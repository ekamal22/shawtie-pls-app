# Architecture Governance

## Purpose

This document defines how Shawtie pls architecture may change after Architecture Baseline 1.0 is frozen.

The goal is not bureaucracy.

The goal is to prevent accidental structural drift while still allowing evidence-based improvement.

## Governing principle

Implementation follows the frozen architecture baseline.

Architecture changes are made because a real constraint, defect, security finding, operational measurement, or product requirement requires them.

A new pattern is not sufficient justification by itself.

## Change classes

### Class A: Implementation detail

No ADR is required when the change preserves existing architecture and trust boundaries.

Examples:

- refactoring inside a module
- adding tests
- query optimization that preserves semantics
- UI component changes
- adding an index
- changing internal function names
- provider-neutral bug fixes

Requirements:

- tests remain green
- documentation is updated if behavior or operational instructions change

### Class B: Architecture-compatible extension

An ADR is normally not required, but architecture documentation must be updated.

Examples:

- adding a new module inside the modular monolith
- adding a new relationship-object subtype using established patterns
- adding a new scheduled-action type
- adding a new lifecycle event type
- adding a new capability that follows the established capability model

An ADR becomes required if the extension creates:

- a new trust boundary
- a new persistent state system
- a new external provider receiving sensitive data
- a new cross-module dependency direction
- a new cryptographic assumption
- a new lifecycle authority

### Class C: Architecture change

An ADR is required before implementation.

Examples:

- introducing Redis as authoritative or coordination state
- extracting a microservice
- replacing PostgreSQL as lifecycle authority
- bypassing the capability engine
- replacing the worker scheduling model
- changing the E2EE architecture
- changing device identity or recovery model
- introducing an SFU
- allowing direct WebRTC when relay-first privacy was previously assumed
- changing local partnership isolation
- changing deletion semantics across systems
- adding third-party executable scripts to the trusted PWA origin

### Class D: Product rule change

A PRD change is required before architecture work.

Examples:

- changing one-partner exclusivity
- changing breakup timing
- changing cooldown duration
- changing restoration consent
- changing account-deletion behavior
- changing age eligibility
- changing message deletion semantics

After the product decision is recorded, architecture changes follow Class B or Class C as appropriate.

## ADR process

A new architecture ADR must contain:

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

Recommended statuses:

```text
Proposed
Accepted
Rejected
Superseded
Deprecated
```

Only Accepted ADRs change the architecture baseline.

## Evidence standard

Useful evidence includes:

- failing tests that expose an architectural limitation
- measured performance data
- security findings
- provider limitations
- production reliability data
- regulatory or legal requirements
- implementation contradiction with the PRD
- demonstrated cost problem
- browser or platform incompatibility

Weak evidence includes:

- preference for a newer tool
- style preference
- trend popularity
- hypothetical scale without measurements
- unnecessary future-proofing

## Architecture review checklist

Before accepting a Class C change, review:

### Product

- Which PRD requirements are affected?
- Does the change alter user-visible behavior?
- Does the PRD need to change first?

### Data

- Which tables, objects, caches, or queues change?
- Does migration require backfill?
- Does deletion behavior change?
- Does the data-classification matrix change?

### Security

- Is a new trust boundary introduced?
- Does the threat model change?
- Does E2EE coverage change?
- Does account recovery or device authorization change?
- Does provider exposure increase?
- Does logging exposure increase?

### Reliability

- What new failure modes appear?
- What becomes eventually consistent?
- What happens during partial failure?
- Is idempotency preserved?
- Is rollback safe?

### Compatibility

- Does the client version need to change?
- Does the API version need to change?
- Does the crypto protocol version need to change?
- Does the local schema version need to change?
- Can old clients fail safely?

### Operations

- What must be deployed first?
- What must be monitored?
- What new credentials or providers are required?
- What are the cost implications?

### Testing

- What new unit tests are required?
- What database invariant tests are required?
- What security regressions are required?
- What browser or physical-device tests are required?

## Documentation authority

The authority order is:

1. accepted ADRs for architecture decisions
2. implemented source code and migrations for current runtime behavior
3. PRD for intended product behavior
4. architecture and security documents
5. testing documentation
6. project state and roadmap
7. Git history for provenance

A source-code implementation that accidentally violates an accepted ADR is a defect, not an automatic architecture change.

## Baseline update process

When an ADR changes a frozen decision:

1. accept the ADR
2. update `ARCHITECTURE_BASELINE.md`
3. update affected architecture and security documents
4. update threat model and data classification when relevant
5. update testing requirements
6. update roadmap and project state
7. implement migration or compatibility work
8. verify all required gates

## Architecture debt

If implementation must temporarily diverge from the baseline:

- document the divergence
- state why it is temporary
- create a tracked remediation item
- define the condition for removal
- do not describe the temporary state as the accepted architecture

## Review cadence

A scheduled architecture redesign cycle is not required.

Review the baseline when triggered by:

- security finding
- implementation contradiction
- significant operational failure
- measured scaling pressure
- new regulatory constraint
- major provider change
- major product-scope expansion

Otherwise, implementation should continue against the frozen baseline.
