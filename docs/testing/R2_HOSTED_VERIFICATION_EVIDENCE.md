# R2 Hosted Verification Evidence

Status: AUTOMATED HOSTED VERIFICATION PASS ON MAIN

Milestone: 21 R2 Public Readiness

Automated evidence anchor: `03bf9bfd1d137ec6cae42a66a450a846aad5e397`

Final hosted run: `37122211679`

Evidence level: exact-main closure

Final gate:

```text
R2_AUTOMATED_GATE_PASS sha=03bf9bfd1d137ec6cae42a66a450a846aad5e397 migrations=24
```

## Final exact-main result

Every required hosted job passed on the same exact candidate SHA:

- R2 candidate: PASS
- R2 baseline: PASS
- R2 full history secret scan: PASS
- R2 dependency audit: PASS
- R2 PostgreSQL and retained S1: PASS
- R2 browser security and performance: PASS
- R2 production containers: PASS
- R2 automated gate: PASS

The PostgreSQL job applied migrations 0001 through 0024 from zero and retained the S1 PostgreSQL/plaintext verification boundary.

The browser job passed:

- R2 static security/accessibility/control-plane/worker regressions
- R2 web artifact performance budget
- real Chromium release-A to release-B service-worker upgrade and offline acceptance
- retained SEC1 browser security
- retained S1 OpenMLS browser verification
- production scans

The container job built the production API, worker, and web runtime images.

The full-history secret-scan job used a non-shallow checkout.

The dependency job passed npm high-severity audit and the pinned Rust advisory audit. The reviewed maintenance-only `RUSTSEC-2026-0173` warning remains governed by `docs/security/R2_RUST_DEPENDENCY_REVIEW.md`; it did not become a vulnerability failure.

## Shakedown history

### Run 1

Candidate: `782d3c0c0ecfa3cc6894827b99b4a9e9a4e269e4`

Run: `37079449060`

Found and corrected:

- migration files incorrectly contained transaction control owned by the migration runner
- secret-scan history-depth variable was scoped incorrectly
- one service-worker static assertion was stale

Dependency audit and production-container builds already passed.

### Run 2

Candidate: `7cddd477bd074de3c52e630a1f88e0af3d4e30b0`

Run: `37081972759`

Found and corrected:

- R2 Prettier drift
- unsupported TypeScript constructor parameter property in the new SupportService under Node 22 strip-only loading
- stale accessibility copy assertion
- incorrect worker-source relative path in a static R2 test

The full-history secret scan, dependency audit, production containers, and all 24 migrations passed.

### Run 3

Candidate: `67a00151a8b37189e2bbd98906f4b095ec48ced8`

Run: `37082393985`

Found and corrected:

- Brevo timeout fake transport allowed Node's event loop to end before the unref timeout signal fired
- R2 Playwright command had not prepared workspace package artifacts before starting the Vite dev server

PostgreSQL/S1, secret scan, dependency audit, production containers, formatting, static R2 tests, and the web artifact budget passed.

### Run 4

Candidate: `e5eb92064464b40a942bacc00c3e54874c5e9165`

Run: `37082859480`

Result: PASS across the complete hosted matrix.

After that run started, a release-operations audit added fail-closed PostgreSQL restore-target scheme validation plus a control-plane regression, so one final exact-state run was required.

### Run 5

Candidate: `1efdd5804201ee8174275f663ab1a910cb2c6d48`

Run: `37083243469`

Started: 2026-10-03T00:43:21Z

Completed: 2026-10-03T00:48:17Z

Result: FINAL FEATURE-BRANCH AUTOMATED PASS.

## Pull request integration verification

Aggregate implementation pull request: #2

A final non-skip evidence commit triggered the normal PR Baseline CI and the R2 hosted workflow on the exact aggregate PR head before merge to `main`.

Result: PASS.

- normal Baseline CI run `37108154293`
- R2 Public Readiness Verification run `37108152002`

## Main integration and exact-main verification

Aggregate R2 implementation PR #2 was merged to `main` at `8a73b62194680e226cb372f7a5cee59eabb6416e`.

Pull-request integration verification on head `b692d04eb85bc4ad9f40b13133a7046ec6743d1c` passed:

- normal Baseline CI run `37108154293`
- R2 Public Readiness Verification run `37108152002`

After merge, the R2 release workflow was enabled on `main`. A SEC1-scoped formatting drift found by the legacy V1 workflow was corrected without production behavior changes.

Exact-main R2 closure candidate:

`2ca1a4ddb13e2bf7195efede5dc4b3f3b616524d`

Exact-main R2 run:

`37108925171`

Result: PASS.

Every R2 job passed on that exact main SHA:

- R2 candidate
- R2 baseline
- R2 full history secret scan
- R2 dependency audit
- R2 PostgreSQL and retained S1
- R2 browser security and performance
- R2 production containers
- R2 automated gate

The final gate emitted `R2_AUTOMATED_GATE_PASS` with migration count 24.

Normal Baseline CI on the same exact main candidate also passed in run `37108925156`.

## Final closure-control candidate verification

After the original exact-main R2 pass, a release-control audit found two closure-sequencing defects: the manual-evidence ledger required a committed file to contain its own commit SHA, and signed provenance was required before the runbook allowed creation of the signed tag.

The control plane was repaired so the ledger binds to an executable candidate ancestor, later evidence commits are limited to documentation, pre-provenance acceptance runs before tag creation, and signed provenance is verified by a separate final release gate.

Final executable candidate:

`03bf9bfd1d137ec6cae42a66a450a846aad5e397`

Final R2 run:

`37122211679`

Companion verification:

- Baseline CI run `37122211697`: PASS
- V1 Release Verification run `37122211730`: PASS
- R2 Public Readiness Verification run `37122211679`: PASS
- R2 automated gate: PASS
- migration count: 24

The final R2 run passed the repository baseline, full-history secret scan, npm/Rust dependency audit, all migrations with retained S1 PostgreSQL/plaintext verification, browser security/performance including retained S1 OpenMLS verification, production scans, production-container builds, and the exact-SHA aggregate gate.

The final E2EE release review also closed on this candidate. See `docs/testing/R2_E2EE_RELEASE_REVIEW_EVIDENCE.md`.

## Closure boundary

This evidence closes the repository-owned hosted R2 automated gate only.

R2 itself remains IN PROGRESS until the candidate-bound live/manual evidence ledger is complete. The following are not claimed by this hosted run:

- real Brevo sender/domain/DNS acceptance
- real authentication and serious-event provider delivery
- real production Web Push
- actual production provider topology/deployment
- applied GitHub `main` protection
- public HTTPS origin verification
- backup/restore deletion drill
- external monitoring and received alert
- owner/legal Privacy, Terms, and license review
- representative manual accessibility
- constrained-network and mid-range device performance
- final physical Android acceptance
- voice/video privacy acceptance
- staged rollback rehearsal
- signed release provenance

Those gates remain explicit in `docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json`. The ledger is bound to the exact executable candidate while allowing later evidence-only documentation commits; release-impacting drift after the candidate is rejected. Pre-provenance closure waits for every required live/manual gate except signed provenance, which is verified afterward by the dedicated final release gate.
