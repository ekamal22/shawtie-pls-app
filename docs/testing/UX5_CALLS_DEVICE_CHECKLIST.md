# UX5 Calls Device Checklist (Redmi Android, Chrome or installed PWA)

Presentation only. Call semantics are unchanged, so C1 and C2 acceptance (`C1_ANDROID_ACCEPTANCE.md`, `C2_ANDROID_ACCEPTANCE.md`) still apply in full. This list adds checks for the redesigned surfaces. Run with two accounts in an active partnership.

## Idle entry
- Talk shows "Call <name>" with Voice call, Video call, and Enable call notifications; text reads "Private relay calling".
- Home and Ours show no call card while idle.
- Buttons are disabled with the note "Calling opens as soon as you're connected" until sync is live.

## Voice
1. Outgoing: full-screen surface, portrait initial with soft glow, "Calling <name>...", Cancel call. Cancel returns to the entry with "Call ended" then Done.
2. Incoming (from Home, Talk, and Ours, and with the screen locked then unlocked via notification): surface covers the app, "Incoming voice call", Decline and Answer both labelled. Nothing answers without a tap.
3. Answer: "Connecting audio..." then "Connected" with a quiet timer, Microphone on badge, Mute, End call.
4. Mute: label becomes Unmute, badge reads "Microphone off", icon changes. TalkBack announces "Your microphone is off."
5. Toggle airplane mode for a few seconds: "Reconnecting... you are still in the call." then recovery.
6. End from either side: ended copy is calm (Call lasted m:ss, No answer., You declined the call.). Failure reads "Couldn't connect. Check your connection and try again." with Try again and Done.
7. Tap to hear appears only if the browser blocks remote audio.

## Video
1. Incoming video shows Decline, Accept with camera off, Accept video. Both accept choices work as before.
2. Active video: partner video is full-bleed; local preview is a small tile. Drag the tile and release: it snaps to the nearest corner. Tap it: it moves to the next corner.
3. Bar shows Mute, Turn camera off, Switch camera, End call (all labelled, no clipping at 360px). It hides after about 4.5 seconds without touch and returns on touch. Microphone and camera badges and the timer stay visible.
4. Turn camera off: preview shows "Camera off", badge reads "Camera off", button becomes Turn camera on.
5. Partner turns camera off: "Waiting for <name>'s video" with a calm second line.
6. Switch camera flips front and rear without ending the call.
7. Leave the app and return during a video call: camera is off with the note that it paused in the background; Turn camera on restores it.
8. Camera permission denied: call continues as voice with "Camera unavailable. You can keep talking."

## Accessibility and display
- Light phone theme: call surface stays dark (Midnight).
- Font scale 200 percent: no clipped labels; the surface scrolls if needed.
- Reduce motion (Android "Remove animations"): glow stops, surface appears without motion.
- TalkBack: dialog title is read on open, focus stays inside until the call ends, Done returns focus to the page.
- Controls are at least 64px and each has visible text.

## Regression spot checks
- Breakup pending: call attempts still follow existing server rules and per-call answer; no new copy about the relationship.
- Second tab on the same device: "This call is open in another tab on this device."
- Answer on another device: "This call is on another device." with no media controls here.
