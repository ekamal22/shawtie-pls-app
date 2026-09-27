# UX8 Physical Android Acceptance

Status: REQUIRED, NOT YET EXECUTED.

Milestone: UX8 Encrypted UX Integration.

Target device: Xiaomi Redmi Note 9S, Android 12 / API 31.

Canonical design authority:

- `docs/design/UX8_ENCRYPTED_UX_INTEGRATION_DESIGN.md`

Automated closure must pass before this physical matrix begins. The preflight command is:

```text
npm run test:ux8:device:prepare
```

The preflight only proves that the expected branch/build/device/CDP target can be reached. It is not scenario acceptance evidence.

## Preconditions

Before physical testing:

1. `feat/ux8-encrypted-ux-integration` is clean and matches its remote.
2. the exact executable SHA is recorded
3. `npm run test:ux8:closure` passes at that SHA
4. retained S1 production scan is green
5. full repository health and high-severity audit are green
6. no unresolved UX8 defect remains from automated verification
7. the physical run uses synthetic accounts and synthetic protected content only

## Mandatory 25-scenario matrix

1. healthy trusted-device status
2. fresh trusted account with recovery not configured
3. recent reauthentication -> create recovery key
4. one-time RMS reveal, copy, acknowledgement, dismissal
5. post-dismissal scan proves RMS absent from browser durable storage/cache/outbox/logs
6. fresh pending device shows protected-access task
7. wrong RMS fails closed and device stays pending
8. correct RMS trusts device and restores real older protected history
9. trusted second device sees pending device and can approve it
10. approved-without-RMS copy does not claim old history
11. device revoke through A1 removes protected future access
12. remaining device observes real rekey state and returns to ready
13. Talk composer blocked correctly while pending/rekeying
14. old unavailable message renders a per-message placeholder, not a blank conversation
15. released Ours item with unavailable history renders a per-item placeholder
16. sealed R1 item remains sealed for release reasons
17. protected media unavailable state does not fall back to plaintext
18. deterministic group repair flow creates next generation and future content works
19. email/account recovery -> sign-in -> pending crypto recovery separation
20. offline/reconnect does not queue recovery secrets or approval operations as M2 user-content operations
21. 200 percent text and Android touch targets across recovery/device flows
22. reduced-motion recovery/repair dialogs
23. background/foreground during pending or rekey state does not lose the required action
24. real realtime device revocation/rekey updates the visible UX without reload
25. final raw scan for RMS, private recovery material, and protected plaintext leakage

## Required final markers

A complete accepted run records all three markers:

```text
UX8_ANDROID_ACCEPTANCE_PASS scenarios=25/25
UX8_RECOVERY_SECRET_STORAGE_PASS
UX8_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS
```

## Evidence rules

The physical runner must record:

- exact Git SHA
- branch
- device model
- Android version and API level
- Chrome version
- scenario-by-scenario PASS/FAIL
- defects discovered
- corrective commit SHAs
- automated regression added for every discovered code defect where practical
- final rerun evidence after any corrective code change
- final storage/privacy scan evidence

If physical testing changes runtime code, automated UX8 closure must be rerun at the new executable SHA before UX8 may be marked DONE.

Until the full 25/25 run is complete, UX8 remains IN PROGRESS even if all automated closure gates pass.
