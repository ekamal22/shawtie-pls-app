# M3 Physical Android Acceptance

## Status

Procedure and device preflight harness are implemented. Execution begins only after M3 automated/local closure is green.

M3 is not DONE until all 20 mandatory physical scenarios pass on a supported physical Android device and committed evidence records the exact tested SHA.

Canonical design: `docs/architecture/M3_MEDIA_VOICE_DESIGN.md`
Canonical API/storage contract: `docs/api/M3_MEDIA_API.md`

## Evidence required

For every scenario record exact commit SHA, device model, Android/API level, Chrome version, ADB serial or sanitized identifier, UTC timestamp, scenario number, PASS/FAIL, observed behavior, and useful log/screenshot evidence.

Never commit real private media, cookies, signed URLs, key material, secrets, or production credentials. Synthetic fixtures only.

## Environment rules

- isolated disposable PostgreSQL
- isolated private object-store test environment
- synthetic accounts and media only
- no reuse of another repo/session's ports
- do not disable M2 lifecycle/realtime behavior
- service worker remains app-shell/static only
- test crypto mode must be explicit and impossible to enable in production

## Mandatory scenarios

1. Image send/receive: process, encrypt, upload, finalize, bind to real M1 message, receive, authorize, decrypt, render.
2. Interrupted image upload: connectivity loss and retry without duplicate media/binding/message.
3. Short video: supported synthetic video within 50 MB/120 seconds, send and play.
4. General file: supported file within 25 MB, download-only safe handling.
5. Voice message: record, preview, cancel, record again, encrypt, upload, send, decrypt, play.
6. Microphone permission denial: no media row, grant, phantom queue, or message.
7. Recording background interruption: deterministic cleanup/failure, no corrupt upload.
8. Connectivity loss during upload/finalize: include lost finalize response; completion retry is idempotent.
9. Local quota failure: no false persisted/queued state and no phantom result after reload.
10. Breakup during upload: chat media follows PRD while stale client authority is never trusted.
11. Account-deletion overlay during upload: completion/binding/new writes fail closed.
12. Final dissolution with bound and partial media: no new grants/binds, local purge, durable object cleanup.
13. Previously issued signed URL: no new grant after dissolution; old bearer grant expires within short configured TTL.
14. Later-partnership isolation: old media IDs, object keys, local drafts, and projections cannot appear or rebind.
15. Device/session revocation: media runtime stops, protected local M3 state purges, revoked authority cannot refresh/resume.
16. R1 Voice Letter visibility: media cannot be fetched before containing item visibility permits it, then becomes accessible after release/open.
17. Service-worker update: no signed URL, authorized media response, or decrypted media enters Cache API; M2 update safety remains intact.
18. Two-tab safety: stale generation/claim work cannot finalize/bind over newer ownership; durable result is exactly once.

19. Whole-object retry identity: interrupt a near-limit encrypted video/file upload, refresh the grant, retry the exact encrypted draft, verify the ciphertext digest is unchanged and only one media object/message becomes authoritative.
20. Provider outage/degraded mode: make the object store unavailable, verify new media operation fails honestly, no API/plaintext fallback occurs, text messaging remains usable, and existing metadata renders media unavailable without claiming deletion or delivery.

## Closure

After 20/20 PASS, commit `docs/testing/M3_ANDROID_ACCEPTANCE_EVIDENCE.md`, reconcile repo-wide M3 status, record final physical SHA, verify raw artifacts/secrets are uncommitted, verify local/remote SHA parity, and only then mark M3 DONE.
