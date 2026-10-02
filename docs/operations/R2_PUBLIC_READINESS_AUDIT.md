# R2 Public Readiness Repo-Wide Audit

Status: ACTIVE TRACKING DOCUMENT

Audit baseline:

- repository: `ekamal22/shawtie-pls-app`
- branch audited: `feat/r2-brevo-auth-email`
- audited branch SHA: `a165c9a29d1535943a3f107531bb843c229bdc8a`
- base `main`: `2dc24424e228777765d767f052db57ea8086a6ce`
- audit date: 2026-10-03

This document records concrete repo-wide release-readiness findings. It does not replace the PRD, architecture decisions, threat model, or milestone acceptance gates. It is the canonical R2 issue inventory for concerns that must be closed or explicitly accepted before Stable Release.

## Audit conclusion

This pass found no evidence of a new critical authentication bypass, new cross-partnership authorization leak, new E2EE plaintext regression, or committed production secret.

The remaining release blockers are concentrated in production delivery, notifications, operational infrastructure, release governance, privacy/support readiness, and final acceptance.

Historical milestone closure remains intact. These R2 findings do not reopen SEC1, S1, UX8, or V1.

## Priority 1 release blockers

### R2-01 Serious-event email delivery is not wired to the production provider

The repository already creates durable non-challenge `auth.security_email` deliveries for account and partnership lifecycle events and contains `createSecurityEmailOutboxHandler()`.

The active Brevo branch intentionally registers only `auth.email_challenge`.

Consequences:

- password-reset completion notices are queued but not externally delivered through the default worker provider path
- old-email change notices are queued but not externally delivered
- account-deletion notices are queued but not externally delivered
- serious breakup, restoration, dissolution, and related lifecycle emails are queued but not externally delivered
- the stable-release PRD requirement for minimal serious partnership/account email notifications is not yet satisfied

Required closure:

1. classify which serious-event email templates may leave Shawtie through the provider boundary
2. keep provider content minimal and privacy-safe
3. avoid message, media, relationship-object, or cryptographic plaintext
4. render and deliver approved templates through the provider-neutral port
5. register the durable `auth.security_email` worker handler only after the privacy boundary is approved
6. add provider/failure/idempotency tests
7. perform real provider acceptance for representative account and partnership events

### R2-02 Brevo authentication email needs real provider acceptance

Implementation exists for registration, registration resend, password recovery, account recovery, and email-change verification.

Still open:

- verify the real Brevo sender
- verify a project-owned sending domain
- complete required DNS authentication
- run the opt-in provider smoke send
- execute a real registration email flow
- verify resend supersedes the prior challenge
- run final full repository health on the final branch state
- merge PR #1 only after those gates are green

The focused provider suite and isolated strict TypeScript check are green. That is not a substitute for real-provider or full-repository acceptance.

### R2-03 General Web Push is incomplete

Current production Web Push is strongly implemented for generic call-state reconciliation.

Repo-wide search found no equivalent production message-push or partner-request-push worker path and no implemented setting for the PRD-required notification-preview privacy preference.

Required closure:

- define the generic notification transport architecture
- add partner-request and other required push event families
- add message notification delivery without violating S1 plaintext boundaries
- implement the user setting that hides message preview content
- ensure hidden-preview mode emits only generic privacy-preserving text
- preserve content-minimized provider payloads
- verify revoked devices and dissolved partnerships cannot continue receiving authorized notifications

### R2-04 Service-worker release cache lifecycle is not release-safe

`apps/web/public/sw.js` still uses the fixed cache name `shawtie-shell-v1`.

The current worker deletes caches with older cache names, but assets from successive releases can accumulate inside the same fixed cache and the durable offline `/` shell can remain tied to an older release until it is replaced.

Required closure:

- use release/build cache versioning or deterministic manifest-based pruning
- prevent unbounded obsolete fingerprinted assets
- verify install -> waiting -> activation behavior
- verify an activated new worker cannot leave an incompatible old offline shell as the durable fallback
- verify offline navigation after upgrade
- verify no private API response is cached

### R2-05 Network abuse subjects are inconsistent

Auth routes already normalize network identity with canonical IPv4 /24 and IPv6 /64 prefixes.

Media and realtime still derive network buckets from exact `request.ip`. Calling also uses exact IP and only the active HMAC key version for its current network buckets.

Risks:

- IPv6 privacy-address rotation can fragment intended network budgets
- key rotation can create inconsistent enforcement behavior between modules
- abuse controls do not share one reviewed network-subject convention

Required closure:

- centralize network subject construction through the canonical prefix helper
- apply it to media, realtime, and calling
- define one reviewed key-version policy for abuse buckets
- add IPv4, IPv6, mapped-address, privacy-address-rotation, and key-rotation regressions

### R2-06 Plaintext web-to-API backend transport is policy-only

`BACKEND_PROXY_TARGET` accepts either HTTP or HTTPS bare origins.

Documentation states that plaintext HTTP is allowed only on a trusted private or loopback hop, but the current production adapter does not mechanically enforce that constraint.

Required closure:

- either reject non-private HTTP backend targets in production
- or introduce an explicit reviewed private-network mode that validates the target/topology
- require HTTPS for any untrusted or externally routed backend hop
- verify the deployed topology, not only local configuration

### R2-07 Abuse reporting and support workflow are missing

The PRD requires reporting/support procedures before broad public launch.

Repo-wide search found no implemented abuse-report flow.

Required closure:

- define abusive-username handling
- define impersonation handling
- define partner-request harassment reporting
- define illegal-content reporting while respecting E2EE limitations
- define compromised-account support
- define account/support request routing
- document what Shawtie can and cannot inspect under E2EE
- implement the minimum product/backend workflow needed for launch

### R2-08 Privacy policy, terms, and launch acceptance are incomplete

The PRD requires applicable terms and privacy-policy acceptance before public launch and a documented privacy policy before Stable Release.

The repository currently contains the requirement, but not a complete launch policy package or acceptance flow.

Required closure:

- publish the actual privacy policy
- publish applicable terms
- record policy/version acceptance where required
- align policy language with the actual providers, metadata exposure, E2EE limits, deletion, retention, backups, support, and abuse processes
- verify registration surfaces expose the required policy links/acceptance

### R2-09 Production deployment infrastructure remains placeholder-only

The following surfaces contain only placeholder files:

- `infra/cloudflare`
- `infra/docker`
- `infra/local`
- `scripts/release`

Required closure:

- define the actual production web/API/worker topology
- configure PostgreSQL
- configure private object storage
- configure TURN
- configure Web Push/VAPID
- configure transactional email
- define secret injection
- define migration execution
- define health/readiness checks
- implement reproducible deployment and rollback automation

### R2-10 Backup and restore safety is unproven

The threat model correctly requires backup restore to avoid resurrecting deleted user-facing content.

No production backup/restore implementation or executed restore-after-deletion evidence currently closes that gate.

Required closure:

- define backup scope and retention
- define encryption and access controls
- define deletion propagation through backup retention
- define restore procedure
- prove deleted partnership/account content cannot return to normal user-facing access after restore
- document any unavoidable retained audit/security metadata separately from private content

### R2-11 Operational observability is incomplete

R2 requires monitoring for critical API, worker, outbox, deletion, media, realtime, call, and email failure classes.

Required closure:

- structured metrics that avoid private content
- API availability/error monitoring
- worker liveness and retry monitoring
- failed/outstanding outbox visibility
- deletion-manifest failure monitoring
- media/object-storage failure monitoring
- realtime disconnect/listener health
- call/TURN/push failure monitoring
- auth-email/provider failure monitoring
- actionable alert thresholds and incident runbooks

### R2-12 Release, migration, staged launch, and rollback tooling is incomplete

`scripts/release` is placeholder-only.

Required closure:

- exact release-candidate procedure
- migration ordering and forward-only/rollback policy
- deployment sequencing for web/API/worker
- staged launch procedure
- rollback criteria and tested rollback steps
- public-origin verification
- release evidence tied to one exact source SHA

### R2-13 Main branch protection is absent

GitHub currently reports `main` as unprotected and no repository rulesets are configured.

Required closure:

- prevent force pushes
- prevent branch deletion
- require the appropriate hosted CI status for release-relevant changes
- keep the chosen merge/history policy compatible with the project's documented milestone flow

### R2-14 Dedicated public-repository secret scanning is missing

The current repository-health scanner includes useful forbidden-file checks and a small static pattern set, but it is not a dedicated secret-scanning solution.

Required closure:

- add a dedicated secret scanner suitable for source and history
- include provider credentials such as transactional email secrets
- define false-positive handling
- define credential-rotation response
- make the stable release gate depend on a clean scan

### R2-15 Stable-release provenance is missing

R2 requires immutable release provenance.

Required closure:

- tie Stable Release to one exact source SHA
- create a signed tag or equivalent signed release record
- produce artifact checksums
- record build/runtime versions
- retain release evidence that can be independently verified

### R2-16 Public-repository licensing decision is missing

The repository has no project-level license.

Required closure:

- explicitly choose the intended licensing policy
- add the appropriate repository-level license or record the intentional decision to remain unlicensed
- keep README/project documentation consistent with that choice

## Priority 2 closure work

### R2-17 Final accessibility acceptance is incomplete

There is meaningful accessibility implementation and historical physical acceptance, including contrast and UX coverage, but no comprehensive R2 accessibility gate exists.

Required closure:

- keyboard navigation
- visible focus
- semantic controls
- accessible names
- form validation
- status announcements
- reduced motion
- representative screen-reader checks
- automated browser accessibility coverage where practical
- final physical-device/manual verification

### R2-18 Performance release criteria are not yet defined

The PRD states that representative-screen performance budgets should be defined once representative screens exist.

Required closure:

- define bundle/startup/perceived-load budgets
- test constrained-network behavior
- verify representative Talk/Ours/Home/call screens
- verify mid-range mobile behavior
- define acceptable background activity and cache growth

### R2-19 Rust transitive maintenance warning remains open

V1 recorded `RUSTSEC-2026-0173` for `proc-macro-error2 2.0.1` as an unmaintained dependency warning, not a known vulnerability.

Required closure:

- identify the dependency path
- determine whether the current OpenMLS/Rust stack can upgrade or remove it
- document acceptance only if no safe upgrade path exists and the warning remains non-vulnerability maintenance risk

### R2-20 Obsolete M3 design branch remains

`design/m3-media-voice` still exists and contains stranded pre-S1 design history including non-authoritative ADR-012.

Required closure:

- archive, delete, or explicitly mark the branch historical-only
- make clear that it is not current crypto architecture
- prevent it from being mistaken for mergeable current design authority

### R2-21 Final release-specific acceptance remains

Historical browser, Redmi, calling, E2EE, SEC1, UX8, and V1 evidence remains valid for the source states it verified.

After the remaining R2 implementation and production-topology work is complete, one final candidate still needs:

- full repository health
- dependency and secret scans
- supported-browser E2E
- accessibility closure
- public HTTPS/header verification
- backup/restore deletion test
- operational smoke tests
- physical Android acceptance
- voice/video privacy acceptance
- E2EE release review
- staged launch and rollback acceptance

## Current Brevo branch status

The active Brevo branch is one commit ahead of `main` and PR #1 is open and mergeable at the time of this audit.

The branch must not be treated as merged or release-accepted until its remaining live-provider and final repository gates pass.

## Non-findings

This audit did not identify evidence of the following new defects:

- new authentication bypass
- new cross-partnership authorization leak
- new protected-content plaintext persistence
- raw verification code persisted in PostgreSQL
- raw verification code stored in the challenge outbox payload
- Brevo API key exposed to browser code
- Brevo API key stored in PostgreSQL
- new database migration required solely for the current Brevo challenge-delivery slice

These non-findings do not prove the absence of all defects. They record what the repo-wide source/configuration/documentation audit did and did not discover.

## R2 execution order

Recommended closure order:

~~~text
Brevo auth provider acceptance
        |
        +--> serious-event email delivery
        +--> general Web Push + preview privacy
        |
        +--> service-worker release cache
        +--> canonical network abuse subjects
        +--> backend transport enforcement
        +--> dedicated secret scanning
        |
        +--> abuse/support workflow
        +--> privacy/terms
        |
        +--> production deployment
        +--> observability
        +--> backup/restore
        +--> release/migration/rollback tooling
        |
        +--> branch protection
        +--> license
        +--> signed provenance
        +--> historical branch disposition
        |
        +--> accessibility/performance closure
        |
        +--> final browser/device/calling/E2EE/public-origin acceptance
        |
        v
      R2 DONE
        |
        v
   STABLE RELEASE
~~~

## Documentation authority

The following documents must stay synchronized with this inventory:

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
- `docs/product/PRD.md`

The PRD remains the product-rule authority. This audit is a current-state and release-readiness inventory only.
