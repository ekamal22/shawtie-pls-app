# Release, Migration, Provenance, and Rollback

## Stable-release principle

A release is one exact source SHA. Build, database migration, deployment, acceptance evidence, tag, checksums, and rollback evidence must all identify that same candidate.

## Candidate preparation

Set:

```text
R2_CANDIDATE_SHA=<exact HEAD SHA>
SHAWTIE_RELEASE_ID=<same exact SHA>
```

Then run:

```text
node scripts/release/verify-candidate.mjs
npm run test:r2:closure
```

`test:r2:closure` intentionally fails until the manual acceptance evidence file records every required live gate.

## Database migrations

Shawtie uses forward-only immutable migrations with a checksum ledger.

Release order:

1. create database backup and erasure-journal export
2. verify the backup set exists
3. run the candidate migrations once
4. deploy API and worker that understand the migrated schema
5. deploy the release-versioned web artifact
6. execute health, provider, and public-origin smoke tests

Do not edit an applied migration.

A database rollback is not the default response to an application failure. Prefer application rollback only when the previous application version is compatible with the current forward schema. Otherwise stop rollout and use a reviewed forward fix.

## Release artifacts

Build the web artifact with `SHAWTIE_RELEASE_ID` equal to the candidate SHA.

Put releasable artifacts in one directory and run:

```text
node scripts/release/artifact-checksums.mjs <artifact-directory>
```

This creates `SHA256SUMS`.

## Signed provenance

Create an annotated signed tag only after R2 candidate acceptance:

```text
git tag -s vX.Y.Z <candidate-sha>
git push origin vX.Y.Z
```

Then verify:

```text
R2_RELEASE_TAG=vX.Y.Z
R2_CANDIDATE_SHA=<candidate-sha>
R2_ARTIFACT_DIR=<artifact-directory>
node scripts/release/verify-provenance.mjs
```

The verifier rejects an unsigned/unverifiable tag, a tag pointing at another SHA, or an artifact checksum mismatch.

## Staged rollout

Recommended stages:

1. isolated migration/restore rehearsal
2. deploy candidate with no public traffic
3. operational smoke tests
4. small controlled public traffic
5. full traffic only after error/worker/provider metrics remain acceptable

## Rollback triggers

Examples:

- authentication or authorization regression
- cross-partnership privacy failure
- E2EE incompatibility
- inability to send required auth email
- worker or deletion backlog above the reviewed threshold
- public-origin CSP/TLS/proxy failure
- call/realtime failure that materially breaks the stable product
- migration or schema incompatibility

## Application rollback

1. stop the rollout
2. preserve logs and aggregate operational evidence without private content
3. determine whether the previous version is compatible with the current schema
4. redeploy the previous known-good release only if compatible
5. re-run public health and privacy smoke checks
6. otherwise keep traffic stopped and produce a forward fix

## Repository governance

Before Stable Release, run the repository-governance helper with an administrative GitHub token:

```text
GITHUB_ADMIN_TOKEN=<secret>
GITHUB_REPOSITORY=ekamal22/shawtie-pls-app
node scripts/release/configure-github-governance.mjs
```

It protects `main`, requires the normal `Repository foundation` status check, requires linear history and resolved conversations, and disables force push/deletion.

Set `R2_DELETE_OBSOLETE_M3_BRANCH=1` only after confirming `design/m3-media-voice` is retained elsewhere as historical evidence if desired.

The administrative token must never be committed or pasted into logs.

## Manual evidence

`docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json` starts with all gates false.

Set a gate to passed only after the named procedure actually executes against the final candidate or final production topology and record a concise evidence reference. Do not use planning documents as evidence.

## Rollback rehearsal

Stable Release requires a rehearsal that demonstrates:

- traffic can be stopped
- the previous compatible application can be restored
- migrations are not destructively reversed by habit
- restored backups remain fenced by the erasure journal
- health and critical user journeys recover
- the incident procedure identifies the exact source/deployment versions
