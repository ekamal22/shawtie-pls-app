# UX0 Implementation Specification

Status: FROZEN FOR UX1 THROUGH UX7 unless the UX lead amends it in this file. This document converts `ROMANTIC_UX_DIRECTION.md` into implementation-ready rules. It is presentation authority only. It never overrides the PRD, architecture documents, API documents, ADRs, or source behavior.

Every concept carries one label:

- `PRESENTATION_ONLY`: may be implemented over existing behavior.
- `PRODUCT_EXTENSION`: needs separate product or architecture approval. Do not implement. Report `PRODUCT_EXTENSION_REQUIRED`.
- `DEFERRED`: intentionally postponed, presentation-safe later.

## 1. Confirmed product rules (audited against PRD, docs, source)

Six non-negotiable rules bind every UX agent. Each agent must acknowledge all six before editing code. Rules 2 and 3 are current product behavior, not a future UX proposal.

1. Remember This is a `relationship_items(kind=remember_this)` row. Reads are shared by both partners. Content edit and delete are creator-only. There is no shared-mutation mode. The item stores an independent snapshot and an optional loose `message` reference; it survives deletion of the source message. `PRESENTATION_ONLY`: present it as belonging to the couple, but show edit and delete only to the creator (capability comes from the server projection), and never offer "stop keeping" on a partner's item.
2. Read receipts are mutual, always enabled, and cannot be turned off (PRD sections 17, 32, 39; M1 design). No toggle, no per-user or partnership-level opt-out, no privacy-mode exception, no settings copy suggesting otherwise.
3. Typing indicators, online presence, and last seen are mutual, always enabled, and cannot be turned off or hidden. No toggle, no "Nobody / Partner" style preference, no privacy setting. Home and Talk may display the authoritative state from the existing conversation contract (`partner.presence.online`, `partner.presence.lastSeenAt`, `partner.typing`): "Online", or "Last seen" with a formatted time or date, or "Offline" when the server reports neither online nor a last-seen time. Never invent precision, never infer presence from unrelated activity, and keep it as quiet context, not a KPI. No settings surface may imply these can be hidden. Earlier concept text that made receipts optional, hid last seen, allowed presence to be disabled, or allowed typing to be disabled is REJECTED and superseded.
4. Breakup, restoration, deletion, cooldown and recovery semantics are unchanged. Copy and layout may change; deadlines, the one-hour initiator cancellation, irreversible restore intent, the single day-ten extension, view-only rules, per-call consent, and cooldowns are read from server state and never re-derived or altered. The concept ideas of a one-hour consent-request cooldown, an export offer, and pausing scheduled letters during breakup are STALE: PRD says scheduled For You and Future Us items still release while `breakup_pending` (strictly before the effective deadline), and no export or new cooldown exists.
5. Privacy copy may state only verified runtime behavior. S1 E2EE is not implemented. Message and relationship text are server-readable development content. Production media crypto is unavailable until S1 (the media crypto port is a test-only synthetic protocol outside test mode). Therefore forbidden: "end-to-end encrypted", "only we can read", "encrypted" applied to user content. Allowed: "private to the two of you inside Shawtie pls" as a description of authorization (partnership-scoped access), relay-only calling ("Private relay calling"), and factual local-storage statements that are true. Existing strings containing "encrypted" in `MessagingPanel.tsx` and `RelationshipSpacePanel.tsx` are reconciled in UX3 and UX6.
6. Voice Letters are a `media` reference with role `voice_letter` attached to an intentional item (For You, Future Us, Surprise, Proposal, Love). Presentation may treat it as a letter; visibility follows the container item. No new persistence.

## 2. Product-extension register

| Concept | Label | Presentation-safe alternative |
| --- | --- | --- |
| Send a Thought | `PRODUCT_EXTENSION` as a new primitive | R1 already has explicit `relationship_signal` items (thinking of you, hug, kiss, and others). Present the existing signal flow more gracefully. Do not add a pulse primitive or notification family |
| Open Together (synchronized reveal) | `PRODUCT_EXTENSION` | Single-person open of a released Future Us item |
| Persistent handwritten signature | `PRODUCT_EXTENSION` | Typeset display name in the editorial face |
| Voice-to-video upgrade | `PRODUCT_EXTENSION` | None. Start a separate video call |
| Location-driven sun/moon arc | `PRODUCT_EXTENSION` | None. Local time only if an existing field supplies it |
| Partner local time / city display | `PRODUCT_EXTENSION` unless existing data supplies it | Hide if absent |
| "Kept by Maya" dual-ribbon state | `PRESENTATION_ONLY` only if the projection exposes creator and message reference | Otherwise a single neutral kept mark |
| Together-again display modes | `PRESENTATION_ONLY` if stored as client-local preference only | Default to server target date |
| Toggles or privacy modes for read receipts, typing, presence, or last seen | Rejected permanently. Not a deferred idea | None |
| Notification opt-ins for This Day, anniversary morning | `DEFERRED` | Existing notification behavior unchanged |
| Midnight-after-11pm warming | `DEFERRED` | None |
| Our Year edits, chapter naming, Two Sides second author note | `PRODUCT_EXTENSION` unless expressible with existing item and curation fields | Present existing single-author memory and curation only |
| Quick-reply messages on declined calls | `PRODUCT_EXTENSION` | None |
| Call "Message" shortcut from call screen | `PRESENTATION_ONLY` (navigation only) | Deep link to Talk |
| Quiet map with custom tiles | `DEFERRED` | List first; map rendering is client behavior with no tracking |

## 3. Information architecture (frozen)

Bottom navigation, three destinations, always labelled: Home, Talk, Ours. Account, devices, security, partnership lifecycle, and partner requests move to an "Us" screen reachable from the pair mark on Home and a header control in Talk and Ours. The Talk destination hides the bottom bar while a conversation is focused only if the composer keyboard needs the space; otherwise the bar stays.

Ours is one scroll of three chapters. No new API. Mapping over existing R1 kinds and experiences:

| Chapter | Content | Source |
| --- | --- | --- |
| Then | Our Story, Firsts, Places, Remember This, memories | kinds `memory`, `first`, `place`, `remember_this`; story projection |
| Now | This Day in Us, released For You (incl. Voice Letters), Love, signals, Surprise and Proposal when released | `this-day` experience; `for_you`, `love`, `relationship_signal`, `surprise`, `proposal` |
| Next | Someday, Future Us, Until We're Together Again, Anniversary, Our Year | `someday`, `future_us`, `reunion`, anniversary and our-year experiences |

Firsts, Places, and Kept are lenses over Then, not separate destinations. Create sheet groups by intent and calls the existing create flows.

## 4. Design tokens (owned by UX1)

Themes: `midnight` and `dawn`, applied by `data-theme` on the root, default following `prefers-color-scheme` (dark maps to Midnight). User override stored client-local. Calls surfaces force Midnight. `color-scheme` set accordingly.

Color roles (initial hex, contrast to be verified in UX1; adjust values, never role names):

| Role | Midnight | Dawn |
| --- | --- | --- |
| `--room` | #15121A | #F6F0E7 |
| `--surface` | #1E1A24 | #FFFBF5 |
| `--raised` | #28232F | #EFE6DA |
| `--mine` | #432B34 | #EBD3CF |
| `--paper` | #F1E8DA | #FFFDF8 |
| `--ink` | #F2EADF | #2A2229 |
| `--ink-2` | #B9AFA6 | #6B5F63 |
| `--ink-onpaper` | #2E2528 | #2E2528 |
| `--rose` (primary relationship accent) | #D48E8B | #9E4F55 |
| `--candle` (rare emphasis) | #E6BE84 | #9A6A2A |
| `--hairline` | rgba(242,234,223,.10) | rgba(42,34,41,.12) |
| `--accept` | #8FB39A | #3F6B4E |
| `--end` | #D0605A | #A8322E |
| `--caution` | #D9A55B | #8A5A12 |

Rules: rose is muted, never a gradient except one call glow. Candle appears at most twice per screen. Tertiary ink never carries essential information. All text and icon pairs meet WCAG AA (4.5:1 body, 3:1 large text and icons); UX1 records the measured ratios.

Typography roles: `ui` (Inter or system UI stack) and `editorial` (Fraunces or a serif fallback stack). Scale tokens: `display` 32/38, `title` 22/28, `date` 28/32 editorial, `letter` 18/29 with max measure 64ch, `quote` 20/30 editorial italic, `ui-title` 17/22, `body` 16/22, `small` 15/21, `meta` 12/16, `caps` 11/14 tracking +6%. All sizes use rem and honor OS text scaling to 200%. Font loading: no binary font files committed. Prefer self-hosted variable fonts through a dev-dependency package bundled by Vite (OFL-licensed), verified for licensing, bundle weight, and CSP (no third-party origins, per ADR-009). If verification fails, ship the system stack with the same role tokens. Editorial face only for dates, titles, letters, quotes, memory captions.

Spacing: 4, 8, 12, 16, 24, 32, 48, 64. Gutter 16 (20 above 360px width). Chat rhythm 2px in group, 12px between speakers; memory rhythm 32 to 64.

Radius: 6, 12, 20, 28, full. Elevation: midnight uses tone plus 1px top highlight; dawn uses two low warm shadows; glass only over media (24px blur, 40 percent scrim; solid raised when reduce-transparency).

Surfaces: Room (base), Paper (letters, light in both themes), Print (photo-book memory pages), Glass (overlays on media). Grain 2 to 3 percent on Room in Midnight only, disabled with reduced motion or transparency, never animated.

Icons: one custom inline SVG set in a single component module, 24px grid, 1.75px stroke, outline resting and filled for active state. Heart only for Love reaction, Love collection, and the anniversary pair mark. Ribbon glyph for Remember This. No lock or shield icons in everyday UI. Every icon-only control has an accessible name.

Motion tokens: instant 120ms, quick 200ms, move 320ms, reveal 480ms, moment 700 to 900ms (letter open only), breath 1.4 to 2.4s loop. Easing vocabulary: `settle` cubic-bezier(.2,.8,.2,1), `unfold` cubic-bezier(.3,0,.1,1), `linear` for loops. No overshoot, no bounce. Nothing blocks input over 400ms except the letter opening, which is skippable. Reduced motion (`prefers-reduced-motion: reduce`): all transitions become 120ms opacity changes, loops stop, parallax off, ceremonial reveals become a single crossfade.

Breakpoints: base 320 to 599 portrait phone (primary), 600 to 899 tablet (single column max 640 content, centered), 900+ desktop (bottom nav becomes a left rail, content max 720). No feature may require more than 480 px of width.

Touch targets: 44px minimum, 48px on Android, call controls 64 to 72.

## 5. Component and screen rules

Buttons: `primary` (rose fill), `secondary` (surface with hairline), `quiet` (text), `danger` (end color, only for destructive and end actions, never the default focused control), `icon` (44px). Inputs and text areas share one field component with visible label, error text linked by `aria-describedby`. Sheets are one component (half and full); dialogs one component with focus trap, Escape, and restore focus. Native `window.confirm` is replaced with the shared dialog in UX3 and UX4 only where existing tests do not assert it; behavior and text of confirmation stay equivalent.

States: loading uses shape-matched skeletons (no words), empty states follow one headline plus one line plus optional action and never imply incompleteness, errors are plain and recoverable with existing server error codes mapped as today, offline shows a thin non-alarming banner while preserving existing M2 queue behavior and copy meaning.

Microcopy rules: warm and brief in emotional moments, exact in operational ones. Examples approved: "Kept for us." only if the keep action is truthfully shared visibility; otherwise "Kept." No exclamation marks in system copy. No guilt, urgency, or persuasion in lifecycle screens. No claims of encryption. Presence and last seen are shown per rule 3.

## 6. Ownership map (parallel work)

| Path or concern | Owner |
| --- | --- |
| `apps/web/src/styles.css` global tokens, base, reset; new `apps/web/src/design/` (tokens, themes, primitives, icons, motion) | UX1 (then lead-only) |
| `apps/web/src/app/App.tsx` shell, navigation, routing, AuthScreen | UX1 shell, then lead integrates UX2 |
| Home | UX2 (new files under `apps/web/src/features/home/`) |
| `MessagingPanel.tsx`, `features/media/*` presentation | UX3 |
| `RelationshipSpacePanel.tsx` shell and Then/Now/Next; new `features/ours/` | UX4 |
| `CallingPanel.tsx`, `VideoSurface.tsx` presentation only | UX5 (never touch `media-controller.ts`, `camera-controller.ts`, `media-owner-lease.ts`, `api.ts`, `push.ts`) |
| Per-kind relationship content views under `features/ours/content/` | UX6 |
| `PartnershipPanel.tsx`, `FormerPartnershipsPanel.tsx`, account and device sections | UX4 lifecycle presentation with lead review |
| `sw.js`, realtime, offline, media runtime, contracts, domain, db, api, worker | Nobody in UX program |

Shared-file rule: surface branches import UX1 primitives and add only feature-local CSS modules or scoped class names prefixed by surface (`home-`, `talk-`, `ours-`, `call-`, `mem-`). Global token edits go through UX1.

## 7. Test coupling warning (critical)

`apps/web/tests/*.browser.test.ts` are source-string assertions against `App.tsx`, `MessagingPanel.tsx`, `RelationshipSpacePanel.tsx`, `CallingPanel.tsx`, `VoiceRecorder.tsx`, `VideoSurface.tsx`, and controllers (for example "Preview before sending", `OFFLINE_OPERATION_REQUIRES_CONNECTION`, `'startOutgoing("voice")'`, `video: false`, and ordering assertions inside `App.tsx`). Refactors must keep those substrings and orderings or update the tests in the same commit with a stated equivalence argument. Playwright harnesses (`tests/e2e/*.spec.ts`) use `#status` and text such as the "Offline" heading and "verify this private session". Run affected tests after every slice.

## 8. Screen inventory (implementation targets)

Shell: bottom nav, Us screen. Home: default, new couple, waiting item, breakup and deletion banner states, offline. Talk: conversation (empty, active, offline, view-only), message actions, reply, edit, delete placeholder, reactions, image viewer, voice recorder and playback, expanded composer, keep-to-Remember flow. Calls: outgoing, incoming voice, connecting, connected, muted, reconnecting, ended, failed, consent states; incoming video, accept video, accept camera off, active video, camera on and off, flip, remote unavailable, weak, backgrounded. Ours: home (three chapters), create sheet. Content: story, kept, firsts, places, for you, voice letter, future us, love, this day, our year, someday, reunion, anniversary, surprise, proposal, signals. Us: profile and relationship, lifecycle (breakup, restore, deletion notices), devices, security, requests, former partners.

Component inventory: PairMark, Avatar, PresenceLine, BottomNav, HeaderBar, Sheet, Dialog, Menu, Button set, Field, Chip, Badge, Toast, Banner (offline, lifecycle), Skeleton set, EmptyState, ErrorNotice, PaperSheet, PrintCard, DateEditorial, KeptRibbon, MessageBubble, ReplyQuote, ReactionTray, TimeSeparator, VoiceBubble, Composer, CallPortrait, CallButton, GlassBar, VideoStage, LocalPreviewTile, StateChip.

## 9. Accessibility expectations

AA contrast in both themes; 200 percent text without clipping; every icon-only control named; focus visible and never obscured by sheets or the composer; sheets and dialogs trap and restore focus; live regions for typing, call state, mute, camera state, and errors; camera and microphone states expressed with icon, text, and color together; gestures always have button alternatives; reduced motion honored; destructive actions use explicit verbs and consequence text; unheard state indicators never rely on color alone.

## 10. Signature moments (allowed scope)

Ribbon (keep from a message using the existing R1 create with message reference), Memory Return (navigate from a Remember This item to its source message when the reference resolves; otherwise show unavailable), Letter Unfolds (open animation over an already-released For You item; recipient-open uses the existing release action), Our Year as a Book (paged presentation of the existing candidate recap, no metrics), Pair Mark (identity motif), Threshold Transition (Home to Ours). Two Sides is limited to moving between a memory and its source conversation context; a second author's annotation is `PRODUCT_EXTENSION`.
