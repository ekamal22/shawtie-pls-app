# UX1 Romantic Design Foundation

Status: implemented on `feat/ux1-romantic-foundation`. Governed by `ROMANTIC_UX_DIRECTION.md` and `UX0_IMPLEMENTATION_SPEC.md`. Presentation only: no API, schema, lifecycle, messaging, presence, receipt, or call semantics changed.

## Where things live

| Concern | Path |
| --- | --- |
| Color roles, type roles, spacing, radii, motion tokens, both themes | `apps/web/src/design/tokens.css` |
| Component styles (buttons, surfaces, overlays, menu, shell, Home foundation) | `apps/web/src/design/design.css` |
| Theme preference and application (client-local only) | `apps/web/src/design/theme.tsx`, `theme-model.ts` |
| Icon set (single module) | `apps/web/src/design/icons.tsx` |
| Primitives | `apps/web/src/design/primitives.tsx` |
| Presence formatting | `apps/web/src/design/presence.ts` |
| Application shell and routing | `apps/web/src/app/shell/` |
| Legacy panel styles, now mapped onto tokens | `apps/web/src/styles.css` |

Surface branches consume these and add only surface-prefixed CSS. Global token or primitive changes go through the UX lead.

## Themes

Dawn (light, default) and Midnight (dark). The document root carries `data-theme` when the person chooses one; with no choice the system preference applies. The choice is stored client-side only (`localStorage`, guarded). Call surfaces may use `.force-midnight`. The browser chrome color follows the resolved theme.

## Typography and font decision

Roles: UI sans for chat, controls, and navigation; editorial serif for dates, titles, letters, quotes, and captions. Families are Inter Variable and Fraunces Variable from the `@fontsource-variable/inter` and `@fontsource-variable/fraunces` npm packages (SIL Open Font License 1.1), pinned exactly, self-hosted through the Vite bundle with `unicode-range` subsets. No font binary is committed to the repository, no third-party origin is contacted (ADR-009), and system stacks remain the fallback. Bundle weight: latin Inter about 48 kB and latin Fraunces roman and italic about 149 kB, fetched on demand.

## Shell

Bottom navigation with Home, Talk, and Ours, labelled and with `aria-current`. On wide screens it becomes a left rail. The pair mark in the header opens Us (account, appearance, partnership and breakup controls, partner requests, notifications, devices, deletion). Talk and the call panel stay mounted on every route so heartbeat, receipts, sync, and incoming-call signaling keep their existing behavior. Ours and Us mount when opened. Route changes move focus to the main region.

## Presence

Presence, typing, last seen, and read receipts are mutual, always on, and cannot be turned off. Home shows the authoritative `partner.presence` and `partner.typing` from the existing conversation contract through `PresenceLine`: "Online", "Last seen recently" (under ten minutes), "Last seen 10:42 PM", "Last seen yesterday 10:42 PM", or a dated form. When the server reports neither online nor a last-seen time the line reads "Offline". A repository test rejects any code that describes hiding or toggling these states.

## Known visual debt handed to surface branches

- Call panel is still the legacy stacked card (UX5). It hides on non-Talk routes while idle.
- Talk header and bubbles still use the legacy panel and a locale timestamp for last seen (UX3 should reuse `PresenceLine`).
- Ours still renders the legacy Relationship Space panel (UX4 and UX6).
- Existing forms still use legacy `.field`, `.primary`, `.secondary`, and `.danger` classes mapped to tokens; migrate to `Button` and field primitives per surface.
- Native `window.confirm` remains in lifecycle and deletion flows (`ConfirmDialog` is ready).
