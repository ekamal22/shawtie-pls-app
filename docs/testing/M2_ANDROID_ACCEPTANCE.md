# M2 Physical Android Acceptance

Status: executable preparation harness implemented. Executed device evidence is still required before M2 can be marked DONE.

## Purpose

M2 is the first milestone that requires a real Android device. Browser automation covers Chromium behavior on the development machine, but it cannot prove Android Chrome suspension, USB-forwarded local access, real background/foreground transitions, device-session revocation behavior, or OS storage behavior.

The preparation harness is deliberately non-destructive. It does not toggle Wi-Fi, mobile data, airplane mode, or clear Chrome storage.

## Preparation

Start the local web/API environment required for the scenario, then install the M2 Chromium browser binary once for desktop acceptance:

```powershell
npm ci
npm run test:m2:install-browser
```

For the physical Android preflight:

```powershell
npm run test:m2:device:prepare
```

The script:

- requires exactly one authorized ADB device unless `ADB_SERIAL` selects one
- verifies the device is awake
- verifies `com.android.chrome`
- configures `adb reverse tcp:4173 tcp:4173` by default
- launches `http://127.0.0.1:4173/` in Android Chrome
- configures CDP forwarding on local port 9222
- confirms a Chrome page target exists for the M2 app URL
- writes non-secret JSON evidence under `validation-logs/`

Override ports or URL with:

```powershell
$env:M2_DEVICE_WEB_PORT = "4173"
$env:M2_DEVICE_CDP_PORT = "9222"
$env:M2_DEVICE_URL = "http://127.0.0.1:4173/"
$env:ADB_SERIAL = "<serial>"
npm run test:m2:device:prepare
```

Do not commit `validation-logs/`.

## Mandatory device scenarios

Record pass/fail evidence for every scenario below on the supported physical Android device.

1. authenticated foreground app reaches live realtime state
2. background Chrome long enough for the socket to suspend, then foreground and verify canonical resync
3. queue a message while offline, restore connectivity, and verify one idempotent send
4. queue edit/delete/reaction offline and verify server lifecycle/version rules are rechecked on replay
5. receive duplicate/out-of-order realtime hints without duplicate product mutations
6. restart the API LISTEN connection while the browser socket remains open and verify forced canonical resync
7. initiate breakup from the other account while this device is offline and verify stale queued mutation is blocked or rejected
8. finalize dissolution while this device is offline and verify old partnership UI/cache/queues are purged before replay
9. create a later partnership and verify no previous-partnership cache or queue entry renders or replays
10. revoke the current device/session elsewhere and verify realtime closes, replay stops, and protected local state is removed
11. cold-start Chrome while offline before S1 and verify the locked shell appears instead of cached protected plaintext
12. exercise the service-worker update path with queued work and verify replay pauses until compatible reload/resync
13. exercise local storage/quota failure where practical and verify the UI never claims an unpersisted mutation is queued
14. use two tabs and verify stale claim completion cannot remove a newer tab's queue claim

## Evidence

For each scenario record:

- exact M2 commit SHA
- device model
- Android version
- Chrome version
- UTC timestamp
- scenario number
- pass/fail
- short observed behavior
- relevant log/screenshot filename when useful

The device preflight JSON is evidence only for setup. It is not acceptance evidence for the scenarios above.

## Cleanup

After testing:

```powershell
npm run test:m2:device:cleanup
```

This removes the M2 ADB reverse and CDP forward rules.

## Closure rule

M2 remains IN_PROGRESS until:

- `npm run test:m2:local` is green, including real Chromium acceptance
- full `npm run health` is green
- `npm audit --audit-level=high` is green
- every mandatory physical Android scenario above has recorded passing evidence
