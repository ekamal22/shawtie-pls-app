# UX Physical Device Acceptance (Redmi Note 9S)

Status: READY TO RUN. Scenarios are defined; none has been executed on a physical device yet.

## Frozen executable baseline

- Branch: `integration/ux-romantic`
- Executable SHA: `425f493` (UX2 through UX7 integrated, review repairs applied)
- Later commits on this branch are documentation only. Do not test a different code SHA without recording it here.
- Prerequisite evidence at that SHA: `npm run health` pass; UX1 to UX7 node suites; M2 browser 25, M3 browser 13, C1 24, C2 16; Chromium UX1 14, UX2 12, UX3 16, UX4 20, UX5 20, UX6 14 (1 opt-in skipped), UX7 12, cross-surface 4, M3 4, C1 5, C2 6, M2 7; PostgreSQL local matrices for M1, R1, M2, M3, C1 and C2 pass with migrations 0001 through 0018 and `reserved=0`.

## Product rules to re-check on the device

1. Remember This is shared to read; only the creator can edit or delete.
2. Read receipts are mutual and always on; a message becomes read only while Talk is the active route.
3. Typing, presence and last seen are mutual, always on and never configurable.
4. Breakup, restoration, deletion and recovery presentation is neutral and unchanged in behavior.
5. No end-to-end encryption claim anywhere; relay-only call wording only.
6. Voice Letters read as letters; no hidden-item teaser, count or countdown for unreleased items.

## Scenarios

Run in Midnight and, where practical, Dawn. Record pass or fail with observations for each.

1. Home density: partner identity, presence or last seen, one latest-message context, one quiet moment, Ours door; nothing crowded.
2. Bottom navigation: Home, Talk, Ours reachable one-handed; the Us pair mark opens account and partnership.
3. Conversation readability: grouped bubbles, time separators, replies, edited and deleted states.
4. Composer keyboard behavior: the navigation hides while typing, the composer stays above the keyboard, and send and mic morph correctly.
5. Attachment sheet: photo or file and voice message entry.
6. Voice-message controls: hold or tap to record, preview before sending, cancel, send, playback.
7. Media rendering: image messages and viewer.
8. Read gate: open the app on Home while the partner sends messages; confirm delivered but not read; open Talk and confirm read.
9. Ours: Then, Now and Next scroll, lenses, item sheet, create sheet.
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

## Recording results

Add an evidence file `docs/testing/UX_ANDROID_ACCEPTANCE_EVIDENCE.md` with the device model, Android and Chrome versions, the executable SHA, each scenario result, defects found, and fixes with regression tests.
