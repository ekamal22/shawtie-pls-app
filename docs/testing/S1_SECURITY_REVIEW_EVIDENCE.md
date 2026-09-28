# S1 Independent Cryptographic and Security Review Evidence

## Status

PASS for the final non-physical S1 security-review gate on 2026-09-27 at executable commit `6cba504d885328bbd25ce8887d509248fc42e84d`.

This was an independent closure review of the implemented source, database constraints, protocol boundaries, and executable adversarial behavior. It is not a claim of a third-party cryptographic audit or formal verification. At the time of this review, S1 remained `IN_PROGRESS` because physical Android acceptance was still mandatory.

Subsequent closure note: mandatory Redmi Note 9S acceptance later closed 30/30, full automated closure re-passed at final corrective executable `cde73a1`, and S1 was fast-forward merged to `main @ 71569cf`. The original review result above remains historical execution-time evidence rather than the current milestone status.

## Review scope

The review covered:

- the pinned OpenMLS profile and browser WASM boundary;
- independent device enrollment, approval, revocation, and KeyPackage state;
- MLS bootstrap, commit sequencing, member add/remove, reset generations, and control visibility;
- protected-content encryption, signatures, recovery capsules, context binding, and projection rules;
- Recovery Master Secret bundle encryption, recovery-key versions, challenges, and proof consumption;
- browser wrapping of device, recovery, MLS, pending-operation, and content-key state;
- PostgreSQL, object storage, outboxes, logs, realtime invalidations, push, service-worker caches, and browser durable storage;
- R1 preview/main role separation and sealed-main withholding;
- dissolution, revocation, rekey, namespace purge, and future-write isolation boundaries.

## Adversarial evidence

| Attack or failure mode | Executable result |
| --- | --- |
| Change partnership, generation, epoch, content type, content ID, version, payload role, sender device, schema version, or crypto profile | Every authenticated-context substitution failed decryption. |
| Modify protected ciphertext or signature | Digest/signature validation rejected the write and persisted no row. |
| Submit plaintext after crypto activation | API returned `CRYPTO_REQUIRED`. |
| Replay a stale group-reset commit | API returned `CRYPTO_EPOCH_CONFLICT`; no additional generation was created. |
| Sign a reset with the wrong recovery key | API returned `CRYPTO_RECOVERY_FAILED`; the active generation was unchanged. |
| Prove recovery with the wrong key | API returned `CRYPTO_RECOVERY_FAILED`. |
| Prove an expired recovery challenge | API returned `CRYPTO_RECOVERY_FAILED`. |
| Replay a consumed recovery proof | API returned `CRYPTO_RECOVERY_FAILED` after the fix in this review. |
| Write from a revoked device before rekey | The rekey/device fence returned 409 and persisted no future message; previously stored ciphertext remained present for authorized historical handling. |
| Put private fields in realtime invalidation payloads | Worker schema validation rejected publication. |
| Expose relationship sealed-main data before R1 visibility allows it | Security projection tests confirmed the main ciphertext is withheld. |
| Leave partnership secrets in durable browser state after purge | Chat/R1 queues, MLS group state, pending operations, and content keys were absent after purge. |
| Search raw server/client stores for a distinctive protected plaintext | PostgreSQL tables/dump, MinIO bytes, logs, IndexedDB, outboxes, Cache API, and notifications contained zero occurrences. |

The API and database implementation additionally use transactional row locks and state predicates for epoch advancement, active KeyPackage consumption, recovery challenge consumption, recovery version replacement, device trust transitions, and group-generation replacement. The canonical repository health suite exercises the surrounding lifecycle, final-dissolution cleanup, account deletion, offline replay, media, realtime, and authorization invariants.

## Finding and repair

### S1-REV-001: consumed recovery proof replay returned success

Severity: medium.

The recovery proof service returned the already-trusted device projection before loading the named challenge. A repeated request using a consumed challenge therefore returned 200. The replay did not grant a different device or expose key material, but it violated the challenge's single-use security contract and weakened auditability.

Repair: remove the trusted-device early success path. Proof submission now requires the current crypto identity to remain pending; every other trust state returns `CRYPTO_RECOVERY_FAILED`. The integration suite proves valid first use, consumption, and 409 rejection on replay.

No other critical, high, or medium unmitigated finding remained after repair.

## Verification results

`npm run test:s1:privacy` passed with the full protected-content fixture and `S1_RAW_PRIVACY_INSPECTION_PASS`.

`npm run test:s1:closure` passed at the same executable SHA with:

- `S1_LOCAL_AUTOMATED_PASS`;
- PostgreSQL integration 4/4;
- real Chromium 4/4;
- plaintext inventory clean;
- production bundle scan pass;
- full repository health pass;
- `npm audit --audit-level=high`: 0 vulnerabilities;
- `git diff --check`: pass;
- `S1_AUTOMATED_CLOSURE_PASS`.

No GitHub Actions workflow was used.

## Residual claims and release decision

The review supports the implemented S1 cryptographic and privacy boundary for the tested local environments. It does not erase the endpoint-compromise threat, does not promise unlimited forward secrecy for intentionally recoverable historical content, and does not replace physical-device verification.

At the time of this review, the raw privacy gate and final independent security-review gate were complete and the only remaining S1 closure gate was the mandatory 30/30 physical Android acceptance procedure. That later procedure passed, corrective closure completed at `cde73a1`, and S1 is now DONE and merged to `main @ 71569cf`. See `S1_ANDROID_ACCEPTANCE_EVIDENCE.md` for the subsequent physical record.
