# R2 Hosted Verification Evidence

Status: SHAKEDOWN IN PROGRESS

Milestone: 21 R2 Public Readiness

## First hosted shakedown

Candidate: `782d3c0c0ecfa3cc6894827b99b4a9e9a4e269e4`

Run: `37079449060`

Observed:

- R2 dependency audit: PASS
- R2 production containers: PASS
- baseline: FAILED on R2 migration-owned transaction control
- PostgreSQL/S1: FAILED on the same migration validation defect
- full-history secret scan: FAILED because the history-depth variable was scoped incorrectly
- browser: FAILED on a stale static assertion

All identified defects were corrected.

## Second hosted shakedown

Candidate: `7cddd477bd074de3c52e630a1f88e0af3d4e30b0`

Run: `37081972759`

Observed:

- R2 candidate: PASS
- full-history secret scan: PASS
- dependency audit: PASS
- production containers: PASS
- migrations 0001 through 0024: PASS
- baseline: reached format verification and found 16 R2 Prettier drifts
- PostgreSQL/S1: reached real S1 integration and exposed one unsupported TypeScript constructor parameter-property in the new SupportService
- browser static R2 suite: exposed one stale accessibility copy assertion and one incorrect worker-source relative path

Corrections:

- repository formatter applied with pinned Prettier 3.9.8, commit `83428547942a5456bc5667efe1239e2d40bd99f7`
- SupportService rewritten to explicit properties for Node 22 strip-only TypeScript compatibility
- R2 accessibility assertion reconciled with final notification privacy copy
- R2 worker-source test path corrected

## Third hosted shakedown

Candidate: `67a00151a8b37189e2bbd98906f4b095ec48ced8`

Run: `37082393985`

Observed:

- R2 candidate: PASS
- full-history secret scan: PASS
- dependency audit: PASS
- PostgreSQL plus retained S1: PASS
- production containers: PASS
- migrations 0001 through 0024: PASS
- repository formatting: PASS
- static R2 security/accessibility/control-plane/worker tests: PASS
- R2 web artifact performance budget: PASS
- baseline: FAILED only because the Brevo timeout fake transport allowed Node's event loop to exit before the unref timeout signal fired
- browser job: reached the real R2 Playwright stage and failed because the dev-server command had not prepared the `@shawtie/contracts` workspace artifact

Corrections:

- Brevo timeout fake transport now uses a bounded ref-counted guard while proving the real timeout signal
- R2 browser command now builds contracts, crypto, and S1 WASM before Playwright
- final manual-evidence ledger is now bound to the exact candidate SHA and requires an evidence string for every live/manual gate
- explicit gates were added for hosted automated success, serious-event email, production topology/deployment, and support workflow acceptance
- R2 closure now verifies the exact release candidate, full-history secret scan, performance budget, and candidate-bound manual evidence
- current repository remains Prettier-clean after a final pinned-format check

## Fourth hosted shakedown

Candidate at trigger time: `b24e80f5dd2af8cf8e8094f8ad03eb8fdac3dcc4`

Purpose:

- prove the complete repository baseline including Brevo timeout handling
- prove all 24 migrations and retained S1 PostgreSQL/plaintext boundaries
- prove full-history secret scan and npm/Rust advisory gates
- run R2 browser/accessibility/control-plane/worker regressions
- execute real Chromium service-worker release upgrade/offline acceptance
- retain SEC1 browser and S1 OpenMLS browser verification
- build all production containers
- emit the exact-SHA R2 automated gate

Final result: PENDING

This document must not be changed to PASS until the corresponding GitHub-hosted run completes successfully on this exact candidate.
