# Shawtie pls Product Requirements Document

**Product name:** Shawtie pls  
**Tagline:** Your space for just the two of you.  
**Repository:** `shawtie-pls-app`  
**Document status:** Draft v0.1  
**Product type:** Privacy-focused two-person communication platform  
**Primary client:** Progressive Web App  
**Initial distribution:** Web and installable PWA  
**Initial operating target:** Free or near-zero-cost student deployment

---

## 1. Product Summary

Shawtie pls is a private communication app built around one simple rule:

> One person. One partner. One shared private space.

Users can register an account, choose a unique username, search for another user by username, send a partner request, and form one active partnership.

A user may have no more than one active partner at a time.

If a partnership ends, the user may later form a new partnership, subject to a server-enforced partner-change cooldown. The initial product rule is that a user may form no more than one new partnership within a rolling three-month period.

Each partnership creates an isolated private space containing communication and shared relationship features. Data from a previous partnership must never become available to a future partner.

Shawtie pls is not intended to be a general social network, public messaging network, dating marketplace, or group-chat platform.

---

## 2. Product Vision

Shawtie pls should feel like a private digital place shared by exactly two people rather than a conventional contact-based messenger.

The long-term product combines:

- private one-to-one messaging
- voice messages
- photo and media sharing
- notifications
- shared memories
- relationship milestones
- private letters
- saved moments
- shared plans
- optional location-based memories
- privacy-focused architecture
- end-to-end encryption

The experience should remain intentionally limited to one active partner.

The limitation is a product feature, not a technical restriction to be hidden from users.

---

## 3. Product Principles

### 3.1 One active partner

Every account may belong to zero or one active partnership.

The server and database must enforce this rule.

The frontend must never be treated as the source of truth for partnership eligibility.

### 3.2 Partnership isolation

Every partnership is a separate security and data boundary.

A new partner must never gain access to:

- messages from a previous partnership
- media from a previous partnership
- memories from a previous partnership
- encryption material from a previous partnership
- push subscriptions associated with a previous partnership
- private drafts from a previous partnership
- conversation state from a previous partnership
- local cached data from a previous partnership

### 3.3 Privacy by default

Private data should be accessible only to the account owner, the currently authorized partner where appropriate, and the minimum server components required by the current security architecture.

### 3.4 Explicit lifecycle rules

Partnership creation, acceptance, termination, cooldowns, data ownership, key rotation, and re-pairing must have explicit rules.

No important partnership behavior should depend on accidental implementation details.

### 3.5 Public repository safety

The public repository must contain only synthetic data.

No real user names, real messages, production credentials, live secrets, private deployment identifiers, or personal relationship information may be committed.

### 3.6 PWA first

The first production-quality client should be a responsive installable web application.

Native mobile applications may be considered later.

---

## 4. Goals

The first stable version should allow users to:

1. Create an account.
2. Sign in securely.
3. Choose and manage a unique username.
4. Search for another user by username.
5. Send and receive a partner request.
6. Accept or decline a partner request.
7. Form exactly one active partnership.
8. Exchange real-time text messages.
9. Send supported media.
10. Send voice messages.
11. Receive notifications.
12. See delivery and read state where supported.
13. End an active partnership.
14. Prevent immediate partner cycling through a three-month eligibility rule.
15. Create a new partnership only when eligible.
16. Keep each partnership's data isolated.
17. Install and use the application as a PWA.
18. Use the application across supported desktop and mobile browsers.
19. Recover safely from temporary network loss.
20. Use end-to-end encrypted messaging before the product is considered ready for sensitive real-world use.

---

## 5. Non-Goals

The initial product will not include:

- group chats
- public profiles
- followers
- social feeds
- public posts
- channels
- communities
- dating discovery
- random partner matching
- multiple simultaneous partners
- business accounts
- advertisements
- SMS-based account verification
- phone-number-based contact discovery
- cryptocurrency features
- public media galleries
- public status updates
- live streaming
- marketplace functionality
- arbitrary third-party bots
- enterprise administration

---

## 6. Target Users

### Primary user

A person who wants a private digital space with one specific partner.

### Secondary user

A user who values a quieter and more intentional alternative to large contact-based messaging platforms.

### Early adopter profile

Early users are expected to be comfortable with:

- username-based account discovery
- installing a PWA
- using a product with a deliberately limited social model
- understanding that a partnership is exclusive while active

---

## 7. Account Model

Each account must have:

- immutable internal account ID
- unique username
- display name
- password credential or supported authentication credential
- account creation timestamp
- account status
- partnership eligibility state
- security metadata
- notification preferences

Optional future fields may include:

- avatar
- short bio
- timezone
- locale
- preferred language

Sensitive authentication data must never be exposed through public API responses.

---

## 8. Username Requirements

Usernames are the primary account discovery mechanism.

A username must:

- be unique
- be case-insensitive for uniqueness checks
- have a normalized canonical representation
- have a documented minimum and maximum length
- use a restricted character set
- reject reserved system names
- be rate-limited when changed

The first version should support username search by exact or normalized match.

Broad public user enumeration should be avoided.

Future fuzzy search may be considered only with appropriate privacy protections.

---

## 9. Registration

A user must be able to register without a phone number.

Initial registration should use:

- username
- display name
- password
- optional email address if account recovery is implemented

Registration must include:

- username availability validation
- password policy validation
- rate limiting
- duplicate account protection where feasible
- abuse controls
- acceptance of applicable terms and privacy policy before public launch

The three-month partner rule is initially enforced per account.

The product should not claim that the rule uniquely identifies a human across multiple accounts.

---

## 10. Authentication

Authentication must provide:

- secure password hashing
- secure session creation
- session expiration
- logout
- session revocation
- protection against session fixation
- rate-limited login attempts
- generic authentication error messages
- secure cookie handling where cookies are used

Future support may include:

- passkeys
- recovery codes
- trusted device management
- email-based recovery
- two-factor authentication

---

## 11. Partner Discovery

Users search for another account using a username.

Search results should expose only the minimum information needed to identify the intended person, such as:

- username
- display name
- avatar if enabled

The system should not expose:

- email address
- active session information
- previous partners
- partnership history
- last known IP address
- private profile metadata

---

## 12. Partner Requests

A user who is eligible may send a partner request to another eligible user.

A partner request has a lifecycle such as:

- pending
- accepted
- declined
- cancelled
- expired

The backend must reject requests when:

- the sender already has an active partner
- the recipient already has an active partner
- the sender is ineligible due to cooldown
- the request targets the sender's own account
- an equivalent request already exists
- abuse or safety controls block the action

The recipient must explicitly accept a request before a partnership becomes active.

---

## 13. Partnership Model

A partnership is a first-class domain entity.

A partnership should contain at minimum:

- partnership ID
- member account IDs
- creation timestamp
- activation timestamp
- status
- termination timestamp if terminated
- termination metadata where appropriate
- security lifecycle metadata

A partnership may be:

- pending
- active
- terminated

The exact state model may be refined during implementation.

An account may belong to at most one active partnership.

This must be enforced transactionally at the database level in addition to domain and API checks.

---

## 14. Three-Month Partner Rule

The initial rule is:

> A user may form no more than one new partnership within a three-month eligibility window.

The server should store or derive a value such as:

`nextPartnerEligibleAt`

Eligibility must be evaluated using trusted server time.

Changing a client device clock must have no effect.

The product must define exactly when the cooldown starts.

The recommended initial rule is:

- a partnership is formed
- the account's next eligibility timestamp is set to three months after partnership activation
- if the partnership remains active, another partnership is impossible regardless of the timestamp
- if the partnership ends before the timestamp, the user must wait until the timestamp
- if the partnership ends after the timestamp, the user may form another partnership immediately after termination

This rule must be documented in the UI before a user confirms a partnership.

The duration should be configurable in backend policy rather than duplicated as a hard-coded frontend constant.

---

## 15. Partnership Termination

Either member may end an active partnership.

Termination must be an explicit server-side operation.

The system should clearly warn the user about consequences before confirmation.

After termination:

- neither user remains in an active partnership
- neither user may send new messages to that partnership
- active realtime authorization must be revoked
- future push delivery for that partnership must stop
- security keys must follow the defined termination lifecycle
- old partnership data must not be attached to any future partnership
- local clients must update their active-partnership state
- cached access credentials associated with the partnership must be invalidated where applicable

The product must define whether historical content remains visible to the original two users after termination.

This is an open product decision and should be finalized before stable release.

---

## 16. Conversation Model

Each active partnership should have one primary private conversation.

The conversation belongs to the partnership, not directly to a mutable username or current-partner field.

Messages must reference an immutable conversation ID and partnership context.

Authorization must verify membership for every protected operation.

---

## 17. Text Messaging

The messaging system should support:

- sending text messages
- receiving messages in real time
- message timestamps
- stable message IDs
- optimistic UI where safe
- retry behavior
- idempotency
- message ordering
- delivery state
- read state
- reconnection after temporary network loss

Future capabilities may include:

- replies
- reactions
- editing
- deletion
- message search
- disappearing messages

These features should not compromise the partnership isolation model.

---

## 18. Realtime Communication

Realtime transport may use WebSockets or another appropriate mechanism.

The realtime system must enforce:

- authenticated connections
- partnership membership
- channel-level authorization
- safe reconnection
- duplicate event handling
- connection cleanup after logout or partnership termination

A user must never be able to subscribe to another partnership by guessing or modifying a channel identifier.

---

## 19. Media

The product should eventually support:

- images
- short videos
- files where appropriate
- voice messages
- avatars

Media requirements include:

- file size limits
- MIME type validation
- server-side or trusted validation
- private storage
- authorization before retrieval
- unique object identifiers
- integrity checks where appropriate
- protection against cross-partnership access
- metadata sanitization where appropriate

Media should be compressed or optimized where practical to preserve free-tier infrastructure.

---

## 20. Voice Messages

Voice messaging should support:

- recording
- preview before sending
- sending
- playback
- duration display
- upload failure recovery
- cancellation before send

The first version should impose a sensible maximum duration and file size.

---

## 21. Notifications

The PWA should support web push notifications where browser support permits.

Notifications may include:

- new message
- partner request
- accepted partner request
- selected memory events

Notification content should respect privacy.

Sensitive message text should not appear on a lock screen by default unless the user explicitly chooses that behavior.

---

## 22. Offline and Unreliable Network Behavior

Shawtie pls should tolerate intermittent connectivity.

The client should support:

- cached application shell
- clear offline state
- safe pending-send behavior
- message retry
- duplicate prevention
- resynchronization after reconnect
- conflict-safe client state

The product should not pretend a message was delivered when only a local send was completed.

---

## 23. Memories and Shared Space

The long-term product may include relationship-focused modules such as:

### Our Story

A private timeline of meaningful shared moments.

### For You

Private letters or messages intended for the partner, potentially supporting future release conditions.

### Future Us

A shared time-capsule experience.

### Reasons

A private collection of things one person appreciates about the other.

### Remember This

Saved messages or moments from the conversation.

### This Day in Us

Historical memories surfaced by date.

### Places We Became Us

Private location-linked memories.

### Someday

Shared future ideas with states such as:

- Someday
- Soon
- We did it

### Our Firsts

Shared milestones.

These are later-stage features and must reuse the same partnership isolation guarantees as messaging.

---

## 24. Privacy

The system should minimize collection of personal information.

The first version should not require:

- phone number
- legal name
- contact book upload
- precise location
- government identity

Usernames and display names may be pseudonymous.

Analytics, if introduced, should be privacy-conscious and documented.

Private message content must never be used for advertising.

---

## 25. Security Requirements

Security is a core product requirement.

The application should include:

- secure password hashing
- secure session handling
- rate limiting
- authorization checks
- CSRF protection where applicable
- XSS defenses
- Content Security Policy
- secure dependency management
- private object storage
- input validation
- output encoding
- audit logging for security-sensitive operations
- dependency vulnerability monitoring
- regression tests for previously discovered security defects
- secret scanning
- branch protection
- secure CI configuration

Security-sensitive failures should default to denial rather than accidental access.

---

## 26. End-to-End Encryption

End-to-end encryption is a planned hard requirement before Shawtie pls is considered suitable for sensitive private communication at stable release.

The architecture must reserve clear boundaries for:

- identity keys
- device keys
- partnership cryptographic state
- session establishment
- message encryption
- attachment encryption
- key rotation
- device enrollment
- partnership termination
- future partnership creation

Cryptographic design should not be improvised.

A reviewed protocol or well-established construction should be preferred over custom cryptography.

The server should eventually be unable to read protected message content covered by E2EE.

---

## 27. New Partnership Security

Forming a new partnership must create new security context.

A future partner must not inherit:

- previous partnership message keys
- previous partnership attachment keys
- previous realtime authorization
- previous notification subscriptions
- previous local decryption state
- previous partnership caches

Partnership transition tests are mandatory before stable release.

---

## 28. Abuse and Safety

Although Shawtie pls is not a social network, public registration introduces abuse risks.

Controls should include:

- account rate limits
- registration rate limits
- partner-request rate limits
- username-change rate limits
- login rate limits
- request cancellation
- request decline
- blocking where needed
- reporting workflow before broad public launch
- server-side abuse controls

A user must never be forced to accept or remain in a partnership.

---

## 29. Moderation

The first version should minimize public content and public interaction.

This reduces moderation requirements.

Before wider public availability, the product should define procedures for:

- abusive usernames
- impersonation
- harassment through partner requests
- illegal content
- account compromise
- support requests
- abuse reports

E2EE will affect what content the service can technically inspect, so moderation design must account for this explicitly.

---

## 30. Data Retention

The product must define retention for:

- terminated partnerships
- messages
- deleted messages
- media
- account deletion
- security logs
- backups

Users should eventually be able to delete their account.

Account deletion must not accidentally transfer or expose partnership content.

Retention behavior must be documented before stable release.

---

## 31. PWA Requirements

The first client should:

- work responsively on phones, tablets, and desktops
- be installable where supported
- provide an application manifest
- use service workers safely
- handle upgrades without corrupting state
- provide an offline fallback
- support secure HTTPS deployment
- support push where available

Mobile-first design is required.

---

## 32. Accessibility

The application should target WCAG 2.1 AA or newer applicable guidance where practical.

Requirements include:

- keyboard navigation
- visible focus states
- semantic controls
- accessible names
- sufficient contrast
- screen-reader-friendly status updates
- reduced-motion support where appropriate
- accessible form validation

Accessibility should be tested rather than treated only as a design guideline.

---

## 33. Performance

The application should remain usable on mid-range mobile hardware and constrained connections.

Priorities include:

- small initial JavaScript payload
- lazy loading
- efficient image delivery
- media compression
- efficient realtime updates
- bounded local caches
- low unnecessary background activity

Performance budgets should be defined once representative screens exist.

---

## 34. Infrastructure Strategy

The initial architecture should prioritize a zero-dollar or near-zero-dollar student deployment.

Potential services include:

- Cloudflare for web hosting and edge functionality
- Supabase or Appwrite for selected backend services
- PostgreSQL for relational data
- Cloudflare R2 or equivalent object storage
- Web Push or FCM for notifications
- GitHub Actions for CI

The final provider selection may change.

Application architecture should avoid unnecessary provider lock-in.

---

## 35. Repository Architecture

The public repository follows this high-level structure:

```text
apps/
  web/
  api/

packages/
  domain/
  contracts/
  db/
  crypto/
  ui/
  testkit/

tests/
  e2e/
  integration/
  security/
  accessibility/
  performance/
  fixtures/synthetic/

infra/
scripts/
docs/
.github/
```

Architecture rules include:

- business rules belong in `packages/domain`
- API schemas belong in `packages/contracts`
- database definitions belong in `packages/db`
- cryptographic concerns belong in `packages/crypto`
- reusable UI belongs in `packages/ui`
- synthetic test helpers belong in `packages/testkit`
- no generic shared junk drawer
- no real-user fixtures
- no committed secrets
- no private worklog directory

---

## 36. Testing Strategy

The project should include:

### Unit tests

For pure domain logic and isolated modules.

### Integration tests

For API, database, storage, and cross-package behavior.

### Security regression tests

Mandatory tests should include:

- a user cannot access another partnership
- a user cannot create two simultaneous partnerships
- a user cannot bypass the cooldown through direct API calls
- a terminated partner cannot send new messages
- a new partner cannot access previous partnership messages
- attachment IDs cannot cross partnership boundaries
- realtime subscriptions cannot cross partnership boundaries
- unauthorized media retrieval fails
- expired sessions fail
- account changes correctly revoke affected sessions

### End-to-end tests

Critical user journeys should be tested in real browsers.

### Physical-device testing

Important mobile flows should be tested on physical Android hardware during development.

Native iOS testing may be introduced when native distribution becomes relevant.

---

## 37. Observability

Production-capable environments should support:

- structured logs
- request correlation
- error reporting
- security event logging
- health checks
- deployment version identification

Logs must not contain:

- passwords
- raw session tokens
- private cryptographic keys
- plaintext message bodies unless explicitly required for a temporary safe development scenario
- sensitive authentication headers

---

## 38. Success Criteria for MVP

The MVP is successful when two independent test accounts can:

1. Register.
2. Sign in.
3. Find one another by username.
4. Send and accept a partner request.
5. Become an active partnership.
6. Exchange text messages reliably.
7. Reconnect after losing network access.
8. Exchange supported media.
9. Receive notifications where supported.
10. End the partnership safely.
11. Be prevented from violating the one-active-partner rule.
12. Be prevented from violating the cooldown rule.
13. Demonstrate complete isolation from unrelated accounts and partnerships.

---

## 39. Stable Release Gates

The first stable release should not ship until the project has:

- secure authentication
- database-enforced partnership exclusivity
- robust authorization
- reliable realtime messaging
- safe media handling
- reliable offline recovery
- security regression coverage
- documented privacy policy
- documented account deletion behavior
- documented partnership termination behavior
- abuse controls appropriate for public registration
- dependency and secret scanning
- E2EE implemented and reviewed for protected communication
- partnership transition isolation verified
- production backup and recovery plan
- release-specific security review

---

## 40. Product Metrics

Early metrics should focus on reliability rather than engagement manipulation.

Potential metrics include:

- successful registrations
- successful partnership formations
- failed partnership formations by reason
- message send success rate
- message delivery latency
- reconnect success rate
- notification delivery success
- crash-free sessions
- failed media uploads
- account deletion completion
- security-related error rates

Private message content should not be collected for analytics.

---

## 41. Development Phases

### Phase 0: Foundation

- monorepo initialization
- TypeScript configuration
- linting
- formatting
- CI
- test framework
- environment handling
- database foundation
- security baseline

### Phase 1: Accounts

- registration
- login
- sessions
- username system
- account settings

### Phase 2: Partnerships

- username discovery
- partner requests
- one-partner invariant
- partnership creation
- three-month eligibility policy
- partnership termination

### Phase 3: Messaging

- conversation creation
- text messages
- realtime transport
- delivery state
- read state
- offline recovery

### Phase 4: Media and Notifications

- images
- voice
- selected file support
- private storage
- push notifications

### Phase 5: Product Experience

- responsive mobile-first interface
- PWA installation
- onboarding
- polish
- accessibility
- performance

### Phase 6: Shared Space

- memories
- saved moments
- relationship timeline
- future-oriented features

### Phase 7: E2EE

- formal design
- threat-model update
- protocol review
- implementation
- migration strategy
- security testing
- partnership lifecycle integration

### Phase 8: Public Readiness

- abuse controls
- privacy documentation
- account deletion
- support process
- production hardening
- final security review
- staged public launch

---

## 42. Open Product Decisions

The following decisions must be resolved during development:

1. Does a terminated partnership remain readable to the two original members?
2. Can a partnership be restored after accidental termination?
3. Exactly when does the three-month cooldown begin?
4. Should the cooldown be exactly 90 days or three calendar months?
5. Can a user change their username while partnered?
6. Can users block another account?
7. How long do pending partner requests remain valid?
8. Should a sender be able to cancel a request?
9. How should account recovery work without mandatory phone numbers?
10. What media types and size limits should be supported initially?
11. Should message deletion remove content only locally, for both users, or according to another policy?
12. How should historical partnership data behave after account deletion?
13. What data can remain server-visible after E2EE?
14. Which shared-space features belong in the first stable release?
15. Which infrastructure providers best satisfy cost, privacy, and portability requirements?

---

## 43. Naming and Product Language

Public product name:

**Shawtie pls**

Tagline:

**Your space for just the two of you.**

Internal technical language should use neutral and precise terms such as:

- account
- partner
- partner request
- partnership
- conversation
- member
- partnership eligibility
- partnership termination

Technical code and schemas should not use gender-specific relationship labels.

---

## 44. Core Product Invariant

The defining invariant of Shawtie pls is:

> An account can have at most one active partner, and every partnership is an isolated private space whose data can never leak into another partnership.

Any implementation that violates this invariant is considered incorrect regardless of whether the user interface appears to work.

---

## 45. Public Repository Rule

Every committed byte should be treated as permanently public.

The repository must never contain:

- real user credentials
- production secrets
- real private messages
- real relationship data
- private user media
- live administrative credentials
- private cryptographic material
- unredacted production database exports
- private operational notes that expose sensitive infrastructure

All examples, fixtures, screenshots, and seeded accounts must use synthetic data.

---

## 46. Current Product Status

The repository is currently in foundation design.

No implementation should be considered authoritative until the architecture, domain rules, and initial release plan are committed and reviewed.

This PRD defines the initial product direction and may evolve through explicit documented revisions as implementation proceeds.
