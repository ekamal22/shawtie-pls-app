# V1 Hosted Verification Evidence

## Status

DONE.

V1 Hosted CI Verification closed on 2026-10-01 against one exact executable candidate:

`d28668b5a7d021bc12b7a3dccbd69193074af9d3`

The durable documentation commits after this executable candidate are status-only evidence reconciliation and do not change the verified source state.

## Final hosted runs

### V1 Release Verification

- workflow: `V1 Release Verification`
- run ID: `36801613394`
- run number: `5`
- attempt: `1`
- event: `push`
- branch: `main`
- candidate SHA: `d28668b5a7d021bc12b7a3dccbd69193074af9d3`
- result: `success`
- started: `2026-10-01T01:32:51Z`
- completed: `2026-10-01T01:37:23Z`
- URL: https://github.com/ekamal22/shawtie-pls-app/actions/runs/36801613394

### Normal Baseline CI

- workflow: `Baseline CI`
- run ID: `36801613306`
- run number: `1`
- attempt: `1`
- event: `push`
- branch: `main`
- candidate SHA: `d28668b5a7d021bc12b7a3dccbd69193074af9d3`
- result: `success`
- started: `2026-10-01T01:32:51Z`
- completed: `2026-10-01T01:34:21Z`
- URL: https://github.com/ekamal22/shawtie-pls-app/actions/runs/36801613306

The release workflow and normal CI therefore both passed on the same final source state.

## Final job results

| Required surface | Result |
| --- | --- |
| Candidate | PASS |
| Baseline | PASS |
| Dependency audit | PASS |
| Security | PASS |
| PostgreSQL integration (SEC1/A1) | PASS |
| PostgreSQL integration (S1) | PASS |
| Browser security | PASS |
| V1 gate | PASS |

`V1_GATE_PASS` was emitted by the final gate. Every verification job reported the same checked-out SHA as `github.sha`.

## Hosted environment

Final run evidence recorded:

- runner OS image: `ubuntu-24.04`
- runner image version: `20260920.314.1`
- runner image provisioner version: `20260828.587`
- Node: `v22.18.0`
- npm: `10.9.3`
- Rust: `rustc 1.91.0 (f8297e351 2025-10-28)`
- Cargo: `cargo 1.91.0 (ea2d97820 2025-10-10)`
- `cargo-audit`: `0.22.2`
- `wasm-pack`: `0.15.0`
- PostgreSQL service image digest: `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`

External GitHub Actions are pinned to full commit SHAs. The reusable workspace setup also falls under repository-health pin enforcement.

## Baseline and dependency evidence

The common workspace setup used:

- `npm ci --ignore-scripts`
- exact checkout SHA assertion
- Node and npm version reporting

Final Baseline passed `npm run ci:baseline`.

The final npm audit reported `0 vulnerabilities`.

The Rust audit used `cargo-audit 0.22.2` against `packages/crypto/openmls-wasm/Cargo.lock` and scanned 199 crate dependencies. It reported no security vulnerability failure and one allowed maintenance warning:

- `RUSTSEC-2026-0173`
- crate: `proc-macro-error2 2.0.1`
- classification: unmaintained

V1 accepts this as a non-vulnerability dependency-maintenance warning for closure. It does not weaken the successful vulnerability gate. R2 subsequently completed the transitive dependency review and retained the warning as maintenance-only under `docs/security/R2_RUST_DEPENDENCY_REVIEW.md`; the final R2 executable candidate `03bf9bfd` also passed the hosted npm/Rust dependency audit in run `37122211679`.

## Security evidence

The final Security job passed:

- `npm run test:sec1:headers`
- `npm run sec1:passwords:check`
- `npm run sec1:lint`
- `npm run sec1:format:check`
- `npm run test:pre-v1:hardening`
- `npm run sec1:production:scan`
- `npm run s1:production:scan`

This retains explicit hosted coverage for the closed Pre-V1 local-crypto lifecycle and HTTP request-boundary regressions.

## PostgreSQL evidence

Both PostgreSQL jobs started from an empty public schema.

### SEC1/A1

- empty database assertion: PASS
- `npm run test:sec1:postgres`: PASS
- final migration count: `21`

### S1

- empty database assertion: PASS
- `npm run test:s1:postgres`: PASS
- `npm run s1:plaintext:assert-clean`: PASS
- plaintext result: `S1_PLAINTEXT_INVENTORY_CLEAN`
- final migration count: `21`

The two jobs used separate databases and the same digest-pinned PostgreSQL 16 Alpine image.

## Browser security evidence

The Browser security job passed the pinned Rust/WASM setup and cold OpenMLS build before Chromium verification.

Final browser results:

- SEC1 production-serving Chromium security: `1/1 PASS`
- S1 OpenMLS Chromium cryptographic harness: `4/4 PASS`
- `SEC1_PRODUCTION_SCAN_PASS`
- `S1_PRODUCTION_BUNDLE_SCAN_PASS`

The S1 browser suite covered OpenMLS Add/Welcome/application delivery, authenticated-context substitution rejection, local-vault persistence and purge, and plaintext exclusion from browser durable stores, outboxes, caches, and notifications.

No failure traces were uploaded because the final browser job passed.

## Workflow integrity

V1 implementation added:

- `.github/actions/setup-workspace/action.yml`
- `.github/workflows/release-verification.yml`
- `scripts/ci/v1-db-evidence.mjs`
- `scripts/ci/workflow-policy.mjs`
- `scripts/ci/workflow-policy.test.mjs`

Normal CI remains separate in `.github/workflows/ci.yml`.

Release verification uses:

- read-only contents permission
- exact-SHA checkout assertions
- non-persisted checkout credentials
- explicit job timeouts
- SHA-pinned external Actions
- non-cancelling release concurrency keyed by candidate SHA
- Candidate ref validation
- a final all-required-jobs and same-SHA gate

The final workflow retains `workflow_dispatch` and `workflow_call`. It also retains a narrow `main` push trigger limited to V1/CI control-plane paths so ordinary product-code pushes do not launch the heavy release workflow.

## Shakedown history and defects found

V1 shakedown found one real repository guardrail defect before closure.

The new policy regression initially showed that the action-pin scanner matched `uses:` but could miss normal YAML list syntax written as `- uses:`. That meant a conventional action reference could escape the intended full-SHA enforcement.

The parser was repaired in:

`c864c97ef5bc93cda073d03e597c2a4e1cb4bd49`

A focused regression now proves unpinned external actions in local composite actions are rejected.

Successful pre-main shakedowns:

- run `36800865766`, SHA `c864c97ef5bc93cda073d03e597c2a4e1cb4bd49`: PASS
- run `36801177675`, SHA `81e0143648a2949efa675a21d2fded83ff110391`: PASS after PostgreSQL digest pinning

The final main run then passed at `d28668b5a7d021bc12b7a3dccbd69193074af9d3`.

No application runtime defect was found by V1.

## Explicit scope

V1 proves on GitHub-hosted infrastructure:

- repository baseline
- npm vulnerability audit
- Rust/OpenMLS Cargo advisory audit
- focused SEC1/S1 security and static gates
- SEC1/A1 PostgreSQL integration from zero
- S1 PostgreSQL integration from zero
- S1 plaintext assertion
- SEC1 production-serving Chromium security
- S1 Chromium/OpenMLS cryptographic behavior
- post-browser production bundle scans
- exact candidate SHA consistency

V1 did not rerun every historical closure matrix.

Historical suites not repeated by V1 include:

- P1, P2, P3 full local matrices
- M1 and R1 full PostgreSQL matrices
- M2 full PostgreSQL/Playwright matrix
- M3 full PostgreSQL/MinIO/Playwright matrix
- C1/C2 full PostgreSQL/Playwright matrices
- UX1 through UX8 full historical Playwright matrices
- full physical Redmi Note 9S matrices

Those retain their existing closure evidence.

No new physical Android run was required because V1 changed repository CI, verification helpers, and workflow policy rather than Android/PWA runtime behavior.

## Closure conclusion

V1 Hosted CI Verification is DONE.

The executable closure anchor is:

`d28668b5a7d021bc12b7a3dccbd69193074af9d3`

R2 Public Readiness is the active release milestone. Its repository implementation has since merged to `main @ 8a73b621`, and exact-main hosted automated verification passed at `03bf9bfd`, run `37122211679`; live/manual R2 gates remain open.
