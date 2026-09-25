# Romantic UX Direction

Status: ACCEPTED DESIGN DIRECTION. UX0 canonicalization and implementation planning are in progress. Runtime implementation has not started.

This document records the accepted product-experience direction for Shawtie pls after completion and merge of C2 Video Calling. It is deliberately separate from architecture, API, database, lifecycle, and cryptographic authority.

## Design thesis

Shawtie pls should feel like a private room that belongs to two people.

The experience should be intimate, calm, warm, premium, personal, and emotionally expressive without becoming childish, decorative, manipulative, or engagement-maximizing. The user's own messages, photos, memories, letters, dates, and plans should provide most of the romance. The interface should provide restraint, framing, timing, typography, motion, and privacy.

A useful design test is:

> Does this feel like something that belongs to us, or like another app feature?

## Accepted information architecture

The primary user-facing model is:

- **Home**: the threshold into the shared private space
- **Talk**: everyday communication
- **Ours**: the couple's relationship world

`Ours` is the user-facing name. Existing internal R1 names, item kinds, APIs, storage, and authority remain unchanged unless a later approved product or architecture change says otherwise.

Within Ours, existing relationship content is presented through:

- **Then**: what made us us, including story, firsts, places, remembered moments, and historical memories
- **Now**: what belongs emotionally to the present, including This Day in Us, current letters, reasons, and resurfaced memories
- **Next**: what points toward the future, including Someday, Future Us, reunion plans, upcoming moments, and time-oriented content

This is a presentation and navigation model, not a database redesign.

## Design principles

1. **Romance through restraint.** Use context, language, photography, typography, timing, and motion before decorative symbols.
2. **Two people, not an audience.** No public-facing social mechanics or performative sharing pressure.
3. **Everyday first.** Talk remains fast and practical enough for constant use.
4. **Progressive disclosure.** Secondary actions appear when needed rather than crowding small screens.
5. **Content leads.** User-created photos, messages, memories, and letters should dominate decorative illustration.
6. **Private by experience, not icon spam.** Privacy should be felt through contained spaces, clear authority, and careful language.
7. **No relationship scoring.** No love score, compatibility score, breakup risk, responsiveness ranking, streak pressure, or engagement leaderboard.
8. **Lifecycle neutrality.** Breakup, restoration, deletion, consent, and recovery states remain humane but non-coercive.
9. **Accessibility is part of polish.** Contrast, text scaling, touch targets, screen readers, reduced motion, and explicit media states are mandatory.
10. **Mobile first.** Design for smaller portrait phones before wider surfaces.

## Visual direction

### Modes

The accepted naming direction is:

- **Midnight**
- **Dawn**

These may serve as emotional visual modes rather than ordinary technical dark/light labels. They must still satisfy normal theme accessibility and platform expectations.

### Palette

Use a disciplined system rather than a collection of romantic colors.

Core direction:

- deep midnight or warm charcoal base
- cream or warm paper light surfaces
- restrained Rosewood relationship accent
- rare Candle highlight for exceptional emphasis

Muted rose, burgundy, plum, dusty lavender, warm sand, and deep blue may inform exploration, but should not all become first-class tokens.

### Typography

Use a highly readable UI sans-serif with a restrained editorial secondary face for memories, letters, dates, and story surfaces.

The current design direction favors:

- Inter or equivalent readable UI sans
- Fraunces or equivalent editorial serif for selected emotional/editorial roles

Final font selection must consider licensing, loading, performance, rendering quality, and accessibility before implementation.

### Surfaces

The conceptual material vocabulary is:

- **Room**: foundational app space
- **Paper**: letters, memories, editorial content
- **Print**: photography and story presentation
- **Glass**: transient overlays and selected controls

These names describe visual roles, not new data models.

## Home

Home should not become a dashboard.

The default experience should prioritize:

1. partner presence or identity
2. an obvious path back into conversation
3. at most one quiet meaningful shared element
4. a restrained doorway into Ours

Avoid large widget grids, productivity-dashboard density, relationship scores, streaks, or engagement summaries.

## Talk

Talk remains the everyday center.

Accepted direction includes:

- lighter partner-first header
- spacious message rhythm
- strong typography for long messages
- clear reply/edit/delete states
- media and voice-message presentation
- compact composer
- expandable secondary action control rather than a permanent dense action row
- natural bridge from a message into Remember This

The Remember This interaction may use the **Ribbon** concept, but must preserve existing M1/R1 authority and privacy behavior.

## Calls

Voice should feel like calling your person, not joining a meeting.

Video should make the partner's video dominant while keeping mute, camera, switching, recovery, consent, and privacy controls obvious.

UX5 may redesign presentation but must preserve accepted C1/C2 semantics, including:

- explicit call and accept gestures
- Accept video
- Accept with camera off
- camera on/off
- front/back switching
- background camera privacy
- relay-only transport policy
- remote video unavailable/recovery states
- existing lifecycle and revocation behavior

Voice-to-video upgrade is not part of C1/C2 and must not be introduced as a UX-only change.

## Relationship experiences

The accepted presentation program includes:

- Our Story
- Remember This
- Our Firsts
- Places We Became Us
- For You
- Voice Letters
- Future Us
- Love / reasons
- This Day in Us
- Our Year
- Someday
- Until We're Together Again
- Anniversary
- Surprise
- Proposal

These features should feel like one relationship world rather than a feature grid.

Memory and letter presentation should favor editorial composition, dates, photography, captions, whitespace, and subtle motion over decorative romantic clichés.

## Signature Shawtie moments

The following concepts are accepted for UX exploration when they can be implemented without changing product authority:

- **The Ribbon**: save a meaningful conversation moment into Remember This
- **Two Sides**: move between a memory presentation and its original conversation context
- **The Letter Unfolds**: intentional For You letter opening treatment
- **Our Year as a Book**: editorial annual relationship reflection without scoring
- **Pair Mark**: a subtle recurring identity motif belonging to the couple
- **Threshold Transition**: entering Ours feels spatially distinct from ordinary navigation
- **Memory Return**: a resurfaced memory can transition back to its place in the relationship story

All motion must respect reduced-motion preferences.

## Product-extension quarantine

The romantic concept contains ideas that are not presentation-only. They are not approved for implementation merely because the design direction is accepted.

The following require separate product and, where applicable, architecture/security approval:

- Send a Thought as a new communication or notification primitive
- synchronized Open Together behavior for Future Us
- stored handwritten signatures or other new persistent personal artifacts
- voice-to-video request or upgrade behavior
- location-driven sunrise/sunset behavior
- new read-receipt behavior
- additional shared/private memory authority modes
- any new durable relationship state, server event, API, database column/table, or worker behavior

An implementation agent that encounters one of these boundaries must stop and report the requirement rather than inventing backend behavior.

## E2EE truth boundary

Reviewed E2EE remains planned under S1.

Until S1 is implemented and verified:

- UX copy must not imply that all user content is end-to-end encrypted
- privacy language must describe only behavior the current runtime actually provides
- romantic privacy framing must not become a security claim

UX8 exists specifically to integrate verified S1 states into the redesigned experience after S1 closes.

## Implementation program

### UX0 Romantic Experience Specification

Freeze:

- screen inventory
- component inventory
- exact design tokens
- responsive behavior
- motion rules
- accessibility requirements
- microcopy principles
- feature-to-surface mapping
- ownership map for parallel implementation
- presentation-only versus product-extension classification

### UX1 Romantic Design Foundation

Implement shared:

- Midnight/Dawn tokens
- typography
- spacing
- surfaces
- iconography
- buttons
- inputs
- sheets
- dialogs
- cards
- navigation shell
- loading, empty, error, and offline states
- motion primitives
- reduced-motion behavior

No screen-specific agent should invent a competing design system.

### UX2 Home

Implement the threshold experience over existing data and behavior.

### UX3 Talk

Redesign messaging and composer while preserving M1/M2/M3 contracts and offline/realtime semantics.

### UX4 Ours

Implement Then/Now/Next presentation over verified R1 behavior.

### UX5 Calls Experience

Redesign voice/video presentation over merged C1/C2. Physical Redmi smoke is required after call UI changes.

### UX6 Memories, Letters, and Time

Implement the relationship-content presentation system across the existing R1/M3 feature set.

### UX7 Signature Shawtie Moments

Integrate the accepted signature interactions that remain presentation-only.

### S1 E2EE and Cryptographic Recovery

May proceed in parallel with UX2 through UX7 after C2 is merged.

### UX8 Encrypted UX Integration

Integrate verified enrollment, recovery, revocation, encryption, and unavailable-history states after S1.

### R2 Public Readiness

Final accessibility, security, browser, device, operational, hosted verification, release, and rollback closure.

## Parallel-agent implementation model

After UX0 is frozen and UX1 is implemented, parallel work is encouraged.

Recommended ownership:

- one UX lead/integrator with final design-system authority
- Home agent
- Talk agent
- Ours agent
- Calls agent
- Memories agent
- read-only visual/accessibility/product-integrity reviewers

Use separate branches/worktrees. Shared primitives remain owned by UX1/lead. Surface agents should not independently create competing global tokens or foundational components.

Integration should remain incremental, with typecheck, build, lint, format, relevant browser tests, and `git diff --check` after each integration. Call-related integrations also require retained C1/C2 regression coverage and physical smoke where appropriate.

## Non-negotiable implementation boundary

The UX program may radically change:

- presentation
- visual hierarchy
- information architecture
- navigation
- typography
- spacing
- motion
- component composition
- progressive disclosure
- copy tone
- empty/error/loading treatment

It may not silently change:

- APIs
- database schema
- migration ownership
- lifecycle rules
- consent rules
- message semantics
- R1 authority
- deletion/recovery rules
- C1/C2 call state or transport semantics
- cryptographic claims
- security boundaries

Any such need becomes a separately reviewed product or architecture change.

## Definition of success

Shawtie pls should emerge from the UX program feeling unmistakably like a private place for two people while remaining technically the same verified product underneath until separately approved milestones change that product.

The design is successful when romance comes from meaning and restraint, everyday communication remains fast, relationship content feels coherent, calls feel intimate without losing clarity, sensitive lifecycle states remain neutral, accessibility remains strong, and no visual redesign weakens the verified privacy and reliability boundaries.
