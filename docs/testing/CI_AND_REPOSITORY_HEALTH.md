# CI and Repository Health

## Status

Baseline CI and repository-health tooling are configured.

The repository workspace, TypeScript, linting, formatting, runtime-contract, dependency-direction, circular-dependency, and repository-health guardrails are locally validated. On 2026-09-20, the canonical `npm ci` bootstrap succeeded from the committed lockfile, installed 180 packages, reported 0 vulnerabilities, and was followed by a complete passing `npm run health` run.

F1 Repository Foundation and Executable Guardrails is therefore complete.

GitHub-hosted execution is tracked separately as V1 Hosted CI Verification. V1 is currently blocked by Actions capacity and does not block ongoing implementation work. It remains required before R2 Public Readiness can be marked DONE.

Do not describe the GitHub Actions gate as verified until a real workflow run completes successfully.

## Baseline workflow

The baseline workflow is:

`.github/workflows/ci.yml`

It is designed to run on:

- pushes to `main`
- pull requests
- manual workflow dispatch

The workflow uses one small job to reduce GitHub Actions consumption.

Current steps are:

1. checkout with persisted credentials disabled
2. use Node 22.18.0
3. install exactly from the committed lockfile with `npm ci`
4. run the complete repository baseline through `npm run ci:baseline`
5. run `npm audit --audit-level=high` as a hard dependency gate

The workflow uses read-only repository permissions, a job timeout, concurrency cancellation, and full commit-SHA pinning for external GitHub Actions.

## Local equivalent

The repository-health checks do not require GitHub Actions.

Run:

```text
npm run health:repo
```

Run the current full local baseline:

```text
npm run health
```

With workspace dependencies installed, this is configured to combine repository health, static migration-plan validation, TypeScript typecheck, build, lint, formatting, dependency and circular-import checks, the domain suite, and runtime-contract tests.

The expanded command has a complete passing local run on the F2-complete branch. It verified repository health across 234 scanned files, six static migration-plan entries, all workspace TypeScript typechecks and production builds, lint, formatting, dependency-direction and circular-dependency checks, 27 domain tests, 2 runtime-contract tests, and 3 worker unit tests.

The canonical clean-clone dependency bootstrap is:

```text
npm ci
```

The clean-install path from the committed lockfile has been validated successfully.

A1 has added its runtime dependencies and local verification commands. The committed lockfile is current, the full local health baseline is green, the expanded disposable PostgreSQL A1 path passes 27/27, the A1 security suite passes 16/16, and the high-severity dependency audit reports 0 vulnerabilities. A1 is DONE at 20/20 acceptance gates.

M1 Messaging Core is closed at runtime anchor `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288` and is now combined with R1 on `integration/m1-r1`. On the exhaustive technical validation baseline `5db7a94183bca153d142389d7188e3887653a9ec`, canonical migrations 0001 through 0014 apply with `reserved=0` and database invariants green; `test:m1:local` passes 64/64 with `M1_LOCAL_POSTGRES_PASS`; `test:r1:local` passes 69/69 with `R1_LOCAL_POSTGRES_PASS`; and full repository health passes with Domain 60/60, Contracts 29/29, API unit/security 44/44, and Worker 4/4. `npm audit --audit-level=high`, `git diff --check`, tracked/staged cleanliness, final worktree cleanliness, and local/remote SHA parity all pass. Hosted GitHub Actions verification remains separate under V1 and was not claimed or triggered for this closure.

The exhaustive sweep passed 40/40 gates on one exact local/remote SHA. It included clean bootstrap, repository scanner, migration-plan validation, typecheck, production builds, lint, formatting, dependency-direction checks, root and feature-specific unit/security suites, and every disposable PostgreSQL harness: F2 39/39, A1 27/27, P1 16/16, P2 27/27, P3 39/39, M1 64/64, and R1 69/69. This is the current local integration-validation source of truth until a later code change requires rerunning the matrix.

## C1 implementation verification status

C1 source implementation and final integrated automated/local closure are complete on `feat/c1-voice-calling`. The branch provides:

```text
npm run test:c1
npm run test:c1:postgres
npm run test:c1:local
npm run test:c1:browser:e2e
npm run test:c1:closure
npm run test:c1:device:prepare
npm run test:c1:device:cleanup
```

The isolated `test:c1:closure` passed at `439b09f` using only the documented 0015/0016 reservations. The first real-migration integrated closure passed at `9b5c255`. A later physical gap check found one stale media-owner defect; after the fix at `b29aaa1`, `test:c1:closure` re-passed with `C1_AUTOMATED_INTEGRATED_PASS reserved=0`, C1 real Chromium 5/5, integrated PostgreSQL/API/worker 111/111, retained M3 gates, full health, audit and git hygiene. Redmi Note 9S acceptance is complete at 25/25, and the rejected-notification, stale-owner and audible bidirectional-audio follow-ups all pass.

## M2 automated closure status

M2 automated/local closure passed at `4bbffdfbcd70bd4160e50c52bb14048cf3339dc0` with `M2_AUTOMATED_CLOSURE_PASS`.

The canonical automated M2 command is:

```text
npm run test:m2:closure
```

That wrapper requires the exact `feat/m2-realtime-offline` branch and remote SHA, an initially clean worktree, `[skip ci]` on every M2 branch commit while hosted Actions capacity is intentionally conserved, no newly introduced Unicode em dash, the full `test:m2:local` Docker/PostgreSQL/API/worker/Chromium matrix, `npm run health`, `npm audit --audit-level=high`, `git diff --check`, and a clean final worktree. Passing that command closes the automated local gate only.

All 14 mandatory physical Android acceptance scenarios have since executed and passed on a physical Xiaomi Redmi Note 9S, final physical acceptance SHA `b83102f`, recorded in `docs/testing/M2_ANDROID_ACCEPTANCE_EVIDENCE.md`. That physical run found and fixed seven real M2 defects not caught by the automated/local closure, each with a focused regression test. M2 is DONE.

## M3 physical closure and C1 dependency status

M3 Media and Voice Messages is DONE and fast-forward merged to `main @ 1d3535f1c4d2d16e66c3bfa4c9c8cef42a95822a`. The canonical automated closure is green and all 20 mandatory physical Android scenarios passed on a Xiaomi Redmi Note 9S at final code SHA `ee59850`.

C1 Voice Calling is DONE and fast-forward merged to `main @ d44c595`. Its final executable baseline is `b29aaa1`, where integrated closure re-passed after the stale media-owner fix. Redmi Note 9S acceptance 25/25 and all focused physical follow-up evidence are complete.

## Repository-health policy

`scripts/ci/repository-health.mjs` checks the current repository for:

- required governance, security, testing, and product files
- forbidden committed environment-secret files
- forbidden private-key and database file extensions
- obvious high-risk token and private-key patterns
- Unicode em dashes in scanned repository text
- Unicode em dash in the current commit message when Git metadata is available
- forbidden `docs/worklog` content
- generic catch-all source directories under `apps` or `packages`
- forbidden infrastructure imports from `packages/domain`
- dangerous workflow use of `pull_request_target`
- workflow `write-all` permissions
- workflows without explicit permissions
- workflows without job timeouts
- external GitHub Actions that are not pinned to a full commit SHA

This is a baseline safety scanner, not a replacement for a dedicated secret-scanning product or security review.

## Workflow supply-chain gate

External GitHub Actions in repository workflows must be pinned to a full 40-character commit SHA.

Human-readable version comments may be kept beside the SHA, but floating tags such as `@v4` are not sufficient for the baseline policy.

The repository-health scanner enforces this rule.

## Architecture-boundary gate

The initial executable dependency boundary protects `packages/domain`.

It rejects imports from infrastructure or application frameworks including:

- React
- Fastify
- PostgreSQL clients
- ORM packages
- cloud provider SDKs
- email provider packages
- Redis clients
- sibling Shawtie packages
- `apps/*`

This remains the dedicated hard boundary for domain purity.

The executable repository foundation additionally defines strict TypeScript configuration and path aliases, ESLint and Prettier configuration, workspace package boundaries, and `scripts/ci/check-dependencies.mjs`. The dependency checker enforces the accepted workspace dependency directions and rejects circular source or workspace dependencies. Full-repository dependency-installed execution now passes locally.

## Secret handling

The baseline repository scanner detects several high-risk secret patterns and forbidden secret-bearing file types.

It does not claim exhaustive secret detection.

Before public stable release, repository settings or CI should also provide dedicated secret scanning and dependency security tooling.

## Dependency scanning

The repository commits `package-lock.json`.

Baseline CI installs with `npm ci` and then runs `npm audit --audit-level=high` as an unconditional hard gate. The local dependency installation that generated the committed lockfile reported 0 vulnerabilities. Hosted execution of the audit gate is still pending.

## CODEOWNERS

`.github/CODEOWNERS` assigns repository ownership to the repository owner.

CODEOWNERS does not enforce review by itself.

Required review enforcement needs a GitHub branch-protection rule or ruleset.

## Security reporting

`SECURITY.md` defines the public vulnerability-reporting policy and tells reporters not to disclose vulnerability details in public issues.

Private vulnerability reporting should be enabled in GitHub repository settings when available.

## GitHub settings that repository files cannot guarantee

The current connected GitHub tooling does not expose write controls for all repository settings.

These settings must be verified separately:

- branch protection or repository ruleset for `main`
- required status check for the baseline CI job
- required pull-request review policy if desired
- GitHub-native secret scanning
- Dependabot security alerts
- private vulnerability reporting
- organization or repository Actions policy where relevant

Until those settings are verified, repository health is partially code-enforced and partially procedural.

## Actions-minute conservation

When GitHub Actions execution is intentionally being avoided, commits may use GitHub's recognized `[skip ci]` marker.

A skipped workflow is not evidence that CI passed.

V1 remains deferred while Actions capacity is unavailable. Once Actions execution is available again:

1. create or push a commit without a skip marker, or manually dispatch Baseline CI
2. inspect the workflow result
3. fix any repository-health or domain-test failure
4. record the successful run in PROJECT_STATE
5. only then treat the GitHub-hosted baseline gate as verified

## Future gate expansion

Local disposable PostgreSQL F2 verification is complete. The Docker-backed path applies all six migrations from zero, runs database invariants, and passes 17/17 F2 integration tests covering races, expired-claim reclaim, fencing, lease ownership, transaction retry and clocks, outbox atomicity and duplicate safety, lifecycle privacy, deletion recovery, queue plans, and worker shutdown.

Baseline CI still contains the intentionally small lockfile, repository-baseline, and dependency-audit job. Hosted GitHub Actions execution remains blocked under V1 while Actions capacity is being conserved.

When hosted PostgreSQL CI infrastructure is justified, it can reproduce the already-passing local F2 database matrix. That hosted reproduction is a V1 or later CI-expansion concern and is not required to reopen F2.

A1 now commits:

- API integration tests
- authentication/security regression tests
- worker integration tests
- `test:a1:local` disposable PostgreSQL orchestration
- new API/runtime dependencies that require a refreshed committed lockfile

These A1 paths are recorded as complete: migration 0007 applies from zero in the seven-migration disposable run, database invariants pass, `npm run test:a1:local` passes 27/27, `npm run test:a1:security` passes 16/16, `npm run health` is green, and `npm audit --audit-level=high` reports 0 vulnerabilities. A1 is DONE.

Later epics add:

- browser E2E beyond the current A1 web foundation
- physical-device evidence where required

## Gate truthfulness

A configured workflow is not a passing workflow.

A passing unit test suite is not equivalent to a passing integration gate.

PROJECT_STATE and ROADMAP_EPICS must distinguish:

- configured
- locally validated
- GitHub Actions validated
- integration validated
- release validated


## M3 local closure

M3 source and verification harnesses are implemented on `feat/m3-media-voice`.

Canonical commands:

```text
npm run test:m3:contracts
npm run test:m3:storage
npm run test:m3:storage:integration
npm run test:m3:browser
npm run test:m3:browser:e2e
npm run test:m3:security
npm run test:m3:postgres
npm run test:m3:local
npm run test:m3:closure
npm run test:m3:device:prepare
npm run test:m3:device:cleanup
```

`test:m3:local` provisions disposable PostgreSQL and private MinIO, then runs the M3 PostgreSQL/API/worker, real object-store, and real Chromium layers. `test:m3:closure` additionally enforces branch/SHA parity, `[skip ci]` history, no introduced Unicode em dash, full repository health, high-severity dependency audit, diff hygiene, and clean-worktree status.

`npm run test:m3:closure` was executed and passed at `305891f` (`M3_AUTOMATED_CLOSURE_PASS`: migration plan `count=16 reserved=0`, database invariants, PostgreSQL/API/worker, MinIO storage integration, real Chromium 4/4, full health, `npm audit --audit-level=high` with 0 vulnerabilities, `git diff --check`). After the physical fixes every step passed again. Physical Android acceptance then passed 20/20 (see `M3_ANDROID_ACCEPTANCE_EVIDENCE.md`). Hosted GitHub Actions verification remains separate under V1 and was not used.
