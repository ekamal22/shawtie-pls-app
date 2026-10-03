# R2 E2EE Release Review

Status: SOURCE-BOUNDARY REVIEW PASS, FINAL ACCEPTANCE-PREP HOSTED GUARD PENDING

Pre-R2 reviewed baseline:

`2dc24424e228777765d767f052db57ea8086a6ce`

Authoritative automated R2 main state reviewed:

`44fe73e7dbed79ebf985f66f6c1237536014121f`

## Review question

Did R2 Public Readiness alter the cryptographic trust boundary established by S1 E2EE and Crypto Recovery?

## Source-boundary result

No.

A repository compare from the pre-R2 baseline to authoritative R2 main changed 122 files and changed none of the protected cryptographic implementation paths.

A second compare from authoritative R2 main to the current final-acceptance preparation work also found no protected cryptographic implementation change at review time.

Protected review paths include:

- `apps/api/src/modules/crypto/`
- `apps/web/src/lib/crypto/`
- `apps/web/src/lib/media/crypto-port.ts`
- cryptographic security model source under `apps/web/src/features/security/`
- `packages/contracts/src/crypto/`
- `packages/crypto/`
- `packages/db/src/repositories/crypto.ts`
- `packages/db/src/repositories/protected-content.ts`
- S1 migrations 0019 through 0021

The executable guard is `scripts/security/r2-e2ee-diff-review.mjs`. It fails R2 verification if any protected path changes relative to the reviewed pre-R2 baseline.

## Retained hosted evidence

On authoritative `main @ 44fe73e7dbed79ebf985f66f6c1237536014121f`, R2 Public Readiness Verification run `37109590242` passed.

PostgreSQL/S1 job `111164765684` proved:

- S1 contracts 10/10
- S1 browser unit surface 10/10
- S1 API security 8/8
- S1 PostgreSQL integration 4/4
- `S1_SERVER_PLAINTEXT_INSPECTION_PASS`
- raw database inspection found ciphertext and no protected plaintext
- `S1_PLAINTEXT_INVENTORY_CLEAN`
- migrations 0001 through 0024 applied with S1 migrations unchanged

Browser/security job `111164765793` proved:

- OpenMLS WASM release build succeeded
- S1 OpenMLS Chromium 4/4
- authenticated-context substitution rejection
- local vault reload and partnership-key purge
- browser durable stores, outboxes, caches, and notifications contain no protected plaintext
- `S1_PRODUCTION_BUNDLE_SCAN_PASS`
- retained SEC1 browser security passed

## R2 notification and provider review

R2 added notification and transactional-email functionality outside the protected-content cryptographic boundary.

Message Web Push remains content-minimized:

- the worker resolves recipient authorization from current partnership membership
- the account-backed notification preference chooses only the generic routing type
- protected message plaintext is not sent to the push provider

Transactional email handles authentication credentials and approved lifecycle/security copy. It is not a protected-message transport and does not receive message/media/relationship-object plaintext or cryptographic secrets.

## Rust maintenance warning

The existing OpenMLS/libcrux dependency chain still carries the reviewed maintenance-only `RUSTSEC-2026-0173` warning through `proc-macro-error2 2.0.1`.

R2 does not perform an unreviewed cryptographic-stack upgrade solely to remove that warning. The current disposition remains in `R2_RUST_DEPENDENCY_REVIEW.md`.

## Release disposition

The source-boundary E2EE review passes for authoritative R2 main.

The final acceptance-prep candidate must still pass the executable E2EE diff guard and retained S1 hosted gates. If a future commit changes any protected path, this review is invalidated and a fresh E2EE review is required before Stable Release.

Physical voice/video privacy and physical Android acceptance are separate gates and are not satisfied by this source review.
