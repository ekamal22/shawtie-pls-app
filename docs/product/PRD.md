# Shawtie pls Product Requirements Document

**Product name:** Shawtie pls  
**Tagline:** Your space for just the two of you.  
**Repository:** `shawtie-pls-app`  
**Document status:** Draft v0.2  
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
- verified email address
- date of birth
- password credential or supported authentication credential
- account creation timestamp
- account status
- partnership eligibility state
- age eligibility state
- username-change eligibility state
- date-of-birth correction state
- account-deletion recovery state
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
- be changeable no more than once per year after registration

The username selected during registration does not count as a username change.

After a successful username change, the backend must set or derive a value such as:

`nextUsernameChangeEligibleAt`

The next username change must not be permitted until one calendar year has elapsed from the previous successful username change.

Username-change eligibility must be enforced by the backend using trusted server time. Changing the client device clock must not affect eligibility.

Username changes are blocked while the account belongs to a partnership with status `active` or `breakup_pending`.

Before confirming a username change, the UI must explicitly tell the user that they will not be able to change their username again for one year.

The first version should support username search by exact or normalized match.

Broad public user enumeration should be avoided.

Future fuzzy search may be considered only with appropriate privacy protections.

---

## 9. Registration

A user must be able to register without a phone number.

Initial registration requires:

- username
- display name
- date of birth
- email address
- password

The email address is mandatory and must be verified before registration is considered complete.

Email verification must use a short-lived verification code sent to the supplied email address. The backend must enforce code expiration, attempt limits, replay protection, and rate limiting.

A user must be at least 18 years old to register.

Age eligibility must be enforced by the backend using simple calendar-date arithmetic with trusted server time.

The authoritative rule is:

`currentServerDate >= dateOfBirth + 18 calendar years`

Equivalently, a user is eligible only when:

`dateOfBirth <= currentServerDate - 18 calendar years`

A calculation based only on `currentYear - birthYear` must not be used because it can incorrectly accept a user before their eighteenth birthday has occurred in the current year.

The frontend may perform the same calculation for immediate feedback, but the backend remains authoritative. Changing the client device clock must not affect age eligibility.

Users younger than 18 must not be allowed to complete account creation.

Date of birth is self-declared in the initial product. Government ID or other identity-document verification is not required.

During registration, the UI must explicitly tell the user that their date of birth can be corrected through self-service only one time after registration.

After registration, a user may change their date of birth through self-service exactly one time.

The initial date of birth entered during registration does not count as that one correction.

Before confirming the correction, the UI must explicitly tell the user that:

- this is their only self-service date-of-birth correction after registration
- after confirmation, they will not be able to change their date of birth again through normal account settings
- the corrected date of birth must still satisfy the minimum age requirement

The backend must track whether the one allowed correction has already been used, using a field or equivalent state such as:

`dateOfBirthCorrectedAt`

A second self-service date-of-birth change must be rejected by the backend even if a client attempts to bypass the UI.

Any corrected date of birth that would make the account ineligible under the 18+ requirement must be rejected. The existing date of birth remains unchanged and the one allowed correction must not be consumed by the rejected attempt.

Registration must include:

- username availability validation
- email validation
- email verification
- date-of-birth validation
- minimum age validation
- password policy validation
- rate limiting
- duplicate account protection where feasible
- abuse controls
- acceptance of applicable terms and privacy policy before public launch

The three-month partner rule is enforced per account.

The product must not claim that the rule uniquely identifies a human across multiple accounts.

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
- verified-email-based password recovery

Password recovery must use the verified email address associated with the account.

Account deletion must use a seven-day recovery period.

When account deletion is requested from an active partnership, the account enters `account_deletion_pending` for seven days and the partnership enters a separate account-deletion-related partnership state rather than `breakup_pending`.

During the seven-day account-deletion recovery period, the user may cancel account deletion and recover the account.

If account deletion is requested while the partnership is already `breakup_pending`, the existing breakup countdown continues according to its existing seven-day or ten-day deadline.

The exact messaging, media, call, and relationship-object permissions during `account_deletion_pending` remain a product decision that must be resolved before implementation.

Future support may include:

- passkeys
- recovery codes
- trusted device management
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

A pending partner request expires exactly seven days after creation if it has not been accepted, declined, or cancelled.

A sender may cancel a pending request at any time before acceptance.

A user may send no more than three partner requests to the same account within any rolling one-month period.

An unpartnered user may have multiple incoming pending partner requests at the same time.

When one pending request is accepted and a partnership is created, all other pending incoming and outgoing partner requests that are no longer compatible with the one-partner invariant must be invalidated.

If two eligible users have pending partner requests to each other at the same time, the mutual requests constitute explicit consent from both sides and the partnership is created automatically.

The backend must reject requests when:

- the sender already has an active or breakup-pending partner
- the recipient already has an active or breakup-pending partner
- the sender is ineligible due to cooldown
- the recipient is ineligible due to cooldown
- the request targets the sender's own account
- the same-direction equivalent request already exists
- the sender has reached the three-requests-per-month limit for that recipient
- either account has blocked the other
- abuse or safety controls block the action

A partnership can never be created without consent from both accounts.

For a normal one-way request, the recipient must explicitly accept the request before a partnership becomes active.

Mutual pending requests count as explicit consent from both accounts and therefore create the partnership automatically.

Silence, inactivity, a previous partnership, or a previous acceptance must never count as consent for a new partnership.

---

## 13. Partnership Model

A partnership is a first-class domain entity.

A partnership should contain at minimum:

- partnership ID
- member account IDs
- creation timestamp
- activation timestamp
- status
- breakup initiation timestamp where applicable
- breakup initiator account ID where applicable
- restoration intent from each member where applicable
- breakup deadline
- final dissolution timestamp where applicable
- security lifecycle metadata

A partnership may be:

- pending
- active
- breakup_pending
- terminated

An account may belong to at most one partnership that is active or breakup_pending.

A breakup-pending partnership still occupies the user's one-partner slot.

This must be enforced transactionally at the database level in addition to domain and API checks.

A new partnership always requires the explicit consent of the invited user.

---

## 14. Three-Month Partner Rule

The rule is:

> After a partnership reaches final dissolution, each former partner must wait exactly three calendar months before forming another partnership.

The cooldown includes weekends, holidays, non-working days, and every other calendar day without exception.

Eligibility returns at the same clock minute exactly three calendar months after the trusted server-side final dissolution timestamp.

The backend must calculate the eligibility timestamp using calendar-month arithmetic rather than a fixed 90-day approximation.

If the corresponding calendar day does not exist in the target month, the eligibility timestamp uses the final valid day of that target month at the same clock minute.

The new partner may be the same former partner or a different eligible user.

The server should store or derive a value such as:

`nextPartnerEligibleAt`

The cooldown starts only when the breakup process reaches final dissolution.

Starting a breakup does not start the three-month cooldown.

If the partnership is restored during the change-your-mind period, no cooldown is created because the partnership never reached final dissolution.

Eligibility must be evaluated using trusted server time.

Changing a client device clock must have no effect.

During the cooldown:

- the user cannot form a new partnership
- the user cannot bypass the restriction through direct API calls
- the user cannot maintain a second active or breakup-pending partnership
- any future partnership still requires the other person's explicit consent

The three-month duration is a product rule and must not be duplicated as independent client-side policy.

---

## 15. Partnership Breakup, Reconsideration, Restoration, and Final Dissolution

Either member may initiate a breakup unilaterally.

Breakup initiation must be an explicit server-side operation.

Immediately after breakup initiation:

- the partnership enters `breakup_pending`
- both partners are clearly notified that the breakup process has started
- both partners are informed of the change-your-mind period and its deadline
- the partnership still occupies both users' one-partner slot
- both partners may continue sending and receiving messages during the reconsideration period
- both partners may continue sending supported media during the reconsideration period
- calls remain available only through explicit consent from both partners for each call
- existing memories and other relationship objects become view-only
- creation, editing, and deletion of relationship objects are disabled unless a later product rule explicitly allows an exception
- neither partner may form or accept another partnership

The initial reconsideration period lasts seven days from the trusted server-side breakup initiation timestamp.

### One-hour initiator cancellation window

For the first one hour after breakup initiation, the partner who initiated the breakup may cancel the breakup directly without requiring the other partner to select restore.

The one-hour window is measured using trusted server time and expires exactly one hour after the breakup initiation timestamp.

If the initiator cancels within this one-hour window:

- the partnership immediately returns to `active`
- the other partner is notified
- no restoration intent is required from the other partner
- no three-day extension is created
- no partnership data is deleted
- no three-month cooldown begins

After the one-hour window expires, the initiator can no longer cancel the breakup unilaterally. Restoration then requires explicit consent from both partners.

### Restoration intent

During the reconsideration period, each partner is shown a restore-partnership action.

After the one-hour initiator cancellation window has expired, restoration requires explicit consent from both partners.

A restoration intent is final for the current breakup process. Once a partner selects restore, that partner cannot withdraw the restoration intent.

If neither partner selects restore:

- the original seven-day deadline remains in effect

If exactly one partner selects restore before the original seven-day deadline:

- that partner's restoration intent is recorded
- the other partner is notified
- the final deadline becomes ten days from the original breakup initiation timestamp
- this is a single three-day extension, not a renewable extension
- the first partner's click does not restore the partnership by itself

If both partners select restore before the applicable deadline:

- the partnership returns to `active`
- the breakup process is cancelled
- relationship objects become writable again
- messaging and media continue as part of the same partnership
- normal call behavior returns
- no partnership data is deleted
- no three-month cooldown begins
- both restoration intents and the restoration event should be auditable

A partner may not create repeated extensions by clicking restore multiple times.

### Messaging and calls during breakup_pending

New messages may continue to be sent during the reconsideration period.

Past messages are read-only except that either partner may reply to them.

During `breakup_pending`, past messages cannot be:

- edited
- deleted
- reacted to
- otherwise modified

Replies to past messages are treated as new messages and remain allowed.

Supported images, videos, files, and voice messages may continue to be sent during the reconsideration period.

Calls may continue during `breakup_pending`, but every call requires explicit consent from both partners. A call media session must not begin unless one partner initiates the call and the other partner explicitly accepts it.

### Final dissolution

The partnership reaches final dissolution when:

- seven days pass after breakup initiation and neither partner has selected restore, or
- ten days pass after breakup initiation after exactly one partner selected restore, and the other partner still has not selected restore

At final dissolution:

- the partnership becomes `terminated`
- both users are notified
- new messages to that partnership are permanently rejected
- realtime authorization for the partnership is revoked
- future push delivery for the partnership stops
- all messages are permanently deleted
- all images, videos, files, voice messages, and other partnership media are permanently deleted
- all memories and relationship objects are permanently deleted
- Future Us content and other shared-space content are permanently deleted
- partnership-specific cryptographic material follows the defined secure destruction lifecycle
- partnership-specific local caches and authorization state must be invalidated
- deleted data must never be attached to a future partnership
- the exact three-calendar-month new-partnership cooldown begins for both former partners

Final dissolution is irreversible through normal product functionality.

After the cooldown expires, either former partner may form a partnership with the same person again or with another eligible user, but every new partnership requires fresh explicit consent and receives a new partnership security context.

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
- replying to messages
- message timestamps
- stable message IDs
- optimistic UI where safe
- retry behavior
- idempotency
- message ordering
- delivery state
- always-on read receipts
- always-on typing indicators
- online status and last-seen information
- reconnection after temporary network loss

Read receipts are always enabled and cannot be disabled.

Typing indicators are always enabled and cannot be disabled.

Online status and last-seen information are shown and cannot be hidden.

During an active partnership, a sent message may be edited for up to 30 minutes after its original server timestamp. Edited messages must display an `edited` indicator.

During an active partnership, message deletion removes the original message content for both partners and leaves a durable placeholder such as:

`This message has been deleted`

The placeholder must not reveal the deleted content.

During `breakup_pending`, new messages and replies remain allowed, but pre-existing messages become read-only. They may be viewed and replied to, but they may not be edited, deleted, reacted to, or otherwise modified.

Any messages created during `breakup_pending` are still partnership data and are permanently deleted if the partnership reaches final dissolution.

Future capabilities may include:

- reactions during active partnership state
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

The product should support:

- images
- short videos
- general file attachments where permitted
- voice messages
- avatars

Recommended initial MVP limits are:

- images: maximum 10 MB per source image, with client-side resizing and compression targeting approximately 2 MB or less when practical
- image dimensions: maximum 4096 pixels on the longest side after processing unless preserving the original is explicitly required
- short videos: maximum 50 MB and maximum 2 minutes per video
- general files: maximum 25 MB per file
- voice messages: maximum 10 minutes and maximum 15 MB
- avatars: maximum 5 MB before processing
- attachments: maximum 10 attachments in one message

These values are intended to keep the first public deployment practical on free or low-cost infrastructure while remaining useful on mobile networks. They may later be changed through server-controlled policy without changing the core product model.

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

Media should be compressed or optimized where practical to preserve infrastructure capacity.

Media created during `breakup_pending` is part of the same partnership data and is permanently deleted if final dissolution occurs.

---

## 20. Voice Messages and Calls

### Voice messages

Voice messaging should support:

- recording
- preview before sending
- sending
- playback
- duration display
- upload failure recovery
- cancellation before send

The initial maximum duration is 10 minutes and the initial maximum stored upload size is 15 MB.

### Voice and video calls

Voice calls and video calls are part of the MVP.

Calls must support:

- voice-only calling
- video calling
- incoming call notification
- explicit call acceptance
- call rejection
- call cancellation before connection
- call end
- clear connection state
- safe handling of network interruption

During an active partnership, normal call initiation and acceptance rules apply.

During `breakup_pending`, every call requires explicit consent from both partners. A media session must not begin unless one partner initiates the call and the other partner explicitly accepts it.

Calls must never silently auto-answer.

Call signaling and media authorization must respect partnership state and membership.

---

## 21. Notifications

The PWA should support web push notifications where browser support permits.

Notifications may include:

- new message
- incoming voice or video call
- partner request
- accepted partner request
- breakup initiation
- restoration request
- partnership restoration
- final dissolution
- selected memory events

Message previews are shown by default.

Users must have a setting to hide message content in notification previews.

When previews are hidden, notifications should use privacy-preserving generic text instead of message content.

Notification content must respect partnership state and privacy settings.

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

The first stable product should preserve the full relationship-space feature set established by the original Shawtie-pls product direction.

### Relationship Home

The app should provide a dedicated private `Us` or equivalent relationship home separate from the main chat surface.

It may include a relationship-duration display based only on user-provided relationship data.

### Our Story

A curated chronological timeline of meaningful shared moments.

### Remember This

A deliberate way to preserve a meaningful message or moment as a relationship object without depending on the continued existence of the original chat message.

### Firsts

A user-created collection of meaningful first experiences and milestones.

### Places We Became Us

A private collection of meaningful places with optional dates, notes, photos, and memories. Passive or background location tracking is not required.

### For You

Private letters or messages intended for the partner, including immediate, date-based, or condition-labelled opening experiences.

### Voice Letters

Preserved voice experiences attached to For You, Future Us, or other intentional relationship objects rather than ordinary chat voice notes.

### Future Us

Shared time capsules and future-oriented content that can be created now and opened later.

### Love

A private collection for affectionate observations such as reasons, things noticed, and things remembered.

### Someday

Shared future ideas with lifecycle states:

- Someday
- Soon
- We did it

### This Day in Us

Occasional resurfacing of meaningful prior memories, messages, or photos by date.

### Our Year

A curated annual relationship recap centered on memories and meaningful moments rather than engagement scoring.

### Anniversary Experience

A special private experience built from curated memories, photos, saved messages, letters, and voice letters.

### Surprise Mode

A private multi-step reveal that can combine letters, photos, memories, voice recordings, and a final reveal.

### Until We're Together Again

An optional manually set reunion date with calm language and prepared content. It must not require location surveillance.

### Proposal Mode

A private experience that can prepare an emotional sequence leading into an in-person proposal. The app must not replace the real-life proposal with a gamified yes-or-no mechanic.

### Relationship Signals

Explicit, user-triggered relationship signals may include:

- I need you
- Call me when you can
- I need reassurance
- a deliberately shared temporary mood or feeling
- thinking of you
- kiss
- hug

These must be explicit user actions and must not be inferred from behavioral signals.

### Private relationship feed

The relationship home may contain a deterministic chronological private feed of relationship events and objects. It must not use public-social engagement mechanics, follower graphs, popularity scores, algorithmic ranking, streak pressure, or advertising incentives.

While a partnership is `breakup_pending`, existing relationship objects and shared-space content are view-only. If the partnership is restored, normal write access returns. If the partnership reaches final dissolution, all relationship-space content, including content created during `breakup_pending`, is permanently deleted.

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

Forming a new partnership must create a completely new security context.

A future partnership, including a future partnership between the same two people, must not inherit:

- previous partnership message keys
- previous partnership attachment keys
- previous realtime authorization
- previous notification subscriptions
- previous local decryption state
- previous partnership caches
- previous partnership identifiers as authorization authority
- previous restoration state

Final dissolution must sever authorization to the old partnership before either former partner can eventually form another partnership.

Partnership transition and breakup lifecycle tests are mandatory before stable release.

---

## 28. Abuse and Safety

Although Shawtie pls is not a social network, public registration introduces abuse risks.

Controls should include:

- account rate limits
- registration rate limits
- partner-request rate limits
- maximum three partner requests to the same account within a rolling one-month period
- username-change rate limits
- login rate limits
- request cancellation
- request decline
- blocking for former partners
- reporting workflow before broad public launch
- server-side abuse controls

Blocking is available only after a breakup has been initiated between the two accounts.

A block may be created during the breakup process or after final dissolution and remains effective before, during, and after the three-month cooldown unless the blocking user later removes it.

When one former partner blocks the other:

- the blocked account must not be able to discover the blocker through normal username search
- the blocked account must not be able to send a partner request to the blocker
- the two accounts must not be able to form a future partnership while the block exists

Blocking does not override the breakup countdown or erase content earlier than the final dissolution rules require.

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

Final dissolution has destructive product semantics.

When the breakup deadline expires without mutual restoration, all user-facing partnership content must be permanently deleted, including:

- messages created before breakup initiation
- messages created during `breakup_pending`
- media created before or during `breakup_pending`
- voice messages
- memories
- Future Us content
- saved moments
- relationship timeline objects
- all other partnership-scoped shared content

The production backup and recovery design must document how deletion propagates through backups and disaster-recovery copies. Backup retention must not silently recreate a terminated partnership or make deleted content accessible through normal product functionality.

Account deletion uses a separate seven-day recovery period.

If account deletion is requested while a partnership is already `breakup_pending`, the breakup countdown continues independently.

The product must separately define retention for:

- account records
- security logs
- abuse-prevention records
- audit events that do not contain deleted private content
- completed account deletion

Account deletion must not accidentally transfer or expose partnership content.

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

- a user younger than 18 cannot complete registration
- age eligibility cannot be bypassed by changing the client device clock
- registration cannot complete without a verified email address
- email verification codes expire and cannot be replayed
- a username cannot be changed again before one calendar year has elapsed from the previous successful change
- username changes are rejected during active and breakup_pending partnership states
- a user can correct their date of birth once after registration
- a second self-service date-of-birth correction is rejected
- a date-of-birth correction that would make the account ineligible under the 18+ rule is rejected without consuming the correction allowance
- a user cannot access another partnership
- a user cannot create two simultaneous partnerships
- partner requests expire after seven days
- a sender can cancel a pending partner request
- more than three requests to the same account within one rolling month are rejected
- multiple incoming requests can coexist before partnership creation
- accepting one request invalidates incompatible pending requests
- mutual pending requests automatically create a partnership
- a block prevents search discovery, partner requests, and future re-pairing
- a user cannot bypass the three-month cooldown through direct API calls
- breakup initiation places both users into breakup_pending
- breakup_pending users cannot form another partnership
- the breakup initiator can cancel unilaterally during the first hour
- unilateral breakup cancellation is rejected after the one-hour window expires
- initiator cancellation restores the partnership without starting a cooldown
- both users can continue messaging and sending supported media during the reconsideration period
- calls during breakup_pending require explicit consent from both partners
- past messages are visible and repliable during breakup_pending
- past messages cannot be edited, deleted, reacted to, or otherwise modified during breakup_pending
- relationship objects are view-only during breakup_pending
- a restoration intent cannot be withdrawn once submitted
- one restore click extends the deadline from seven days to ten days exactly once
- the waiting partner can see that restoration is pending
- the other partner is notified of who requested restoration
- one restore click never restores the partnership by itself
- two restore clicks restore the same partnership before the applicable deadline
- restoration prevents deletion and does not start the three-month cooldown
- no restore intent causes final dissolution at seven days
- exactly one restore intent causes final dissolution at ten days if the other partner does not consent
- final dissolution permanently rejects new messages to the old partnership
- final dissolution deletes partnership messages, media, and relationship objects, including content created during breakup_pending
- the three-calendar-month cooldown begins only at final dissolution
- cooldown eligibility is calculated to the same clock minute using calendar-month arithmetic
- a new partnership requires fresh explicit consent
- a new partner cannot access previous partnership messages
- message deletion leaves a deletion placeholder visible to both partners
- message editing is rejected after 30 minutes
- edited messages display an edited indicator
- read receipts cannot be disabled
- typing indicators cannot be disabled
- online and last-seen visibility cannot be disabled
- account deletion enters a seven-day recovery state
- breakup countdown continues if account deletion is requested during breakup_pending
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

The MVP is successful when two independent eligible adult test accounts can:

1. Register only after passing the server-side minimum-age check.
2. Verify the mandatory registration email through a code.
3. Sign in and recover account access through the verified email.
4. Find one another by username.
5. Send, cancel, expire, and rate-limit partner requests correctly.
6. Support multiple incoming requests and automatically invalidate incompatible requests after partnership creation.
7. Automatically create a partnership from mutual pending requests.
8. Become an active partnership only with consent from both accounts.
9. Exchange text messages reliably.
10. Edit a message for up to 30 minutes with an edited indicator.
11. Delete a message for both users while leaving a deletion placeholder.
12. Use always-on read receipts, typing indicators, online status, and last seen.
13. Reconnect after losing network access.
14. Exchange supported images, videos, files, and voice messages within configured limits.
15. Make and receive voice and video calls.
16. Receive notifications with previews shown by default and optionally hidden.
17. Use the full relationship-space feature set defined in this PRD.
18. Allow either partner to initiate breakup.
19. Allow the breakup initiator to cancel directly during the first hour only.
20. Continue messaging, replying, and sending supported media during the reconsideration period.
21. Require explicit consent from both partners for each call during the reconsideration period.
22. Keep pre-existing messages read-only except for replies during the reconsideration period.
23. Restrict relationship objects to view-only during the reconsideration period.
24. Prevent a submitted restoration intent from being withdrawn.
25. Show the requester that restoration is waiting and notify the other partner who requested it.
26. Restore the partnership only after both partners explicitly select restore once the one-hour cancellation window has expired.
27. Extend the breakup deadline by three days when exactly one partner selects restore.
28. Reach final dissolution at the correct deadline when mutual restoration does not occur.
29. Permanently delete all partnership content, including content created during breakup_pending, at final dissolution.
30. Start the exact three-calendar-month cooldown at final dissolution.
31. Calculate cooldown expiry to the same clock minute using trusted server time.
32. Allow former partners to block each other after breakup initiation and enforce that block across search, requests, and future pairing.
33. Prevent either former partner from forming another partnership during cooldown.
34. Allow a future partnership after cooldown only through fresh consent.
35. Enter a seven-day account-deletion recovery state when account deletion is requested.
36. Continue an existing breakup countdown if account deletion is requested during breakup_pending.
37. Be prevented from violating the one-active-partner rule.
38. Demonstrate complete isolation from unrelated accounts and partnerships.

---

## 39. Stable Release Gates

The first stable release should not ship until the project has:

- server-enforced 18+ registration eligibility
- mandatory verified-email registration
- verified-email password recovery
- server-enforced one-year username-change eligibility
- username-change blocking during active and breakup_pending states
- server-enforced one-time date-of-birth correction
- secure authentication
- database-enforced partnership exclusivity
- seven-day partner-request expiry
- three-requests-per-recipient monthly limit
- mutual-request automatic partnership creation
- former-partner blocking
- server-enforced breakup reconsideration lifecycle
- one-hour initiator cancellation window
- mutual-consent partnership restoration
- immutable submitted restoration intent
- breakup-period call consent enforcement
- breakup-period message mutation restrictions
- tested final-dissolution deletion semantics
- exact three-calendar-month cooldown calculation
- fresh explicit consent for every new partnership
- seven-day account-deletion recovery state
- robust authorization
- reliable realtime messaging
- 30-minute message editing
- deletion placeholders
- always-on read receipts and typing indicators
- always-visible online and last-seen state
- safe media handling
- voice and video calling
- configurable notification preview privacy
- full relationship-space feature set defined in this PRD
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
- mandatory email verification by code
- server-enforced 18+ eligibility
- login
- verified-email password recovery
- sessions
- username system
- one-year username-change eligibility
- username-change state restrictions
- one-time post-registration date-of-birth correction
- seven-day account-deletion recovery
- account settings

### Phase 2: Partnerships

- username discovery
- seven-day partner-request lifecycle
- request cancellation
- three-requests-per-recipient monthly limit
- multiple incoming requests
- mutual-request automatic pairing
- one-partner invariant
- partnership creation
- explicit partner consent
- former-partner blocking
- breakup initiation
- one-hour initiator cancellation window
- seven-day reconsideration period
- breakup-period messaging and call rules
- irreversible restoration intent
- one-click three-day extension
- mutual-consent restoration
- final dissolution and destructive cleanup
- exact three-calendar-month post-dissolution eligibility policy

### Phase 3: Messaging

- conversation creation
- text messages
- replies
- 30-minute editing
- deletion placeholders
- realtime transport
- delivery state
- always-on read receipts
- always-on typing indicators
- online and last-seen state
- offline recovery

### Phase 4: Media and Notifications

- images
- short videos
- voice messages
- selected file support
- private storage
- voice calls
- video calls
- push notifications
- notification preview settings

### Phase 5: Product Experience

- responsive mobile-first interface
- PWA installation
- onboarding
- polish
- accessibility
- performance

### Phase 6: Shared Space

- Relationship Home
- Our Story
- Remember This
- Firsts
- Places We Became Us
- For You
- Voice Letters
- Future Us
- Love
- Someday
- This Day in Us
- Our Year
- Anniversary Experience
- Surprise Mode
- Until We're Together Again
- Proposal Mode
- relationship signals

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

1. During `account_deletion_pending`, can the user continue messaging, sending media, calling, and viewing or changing relationship objects?
2. When the seven-day account-deletion recovery period expires for an actively partnered account, what exact partnership transition and data-deletion behavior occurs?
3. Should the app explicitly show which partner initiated a breakup?
4. Should breakup initiation, restoration requests, account-deletion state, and final dissolution also trigger email notifications in addition to in-app and push notifications?
5. What exact profile fields are visible in username search results before partnership, such as username, display name, avatar, or bio?
6. When a username is changed, how long should the old username remain reserved before another account can claim it?
7. Should display-name changes be unrestricted or rate-limited?
8. Can one person create and operate multiple Shawtie pls accounts?
9. Should active-partnership message reactions be included in MVP, and if so, which reaction model should be supported?
10. What data can remain server-visible after E2EE?
11. Which infrastructure providers best satisfy cost, privacy, calling, and portability requirements?

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
