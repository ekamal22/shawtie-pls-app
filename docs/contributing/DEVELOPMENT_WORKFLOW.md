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

## Milestone branch discipline

Every implementation epic or milestone gets its own durable Git branch.

Branch rules:

1. branch from the current verified `main` after the preceding milestone has been merged
2. use a milestone-specific name such as `feat/p2-partnership-formation`
3. keep implementation, tests, and milestone-specific design/docs on that branch
4. do not implement a later milestone on an earlier milestone's branch
5. close all required acceptance gates and reconcile documentation before milestone merge
6. merge the completed milestone branch into `main`
7. retain the completed milestone branch as an audit/history ref unless there is an explicit cleanup decision
8. create the next milestone branch from the newly updated `main`

Historical reconstruction must never rewrite commits merely to manufacture old merge commits. When earlier work was developed linearly, preserve genuine milestone closure commits with branch refs and fast-forward `main` to the latest verified closure where ancestry permits.

The legacy branch `feat/m1-executable-foundation` refers to an earlier executable-foundation naming scheme. It is not the future M1 Messaging Core branch and must not be reused for M1 Messaging work.

Future branch examples:

```text
feat/p2-partnership-formation
feat/p3-partnership-lifecycle
feat/m1-messaging-core
feat/r1-relationship-space
feat/m2-realtime-offline
feat/m3-media-voice
feat/c1-voice-calling
feat/c2-video-calling
feat/s1-e2ee
```

Architecture-only branches may be used before a dependency milestone closes when they contain documentation only and cannot be mistaken for implementation. Current example:

```text
design/m3-media-voice
```

`design/m3-media-voice` is based on the current M2 design/runtime state only to refine M3 architecture. It must not receive M3 runtime source, migrations, production dependencies, or closure claims. After M2 is verified and merged, the real `feat/m3-media-voice` branch must be created from the then-current verified `main`; do not convert the design branch into the implementation branch.

## Epic acceptance gates

Before starting implementation work, identify the roadmap epic in `../ROADMAP_EPICS.md`.

Acceptance gates are part of the implementation contract.

A pull request may satisfy only some gates. That is valid, but the epic remains IN_PROGRESS until all required gates are verified.

Do not mark an epic DONE based on:

- source code existing without tests
- domain tests without persistence or API integration when those are required
- UI completion without server enforcement
- documentation describing behavior that is not implemented
- a successful happy-path demo while required security or race gates remain

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
- roadmap and epic status are updated where appropriate
- affected epic acceptance gates have evidence
- no secrets or real private data are committed

## Documentation discipline

Use:

- PRD for product behavior
- ADRs for accepted architecture decisions
- architecture docs for current intended design
- security docs for threats and handling rules
- testing docs for verification requirements
- PROJECT_STATE for verified current state
- ROADMAP for high-level execution order
- ROADMAP_EPICS for epic status and acceptance gates
- CI_AND_REPOSITORY_HEALTH for current CI gate status

Do not use Git commit messages as the only documentation for architectural decisions.

Current-state claims must be refreshed in the same change that makes them stale.

Do not update accepted ADRs merely to reflect implementation progress. Supersede or amend an architecture decision through the governance process when the decision itself changes.

## Experimental work

Experiments must not silently redefine the baseline.

If an experiment is needed:

- isolate it on a branch
- label it experimental
- avoid irreversible migrations
- do not update the frozen baseline until evidence supports adoption

## Local verification while hosted CI is skipped

When hosted GitHub Actions is intentionally skipped, run the local baseline where practical:

```text
npm run health
```

Record hosted CI as unverified until an actual GitHub Actions run succeeds.

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
