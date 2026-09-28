# UX8 Automated Closure Evidence

Status: UX8 AUTOMATED CLOSURE PASS, PHYSICAL ANDROID 25/25 PASS. UX8 is DONE. See the corrective section below for the final runtime evidence anchor; the original result immediately following is preserved unchanged as the record of what first passed before physical testing found one defect.

Date: 2026-09-27 (original); 2026-09-28 (corrective).

Branch: `feat/ux8-encrypted-ux-integration`.

Original automated executable SHA: `39de742c8ab795137be95ecbaa685131b608e813`.

Final corrective executable SHA (current runtime evidence anchor): `43ff9b1ec319703f3d9270ae8053ab196ca54419`. See "Corrective closure after physical-run fix" below.

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

## Deferred physical gate (as of the original run)

The mandatory physical Android acceptance was NOT EXECUTED during this original closure.

All 25 Redmi Note 9S scenarios were pending as of this original run. They have since been executed; see the corrective section immediately below and `docs/testing/UX8_ANDROID_ACCEPTANCE_EVIDENCE.md` for the full physical record.

## Corrective closure after physical-run fix

Physical Redmi Note 9S testing (`docs/testing/UX8_ANDROID_ACCEPTANCE_EVIDENCE.md`) found one real defect while exercising scenario 8 (correct RMS recovery): a device that had genuinely just become trusted and recovery-capable could still be classified `repair_required` and shown a destructive "Protected sharing needs repair" prompt, because the S1 group join it was waiting on can legitimately take more than one reconciliation round to land, and a single pass looked identical to a truly broken local group. The fix (`abc38c7`, formatting-corrected in `43ff9b1`) makes `CryptoSecurityProvider` retry reconciliation with real spacing before concluding the group is unusable, and makes the repair-eligibility predicate treat a device within a short grace window of its own recorded `approvedAt` as still joining rather than repair-eligible, using only data already present on its own device projection. A focused regression test was added; the original 27 UX8 model tests plus the new one (28 total) all pass.

Because runtime source changed, the full automated closure was rerun from a clean, `origin`-matching worktree at the corrective HEAD and passed completely:

```text
UX8_CLOSURE_STEP_PASS fetch
UX8_CLOSURE_STEP_PASS ux8-model            (28/28)
UX8_CLOSURE_STEP_PASS ux8-browser          (2/2 real Chromium/OpenMLS flows)
UX8_CLOSURE_STEP_PASS s1-retained-local    (S1 contracts 9/9, browser 9/9, security 7/7,
                                             PostgreSQL integration incl.
                                             S1_SERVER_PLAINTEXT_INSPECTION_PASS tables=65,
                                             S1_PLAINTEXT_INVENTORY_CLEAN, real Chromium 4/4,
                                             S1_PRODUCTION_BUNDLE_SCAN_PASS)
UX8_CLOSURE_STEP_PASS s1-production-scan   (S1_PRODUCTION_BUNDLE_SCAN_PASS, standalone)
UX8_CLOSURE_STEP_PASS health               (REPOSITORY_HEALTH_PASS: all workspace typechecks,
                                             builds, eslint --max-warnings=0, prettier --check,
                                             dependency/cycle checks, full repository test suite)
UX8_CLOSURE_STEP_PASS audit-high           (0 vulnerabilities)
UX8_CLOSURE_STEP_PASS git-diff-check
UX8_AUTOMATED_CLOSURE_HEAD 43ff9b1ec319703f3d9270ae8053ab196ca54419
UX8_AUTOMATED_CLOSURE_PASS
```

An initial rerun attempt failed once at the `health` step's `prettier --check`, on a single line the fix commit left unwrapped; it was corrected in a separate, purely formatting commit (`43ff9b1`) and the closure re-run above is from that final commit.

No API route, contract schema, database migration, durable product authority, cryptographic protocol, device authority, or plaintext fallback was added or changed by the fix.

Mandatory physical Redmi Note 9S acceptance then closed all 25 scenarios at this final executable SHA, including re-verifying the fix live: a fresh device correctly recovering with its RMS no longer shows the false repair prompt, correctly shows an honest "not ready yet" state instead, and correctly converges to full, real decrypted history once its own and its partner's ordinary reconciliation completes. Full evidence: `docs/testing/UX8_ANDROID_ACCEPTANCE_EVIDENCE.md`.

UX8 is DONE at final executable `43ff9b1ec319703f3d9270ae8053ab196ca54419`. `feat/ux8-encrypted-ux-integration` is fast-forward merged to `main` at `a029169`.
