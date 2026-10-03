# V1 Hosted CI Verification Plan

## Status

DONE.

V1 closed on 2026-10-01 at executable candidate `d28668b5a7d021bc12b7a3dccbd69193074af9d3`.

Final V1 Release Verification run `36801613394` passed, normal Baseline CI run `36801613306` passed on the same SHA, and `V1_GATE_PASS` closed the release-verification graph.

Durable evidence: `docs/testing/V1_HOSTED_VERIFICATION_EVIDENCE.md`.

The implemented V1 architecture keeps normal CI separate from a dedicated release-verification workflow.

## Purpose

V1 is the hosted verification boundary between the completed implementation/security milestones and R2 Public Readiness.

V1 proves that one exact release-candidate source state passes the required repository baseline, dependency advisory, SEC1/S1 security, PostgreSQL integration, and Chromium verification gates on GitHub-hosted infrastructure.

V1 is not a feature milestone and does not replace historical local or physical closure evidence.

## Workflow architecture

```text
ci.yml
PR + push main + manual dispatch
        |
        v
fast Baseline CI
superseded PR runs may cancel


release-verification.yml
workflow_dispatch + workflow_call
+ narrow main push for V1/CI control-plane paths
        |
        v
     Candidate
        |
        +---------------+---------------+---------------+---------------+---------------+---------------+
        |               |               |               |               |               |
        v               v               v               v               v               v
     Baseline      Dependency audit   Security      PostgreSQL      PostgreSQL       Browser
                                                 SEC1 / A1          S1            security
        |               |               |               |               |               |
        +---------------+---------------+---------------+---------------+---------------+
                                        |
                                        v
                                     V1 gate
                                        |
                                        v
                             one exact candidate SHA
```

There are eight release-workflow jobs:

- Candidate
- Baseline
- Dependency audit
- Security
- PostgreSQL integration (SEC1/A1)
- PostgreSQL integration (S1)
- Browser security
- V1 gate

The six verification jobs run in parallel after Candidate succeeds.

## Normal CI

`.github/workflows/ci.yml` remains the fast pull-request/main feedback workflow.

V1 implementation should preserve the existing repository baseline while refining concurrency so superseded pull-request runs may cancel without cancelling immutable main/release evidence.

Normal CI is not V1 closure evidence.

## Release verification triggers

`.github/workflows/release-verification.yml` is implemented.

Final triggers:

- `workflow_dispatch`
- `workflow_call`
- a narrow `push` trigger on `main` limited to V1 and CI control-plane paths

The heavy release workflow does not run on pull requests or ordinary product-code pushes. The narrow main trigger exists so a CI-control-plane release candidate can obtain hosted closure evidence even when a manual workflow-dispatch action is unavailable to the automation client.

The temporary feature-branch push trigger used during shakedown was removed before merge to `main`.

## Common workspace setup

Add:

```text
.github/actions/setup-workspace/action.yml
```

Responsibilities:

- SHA-pinned `actions/setup-node`
- Node `22.18.0`
- print Node/npm versions
- `npm ci --ignore-scripts`
- assert `git rev-parse HEAD == GITHUB_SHA`
- expose/log checked-out SHA

The current lockfile marks only optional macOS `fsevents` with an install script, so ignoring npm lifecycle scripts is acceptable for the Linux V1 runner. Re-check this assumption whenever the lockfile changes.

Extend `scripts/ci/repository-health.mjs` so external `uses:` references inside `.github/actions/**/*.yml` are subject to the same full-SHA pin policy already enforced for workflow files.

No dependency/build cache is required for the closure run.

## Runner and workflow security

Release jobs:

```text
runs-on: ubuntu-24.04
permissions:
  contents: read
```

Required:

- external Actions pinned to full commit SHA
- checkout with `persist-credentials: false`
- explicit job timeouts
- no `pull_request_target`
- no write-all token
- no secrets in logs
- release evidence runs never cancelled by a newer candidate
- release concurrency keyed by candidate SHA with `cancel-in-progress: false`
- PR CI may cancel superseded PR runs

Record runner image version and relevant tool versions in V1 evidence.

## Candidate SHA integrity

Candidate equals `github.sha`.

Rules:

1. checkout without a branch-name `ref:` override
2. every verification job asserts `git rev-parse HEAD == GITHUB_SHA`
3. every verification job reports the checked-out SHA
4. V1 gate compares every reported SHA with `github.sha`
5. reruns reuse the same workflow-run SHA
6. any repository edit creates a new candidate and requires the complete V1 set again

For V1 closure, the final candidate was triggered by the narrow `main` push path at `d28668b5`. Manual dispatch remains supported for future release verification.

The Candidate job rejects an unintended ref before expensive jobs begin.

## Candidate job

Name: `Candidate`

Purpose:

- require the intended closure ref
- validate the candidate SHA shape
- record `github.sha`
- block the expensive jobs on an unintended branch

For V1 closure, accepted ref:

```text
refs/heads/main
```

Future R2/stable tag support can be added deliberately later.

Timeout: 5 minutes.

## Baseline job

Name: `Baseline`

Command:

```text
npm run ci:baseline
```

Common setup already ran `npm ci --ignore-scripts`.

This covers repository health, migration static plan, typecheck, builds, root lint/format, dependency-direction/circular checks, and normal Node test suites.

Do not run `npm audit` here.

Initial timeout: 20 minutes, recalibrated after shakedown.

## Dependency audit job

Name: `Dependency audit`

Required JavaScript gate:

```text
npm audit --audit-level=high
```

V1 also requires Rust advisory review for the OpenMLS/WASM dependency graph because npm audit does not cover `Cargo.lock`, and the OpenMLS binding documentation requires Cargo advisory review before production closure builds.

Implementation requirements:

- pin the `cargo-audit` version
- avoid unpinned third-party setup actions
- record cargo-audit version
- fail on unresolved advisory unless an explicit owner risk acceptance is recorded

Initial timeout: 15 minutes, recalibrated after shakedown.

## Security job

Name: `Security`

Run each gate as a separately named step:

```text
npm run test:sec1:headers
npm run sec1:passwords:check
npm run sec1:lint
npm run sec1:format:check
npm run test:pre-v1:hardening
npm run sec1:production:scan
npm run s1:production:scan
```

Ordering matters. `test:pre-v1:hardening` already builds the relevant contracts, crypto, DB, API, and web workspaces, so it creates the web `dist` required by the production scans. Do not add a redundant full `npm run build` before the scans unless later source changes make the hardening command insufficient.

Keep `test:pre-v1:hardening` despite partial overlap because it is the named regression gate for the two closed Pre-V1 defects.

Do not run separately:

- `test:sec1`
- `test:s1:security`
- `test:sec1:closure`
- `test:s1:closure`

The first two duplicate required work. The closure scripts are branch/history specific and are not mainline V1 entry points.

Initial timeout: 15 minutes, recalibrated after shakedown.

## PostgreSQL integration (SEC1/A1)

Use a dedicated GitHub Actions PostgreSQL service container.

Base image:

```text
postgres:16-alpine
```

Pin the image by digest before final merge.

Database:

```text
POSTGRES_USER=shawtie_test
POSTGRES_PASSWORD=shawtie_test
POSTGRES_DB=shawtie_a1_test
```

Required app env mirrors the existing local A1 harness:

```text
DATABASE_URL=postgresql://shawtie_test:shawtie_test@127.0.0.1:5432/shawtie_a1_test
DB_TEST_CONFIRM=1
NODE_ENV=test
APP_ORIGIN=http://127.0.0.1:4173
ALLOW_INSECURE_LOOPBACK_COOKIES=1
AUTH_HMAC_KEYS=<existing deterministic test key>
AUTH_HMAC_ACTIVE_VERSION=1
```

Before the suite, assert the database has no user schema tables.

Command:

```text
npm run test:sec1:postgres
```

Record the final migration count from `_schema_migrations`.

Initial timeout: 25 minutes.

## PostgreSQL integration (S1)

Use a separate PostgreSQL 16 service container/database so S1 independently proves migration-from-zero and invariants.

Database:

```text
POSTGRES_USER=shawtie_test
POSTGRES_PASSWORD=shawtie_test
POSTGRES_DB=shawtie_s1_test
```

Use the same test auth environment plus:

```text
PARTNER_REQUEST_MODE=paired
```

Before the suite, assert the database is empty.

Commands:

```text
npm run test:s1:postgres
npm run s1:plaintext:assert-clean
```

The plaintext assertion is required because the existing S1 local closure runs it after PostgreSQL verification.

Record the final migration count from `_schema_migrations`.

Initial timeout: 25 minutes.

## Browser security

Name: `Browser security`

SEC1 and S1 Chromium prove different boundaries:

- SEC1 uses the production web server and stub backend, covering CSP, headers, WASM under CSP, service worker registration, WebSocket proxying, and production serving behavior
- S1 uses the Vite development harness page and proves the S1 browser cryptographic harness; do not describe it as production-server S1 coverage

Toolchain setup:

1. print `rustc --version` and require Rust >= 1.91
2. `rustup target add wasm32-unknown-unknown`
3. install pinned `wasm-pack 0.15.0` without an unpinned setup Action
4. `npm run build --workspace @shawtie/crypto`
5. explicit cold `npm run build:s1-wasm`
6. `npx playwright install --with-deps chromium`

Then:

```text
npm run test:sec1:browser:e2e
npm run test:s1:browser:e2e
npm run sec1:production:scan
npm run s1:production:scan
```

The cold WASM build occurs before Playwright so expensive Rust compilation is outside the SEC1 webServer startup timeout. Existing inner builds should then be incremental.

Keep Playwright `retries: 0`.

Initial timeout: 45 minutes, recalibrated from hosted shakedown measurements.

Failure-only artifacts:

- SEC1 Playwright traces
- S1 Playwright traces

Initial retention: 14 days.

Do not upload node_modules, environment files, database dumps, container filesystems, or broad workspace archives.

## V1 gate

Name: `V1 gate`

Needs:

- Candidate
- Baseline
- Dependency audit
- Security
- PostgreSQL integration (SEC1/A1)
- PostgreSQL integration (S1)
- Browser security

Run with `if: always()`.

Fail unless:

- every required result is `success`
- no required job is skipped
- every verification job reports the same SHA
- every reported SHA equals `github.sha`

Summary records:

- candidate SHA
- run ID
- run attempt
- workflow ref
- runner image version
- relevant tool versions
- each required job/result

Timeout: 5 minutes.

## Failure and retry policy

| Event | Rule |
| --- | --- |
| runner/platform cancellation | infrastructure; rerun failed job up to two attempts |
| clear npm/apt/Playwright/crates/Docker network failure | infrastructure; rerun failed job up to two attempts |
| PostgreSQL service health failure | one infra rerun; recurrence requires investigation |
| Chromium crash/OOM without assertion failure | one infra rerun; recurrence requires investigation |
| assertion, lint, format, scan, migration, invariant, or security failure | deterministic; do not rerun to green; fix and preserve regression |
| assertion-style failure passes only after rerun | flake is a defect; investigate and fix |
| timeout | inspect duration and change timeout only in a new candidate |
| npm/Cargo advisory | dependency change or explicit owner risk acceptance; rerun alone is not a fix |

Any repository edit creates a new candidate and requires the complete V1 set again.

## Evidence

Create after execution:

```text
docs/testing/V1_HOSTED_VERIFICATION_EVIDENCE.md
```

Record:

- candidate SHA
- run ID
- attempt numbers
- required job conclusions
- runner/tool versions
- PostgreSQL migration counts
- Chromium results
- advisory results
- defects and fix/regression refs
- explicit scope/non-scope

Optional artifacts:

- sanitized npm audit JSON
- sanitized Cargo advisory output
- failure-only Playwright traces

Never upload:

- node_modules
- .env files
- DB dumps
- container filesystems
- raw password corpus
- tokens
- broad environment dumps

## Explicit scope

Hosted V1 proves:

- normal repository baseline
- npm and Rust advisory gates
- focused SEC1/S1 security/static gates
- SEC1/A1 PostgreSQL integration
- S1 PostgreSQL integration plus plaintext assertion
- SEC1 Chromium production-serving security path
- S1 Chromium browser cryptographic harness

V1 does not re-execute every historical integration or browser/device matrix.

Not V1-required hosted reruns:

- P1, P2, P3
- M1, R1
- M2 PostgreSQL/Playwright
- M3 PostgreSQL/MinIO/Playwright
- C1/C2 PostgreSQL/Playwright
- UX1 through UX8 and UX integration Playwright suites
- full Redmi matrices

Those retain their historical closure evidence unless a V1 or R2 change crosses their boundary.

## Android boundary

No default Redmi rerun.

Require a focused physical rerun only if a V1-discovered fix changes Android/PWA/device-specific behavior that hosted tests cannot adequately prove.

## Implementation sequence

### V1-00

Reconcile documentation to this approved plan.

Validation:

```text
npm run health:repo
```

Commit:

```text
docs: revise V1 hosted verification plan [skip ci]
```

### V1-01

Create local composite setup and extend repository-health pin scanning to `.github/actions`.

Validate repository health, lint, format, and a regression proving an unpinned external action in a local composite is rejected.

Commit:

```text
ci: add pinned workspace setup action [skip ci]
```

### V1-02

Create release workflow skeleton with Candidate, Baseline, Dependency audit, V1 gate, and a temporary feature-branch push trigger.

Run hosted shakedown.

The intentional shakedown trigger commit omits `[skip ci]`.

### V1-03

Add Security and run hosted shakedown.

### V1-04

Add isolated SEC1/A1 and S1 PostgreSQL jobs and run hosted shakedown.

### V1-05

Add Rust advisory/toolchain setup and Browser security. Measure cold WASM build and recalibrate timeouts.

### V1-06

DONE.

Normal CI concurrency, release triggers, pins, timeouts, service-image digest, and failure artifacts were finalized. The temporary feature-branch trigger was removed before merge.

Hosted shakedowns:

- run `36800865766` at `c864c97ef5bc93cda073d03e597c2a4e1cb4bd49`: PASS after fixing the action-pin scanner regression
- run `36801177675` at `81e0143648a2949efa675a21d2fded83ff110391`: PASS after pinning the PostgreSQL service image digest

The original planning text asked for two green runs on one unchanged SHA. Execution instead used successive control-plane candidates because the service-image digest was deliberately hardened between shakedowns. The finalized digest-pinned state then passed again on `main` at `d28668b5`, providing a third complete green execution before closure.

### V1-07

DONE.

Final V1 Release Verification run `36801613394` executed on `main` at exact candidate `d28668b5a7d021bc12b7a3dccbd69193074af9d3`.

`V1 gate`: PASS.

Normal Baseline CI run `36801613306` independently passed on the same exact SHA.

### V1-08

DONE.

Durable evidence is committed in `docs/testing/V1_HOSTED_VERIFICATION_EVIDENCE.md`, and repository status documentation is reconciled to V1 DONE.

## Closure result

The completion contract above is satisfied by final executable candidate `d28668b5a7d021bc12b7a3dccbd69193074af9d3`.

- V1 Release Verification run `36801613394`: PASS
- Baseline CI run `36801613306`: PASS
- final migration counts: 21 for SEC1/A1 and 21 for S1
- S1 plaintext assertion: PASS
- SEC1 Chromium: 1/1 PASS
- S1 Chromium/OpenMLS: 4/4 PASS
- production scans: PASS
- npm audit: 0 vulnerabilities
- Cargo audit: no vulnerability failure; one accepted maintenance warning `RUSTSEC-2026-0173`
- V1 gate: PASS

## Completion contract

V1 is DONE only when:

- normal CI and release verification are separate
- release workflow and composite setup are merged to main
- local composite external dependencies are covered by SHA-pin policy
- Candidate succeeds
- Baseline succeeds
- Dependency audit succeeds for npm and Rust/Cargo, or an explicit owner risk acceptance is recorded
- Security succeeds
- SEC1/A1 PostgreSQL succeeds from an empty DB
- S1 PostgreSQL succeeds from a separate empty DB
- S1 plaintext assertion succeeds
- Browser security succeeds
- both production scans succeed on the browser/WASM-bearing output
- V1 gate succeeds
- every required job reports the exact same candidate SHA
- workflow permissions, pins, triggers, concurrency, and timeouts are reviewed
- deterministic failures are fixed with regression evidence and the full set is rerun on the new candidate
- durable evidence records the final scope and non-scope

All V1 completion-contract conditions are satisfied. R2 Public Readiness is active.

Post-V1 note: transactional authentication-email provider integration, including the Brevo adapter on `feat/r2-brevo-auth-email`, is R2 production-provider work. It does not alter or reopen the V1 hosted-verification closure.
