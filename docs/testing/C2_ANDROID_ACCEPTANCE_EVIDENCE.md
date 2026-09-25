# C2 Android Video Calling Acceptance Evidence

## Status

PHYSICAL ACCEPTANCE COMPLETE. Every mandatory scenario in `C2_ANDROID_ACCEPTANCE.md` (1 to 31 and 33 to 36; there is no scenario 32) passed on one exact executable SHA.

- Final executable SHA: `ecbb2e1877fbc8ee7bbeac0c15674a66683e8143`
- Automated closure on that SHA: `npm run test:c2:closure` printed `C2_AUTOMATED_INTEGRATED_PASS reserved=0`
- Branch: `feat/c2-video-calling`. Merge base with `main`: `5323d7be21e8776b45f507ec4cf60b9582544621`. `main` at that SHA is unchanged. C2 is NOT merged.

## Environment

- Physical endpoint: Xiaomi Redmi Note 9S, Android 12, Chrome 153 (`153.0.8010.52` reported by the canonical preflight).
- Peer endpoint: desktop Chrome 153 with a fresh dedicated profile, anti-occlusion flags verified on the running process, a fake camera and fake microphone (`440 Hz` tone) device, and a verified `videoinput` plus a successful real `getUserMedia()` before Scenario 1.
- Redmi network: Wi-Fi to the same LAN as the laptop, with a mobile-data transition in Scenario 18.
- TURN: disposable coturn container on the laptop, UDP plus TCP for most scenarios, and a `--no-udp` TCP-only configuration for Scenario 17. ICE policy was `relay` throughout.
- Synthetic accounts only. Non-private scenes (generated test pattern on the desktop peer; the Redmi camera was aimed at nothing sensitive).
- Canonical preflight: `npm run test:c2:device:prepare` printed `C2_ANDROID_PREPARE_PASS`. Cleanup: `npm run test:c2:device:cleanup` printed `C2_ANDROID_CLEANUP_PASS`.

## Evidence categories

- Automated: closure, focused unit and Chromium regression tests (retained in the repository).
- Physical observation: measured on the real Redmi through Chrome DevTools over adb (tracks, peer connections, sockets, selected candidate pair type, frame and packet counters) and `dumpsys media.camera` for camera hardware use.
- User-confirmed sensory: audible audio, visible video, front/rear view, camera indicator and preview state, asked as one short question at the exact point and answered by the person holding the device.
- Instrumentation counters: RTP/frame counters and probe-recorded getUserMedia attempts. Counters were never used in place of a required sensory confirmation.

## Scenario results

Every result below is PASS on the final executable SHA. "Sensory" marks a user confirmation. No frames, SDP, ICE candidate text, IP addresses, TURN credentials, camera labels, device IDs, or secrets appear here.

| # | Result | Safe observation |
| - | ------ | ---------------- |
| 1 | PASS | Caller microphone pre-acquired before durable create. Camera never requested while ringing (no getUserMedia video, hardware idle). Callee UI identified video and did no capture before accept. Signaling only after accept (`shawtie.call.v2`). Camera requested only after accept. Relay-only selected pair. One audio and one video m-line. Clean hangup released all tracks, peer connections, sockets and camera hardware. Sensory: video both ways and audio both ways confirmed. |
| 2 | PASS | Accept with camera off: no camera capture, durable kind stayed video, remote video still received (counters), explicit Turn camera on later worked. Sensory: remote video visible on the Redmi while its camera was off. |
| 3 | PASS | Real Android camera block: one attempt, "Camera permission was denied. Audio can continue.", no retry loop, explicit retry is one bounded attempt, call kind stayed video, no camera metadata on the server. |
| 4 | PASS | Same on the Redmi as callee. Sensory: tone and remote video continued while the camera was denied. |
| 5 | PASS | Notification tap opened incoming UI with no camera request. Outgoing and incoming ringing never requested a camera. Losing tab or device and stale UI were evidenced in scenarios 12, 26 and 34. |
| 6 | PASS | Camera off: capture stopped, hardware released, preview tile showed the camera-off placeholder, audio continued, durable version unchanged. Sensory: no camera indicator, placeholder shown, tone audible. |
| 7 | PASS | Camera on again attached to the existing sender without a new peer connection, audio stable, version unchanged. Sensory: indicator, live video on the peer, tone continuous. |
| 8 | PASS | Front to rear to front. Exactly one live video track at all times, superseded tracks ended, audio uninterrupted. Sensory: rear view and front view confirmed on both screens. |
| 9 | PASS | Forced overconstraint fell to the next tier, all-tier failure was bounded at three attempts with an unavailable message, denial was one attempt, no unbounded retry. |
| 10 | PASS | Delayed acquisition released after backgrounding: stale track stopped immediately, never attached to the preview or the sender. |
| 11 | PASS | Pending switch hides new switch and camera-off actions; a stale switch result was fenced; one live video track maximum. |
| 12 | PASS | Only the owner tab held media. Observer tab did no capture. Takeover incremented the media-owner generation. A frozen stale owner never requested a camera and had no signaling authority after takeover. Known Chrome behavior: a hidden frozen tab keeps its microphone until foregrounded. |
| 13 | PASS | C1-only accept and wrong profile: 409 `CALL_MEDIA_PROFILE_UNSUPPORTED`. v1 signaling for a video call rejected. The C2 Redmi accepted normally. |
| 14 | PASS | Fifteen wire-level injections: valid audio plus video accepted. Duplicate video, extra audio, application m-line, audio-only, wrong order, candidate lines and end-of-candidates closed with 1008 "Invalid SDP". |
| 15 | PASS | Relay candidates with audio and video media locators accepted. Missing locator and out-of-range index closed with 1008 "Invalid signaling frame". Host, srflx and prflx closed with 1008 "Invalid ICE candidate". Real call sent locators for both media sections. |
| 16 | PASS | Wi-Fi: Redmi selected relay over UDP, audio and video counters advancing. Sensory: video both ways and tone. |
| 17 | PASS | UDP disabled at TURN: both endpoints selected relay over TCP, no direct pair. Sensory: video both ways and tone. |
| 18 | PASS | Wi-Fi turned off mid-call: within seconds the Redmi selected relay over TCP on cellular, counters kept advancing for 30 seconds, camera state coherent, no direct pair. Sensory: video both ways and tone. |
| 19 | PASS | Signaling socket interrupted: media continued, reconnect into a fresh generation, later camera switch worked. |
| 20 | PASS | Backgrounding released camera hardware (microphone stayed for the audio call), preview cleared, no hidden capture. Instrumentation only. |
| 21 | PASS | Foreground did not restart the camera (eight seconds of observation, no capture), Turn camera on was offered. |
| 22 | PASS | Injected playback rejection showed Tap to show video, audio continued, the tap cleared it, no durable mutation. Sensory: video both ways and tone after the tap. |
| 23 | PASS | Simulated track end: preview cleared, no silent reacquisition, audio continued, explicit retry restored. |
| 24 | PASS | Mute did not touch the camera, camera toggles did not touch the microphone, version unchanged. Sensory: laptop heard nothing while muted, video stayed. |
| 25 | PASS | breakup_pending: new video call needed a fresh accept, no consent carried, camera followed the caller's own explicit action. |
| 26 | PASS | account_deletion_pending: new video denied, active call ended, tracks stopped, a stale held camera acquisition stopped immediately on release and never attached. |
| 27 | PASS | Revoked Redmi device: call ended, TURN refresh and signaling reconnect returned 401, tracks stopped. |
| 28 | PASS | Ringing and connected cases: authorization removed, TURN refresh denied, tracks stopped, call rows purged per the C1/P3 rules. |
| 29 | PASS | Transport off: video accept, signaling and TURN failed closed, no direct fallback. After restore a fresh video call connected. Sensory: video both ways and tone. |
| 30 | PASS | Eight camera cycles: at most one live video track, one peer connection and one signaling socket, no new peer connections or sockets, responsive browser. |
| 31 | PASS | `C2_VIDEO_ENABLED=0`: new video create 409, ringing video accept blocked without voice reinterpretation, voice call worked (v1). Sensory: voice tone audible. |
| 33 | PASS | Caller reloaded before answer: after accept media stayed off and the camera unopened until explicit resume, then camera stayed off until Turn camera on. |
| 34 | PASS | Two callee devices raced: both pre-acquired the microphone, first committed accept won, loser released its microphone and never requested a camera, winner requested its camera after confirmation. |
| 35 | PASS | Flag off after acceptance: existing media, signaling and TURN refresh continued. Transport off then failed closed (TURN 503, signaling closed). Sensory: media kept working. |
| 36 | PASS | Database dump and all first-party logs scanned for 19 sensitive needles and SDP/ICE patterns: zero hits. |

## Harness notes (not product defects)

- Desktop Chrome blocks UDP from http pages to a private-IP TURN server unless local-network-access is granted for the origin. The peer profile was granted it. Production TURN is not on a private address.
- The peer window was minimized several times while the operator worked; C2 correctly disabled its camera on hidden. A small watcher script restored the window. No product change was made for this, and the background-privacy behavior is unchanged.
- The peer uses a fake microphone tone; speaking into the laptop is not captured by design.
- Chrome DevTools cannot deny the camera on Android Chrome. The real denial used `pm revoke` and `pm grant` of the Android camera permission, then restored it.

## Defects found and fixed during the discovery sweep (before the final run)

- `e6576e9`: callee created a second video transceiver on answering an offered video call, causing a second video m-line. Fixed to adopt the offered transceiver, with source-level, Chromium negotiation and API regression tests.
- `ecbb2e1`: a stopped remote sender left the last frame frozen instead of the "Waiting for partner video" state. Fixed with a rendering-progress check, with a real-Chromium regression test.

No defect was found during the final pass, so no fix, rerun of the full closure, or restart of the matrix followed the freeze.

## Closure markers

- `C2_AUTOMATED_INTEGRATED_PASS reserved=0` at `ecbb2e1877fbc8ee7bbeac0c15674a66683e8143`
- `C2_ANDROID_ACCEPTANCE_PASS`
- `C2_PHYSICAL_REDMINOTE9S_ACCEPTANCE_PASS`
