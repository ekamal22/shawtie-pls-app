# Project State

## Status

Architecture Baseline 1.0 is accepted and frozen.

Foundation implementation and the first two parallel product-substrate milestones are locally complete. F0, F1, F2, A1, P1, P2, P3, M1 Messaging Core, and R1 Relationship Space are DONE with executed evidence. M1 runtime closure is anchored at `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288` with source head `b29b095`; R1 source head is `9bc9ba4`; source integration is anchored at `01fa182`; exhaustive combined technical validation is anchored at `5db7a94183bca153d142389d7188e3887653a9ec`. On that baseline, migrations 0001 through 0014 apply from zero with `reserved=0` and database invariants green; `test:m1:local` passes 64/64; `test:r1:local` passes 69/69; the final full health run passes with Domain 60/60, Contracts 29/29, API unit/security 44/44, and Worker 4/4; `npm audit --audit-level=high` reports 0 vulnerabilities; and git cleanliness plus local/remote SHA parity pass. The documentation-closed M1/R1 integration is merged to `main @ d7d95a650a1c0878f210d7da3a73d0c4ac9303d3`. Hosted GitHub Actions verification is tracked separately under V1.

M2 Realtime and Offline Reliability is DONE on `feat/m2-realtime-offline`. Automated/local closure passed at `4bbffdfbcd70bd4160e50c52bb14048cf3339dc0`: migrations 0001 through 0014 apply from zero with `reserved=0`, database invariants pass, the PostgreSQL/API/worker matrix passes 100/100 with `M2_LOCAL_POSTGRES_PASS`, real Chromium passes 7/7 with `M2_LOCAL_BROWSER_PASS`, full health passes with Domain 60/60, Contracts 36/36, API unit/security 49/49, and Worker 9/9, the high-severity audit reports 0 vulnerabilities, and `M2_AUTOMATED_CLOSURE_PASS` is recorded. All 14 mandatory physical Android acceptance scenarios have since executed and passed on a physical Xiaomi Redmi Note 9S (Android 12), recorded in `docs/testing/M2_ANDROID_ACCEPTANCE_EVIDENCE.md`, final physical acceptance SHA `b83102f` on `feat/m2-realtime-offline`. That physical run found and fixed seven real defects in the M2 realtime/offline implementation not caught by the automated/local closure, each with a focused regression test; see the evidence document and the branch's commit history. M2 is merged to `main` at fast-forward anchor `b6183158dcc916589cef415b42fa9e9d2b8cc2fd`.

M3 Media and Voice Messages architecture/design is second-pass hardened and is complete on `feat/m3-media-voice` (final physical acceptance code SHA `ee59850`; source completed at `afc73bafec43bb7f8c0a7af3dca133e1e6045b3f`), created from merged-M2 `main @ 54b8659a101dcaeb6ff1e0b7caee76921c5b9919`. Implemented source includes real migrations 0015/0016, media contracts/domain/repository, private S3-compatible object storage, short-lived upload/download grants, server-side feature controls and rate limits, M1 attachments/media-only/voice-message binding, R1 attachments/Voice Letters, durable upload/delete/dissolution cleanup, encrypted account/partnership/feature-scoped browser drafts, worker-backed image re-encoding, voice preview/send, whole-object retry, browser rendering, and the full PostgreSQL/MinIO/Chromium/Android closure harness. Automated closure (`npm run test:m3:closure`) passed at `305891f` before device work, and every step passed again after the physical fixes (migrations 0001 through 0016 with `reserved=0`, database invariants, PostgreSQL/API/worker, MinIO, real Chromium, full health, zero-vulnerability high-severity audit, `git diff --check`). All 20 mandatory physical Android scenarios passed on a Xiaomi Redmi Note 9S (Android 12, Chrome 153.0.8010.52), final physical acceptance code SHA `ee59850`, recorded in `docs/testing/M3_ANDROID_ACCEPTANCE_EVIDENCE.md`. The run found and fixed three real defects (stale upload draft state after a failed upload, microphone capture continuing while the page was hidden, and a 500 instead of 503 MEDIA_UNAVAILABLE when the object store fails during completion), each with a regression test. M3 is DONE and fast-forward merged to `main` at `1d3535f1c4d2d16e66c3bfa4c9c8cef42a95822a`. Canonical design: `docs/architecture/M3_MEDIA_VOICE_DESIGN.md`. Canonical API/storage contract: `docs/api/M3_MEDIA_API.md`. Physical Android closure procedure: `docs/testing/M3_ANDROID_ACCEPTANCE.md`.

## Product definition

The product rules are defined in:

`docs/product/PRD.md`

The partnership lifecycle, breakup recovery rules, account deletion rules, messaging behavior, calls, relationship-space requirements, cooldowns, profile rules, and stable-release E2EE requirement are documented.

## Architecture status

Accepted architecture decisions include:

- modular monolith
- separate durable worker
- PostgreSQL source of truth
- database-enforced partnership occupancy
- transactional outbox
- durable scheduled actions
- centralized capability engine
- append-only lifecycle event ledger for sensitive transitions
- generation tokens for scheduled lifecycle jobs
- deletion manifest workflow
- explicit device model
- account recovery separated from cryptographic recovery
- per-partnership cryptographic context with crypto epochs
- strict PWA browser hardening
- WebSockets for realtime synchronization
- IndexedDB partnership isolation
- WebRTC voice and video
- relay-first TURN privacy
- short-lived TURN credentials
- no Redis in the initial architecture
- reviewed E2EE before stable release
- formal threat model
- repository-wide data classification and handling matrix
- architecture freeze and change-control governance
- architecture change classification and ADR workflow
- baseline CI workflow configuration
- local repository-health scanner
- CODEOWNERS ownership metadata
- public security-reporting policy
- initial PostgreSQL schema migrations
- migration checksum ledger and runner
- static migration-plan validation
- database invariant test suite
- deterministic account-lock SQL pattern
- scheduled-action `FOR UPDATE SKIP LOCKED` claim pattern

## Implementation state

Repository foundation implemented and locally validated:

- npm workspace layout for `apps/*` and `packages/*`
- strict shared TypeScript configuration and package path aliases
- executable scaffolds for `apps/web`, `apps/api`, and `apps/worker`
- package scaffolds for contracts, crypto, database, UI, and testkit boundaries
- ESLint and Prettier configuration with cross-platform line-ending handling
- workspace dependency-direction and circular-dependency scanner
- Zod-based runtime boundary-validation convention with two passing contract tests
- root build, typecheck, lint, formatting, dependency-check, test, and health commands
- committed `package-lock.json`
- local dependency installation with 0 reported npm audit vulnerabilities
- full `npm run health` pass covering repository health, migration-plan validation, all workspace typechecks, all workspace builds, lint, formatting, dependency/cycle checks, 27 domain tests, and 2 contract tests

The full local health run passed on 2026-09-20. The canonical clean-clone bootstrap command `npm ci` was then executed successfully from the committed lockfile, installed 180 packages, reported 0 vulnerabilities, and was followed by another complete passing `npm run health` run. Hosted GitHub Actions validation is tracked separately under V1 and is not a prerequisite for further implementation.

Implemented and locally validated:

- pure partnership domain types
- trusted-time calendar helpers
- breakup initiation
- one-hour initiator cancellation boundary
- irreversible restore intent
- one-time day-ten extension
- mutual restoration
- generation-guarded breakup finalization
- three-calendar-month breakup cooldown
- account-deletion recovery overlay
- account recovery without resetting an existing breakup
- breakup deadline precedence over a later deletion deadline
- one-calendar-month cooldown after permanent partner-account deletion
- centralized capability evaluation
- pre-breakup message mutation restrictions
- breakup-period nickname and email capabilities
- account-deletion view-only capability behavior
- former-partner blocking capability
- partnership cooldown capability
- clean PostgreSQL migration from zero across all six migrations
- migration rerun idempotency and checksum-drift rejection
- database invariant SQL against PostgreSQL 16
- critical constraint, index, foreign-key, and trigger creation
- occupied partnership-slot concurrency protection
- scheduled-action `FOR UPDATE SKIP LOCKED` claim concurrency
- deterministic two-account lock ordering

This earlier partnership-domain validation stage contained 38 tests and passed locally. Current suite totals are recorded in the epic closure evidence below.

The threat model and data-classification baseline are complete and remain the active security foundation for implementation.

Architecture governance is complete. Structural changes now require the evidence-based process in `docs/architecture/ARCHITECTURE_GOVERNANCE.md`.

Roadmap epics and objective acceptance gates are now defined in `docs/ROADMAP_EPICS.md`.

Current epic status:

- F0 Governance and Security Baseline: DONE
- F1 Repository Foundation and Executable Guardrails: DONE based on committed lockfile bootstrap, full local health validation, dependency and circular checks, runtime-contract tests, and repository guardrails
- V1 Hosted CI Verification: BLOCKED while GitHub Actions capacity is unavailable; this is a separate non-blocking verification track and does not prevent F2 or feature development
- F2 Persistence and Worker Foundation: DONE. The database runtime, migration 0006, fencing-aware durable repositories, bounded worker consumers, transactional outbox runtime, lifecycle-event repository, deletion runtime, Docker-backed disposable PostgreSQL harness, and F2 integration matrix are implemented and locally verified. The F2 PostgreSQL suite passes 17/17 after applying all six migrations from zero, and the final full `npm run health` regression passes from the committed lockfile
- P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns: DONE on `feat/p3-partnership-lifecycle`. All 22 acceptance gates are closed. The lifecycle domain/contracts suite passes 28/28, P3 security passes 6/6, all ten migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker matrix passes 39/39 with `P3_LOCAL_POSTGRES_PASS`. Executed evidence covers exact cancellation/restoration boundaries, generation fencing, canonical dissolution, account-deletion precedence and recovery, exact cooldowns, synchronous authorization revocation, deletion manifests, former-partner blocking and privacy, serious notices, race persistence, and A1/P1/P2 regressions. Full repository health passes with Domain 48/48, Contracts 17/17, API unit/security 22/22, Worker 4/4, and all static/build checks green. `npm audit --audit-level=high` reports 0 vulnerabilities.
- X1 Post-stable Maturity: PLANNED after the first stable release and focused on operational evidence, cost measurement, and stabilization
- X2 Deferred Heavy Features: DEFERRED and optional; consensual call recording is moved here and requires post-stable demand, cost, privacy, legal, deletion, retention, and E2EE evidence before implementation
- A1 Accounts and Devices: DONE. All 20 acceptance gates are closed. The expanded disposable PostgreSQL suite passes 27/27 with all seven migrations applied from zero and database invariants green; `npm run test:a1:security` passes 16/16; the full `npm run health` regression passes with Domain 32/32, Contracts 4/4, API unit/security 8/8, and Worker 4/4; and `npm audit --audit-level=high` reports 0 vulnerabilities. The final acceptance run includes challenge expiry/exhaustion/resend/rate-limit coverage, ownership and registration races, logout and revoked-cookie rejection, absolute/idle session expiry and session-generation fencing, recent reauthentication, username API rules, device list/rename/revocation/current-device behavior, exact account-recovery deadline behavior, browser-security negative paths, raw-code/outbox exclusion, and raw device-handle storage exclusion. The final test-harness correction is commit `4019db2`; no production change was required for that failure.
- P1 Discovery and Partner Requests: DONE. All 14 acceptance gates are closed. Migration 0008 applies as part of an eight-migration clean run with database invariants green; `npm run test:p1:local` passes the disposable PostgreSQL/API/worker matrix 16/16 with `P1_LOCAL_POSTGRES_PASS`; the final full `npm run health` regression passes with Domain 38/38, Contracts 8/8, API unit/security 11/11, and Worker 4/4; Prettier, ESLint, dependency checks, typecheck, and production builds are green; and `npm audit --audit-level=high` reports 0 vulnerabilities.
- P2 Partnership Formation and Relationship Date: DONE. All 11 acceptance gates are closed. The P2 domain/contracts suite passes 14/14, the P2 security suite passes 5/5, all nine migrations apply from zero with database invariants green, and the disposable PostgreSQL/API/worker matrix passes 27/27 with `P2_LOCAL_POSTGRES_PASS`. The matrix proves explicit and reciprocal formation, accepted-request replay linkage, deterministic locking, incompatible-request invalidation, expiry-action handling, one-partner occupancy races, relationship-date version and generation separation, other-partner notification isolation, notification snapshot pagination, and P1 behavior in real `paired` mode. The standalone historical `test:p1:local` harness remains request-only. Full repository health and `npm audit --audit-level=high` are green. Migration 0008 remains byte-for-byte unchanged at SHA-256 `94e2d22ceff3b73fc990fc07810cabedea097d7440a571c54c00ec185bebd18e`.
- M1 Messaging Core: DONE at 18/18 acceptance gates. Runtime closure is anchored at `aa40a2c`; source head `b29b095` is integrated and exhaustively validated on `integration/m1-r1 @ 5db7a94`. M1 owns verified migrations 0011 and 0012.
- R1 Relationship Space: DONE. Source head `9bc9ba4` is integrated and exhaustively validated on `integration/m1-r1 @ 5db7a94`. R1 owns migrations 0013 and 0014. Canonical 0001 through 0014 migrations run without reservations, `test:r1:local` passes 69/69 with `R1_LOCAL_POSTGRES_PASS`, the real same-partnership M1 message-reference seam is positively verified without copying message plaintext, and full repository health plus audit are green.
- M2 Realtime and Offline Reliability: DONE on `feat/m2-realtime-offline`. The canonical automated/local closure passed at `4bbffdfbcd70bd4160e50c52bb14048cf3339dc0` with PostgreSQL/API/worker 100/100, real Chromium 7/7, full health, a zero-vulnerability high-severity audit, and git hygiene green. All 14 mandatory physical Android acceptance scenarios subsequently passed on a physical Xiaomi Redmi Note 9S, final physical acceptance SHA `b83102f`, recorded in `docs/testing/M2_ANDROID_ACCEPTANCE_EVIDENCE.md`. That physical run found and fixed seven real M2 defects, each with a focused regression test. M2 is merged to `main` at fast-forward anchor `b6183158dcc916589cef415b42fa9e9d2b8cc2fd`.
- M3 Media and Voice Messages: DONE and fast-forward merged to `main @ 1d3535f1c4d2d16e66c3bfa4c9c8cef42a95822a`; automated closure green and physical Android acceptance 20/20 at final code SHA `ee59850`.
- C1 Voice Calling: DONE and fast-forward merged to `main @ d44c595cd6ea5107d8c33e11b4bb04f39a5c8185`. Final executable baseline `b29aaa1dc62c9e3419c41084cddf4016a4f1bad8`; `npm run test:c1:closure` re-passed there with `C1_AUTOMATED_INTEGRATED_PASS reserved=0` after the stale media-owner fix. Redmi Note 9S acceptance passed 25/25, and rejected-notification cleanup, stale-owner fencing, and audible bidirectional audio are physically confirmed.
- C2 Video Calling: DONE and fast-forward merged to `main @ fed2db7853c52ce87964dd351dd89b9a3879cd2f`. The final executable SHA is `ecbb2e1877fbc8ee7bbeac0c15674a66683e8143`; the first automated/local closure passed earlier at `94e0e9329e083cb3d9bcf4e3b13ad60d4af2e978`. The canonical closure passed real migrations 0001 through 0018 with `reserved=0`, retained M3 and C1 coverage, C2 focused 15/15, C2 PostgreSQL/API 9/9, C1 Chromium 5/5, C2 Chromium 4/4, full health, zero high-severity vulnerabilities, and git hygiene. No PostgreSQL migration is added or reserved. The discovery sweep found two defects, fixed before the final run: `e6576e9` (callee duplicate video transceiver) and `ecbb2e1` (frozen remote last frame). `npm run test:c2:closure` re-passed at `ecbb2e1` with `C2_AUTOMATED_INTEGRATED_PASS reserved=0`, and mandatory physical Redmi Note 9S acceptance is COMPLETE: every scenario (1 through 31 and 33 through 36) PASSED (`C2_ANDROID_ACCEPTANCE_PASS`, `C2_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`). Evidence: `docs/testing/C2_ANDROID_ACCEPTANCE_EVIDENCE.md`.
- UX0 Romantic Experience Specification: DONE. The frozen implementation specification is `docs/design/UX0_IMPLEMENTATION_SPEC.md`, merged to `main` with the mutual presence, last-seen, typing, and read-receipt rules locked (always on, not configurable).
- UX1 Romantic Design Foundation: DONE. Tokens, Midnight and Dawn themes, self-hosted OFL fonts, primitives, and the Home, Talk, Ours shell are implemented over unchanged product semantics; see `docs/design/UX1_FOUNDATION.md`. It is included in the physically accepted romantic integration.
- UX2 through UX7: DONE on `integration/ux-romantic` and physically accepted at executable SHA `ca7cd35` (started at `0ec184d`; not yet merged to `main`). Home, Talk (read receipts gated to the active Talk view, Ribbon, Memory Return), Ours with Then, Now and Next, Us, full-screen call presentation, memory and letter views, and the signature moments are implemented over unchanged product semantics. The visual and accessibility reviews produced repairs (contrast, sealed-item neutrality, touch targets, 200 percent text, dialog focus, outlined destructive entry points). Automated closure at that SHA: full health, node suites, Chromium UX1 to UX7 and cross-surface, retained M2, M3, C1 and C2 suites, and PostgreSQL local matrices for M1, R1, M2, M3, C1 and C2. The accepted scheduled-release visibility rule (a recipient may see the authorized scheduled time, nothing else about hidden items) is recorded in `docs/design/UX0_IMPLEMENTATION_SPEC.md` section 11. Physical Redmi Note 9S acceptance is defined in `docs/testing/UX_ANDROID_ACCEPTANCE.md` and passed 22 of 22 on 2026-09-26, see `docs/testing/UX_ANDROID_ACCEPTANCE_EVIDENCE.md`.
- S1 E2EE and Cryptographic Recovery: PLANNED and still mandatory before stable release. UX copy must not claim E2EE until S1 is implemented and verified.
- UX8 Encrypted UX Integration: PLANNED after S1 and the main romantic UX surfaces, to integrate device enrollment, recovery, revocation, and encryption states into the redesigned experience.
- R2 Public Readiness: PLANNED after pre-release implementation and V1 hosted verification.


## Accepted product-experience direction

The accepted user-facing direction is a private shared world organized around `Home`, `Talk`, and `Ours`. `Ours` presents relationship content through `Then`, `Now`, and `Next` without changing the underlying R1 data model. The visual direction uses the restrained Midnight/Dawn concept, a disciplined relationship accent, editorial memory and letter presentation, mobile-first progressive disclosure, and emotionally warm but operationally clear microcopy. The implementation boundary is strict: UX milestones may radically change presentation and information architecture, but may not silently add durable product state, API behavior, database schema, relationship scoring, surveillance, voice-to-video upgrade semantics, or claims of E2EE. New product concepts require separate product and architecture approval. Canonical direction: `docs/design/ROMANTIC_UX_DIRECTION.md`.

## Repository branch state

Milestone history is preserved with durable branch refs at genuine closure commits:

- `milestone/f0-governance-security` -> `34682c2`
- `milestone/f1-repository-foundation` -> `ddf368d`
- `milestone/f2-persistence-worker` -> `e3ce811`
- `milestone/a1-accounts-devices` -> `a876406`
- `milestone/p1-discovery-requests` -> `69cb238`
- `feat/p2-partnership-formation` -> `04b5229`
- `feat/p3-partnership-lifecycle` -> completed P3 development and closure history
- `feat/m1-messaging-core` -> M1 runtime closure `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`, documentation-reconciled source head `b29b095`
- `feat/r1-relationship-space` -> R1 source head `9bc9ba4`, isolated closure history preserved
- `integration/m1-r1` -> completed historical integration branch, source merge `01fa182`, exhaustive technical validation anchor `5db7a94183bca153d142389d7188e3887653a9ec`, documentation closure `d7d95a6`
- `main` -> current verified mainline at `f53eb00f176f1b75705ea20e006d26f48ffa75fc`, containing completed M1/R1, M2, M3, C1, C2, and the UX0 specification documentation
- `feat/m2-realtime-offline` -> M2 automated/local closure anchor `4bbffdf`; DONE with physical Android acceptance 14/14 at final SHA `b83102f`; fast-forward merged to `main @ b6183158`
- `feat/m3-media-voice` -> completed M3 milestone history; automated closure green, physical Android 20/20 at final code SHA `ee59850`; fast-forward merged to `main @ 1d3535f`
- `feat/c1-voice-calling` -> historical completed branch; C1 merged to `main @ d44c595`; final executable baseline `b29aaa1`; all physical evidence complete
- `feat/c2-video-calling` -> historical completed branch; C2 fast-forward merged to `main @ fed2db7`; final executable SHA `ecbb2e1` with automated closure and mandatory Redmi Note 9S acceptance complete
- `integration/ux-romantic` -> UX0 through UX7 complete and physically accepted; final executable `ca7cd35`, documentation head `c6a00b1` before this reconciliation, 22/22 Redmi Note 9S scenarios PASS

P3 was fast-forward merged to `main` after all 22 acceptance gates closed. The completed `feat/p3-partnership-lifecycle` branch is preserved as milestone history. Dependent work must branch from the latest `main` containing the verified P3 baseline.

The legacy `feat/m1-executable-foundation` branch records the earlier executable-foundation development line. It is not the M1 Messaging Core branch and must not be reused for messaging work.

From P2 onward, each milestone uses its own branch created from the latest verified `main`, closes its acceptance gates and documentation on that branch, then merges to `main` before the next dependent milestone branch is created.

The persistence schema foundation has repeatable disposable PostgreSQL evidence. Earlier schema verification covered migration rerun idempotency, checksum drift, catalog inspection, occupied-slot contention, scheduled-action claim contention, and deterministic account-lock ordering. F2 then applied all six migrations from zero and passed 17/17 runtime integration tests covering transaction policy, retries, PostgreSQL clocks, stale generations, durable payload versions, rollback, outbox atomicity and duplicate safety, claim fencing and reclaim, lifecycle privacy, deletion recovery, queue plans, and graceful worker shutdown. Product-specific API and lifecycle integration remain work for later epics.

Baseline CI is configured in `.github/workflows/ci.yml`, including SHA-pinned external Actions and repository-health checks. GitHub-hosted validation has not yet been executed and is tracked separately under V1. Current repository commits intentionally use `[skip ci]` while hosted Actions execution is being conserved.

## Progress reporting rule

Do not report an epic as complete from a partial layer.

For example, a passing domain state machine does not mean the persisted API and worker lifecycle epic is complete.

Epic completion is governed by the acceptance gates in `docs/ROADMAP_EPICS.md`.

## Next engineering work

UX0 through UX7 are complete and physically accepted on the romantic integration line. The remaining pre-release sequence is:

1. merge the documentation-reconciled `integration/ux-romantic` line to `main`
2. implement S1 E2EE and Cryptographic Recovery with reviewed protocol and physical-device evidence
3. implement UX8 Encrypted UX Integration over verified S1 states
4. complete V1 Hosted CI Verification when Actions capacity is available
5. close R2 Public Readiness with final security, accessibility, browser/device, operational, release, and rollback evidence
6. cut Stable Release only after S1, UX8, V1, and R2 are closed

The accepted UX executable remains `ca7cd35`; documentation-only reconciliation does not change that runtime SHA.

## Deferred heavy feature policy

Call recording is intentionally outside the first stable release and outside the initial post-stable maturity milestone. It is tracked under X2 Deferred Heavy Features and is not a required product milestone.

No implementation should begin until real production evidence shows sufficient user demand and acceptable storage, bandwidth, retention, deletion, backup-expiry, privacy, legal, and E2EE cost.

## Stable release blockers

Stable release remains blocked until:

- reviewed E2EE is implemented
- partnership isolation is verified
- deletion workflows are verified
- account and crypto recovery are safely separated
- browser security baseline is enforced
- voice and video privacy behavior is verified
- security and physical-device acceptance passes


## Documentation freshness

A1, P1, P2, P3, M1, and R1 documentation are reconciled against completed acceptance evidence. M1 remains closed at 18/18 gates with runtime anchor `aa40a2cc74e8efb08bcefdbe3ae40e306cabe288`. R1 is closed by the combined validation baseline `5db7a94183bca153d142389d7188e3887653a9ec`, which proves canonical migrations 0001 through 0014 with no reservations, R1 69/69, M1 64/64, full health, zero audit vulnerabilities, git cleanliness, and local/remote SHA parity. The documentation-closed integration is merged to `main @ d7d95a650a1c0878f210d7da3a73d0c4ac9303d3`.

Current-state claims belong here and in `ROADMAP_EPICS.md`. Product, architecture, security, and ADR documents should not be interpreted as proof that their described runtime behavior is already implemented.
