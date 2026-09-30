# V1 Hosted CI Verification Plan

## Status

IN_PROGRESS.

Pre-V1 follow-up hardening is DONE on `main @ a1659dc`. Hosted focused validation run `36773261743` is green, and GitHub Actions capacity is available again.

The active V1 task is to expand the hosted workflow so the release gate protects the full baseline plus the focused SEC1/S1 security boundaries, then execute the real V1 run against an exact release-candidate SHA.

## Purpose

V1 proves that the release candidate passes the required repository, security, PostgreSQL, browser, and dependency gates on GitHub-hosted infrastructure.

V1 is not a feature milestone. It is the hosted verification boundary between the completed implementation/security milestones and R2 Public Readiness.

A local pass is not a substitute for V1, and a successful lightweight or probe workflow is not V1 evidence.

## Workflow topology

The V1 workflow should use separate required jobs rather than one oversized monolithic job.

### 1. Baseline

Purpose: prove the committed repository installs and passes the normal repository baseline on GitHub-hosted Ubuntu.

Required commands:

```text
npm ci
npm run ci:baseline
npm audit --audit-level=high
```

Required checks:

- committed lockfile installs without mutation
- repository health passes
- migrations static plan check passes through the baseline
- TypeScript, build, lint, format, dependency-direction, circular-dependency, and normal test suites pass
- high-severity dependency audit is green

### 2. Security

Purpose: protect the SEC1/S1 boundaries that are not fully covered by `npm run health`.

Required commands:

```text
npm ci
npm run test:sec1:headers
npm run sec1:passwords:check
npm run sec1:production:scan
npm run s1:production:scan
npm run sec1:lint
npm run sec1:format:check
npm run test:pre-v1:hardening
```

This job must fail if production web headers/proxy behavior, the common-password corpus, production bundle restrictions, dedicated SEC1 lint/format coverage, or the two closed Pre-V1 hardening regressions break.

### 3. PostgreSQL integration

Purpose: prove the relevant authentication/security and S1 persistence boundaries against disposable PostgreSQL on hosted infrastructure.

Preferred existing commands:

```text
npm ci
npm run test:sec1:postgres
npm run test:s1:postgres
```

The workflow implementation may use one composite wrapper if that reduces duplicate setup, but it must preserve the assertions of both existing commands. It must not replace them with source scans.

Required evidence includes:

- migrations apply cleanly from zero
- database invariants remain green
- SEC1/A1 authentication persistence behavior passes
- S1 PostgreSQL integration passes
- no test assertion is weakened merely to fit hosted execution

### 4. Browser security

Purpose: prove the production browser/security boundaries in real Chromium on hosted infrastructure.

Preferred existing commands:

```text
npm ci
npx playwright install --with-deps chromium
npm run test:sec1:browser:e2e
npm run test:s1:browser:e2e
```

The job must exercise the real browser path used by the existing SEC1/S1 Playwright configurations. It must retain production-bundle/CSP/OpenMLS/service-worker behavior rather than substituting static checks.

## Job dependencies and failure behavior

The workflow may run independent jobs in parallel after checkout/install setup is defined, but V1 is green only when every required V1 job is green.

No single job result is sufficient by itself.

If a job finds a defect:

1. record the failing run and exact candidate SHA
2. fix the defect on a focused branch
3. add or preserve a regression test
4. reconcile any documentation made stale by the fix
5. rerun the affected hosted job
6. rerun the full required V1 job set on the final candidate before declaring V1 DONE

Do not mark V1 DONE from a partial rerun whose other required jobs correspond to an older source SHA.

## Release-candidate SHA rule

The final V1 evidence must identify one exact release-candidate commit.

All required V1 jobs used for closure must correspond to that same source state, or to a workflow-only evidence commit whose checkout is explicitly pinned to that exact candidate SHA.

The final evidence record must include:

- release-candidate SHA
- workflow run ID
- workflow attempt
- each required job name
- each job conclusion
- relevant defect/fix references if the first attempt was not green

## Trigger and workflow security

The V1 workflow must retain:

- SHA-pinned external GitHub Actions
- minimal permissions, normally `contents: read`
- explicit timeouts
- no persisted checkout credentials unless a reviewed job actually needs them
- controlled concurrency where duplicate release-verification runs would waste capacity
- no secrets printed to logs

The real V1 run must not use `[skip ci]`.

Documentation-only reconciliation after a successful V1 run may continue to use `[skip ci]`.

## Android/device boundary

A Redmi Note 9S rerun is not a default V1 requirement.

V1 is a hosted infrastructure verification milestone. A focused physical-device rerun is required only if fixing a V1-discovered defect changes Android/PWA/device-specific behavior that the hosted browser and integration suites cannot adequately prove.

## Completion criteria

V1 is DONE only when:

- the hosted workflow contains all required V1 job surfaces
- the final exact candidate SHA is recorded
- Baseline is green
- Security is green
- PostgreSQL integration is green
- Browser security is green
- dependency audit is green
- workflow permissions, pinned Actions, trigger behavior, concurrency, and timeout behavior are reviewed
- any defects found during V1 are fixed with regression evidence
- the final all-green hosted run is recorded in `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ROADMAP_EPICS.md`, and `docs/testing/CI_AND_REPOSITORY_HEALTH.md`

After V1 closes, the active milestone becomes R2 Public Readiness.
