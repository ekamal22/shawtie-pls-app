# UX8 Automated Closure Evidence

Status: UX8 AUTOMATED CLOSURE PASS, PHYSICAL ANDROID 25/25 PENDING.

Date: 2026-09-27.

Branch: `feat/ux8-encrypted-ux-integration`.

Automated executable SHA: `39de742c8ab795137be95ecbaa685131b608e813`.

This SHA is the runtime evidence anchor. The documentation commit created after this run is not a substitute for the executable SHA above.

## Canonical result

`npm run test:ux8:closure` completed successfully at the automated executable SHA and emitted:

```text
UX8_AUTOMATED_CLOSURE_HEAD 39de742c8ab795137be95ecbaa685131b608e813
UX8_AUTOMATED_CLOSURE_PASS
Physical Android acceptance remains a separate required 25-scenario gate.
```

## Executed evidence

- UX8 model, state, race, recovery, content-failure, and static checks: 27/27 passed.
- Real Chromium/OpenMLS recovery and approval flow: 2/2 passed.
- The Chromium flow covered explicit RMS generation, one-time reveal, durable-store and URL inspection, trusted-device approval, a fresh pending browser, wrong-RMS failure, correct-RMS recovery, one enrollment under concurrent React initialization, 200 percent text, and reduced motion.
- Retained S1 local closure passed with migrations 0001 through 0021, `reserved=0`, database invariants, S1 contracts 9/9, S1 browser 9/9, S1 API security 7/7, PostgreSQL integration 4/4, real Chromium/OpenMLS 4/4, plaintext inventory clean, and `S1_LOCAL_AUTOMATED_PASS`.
- Production bundle scan: `S1_PRODUCTION_BUNDLE_SCAN_PASS`.
- Full repository health: `REPOSITORY_HEALTH_PASS`; all workspace typechecks, builds, lint, format-check, dependency checks, and repository test suites passed.
- High-severity dependency audit: 0 vulnerabilities.
- `git diff --check`: passed.
- Branch was clean and local HEAD matched `origin/feat/ux8-encrypted-ux-integration` before the canonical run.
- Every commit from `origin/main` through the automated executable SHA contains `[skip ci]`.
- The closure scan found no newly introduced Unicode em dash.

## Defects found and corrected

Corrective commit `563d3cccc16c800d89f4de22eac6ad8866058d37`:

- stale approval, recovery, RMS setup, and repair results could still surface success after account, lifecycle, or authority revision changes
- recovery setup checked only for the presence of a reauthentication timestamp instead of the A1 ten-minute window
- the entered RMS field was not password-masked
- concurrent S1 runtime startup could race local device enrollment and overwrite the local engine identity
- the Ours plaintext-only fallback omitted the required per-item crypto availability fields
- the UX8 browser mock did not model idempotent device enrollment, and two locators were ambiguous
- the required transition/race and accessibility coverage was incomplete

Corrective commit `39de742c8ab795137be95ecbaa685131b608e813`:

- UX8 media placeholder wording violated the retained UX3 privacy-claim policy even though it remained fail-closed; the wording was made truthful and policy-compatible without changing behavior

No API route, contract schema, database migration, durable product authority, cryptographic protocol, device authority, or plaintext fallback was added.

## Automated acceptance disposition

- Design section 24 items 1 through 24: PASS through the 27 focused UX8 checks, real Chromium/OpenMLS flow, retained S1 closure, production scan, and full health.
- Design section 24 item 25: PASS for the automated scope through reduced-motion emulation, 200 percent text, keyboard-accessible native controls, dialog semantics, and existing accessibility regressions. Physical Android accessibility remains part of the deferred device matrix.
- Design section 24.1 transition and race matrix: PASS through deterministic approval/revoke, recovery/approval, account teardown, lifecycle/finalization, resume reconciliation, stale response, repair, integrity-refetch, and monotonic request-ticket checks.
- Design section 25 physical Android matrix: NOT EXECUTED and deferred in full.

## Deferred physical gate

The mandatory physical Android acceptance was NOT EXECUTED during this closure.

All 25 Redmi Note 9S scenarios remain pending. The next runner must use `docs/testing/UX8_ANDROID_ACCEPTANCE.md` at executable SHA `39de742c8ab795137be95ecbaa685131b608e813`. If physical testing changes runtime code, automated closure must be rerun and this evidence anchor must be replaced with the new passing executable SHA.

UX8 remains IN PROGRESS and must not be reported DONE until the physical matrix and final evidence reconciliation complete.
