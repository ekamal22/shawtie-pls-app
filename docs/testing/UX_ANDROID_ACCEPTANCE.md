# UX Physical Device Acceptance (Redmi Note 9S)

Status: DONE. All 22 mandatory scenarios passed on a physical Xiaomi Redmi Note 9S on 2026-09-26 at final executable SHA `ca7cd35`. Canonical evidence: `docs/testing/UX_ANDROID_ACCEPTANCE_EVIDENCE.md`.

## Frozen executable baseline

- Acceptance branch at execution time: `integration/ux-romantic`; accepted history fast-forward merged to `main` at merge anchor `9f0bea4`
- Executable SHA: `ca7cd35` (physically accepted; frozen at `0ec184d` at the start, then repaired during acceptance, see the evidence file. Earlier freezes: `0ec184d`, supersedes the earlier freeze `425f493`, invalidated by a small presentation change that shows the authorized scheduled arrival time on sealed Ours rows). Physical acceptance must use only this SHA.
- Later commits on this branch are documentation only. Do not test a different code SHA without recording it here.
- Final automated evidence at `ca7cd35`: `npm run health` PASS; M2 browser 25, M3 browser 13, C1 24, C2 16, R1 security 16 and 13; Chromium UX1 15, UX2 12, UX3 16, UX4 22, UX5 22, UX6 15 (1 opt-in skipped), UX7 12, cross-surface 6, M2 7, M3 4, C1 5, C2 6; audit 0 vulnerabilities. PostgreSQL local matrices for M1, R1, M2, M3, C1 and C2 last ran at `425f493`; there is no backend runtime diff from the accepted UX repair line that would invalidate that evidence.

## Product rules checked on the device

1. Remember This is shared to read; only the creator can edit or delete.
2. Read receipts are mutual and always on; a message becomes read only while Talk is the active route.
3. Typing, presence and last seen are mutual, always on and never configurable.
4. Breakup, restoration, deletion and recovery presentation is neutral and unchanged in behavior.
5. No end-to-end encryption claim anywhere; relay-only call wording only.
6. Voice Letters read as letters; no hidden-item teaser, count or countdown for unreleased items.

## Scenarios

All scenarios below passed. Detailed observations, disclosed emulation boundaries, defects, repairs, and regression coverage are recorded in `UX_ANDROID_ACCEPTANCE_EVIDENCE.md`.

1. Home density: partner identity, presence or last seen, one latest-message context, one quiet moment, Ours door; nothing crowded.
2. Bottom navigation: Home, Talk, Ours reachable one-handed; the Us pair mark opens account and partnership.
3. Conversation readability: grouped bubbles, time separators, replies, edited and deleted states.
4. Composer keyboard behavior: the navigation hides while typing, the composer stays above the keyboard, and send and mic morph correctly.
5. Attachment sheet: photo or file and voice message entry.
6. Voice-message controls: hold or tap to record, preview before sending, cancel, send, playback.
7. Media rendering: image messages and viewer.
8. Read gate: open the app on Home while the partner sends messages; confirm delivered but not read; open Talk and confirm read.
9. Ours: Then, Now and Next scroll, lenses, item sheet, create sheet. A scheduled letter from your partner shows Arrives and its time but no content, kind cue, count or teaser; your own scheduled letter shows Sealed for later with its time.
10. Long letters: For You letter reading, Letter Unfolds, skip with tap.
11. Memory surfaces: Our Story, Kept, Places, Someday, Our Year paging.
12. Memory Return: from a kept item to the source message and back.
13. Lifecycle view-only states: breakup pending and account-deletion pending banners; Us shows neutral wording and unchanged actions.
14. Incoming voice call: full-screen surface, Answer and Decline reachable.
15. Active voice call: mute, End call, microphone state, timer.
16. Incoming video call: Accept video and Accept with camera off.
17. Active video call: remote video dominant, camera off and on, front and rear switch, local preview tile, control bar auto-hide, badges stay visible.
18. Call privacy behaviors accepted in C1 and C2 remain: background camera pause, stale-owner fencing, relay-only.
19. Reduced viewport: keyboard open, split screen, landscape incoming call.
20. Reduced motion: system setting on; every signature transition becomes a short fade.
21. 200 percent text: Talk, Us and call entry keep everything on screen.
22. Dawn and Midnight parity, follow-my-phone switching.

## Result

`docs/testing/UX_ANDROID_ACCEPTANCE_EVIDENCE.md` records the device model, Android and Chrome versions, executable SHA, every scenario result, defects found, repairs, regression tests, and the final markers `UX_ANDROID_ACCEPTANCE_PASS` and `UX_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`.
