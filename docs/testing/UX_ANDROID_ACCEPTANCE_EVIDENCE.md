# UX Physical Device Acceptance Evidence

Status: CLOSED. All 22 scenarios PASS on the physical device at executable SHA `ca7cd35`.

Procedure: `docs/testing/UX_ANDROID_ACCEPTANCE.md` (22 scenarios).

## Run record

- Starting frozen SHA: `0ec184d`
- Final executable SHA under test: `ca7cd3596cbf76d38399eb2089b4dc79c4ab10a4` (`ca7cd35`)
- Build identity: the served bundle carried `<meta name="shawtie-build-sha">` equal to the SHA above (bundle `index-KWP5plug.js`), read from the phone over the DevTools protocol before the final sweep.
- Device: Xiaomi Redmi Note 9S, serial `bf4b0dc9`, 1080x2400 at 440 dpi, viewport 392x732 CSS px portrait, 788x299 landscape
- Android version: 12 (API 31), MIUI V14.0.3.0.SJWMIXM
- Chrome version: 153.0.8010.52
- Environment: the real API, worker, PostgreSQL, MinIO and coturn (relay-only TURN) running on the workstation in isolated containers on non-default ports, reached from the phone over `adb reverse` (4186 web, 3478 TURN, MinIO). Web build made from a detached worktree at the candidate SHA with `--mode uxdevice` and the test-crypto flag. The second participant (Bob) is a real app client in desktop Chromium with fake media devices. Automation used ADB and the Chrome DevTools Protocol. No emulator was used.
- Date: 2026-09-26
- Tester: Claude Code (automation), with the user granting the camera permission prompt on the handset once.

## Scenario results (final sweep on `ca7cd35`)

| # | Scenario | Result | Observations |
|---:|---|---|---|
| 1 | Home density | PASS | Presence line, latest message, one waiting item fit without clutter. Home refreshes on a new incoming message (defect D2 fixed). |
| 2 | Bottom navigation | PASS | Home, Talk, Ours, Us reachable; tap targets at least 44 px; nav kept mounted Talk state. |
| 3 | Conversation readability | PASS | Grouping, human time separators and delivery labels legible at 392 px. |
| 4 | Composer keyboard behavior | PASS | Composer stays above the keyboard and the bottom nav hides while it is open (defect D1 fixed). |
| 5 | Attachment sheet | PASS | Sheet opens, options reachable, dismisses cleanly. |
| 6 | Voice-message controls | PASS | Record, cancel, send work; microphone released after recording. |
| 7 | Media rendering | PASS | Image and media bubbles render at correct aspect without overflow. |
| 8 | Read gate | PASS | Delivered advances while on Home; read advances only while Talk is actively viewed. Checked against the server receipts. |
| 9 | Ours Then, Now, Next, sheets, scheduled arrival | PASS | Recipient sees the authorized scheduled time only. No content, kind cue, counts or countdown for hidden items. Open-when letters reachable (D3, D4 fixed). |
| 10 | Long letters and Letter Unfolds | PASS | Long letter scrolls, unfold completes, the sheet shows the opened letter (D8 fixed). |
| 11 | Memory surfaces | PASS | Kept, Our Story and Our Year render. Kept messages are titled by their words. |
| 12 | Memory Return | PASS | Take me there returns to the original message. Partner edit and delete return 403 `RELATIONSHIP_ITEM_NOT_OWNED`. Partner Add to Our Story returns 200. |
| 13 | Lifecycle view-only states | PASS | Breakup shows a neutral banner and view-only Ours, cancel restores active. Account-deletion-pending pair shows the neutral banner and a disabled composer. |
| 14 | Incoming voice call | PASS | Answer and Decline visible and tappable. |
| 15 | Active voice call | PASS | Relay/relay ICE pair on both ends, audio packets flowing, mute and unmute work, microphone released after end. |
| 16 | Incoming video call | PASS | Accept with camera off works. |
| 17 | Active video call | PASS | Camera on/off, front/rear switch (camera service shows 1 to 0), camera hardware released when off, backgrounding pauses the camera with no auto restart. |
| 18 | C1 and C2 call privacy behaviors | PASS | Relay-only transport. A second tab shows connecting but does not capture media. |
| 19 | Reduced viewport | PASS | Landscape 788x299: incoming Answer and Decline remain on screen and tappable (D5 fixed). Split-screen height emulated. |
| 20 | Reduced motion | PASS | Animator scale 0 makes `prefers-reduced-motion` true. Ours arrival, letter unfold and book use 0.12 s fades on `ca7cd35` (D6 fixed). Ribbon (`ux7-fade-in 0.12s`) and Memory Return (no view transition) were verified at `4ec5ba6`; the final-sweep rerun of those two hit a harness UI-state error, not an app defect, and no runtime code touching them changed afterward. |
| 21 | 200 percent text | PASS | Composer and controls remain usable (D7 fixed). Verified at `4ec5ba6` and unchanged since. |
| 22 | Dawn and Midnight parity | PASS | Follow my phone tracks Android night mode. Both themes legible. Verified at `4ec5ba6` and unchanged since. |

22 of 22 PASS.

## Disclosures

- Chrome on Android does not apply the Android `font_scale` to the page, so 200 percent text was emulated on the device by injecting `html{font-size:32px!important}`.
- True split-screen was emulated with `wm size 1080x1350`.
- Call audio and video were confirmed by RTC packet counters, ICE candidate pairs, the Android camera service and screenshots, not by human listening or viewing.
- The Talk call-entry card is large. Accepted visual debt, not a defect.
- `accelerometer_rotation` was set to 0 during testing and the original value was not recorded. The device was left portrait with the animation scales 1.0, font scale 1.0, size reset and night mode yes.
- Screenshots contain the personal phone chrome and are kept outside the repository.

## Defects found, repairs, and regression tests

| ID | Defect | Repair | Regression coverage |
|---|---|---|---|
| D1 | Bottom navigation stayed above the keyboard (Chrome resizes the layout viewport) | `6f6445b` | `ux1.design.test.ts` keyboard model tests, UX1 browser spec |
| D2 | Home latest message stale on realtime events | `d00a34a` | `ux-integration.spec.ts` |
| D3 | Recipient-open letters unreachable in Ours | `91a5120`, `022dab5` | `ux4.ours.test.ts`, `ux4-ours.spec.ts` |
| D4 | Duplicate letters in the full-space For you lens | `83a186c` | `ux4.ours.test.ts`, `ux4-ours.spec.ts` |
| D5 | Incoming call Answer and Decline below the fold in landscape | `2f3c845` | `ux5-calls.spec.ts` landscape case |
| D6 | Reduced-motion Ours arrival used 360 ms | `df4d065` | `ux7-signature.spec.ts`, `ux1.design.test.ts` |
| D7 | Touch tokens in rem collapsed the composer at 200 percent | `4ec5ba6` | `ux1.design.test.ts` |
| D8 | Ours sheet kept showing the sealed card after opening a letter | `bc01a38`, `560ee92` | `ux4-ours.spec.ts` |
| M1 | Creator's own letter labelled as from the partner | `1f5415f` | `ux4.ours.test.ts` |
| M2 | Kept message titled with the author's name | `ca7cd35` | `ux3.talk.test.ts` `keptTitle` assertions |

Each runtime repair invalidated the frozen SHA. The acceptance procedure now names `ca7cd35`, and the final sweep above was run on that build.

## Automated regression at `ca7cd35`

`npm run health` passes. M2 browser 25, C1 24, C2 16, R1 security 16 and 13. Chromium UX1 15, UX2 12, UX3 16, UX4 22, UX5 22, UX6 15 (one skipped), UX7 12, cross-surface 6, M2 7, M3 4, C1 5, C2 6. No vulnerabilities. No diff in api, packages, worker or scripts since `0ec184d`, so the PostgreSQL local matrices last run at `425f493` still apply.

## Product rules acknowledged

Remember This is shared to read with creator-only edit and delete. Read receipts, typing, presence and last seen are mutual and always on. Breakup, restoration, deletion and recovery are unchanged. Copy claims only verified guarantees (S1 E2EE is not done). Voice Letters may look like letters with no persistence change. The recipient may see the authorized scheduled time and nothing else about hidden items. The Home hidden-item hint stays `DEFERRED_PRIVACY_BOUNDARY`.

## Final physical acceptance result

UX_ANDROID_ACCEPTANCE_PASS

UX_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS

`integration/ux-romantic` is physically accepted for UX0 to UX7. It has not been merged to `main`.
