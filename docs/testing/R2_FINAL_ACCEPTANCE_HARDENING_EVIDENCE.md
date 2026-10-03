# R2 Final Acceptance Hardening Evidence

Status: HOSTED SHAKEDOWN IN PROGRESS

Base authoritative main:

`44fe73e7dbed79ebf985f66f6c1237536014121f`

Final-acceptance preparation source before this trigger:

`d369826c7c058a6fd5e7c2f8fc6ee09492019ffc`

This shakedown adds executable evidence for repository-owned Milestone 21 acceptance depth:

- synthetic support report create, operator list, resolve, and account-deletion cleanup
- PostgreSQL backup of pre-erasure state
- separately exported erasure journal
- restore into an exact-confirmed isolated database
- account and partnership erasure replay
- normal deletion-worker drain after restore
- verification that deleted account privacy/support state does not resurrect
- verification that deleted partnership access does not resurrect
- full-history R2 E2EE source-boundary diff guard
- retained S1 PostgreSQL/plaintext and OpenMLS Chromium gates
- all existing R2 baseline, secret, dependency, browser, performance, and container gates

No pass is claimed until the GitHub-hosted run completes on the trigger commit.


## Shakedown 1

Run: `37116208379`

Candidate: `ecbf481f10737b5c45e4e491a3582b0c2fa959b1`

Verified before the rerun:

- repository baseline: PASS
- full-history secret scan: PASS
- `R2_E2EE_DIFF_REVIEW_PASS` with 127 changed files and zero protected cryptographic path changes
- dependency audit: PASS
- synthetic support workflow drill: PASS

The PostgreSQL job then failed before the restore drill could execute because the standalone drill imported `@shawtie/worker`, whose workspace package intentionally has no root runtime export. The workflow had already built the worker successfully. The drill now imports the actual built `apps/worker/dist/index.js` export surface.

No restore safety assertion was weakened.
