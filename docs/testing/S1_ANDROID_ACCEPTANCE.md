# S1 Physical Android Acceptance

## Status

Not yet executed.

S1 can be marked DONE only after automated closure passes and all 30 mandatory scenarios below pass on a supported physical Android device with committed evidence tied to the exact tested SHA.

Use synthetic accounts, messages, relationship objects, media, recovery secrets, and devices only. Never commit private user content, cookies, session tokens, Recovery Master Secrets, device private keys, recovery private keys, signed URLs, or production credentials.

## Preparation

Run:

`npm run test:s1:device:prepare`

The command records the branch, exact SHA, Android device, API level, Chrome version, CDP target, and local ports under `validation-logs/`.

After the run, clean ADB forwarding with:

`npm run test:s1:device:cleanup`

## Mandatory scenarios

1. First trusted device enrolls with an independent S1 crypto identity and KeyPackages.
2. Recovery setup creates a Recovery Master Secret locally and only encrypted recovery material reaches the server.
3. Partnership bootstrap creates a fresh MLS group unrelated to any previous partnership.
4. The partner device joins through a valid KeyPackage Add and Welcome flow.
5. Protected text send decrypts only on authorized devices and raw PostgreSQL contains no message plaintext.
6. Message edit creates a new protected content version/key and the prior protected key metadata is erased.
7. Protected reaction send/update/remove works without plaintext reaction content in PostgreSQL.
8. Protected chat nickname set/replace/clear works without plaintext nickname content in PostgreSQL.
9. Reply rendering decrypts the referenced protected body without changing reply topology.
10. Offline protected send persists frozen ciphertext before network transmission and replays exactly once after reconnect.
11. Lost HTTP response retry reuses the same encrypted request, content key ID, nonce, digest, signature, and idempotency key.
12. Two tabs cannot advance one device MLS state concurrently; stale work loses safely.
13. Protected image upload stores ciphertext only and decrypts/renders after authorization.
14. Protected video or general-file upload retains the same ciphertext digest across whole-object retry.
15. Protected voice message records, previews, sends, decrypts, and plays without plaintext object-store content.
16. R1 immediate item encrypts main content and decrypts only for authorized partnership members.
17. R1 scheduled item exposes only authorized preview ciphertext before release and withholds sealed main ciphertext/key metadata.
18. R1 recipient-open item keeps sealed main content unavailable until authoritative release/open.
19. A trusted device approves a pending same-account device; an ordinary authenticated device cannot self-promote.
20. Revoking a trusted device revokes its future key delivery, marks rekey required, and blocks protected writes until rotation.
21. A revoked/offline stale device cannot send future protected content after rekey.
22. A newly trusted device joins the current group without receiving a plaintext private-key download.
23. Email-only account recovery restores account access but cannot decrypt historical protected content.
24. Correct Recovery Master Secret restores authorized historical recovery material on a new device.
25. Wrong Recovery Master Secret/recovery proof fails closed without partial history access.
26. Recovery-authorized catastrophic group reset creates the next group generation and does not reuse the old group root.
27. Breakup pending keeps the same partnership crypto namespace while existing product permissions remain authoritative.
28. Final dissolution purges local MLS/content keys and server protected key/recovery-capsule state alongside P3 physical deletion.
29. A later partnership between the same accounts cannot decrypt or enumerate the former partnership's protected content.
30. Final raw inspection confirms no protected plaintext in PostgreSQL, object storage, browser durable queues/caches, logs, push payloads, or Cache API.

## Evidence

Create `docs/testing/S1_ANDROID_ACCEPTANCE_EVIDENCE.md` only after execution. For every scenario record:

- exact tested SHA
- scenario number and PASS/FAIL
- UTC timestamp
- device model and Android/API level
- Chrome version
- synthetic account/device labels
- observed behavior
- relevant sanitized logs or screenshots
- defects found and the fixing commit, if any

The evidence file must explicitly record the final markers:

`S1_SERVER_PLAINTEXT_INSPECTION_PASS`

`S1_OBJECT_STORAGE_CIPHERTEXT_PASS`

`S1_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`

Use the actual device model in the final marker narrative if a different supported device is used.

## Closure

S1 remains open until all automated gates, 30/30 physical scenarios, raw plaintext inspections, final security review, documentation reconciliation, clean worktree, and local/remote SHA parity pass.
