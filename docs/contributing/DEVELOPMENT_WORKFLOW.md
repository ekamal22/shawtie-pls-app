# Development Workflow

## Purpose

Implementation should move quickly without allowing product rules, architecture, or security boundaries to drift silently.

## Before coding

Classify the proposed work.

### Product change

If user-visible product rules change:

1. update the PRD
2. update affected acceptance requirements
3. determine whether architecture also changes

### Architecture change

If a frozen architectural decision changes:

1. create an ADR
2. document evidence and alternatives
3. assess security, privacy, data, migration, compatibility, and testing impact
4. accept the ADR
5. update the architecture baseline
6. then implement

### Architecture-compatible implementation

Proceed without a new ADR when the work follows accepted architecture.

Update documentation when implementation details become concrete.

## Definition of done

A change is complete only when relevant items are satisfied:

- implementation is complete
- tests pass
- new product behavior has tests
- architecture invariants are preserved
- migrations exist when persistent data changes
- security implications are addressed
- data classification is updated when handling changes
- documentation reflects verified state
- PROJECT_STATE does not claim unverified work
- roadmap status is updated where appropriate
- no secrets or real private data are committed

## Documentation discipline

Use:

- PRD for product behavior
- ADRs for accepted architecture decisions
- architecture docs for current intended design
- security docs for threats and handling rules
- testing docs for verification requirements
- PROJECT_STATE for verified current state
- ROADMAP for execution order

Do not use Git commit messages as the only documentation for architectural decisions.

## Experimental work

Experiments must not silently redefine the baseline.

If an experiment is needed:

- isolate it on a branch
- label it experimental
- avoid irreversible migrations
- do not update the frozen baseline until evidence supports adoption

## Commit discipline

Commit messages should describe the change clearly and concisely.

Do not include secrets, personal private information, or sensitive production identifiers.

## Public repository discipline

Assume every committed byte can be permanently indexed.

Use synthetic data only.

Never commit:

- production credentials
- private messages
- private media
- real recovery secrets
- real private keys
- production database exports
- provider secrets
