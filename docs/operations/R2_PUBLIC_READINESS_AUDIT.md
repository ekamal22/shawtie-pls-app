# R2 Public Readiness Repo-Wide Audit

Status: ACTIVE TRACKING DOCUMENT

Repository implementation: merged to `main @ 8a73b62194680e226cb372f7a5cee59eabb6416e`

This document is the canonical R2 issue inventory. It distinguishes repository implementation from hosted verification and from live/manual release acceptance. R2 is not DONE until every required acceptance gate has executed against one final candidate.

## Current conclusion

The R2 repository implementation is substantially complete and merged. The mainline now contains the release-specific security, notification, privacy, support, operations, deployment, backup, observability, provenance, accessibility, and performance control plane that the original audit found missing.

R2 hosted automated verification is complete on exact `main` candidate `03bf9bfd1d137ec6cae42a66a450a846aad5e397`. Main run `37122211679` passed Baseline, full-history secret scan, npm/Rust dependency audit, all 24 migrations plus retained S1 PostgreSQL/plaintext verification, browser security/performance, production-container builds, and the exact-SHA automated gate.

Earlier shakedowns found and corrected migration transaction-control, secret-scanner scope, stale-test, formatting, Node TypeScript-loader, Brevo timeout-test, and R2 Playwright workspace-preparation defects. Their evidence is retained in `docs/testing/R2_HOSTED_VERIFICATION_EVIDENCE.md`.

No current source audit evidence identifies a new critical authentication bypass, cross-partnership authorization leak, E2EE plaintext regression, or committed production credential.

## Issue status

### R2-01 Serious-event email delivery

Repository implementation: IMPLEMENTED

- serious account and partnership templates are rendered through the provider-neutral email port
- `auth.security_email` is registered in the default worker when email delivery is configured
- provider payloads contain only the destination and approved minimal security/lifecycle content
- password reset, old-email change, account deletion, breakup start, restoration, dissolution, and partner-account deletion paths are covered
- `breakup_cancelled` remains intentionally in-app only

Still required:

- live Brevo delivery for representative serious-event templates
- final provider/privacy acceptance on the release candidate

### R2-02 Brevo authentication email

Repository implementation: IMPLEMENTED

Still required live evidence:

- project-owned sender/domain verification
- provider DNS authentication
- smoke send
- real registration and resend/supersede
- final-candidate provider acceptance

### R2-03 General Web Push and preview privacy

Repository implementation: IMPLEMENTED

- partner-request and account-notification push use the durable outbox
- new-message push is content-free and derives recipients from current unreleased partnership membership
- final dissolution removes current members, so stale message events cannot derive recipients
- device revocation retains push-subscription revocation
- preview details are account-backed and hidden by default
- protected message plaintext is never sent to the push provider
- production worker startup refuses absent VAPID configuration

Still required:

- real production Web Push acceptance on supported devices

### R2-04 Service-worker release cache lifecycle

Repository implementation: IMPLEMENTED

- the web build injects one release identity
- worker URL and shell cache are release-scoped
- activation prunes prior release shell caches
- persistent notification privacy settings use a separate cache
- private `/api/*` responses remain excluded
- a real Chromium R2 upgrade test covers release A to release B, old-cache pruning, offline navigation, and private-API exclusion

Automated acceptance: COMPLETE on exact `main` candidate `03bf9bfd1d137ec6cae42a66a450a846aad5e397`, including the real Chromium release-A to release-B upgrade/offline gate.

Still required:

- physical mobile update/offline evidence in final acceptance

### R2-05 Network abuse subjects

Repository implementation: IMPLEMENTED

Media, realtime, and calling now use the canonical network prefix helper. Calling uses all configured HMAC key versions for rate-limit continuity.

Automated hosted regression: COMPLETE on exact `main` candidate `03bf9bfd1d137ec6cae42a66a450a846aad5e397`.

Post-launch production abuse-control observation remains X1 work and is not an open R2 source or hosted-automation gate.

### R2-06 Web-to-API backend transport

Repository implementation: IMPLEMENTED

The production web adapter rejects plaintext untrusted backend targets. HTTP requires loopback/private addressing or explicit reviewed private-host mode. Stable Release production-contract validation also rejects unreviewed public plaintext topology.

Still required:

- deployed topology verification
- public-origin acceptance

### R2-07 Abuse reporting and support

Repository implementation: IMPLEMENTED

- authenticated, rate-limited support-report endpoint
- categories for abusive username, impersonation, request harassment, account compromise, suspected illegal use, and other support
- bounded username/account subject reference
- in-app report form
- E2EE limitation and recovery-secret warning
- operator list/resolve tooling
- account deletion removes reports submitted by the deleting user and clears internal target references in other reports
- operating procedure: `docs/operations/SUPPORT_AND_ABUSE.md`

Still required:

- synthetic create/list/resolve/deletion acceptance in the final environment
- owner/legal review for escalation obligations

### R2-08 Privacy, Terms, and acceptance

Repository implementation: IMPLEMENTED

- public Privacy Notice and Terms surfaces
- CSP-compatible external legal stylesheet
- production registration requires the current policy version and explicit Terms/Privacy acknowledgement
- acceptance is carried through registration and stored during account lifetime
- acceptance rows are removed at permanent account deletion to avoid accidental indefinite retention

Still required:

- owner/legal review of the final deployed wording and provider list
- live registration acceptance

### R2-09 Production deployment infrastructure

Repository implementation: IMPLEMENTED AS PROVIDER-NEUTRAL RELEASE CONTRACT

- production API, worker, and web container definitions
- local PostgreSQL/object-storage composition
- edge/DNS behavior contract
- production environment example
- executable per-role production configuration validator
- private object storage is required at production runtime
- runtime email and push configuration fail closed in production

Still required:

- actual provider resources, DNS, TLS, database, object storage, TURN, Brevo, VAPID, secret injection, and deployment execution

### R2-10 Backup and restore safety

Repository implementation: IMPLEMENTED

- PostgreSQL backup command
- separate erasure tombstone journal with SHA-256 sidecar
- account and partnership final deletion write erasure tombstones
- isolated restore fence
- erasure replay before restored traffic may be served
- restored partnership cleanup uses the existing deletion-manifest worker authority
- verification refuses resurrected deleted account access or incomplete partnership deletion

Still required:

- executed synthetic backup/restore/deletion drill against the final production topology
- provider backup encryption/retention review

### R2-11 Operational observability

Repository implementation: IMPLEMENTED FOR APPLICATION-OWNED AGGREGATE STATUS

- metadata-only operational status for outbox, scheduled work, deletion, security email, and support queues
- threshold failures return a failing exit status
- privacy-safe observability rules are documented

Still required:

- external uptime/resource/TURN/provider monitors
- alert routing
- received test-alert evidence

### R2-12 Release, migration, staged launch, and rollback

Repository implementation: IMPLEMENTED

- exact-candidate verification
- forward-only migration procedure
- artifact checksum generation
- public-origin verification
- staged launch/rollback runbook
- pre-provenance closure harness that refuses missing manual evidence and rejects release-impacting drift after the executable candidate
- separate final release gate that verifies signed provenance after candidate acceptance

Still required:

- executed staged deployment and rollback rehearsal

Release-control correction: COMPLETE. The original manual-evidence design required a committed ledger to contain its own commit SHA and required signed provenance before the tag could legally be created. The repaired model binds evidence to an executable candidate ancestor, rejects release-impacting drift after that candidate, runs pre-provenance acceptance first, and verifies the signed tag in a separate final release gate.

### R2-13 Main branch protection

Repository implementation: AUTOMATION PREPARED

`scripts/release/configure-github-governance.mjs` applies release-appropriate `main` protection and can optionally remove the obsolete M3 design branch.

Still required:

- run it with repository administration permission
- verify the resulting protection/rules in GitHub

### R2-14 Dedicated secret scanning

Repository implementation: IMPLEMENTED

- tracked-source scan
- full Git patch-history scan
- dedicated provider/private-key patterns
- explicit shallow/full history reporting
- hosted R2 job requires a full-history checkout

Automated acceptance: COMPLETE on exact `main` candidate `03bf9bfd1d137ec6cae42a66a450a846aad5e397`, run `37122211679`.

### R2-15 Stable-release provenance

Repository implementation: IMPLEMENTED

- exact source candidate verification
- release artifact SHA-256 checksums
- signed-tag verification against the exact source SHA

Still required:

- create and verify the signed release tag after pre-provenance R2 acceptance, record the provenance evidence, and run `npm run release:r2:finalize`

### R2-16 Licensing

Repository implementation: DECISION RECORDED

A repository-level proprietary source-visible `LICENSE` is present.

Still required:

- owner/legal review of the intended licensing terms

### R2-17 Accessibility

Repository implementation: PARTIAL ACCEPTANCE AUTOMATION IMPLEMENTED

Static/accessibility regressions cover focus treatment, reduced motion, semantic naming, registration/legal controls, support controls, and critical private surfaces.

Still required:

- representative screen-reader/manual acceptance
- final physical-device accessibility pass

### R2-18 Performance

Repository implementation: BUDGETS IMPLEMENTED

Production artifact budgets cover total web output, JavaScript, CSS, and WASM.

Automated hosted artifact budget: COMPLETE on exact-main run `37122211679`.

Still required:

- mid-range Android and constrained-network measurements

### R2-19 Rust transitive maintenance warning

Repository review: COMPLETE

The current path is documented as `hax-lib 0.3.7 -> hax-lib-macros 0.3.7 -> proc-macro-error2 2.0.1` through the OpenMLS/libcrux stack.

The warning is maintenance-only, not a vulnerability finding. R2 does not perform an unreviewed cryptographic-stack upgrade merely to remove the warning. Any future dependency-family change requires a fresh E2EE review.

Exact-main hosted `cargo audit`: COMPLETE on run `37122211679` with no vulnerability failure.

### R2-20 Obsolete M3 design branch

Repository disposition: COMPLETE

`docs/architecture/HISTORICAL_BRANCHES.md` marks `design/m3-media-voice` historical-only and explicitly non-authoritative. Deletion remains optional hygiene and requires explicit invocation of the governance helper.

### R2-21 Final release-specific acceptance

Status: OPEN

Hosted automated evidence is complete for full repository health, full-history secret scan, npm/Rust audit, all 24 migrations with retained S1, R2 plus retained browser security/E2EE suites, performance budget, and production-container builds.

Final E2EE release review: COMPLETE for executable candidate `03bf9bfd1d137ec6cae42a66a450a846aad5e397`. Evidence: `docs/testing/R2_E2EE_RELEASE_REVIEW_EVIDENCE.md`.

The remaining executed evidence is live/manual:

- real Brevo provider acceptance
- real production Web Push
- public HTTPS/header verification
- backup/restore deletion drill
- external operational alert receipt
- applied repository protection
- signed provenance
- owner/legal Privacy/Terms/license review
- representative accessibility
- mid-range performance
- physical Android
- voice/video privacy
- staged rollback rehearsal

The source of truth for those live/manual gates is `docs/testing/R2_MANUAL_ACCEPTANCE_EVIDENCE.json`. The ledger binds evidence to the executable candidate SHA while allowing later evidence-only documentation commits. `test:r2:closure` requires all pre-provenance gates. Signed provenance is then verified by `release:r2:finalize` so the tag sequencing is satisfiable.

## Current execution order

~~~text
repository implementation merged to main
        |
        v
exact-main hosted R2 automated verification PASS
        |
        v
configure live providers and production topology
        |
        v
apply repository protection
        |
        v
execute provider/public-origin/restore/alert/device/accessibility/voice-video/rollback acceptance
        |
        v
pre-provenance R2 acceptance PASS
        |
        v
create and verify signed stable-release provenance
        |
        v
R2 final release gate PASS
        |
        v
Stable Release
~~~

## Documentation authority

Keep these synchronized with this inventory:

- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ROADMAP_EPICS.md`
- `docs/EXECUTION_GRAPH.md`
- `docs/testing/CI_AND_REPOSITORY_HEALTH.md`
- `docs/testing/TEST_STRATEGY.md`
- `docs/security/SECURITY_MODEL.md`
- `docs/security/THREAT_MODEL.md`
- `docs/security/DATA_CLASSIFICATION.md`
- `docs/operations/TRANSACTIONAL_EMAIL.md`
- `docs/operations/PRODUCTION_WEB_SERVING.md`
- `docs/operations/BACKUP_AND_RESTORE.md`
- `docs/operations/OBSERVABILITY.md`
- `docs/operations/PRODUCTION_ENVIRONMENT.md`
- `docs/operations/RELEASE_AND_ROLLBACK.md`
- `docs/operations/SUPPORT_AND_ABUSE.md`
- `docs/product/PRD.md`

The PRD remains the product-rule authority. This audit reports current implementation and release evidence only.
