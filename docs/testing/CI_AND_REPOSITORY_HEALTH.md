# CI and Repository Health

## Status

Baseline CI and repository-health tooling are configured.

The M1 workspace, TypeScript, linting, formatting, runtime-contract, and dependency-direction scaffolding is also configured. Dependency installation has completed locally. Repository health and the static migration-plan check pass. The first expanded local health run exposed deprecated `baseUrl`; the second exposed non-relative `paths` targets after `baseUrl` was removed. The shared config now uses explicit `./` path targets with no `baseUrl`, matching the TypeScript 6 migration guidance. The full local health gate must be rerun.

The first GitHub-hosted execution is still pending.

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
3. run repository-health checks
4. run the static database migration-plan check
5. run the domain test suite
6. run dependency audit when a package lockfile exists

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

The expanded command has now been executed twice with installed workspace dependencies. Repository health and static migration-plan validation passed both times. The first typecheck exposed deprecated `baseUrl`; the second exposed that `paths` targets must be explicitly relative once `baseUrl` is removed. The shared config now uses explicit `./` targets. Typecheck and all later gates remain unverified until the command is rerun.

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

The M1 scaffold now additionally defines strict TypeScript configuration and path aliases, ESLint and Prettier configuration, workspace package boundaries, and `scripts/ci/check-dependencies.mjs`. The dependency checker enforces the accepted workspace dependency directions and rejects circular source or workspace dependencies. Its authored script has passed syntax and scaffold-only static checks, but full-repository dependency-installed execution remains pending.

## Secret handling

The baseline repository scanner detects several high-risk secret patterns and forbidden secret-bearing file types.

It does not claim exhaustive secret detection.

Before public stable release, repository settings or CI should also provide dedicated secret scanning and dependency security tooling.

## Dependency scanning

The baseline workflow runs `npm audit --audit-level=high` only when `package-lock.json` exists.

A package lockfile has now been generated locally by `npm install`, and npm reported 0 vulnerabilities during that install. The lockfile is not yet committed, so repository and CI dependency-audit enforcement is not active yet.

When the workspace and dependency graph are established, the lockfile becomes mandatory and dependency scanning must become a hard gate.

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

Once Actions execution is available again:

1. create or push a commit without a skip marker, or manually dispatch Baseline CI
2. inspect the workflow result
3. fix any repository-health or domain-test failure
4. record the successful run in PROJECT_STATE
5. only then treat the GitHub-hosted baseline gate as verified

## Future gate expansion

Local disposable PostgreSQL validation completed on 2026-09-20 for migration from zero, invariant SQL, migration rerun idempotency, schema catalog inspection, and selected two-session races. This is local evidence only and does not satisfy the still-pending GitHub-hosted gate.

As the repository foundation grows, Baseline CI should add hard steps for:

- package installation from a committed lockfile
- formatting
- linting
- TypeScript typecheck
- build
- circular-dependency checks
- runtime contract tests
- real PostgreSQL migration-from-zero and invariant tests when PostgreSQL CI infrastructure is available

As persistence is implemented, add:

- migration-from-zero test
- PostgreSQL invariant tests
- PostgreSQL race tests
- worker tests
- outbox tests
- deletion-manifest tests

Later epics add:

- API integration
- security regression
- browser E2E
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
