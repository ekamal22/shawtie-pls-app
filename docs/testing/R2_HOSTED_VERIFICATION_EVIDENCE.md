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
- browser: FAILED on a stale static assertion, not the service-worker implementation

All identified defects were corrected on the R2 branch.

## Second hosted shakedown

Candidate at trigger time: `c7cf1d4fca55ec2a676120c2cb72453f1624164c`

Purpose:

- validate migrations 0001 through 0024 from zero
- validate the corrected full-history secret scan
- run complete repository baseline
- run R2 notification/privacy/support/security regressions
- run real Chromium R2 service-worker upgrade/offline acceptance
- retain SEC1 browser and S1 OpenMLS browser gates
- validate npm/Rust dependency audits
- build production API, worker, and web containers
- enforce one exact candidate SHA at the R2 automated gate

Final result: PENDING

This document must not be changed to PASS until the corresponding GitHub-hosted run completes successfully on this exact candidate.
