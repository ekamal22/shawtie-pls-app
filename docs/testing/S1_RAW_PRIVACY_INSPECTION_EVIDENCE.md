# S1 Raw Privacy Inspection Evidence

## Status

PASS on 2026-09-27 at executable commit `e08b0aadaaf8fb7e5bb3bdbdff52104caf7505e1`.

This evidence covers the non-physical raw privacy gate only. S1 remains `IN_PROGRESS` until the separate 30-scenario physical Android procedure passes with committed evidence.

## Command

```powershell
npm run test:s1:privacy
```

The command created disposable PostgreSQL 16 and MinIO containers on isolated random loopback ports. It generated a unique protected plaintext sentinel for that run, exercised crypto-required message storage and authenticated media encryption, inspected raw stores, and removed the containers in a `finally` block.

The command completed with:

```text
S1_SERVER_PLAINTEXT_INSPECTION_PASS tables=65
S1_OBJECT_STORAGE_CIPHERTEXT_PASS bytes=67
S1_POSTGRES_DUMP_PLAINTEXT_INSPECTION_PASS bytes=213082
S1_MINIO_RAW_OBJECT_INSPECTION_PASS bytes=67
S1_LOG_PLAINTEXT_INSPECTION_PASS
S1_BROWSER_DURABLE_STORAGE_PASS
S1_REALTIME_PUSH_CONTROL_PRIVACY_PASS
S1_RAW_PRIVACY_INSPECTION_PASS
```

## PostgreSQL and dump inspection

The integration fixture encrypted the per-run sentinel with the production S1 AES-256-GCM content path and submitted a correctly signed crypto-required message envelope. It then verified:

- `messages.body_text` was `NULL`;
- stored ciphertext matched the client-produced ciphertext;
- stored ciphertext did not contain the sentinel bytes;
- a `to_jsonb(row)::text` scan across all 65 public tables found zero sentinel occurrences;
- a raw `pg_dump --no-owner --no-privileges` output scan found zero sentinel occurrences.

The all-table scan included message, reaction, nickname, R1, media, durable outbox, notification, recovery, crypto-control, idempotency, and lifecycle tables present in the disposable schema.

## Object storage inspection

The storage fixture encrypted the sentinel through `@shawtie/crypto`, uploaded only authenticated ciphertext through the production S3-compatible adapter, verified object length and SHA-256, downloaded the raw object, and decrypted it only on the client test side. Both the adapter download and an independent raw `mc cat` read found no sentinel bytes in the object.

## Browser durable storage inspection

Real Chromium executed four S1 tests. The raw privacy case wrote encrypted chat and R1 offline operations plus device state, recovery private material, MLS group state, a pending candidate state, and a content key. It then enumerated raw values from:

- every IndexedDB database and object store;
- local storage and session storage;
- every Cache API cache, request URL, and response body;
- service worker registrations and visible notification title/body/data.

The scan found zero sentinel string or byte occurrences. The S1 content namespace was `shawtie.mls.v1`. Partnership purge then removed chat outbox, R1 outbox, group state, pending operations, and content keys.

## Logs, outboxes, realtime, push, and control traffic

The runner scanned PostgreSQL logs, MinIO logs, and captured child-process output for the unique sentinel. It found zero occurrences.

The executable worker review also passed seven tests proving that messaging and relationship invalidations are schema-validated and content-free, extra private fields fail closed, and C1 push remains generic and content-free. The PostgreSQL all-table scan independently covered the durable outbox and notification rows created by the exercised API flows.

## Supporting results

- migration plan: 21 migrations, `reserved=0`;
- S1 contracts: 9/9 passed;
- S1 browser source tests: 7/7 passed;
- S1 API security tests: 5/5 passed;
- S1 PostgreSQL integration: 4/4 passed;
- S1 object-storage integration: 1/1 passed;
- realtime/push/control worker tests: 7/7 passed;
- real Chromium: 4/4 passed.

No GitHub Actions workflow was used.
