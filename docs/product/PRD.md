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
- unique verified email address
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

Each verified email address may be associated with only one Shawtie pls account.

The product rule is one person, one email, one account.

The backend must strictly enforce one account per verified email address.

Beyond the enforceable one-email-one-account rule, one-person-one-account is an account policy. Government ID verification is intentionally not required in the initial product because identity-document collection introduces significant privacy, legal, security, and operational obligations.

Display names are non-unique and may be changed without a long-term cooldown, subject to ordinary server-side abuse and spam rate limiting.

Partnership-scoped chat nicknames behave as shared conversation metadata similar to Messenger. When either partner changes a nickname, both partners see the updated nickname.

Chat nicknames may be changed freely while the partnership is active and may also be changed during `breakup_pending`.

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
- be 3 through 30 characters in the initial implementation
- normalize with NFKC before canonical comparison
- use lowercase ASCII letters, digits, period, and underscore in canonical form
- begin and end with an alphanumeric character
- reject consecutive period or underscore separators
- reject reserved system names
- be changeable no more than once per year after registration

The username selected during registration does not count as a username change.

After a successful username change, the backend must set or derive a value such as:

`nextUsernameChangeEligibleAt`

The next username change must not be permitted until one calendar year has elapsed from the previous successful username change.

Username-change eligibility must be enforced by the backend using trusted server time. Changing the client device clock must not affect eligibility.

Username changes are blocked while the account belongs to a partnership with status `active` or `breakup_pending`.

When a username change succeeds, the previous username is released immediately and may be claimed by any eligible account.

The previous owner has no reservation right over the released username. The previous owner may claim it again only if it is still available when that account is next eligible to change usernames after the one-year cooldown.

Before confirming a username change, the UI must explicitly tell the user that:

- the username cannot be changed again for one year
- the old username will become immediately available to other accounts

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

The email address is mandatory, must be unique across active accounts, and must be verified before registration is considered complete.

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
- unique-email validation
- email verification
- date-of-birth validation
- minimum age validation
- password policy validation
- rate limiting
- duplicate-account abuse controls where feasible
- acceptance of applicable terms and privacy policy before public launch

The three-month partner rule is enforced per account.

The product must not claim that the rule uniquely identifies a human across multiple accounts.

---

## 10. Authentication, Email Changes, and Account Recovery

Authentication must provide:

- passwords of at least 15 Unicode code points in the initial password-only implementation, with no composition rule and no silent truncation
- password support up to at least 128 Unicode code points subject to a defensive encoded-size limit
- Unicode passwords normalized with NFC before hashing
- secure Argon2id password hashing
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

Account authentication recovery and E2EE content-key recovery are separate security processes.

Verified-email recovery may restore account access, but it must not automatically grant decryption access to historical protected content.

Historical protected-content recovery must require a trusted existing device, a high-entropy cryptographic recovery secret, or another reviewed cryptographic recovery mechanism.

### Email address changes

The verified email address may be changed after registration.

Changing the email address requires:

- confirmation of the current account password or equivalent recent strong reauthentication
- entry of a new email address that is not already attached to another account
- verification of the new email address using a short-lived code sent to that new address
- expiration, attempt limits, replay protection, and rate limiting for the verification code
- notification to the previous verified email address after the change succeeds
- revocation of all other active sessions after the email change succeeds

The email change must not take effect until the new email address has been verified successfully.

Verified email changes remain allowed during `breakup_pending` because the account remains accessible in that state.

Verified email changes cannot occur during `account_deletion_pending` because account access is removed immediately when deletion is requested.

### Account deletion recovery

Account deletion uses a seven-day recovery period.

When account deletion is requested:

- access to the account is immediately removed from the account owner
- all active sessions for that account are revoked
- the account owner cannot message, send media, call, create relationship objects, modify shared data, change email, change profile information, or perform any other account action unless the account is recovered
- the seven-day recovery deadline is calculated using trusted server time
- the account may be recovered during the seven-day period through the defined recovery flow

If account deletion is requested from an active partnership:

- the partnership enters a distinct account-deletion-related state rather than `breakup_pending`
- the remaining partner retains view-only access to existing shared partnership data for the seven-day recovery period
- no new messages, media, calls, memories, relationship objects, or other shared data may be created
- the remaining partner cannot form or accept another partnership while the account-deletion recovery state is active
- the remaining partner is informed in-app, by push notification where available, and by email that the partner account entered deletion recovery

If the account is recovered before the deadline:

- the account regains access
- the partnership returns to exactly the state it had immediately before account deletion was requested unless a separate breakup deadline already caused final dissolution
- existing shared data remains intact unless a separate breakup deadline already caused final dissolution
- no cooldown is created solely because account deletion was requested and cancelled

If the seven-day recovery period expires without recovery while the partnership was active:

- the account is permanently deleted
- all partnership-scoped shared data associated with that partnership is permanently deleted
- the remaining partner is informed in-app, by push notification where available, and by email that the partner account was permanently deleted
- the remaining partner enters a one-calendar-month partnership cooldown starting at the permanent account-deletion timestamp
- eligibility returns at the same clock minute one calendar month later using trusted server-side calendar-month arithmetic

After permanent account deletion, the deleted email address is released and may be used to register a new account, subject to normal registration and verification rules.

### Account deletion requested during breakup_pending

If account deletion is requested while the partnership is already `breakup_pending`, the existing breakup countdown continues and is not reset or extended.

If the account is recovered before the breakup deadline:

- account access is restored
- the original breakup remains in progress
- the original breakup deadline remains unchanged
- any prior restoration intent remains governed by the normal breakup rules

If the breakup deadline arrives before the seven-day account-deletion recovery deadline:

- the breakup deadline controls final dissolution of the partnership
- all partnership-scoped shared data is permanently deleted at the breakup deadline
- the normal breakup email reminders and final notices are still sent
- the remaining partner may receive a reminder such as `Your breakup will be executed in 2 days` when that timing applies
- the account-deletion recovery process for the deleting account continues independently until recovery or its own seven-day deadline
- recovering the account after the partnership has already reached final dissolution does not restore the deleted partnership or its deleted shared data
- the normal three-calendar-month breakup cooldown applies because dissolution occurred through the breakup lifecycle

Future support may include:

- passkeys
- recovery codes
- trusted device management
- two-factor authentication

---

## 11. Partner Discovery

Users search for another account using a username.

Search results may expose:

- username
- display name
- avatar if enabled
- short bio if provided
- current age
- an opaque account identifier used only by the authenticated client as request-targeting transport metadata

Age must be derived from the stored date of birth using trusted server date logic. The date of birth itself must not be exposed in search results.

The system must not expose:

- email address
- exact date of birth
- active session information
- previous partners
- partnership history
- last known IP address
- private profile metadata

A block must remove the blocker from the blocked former partner's normal username search results.

---

## 12. Partner Requests

A user who is eligible may send a partner request to another eligible user.

A partner request has a lifecycle such as:

- pending
- accepted
- declined
- cancelled
- expired

A pending partner request expires exactly seven days after creation if it has not been accepted, declined, or cancelled. The request is considered expired at that exact server-time deadline even if background cleanup persists the terminal status later.

A sender may cancel a pending request at any time before acceptance.

A user may send no more than three partner requests to the same account within any rolling one-month period. The rolling boundary uses trusted server calendar arithmetic; a request created at exactly the one-month cutoff no longer counts, while newer successfully sent requests do count even if they were later cancelled, declined, expired, or invalidated.

If a recipient declines a partner request, the sender must wait exactly one hour before sending another request to that same account. At the exact one-hour server-time boundary, a new request may be sent if every other eligibility rule passes. A later request still counts toward the three-requests-per-month limit.

Declining a request does not automatically block the sender.

An unpartnered user may have multiple incoming pending partner requests at the same time.

When one pending request is accepted and a partnership is created, all other pending incoming and outgoing partner requests that are no longer compatible with the one-partner invariant must be invalidated.

If two eligible users have pending partner requests to each other at the same time, the mutual requests constitute explicit consent from both sides and the partnership is created automatically.

The backend must reject requests when:

- the sender already has an active or breakup-pending partner
- the recipient already has an active or breakup-pending partner
- the sender is ineligible due to cooldown
- the recipient is ineligible due to cooldown
- the sender is within the one-hour post-decline cooldown for that recipient
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
- manually entered relationship start date
- status
- breakup initiation timestamp where applicable
- breakup initiator account ID where applicable
- restoration intent from each member where applicable
- breakup deadline
- final dissolution timestamp where applicable
- account-deletion state metadata where applicable
- security lifecycle metadata

A partnership may include states such as:

- pending
- active
- breakup_pending
- account_deletion_pending
- terminated

An account may belong to at most one partnership that is active, breakup_pending, or account_deletion_pending.

A breakup-pending or account-deletion-pending partnership still occupies the one-partner slot.

This must be enforced transactionally at the database level in addition to domain and API checks.

A new partnership always requires consent from both accounts.

### Relationship start date

The relationship start date is separate from the in-app partnership activation date.

The relationship start date must be manually entered rather than automatically copied from the partnership activation timestamp.

The relationship start date must be a calendar date that is today or earlier. Future relationship start dates are not permitted.

Either partner may update the relationship start date without approval from the other partner while the partnership state allows edits.

When the relationship start date is changed, the other partner must be notified.

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
- the interface identifies which partner initiated the breakup
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

Blocking is not available while the partnership is `breakup_pending`.

Scheduled For You letters and Future Us content continue to unlock or arrive according to their existing schedule during `breakup_pending`. Their scheduled release is not treated as creation of new shared content.

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
- emoji message reactions during active partnership state
- shared partnership-scoped chat nicknames
- reconnection after temporary network loss

Read receipts are always enabled and cannot be disabled.

Typing indicators are always enabled and cannot be disabled.

Online status and last-seen information are shown and cannot be hidden.

During an active partnership, a sent message may be edited for up to 30 minutes after its original server timestamp. Edited messages must display an `edited` indicator.

During an active partnership, message deletion removes the original message content for both partners and leaves a durable placeholder such as:

`This message has been deleted`

The placeholder must not reveal the deleted content.

Message reactions are part of the MVP during active partnership state.

The fixed default reaction template is `❤️ 😂 😭 😮 😡 👍`. The reaction interface must also provide an add-emoji action so a user can choose another supported emoji.

Partnership chat nicknames are shared metadata. A nickname change made by either partner is visible to both partners.

Chat nicknames may be changed during active partnership state and during `breakup_pending`, including after either partner has submitted a restoration intent.

During `breakup_pending`, new messages and replies remain allowed, but pre-existing messages become read-only. They may be viewed and replied to, but they may not be edited, deleted, reacted to, or otherwise modified.

Nickname changes during `breakup_pending` are permitted as a specific exception to the general freeze on pre-existing message and relationship-object modification.

Any messages created during `breakup_pending` are still partnership data and are permanently deleted if the partnership reaches final dissolution.

Future capabilities may include:

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
- call history

Call history should record:

- voice or video call type
- incoming or outgoing direction
- start time
- end time or duration where applicable
- missed-call state
- partnership context

Call-history records are partnership-scoped data and must follow the same final-dissolution deletion rules as other partnership data.

During an active partnership, normal call initiation and acceptance rules apply.

During `breakup_pending`, every call requires explicit consent from both partners. A media session must not begin unless one partner initiates the call and the other partner explicitly accepts it.

Calls must never silently auto-answer.

Call signaling and media authorization must respect partnership state and membership.

### Call recording

Built-in call recording is not part of the MVP or first stable release.

Call recording is a deferred post-stable feature. It must not be scheduled merely because the stable release has shipped. The product should first gather post-stable evidence about real call usage, storage growth, bandwidth cost, deletion and backup-expiry cost, and user demand.

Implementation is optional and should proceed only if that evidence justifies the feature.

Any future built-in call recording must require explicit consent from both participants for every recording session before recording begins.

After both participants consent, a recording is treated as partnership-scoped media:

- both partners may access it
- it follows partnership authorization rules
- it must be protected by the final E2EE media model
- it is deleted under normal user-facing deletion rules where applicable
- it is permanently deleted at final dissolution
- it is permanently deleted when permanent account deletion removes the partnership data

Before any future implementation, the team must first select and document a viable recording model and receive separate privacy, legal, security, retention, export, consent, storage-cost, bandwidth-cost, deletion, and backup-expiry review.

---

## 21. Notifications

The PWA should support web push notifications where browser support permits.

Notifications may include:

- new message
- incoming voice or video call
- partner request
- accepted partner request
- declined partner request
- breakup initiation
- breakup deadline reminders
- restoration request
- partnership restoration
- account-deletion initiation
- account recovery
- permanent account deletion
- final dissolution
- relationship start-date changes
- selected memory events

Message previews are shown by default.

Users must have a setting to hide message content in notification previews.

When previews are hidden, notifications should use privacy-preserving generic text instead of message content.

Serious account and partnership events must also generate email notifications. This includes at minimum:

- breakup initiation
- breakup deadline reminders
- restoration request
- partnership restoration
- account-deletion initiation
- permanent account deletion
- final dissolution
- verified email-address changes

Serious-event emails must remain minimal. They should identify the event, any important deadline, and the minimum account or partnership context necessary to understand the notice.

Serious-event emails must not include private message content, media content, relationship-object content, or unnecessary sensitive profile details.

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

While a partnership is `breakup_pending`, existing relationship objects and shared-space content are view-only. Scheduled For You letters and Future Us items still unlock or arrive at their scheduled time. If the partnership is restored, normal write access returns. If the partnership reaches final dissolution, all relationship-space content, including scheduled content that unlocked during `breakup_pending`, is permanently deleted.

Relationship-duration experiences must use the manually entered relationship start date rather than the in-app partnership activation date.

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
- centralized server-authoritative capability evaluation
- first-class device records and revocation
- strict browser execution policy for the PWA
- no third-party advertising scripts in the trusted application origin
- no arbitrary remote JavaScript in the trusted application origin
- explicit client, API, crypto, and local-schema compatibility versions
- short-lived TURN credentials
- durable deletion manifests for cross-system deletion
- generation checks on lifecycle-sensitive scheduled jobs

Security-sensitive failures should default to denial rather than accidental access.

The initial architecture should not depend on Redis. PostgreSQL remains the authoritative durable coordination layer unless measured production requirements justify another state system.

---

## 26. End-to-End Encryption

End-to-end encryption is a hard requirement before Shawtie pls is considered suitable for sensitive private communication at stable release.

The architecture must reserve clear boundaries for:

- identity keys
- device keys
- partnership cryptographic state
- session establishment
- message encryption
- attachment encryption
- relationship-object encryption
- reaction and reply metadata where practical
- key rotation
- device enrollment
- partnership termination
- future partnership creation
- call media encryption
- device revocation
- cryptographic recovery separate from account recovery
- partnership cryptographic epochs
- crypto protocol versioning

Cryptographic design must not be improvised.

A reviewed protocol or well-established construction must be preferred over custom cryptography.

### Server-visible metadata policy

The server should retain only the metadata required to route, deliver, synchronize, secure, and operate the service.

Server-visible data may include where technically required:

- account and device routing identifiers
- opaque partnership and conversation identifiers
- server receipt timestamps
- delivery and synchronization state
- ciphertext sizes
- encrypted attachment object identifiers and storage sizes
- push-routing tokens and delivery state
- online presence, typing, and read-receipt routing state
- call signaling and call-session state
- limited security and abuse-prevention metadata

The server must not receive plaintext versions of protected content, including:

- message bodies
- image, video, file, and voice-message contents
- relationship-object contents
- For You letters
- Future Us contents
- memory captions or private notes
- call audio or video media
- call recordings if the deferred post-stable recording feature is ever implemented

Metadata such as filenames, captions, attachment MIME types, reaction content, and other descriptive fields should be encrypted when practical rather than exposed merely for convenience.

Typing indicators, presence, read receipts, and similar transient state should use the minimum retention necessary for delivery and synchronization.

Security logs must avoid storing private content and should use bounded retention appropriate to abuse prevention and operational security.

Voice and video call media must use end-to-end media encryption appropriate to the selected calling architecture. Relay infrastructure may necessarily observe network-level connection metadata, but it must not receive plaintext call media.

The product must document unavoidable metadata exposure honestly rather than describing E2EE as metadata anonymity.

Every partnership must have a cryptographic context that is isolated from every prior or future partnership.

Within a partnership, explicit cryptographic epochs may be used for reviewed key rotation, device revocation, and protocol migration.

Email account recovery alone must never be sufficient to decrypt historical E2EE content.

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
- one-hour cooldown after a declined request before another request to the same account
- username-change rate limits
- login rate limits
- request cancellation
- request decline
- blocking for former partners after final dissolution
- reporting workflow before broad public launch
- server-side abuse controls

Blocking is not available while a partnership is active or `breakup_pending`.

After final dissolution, either former partner may block the other.

A block may be created during the three-month cooldown or at any later time and remains effective unless the blocking account removes it.

When one former partner blocks the other:

- the blocked account must not be able to discover the blocker through normal username search
- the blocked account must not be able to send a partner request to the blocker
- the two accounts must not be able to form a future partnership while the block exists

Blocking does not alter or shorten the completed breakup lifecycle and does not restore deleted content.

Declining a partner request does not automatically create a block.

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
- call history
- memories
- Future Us content
- scheduled content that unlocked during `breakup_pending`
- saved moments
- relationship timeline objects
- all other partnership-scoped shared content

The production backup and recovery design must document how deletion propagates through backups and disaster-recovery copies. Backup retention must not silently recreate a terminated partnership or make deleted content accessible through normal product functionality.

### Account deletion retention

Account deletion uses a separate seven-day recovery period.

During that period, the deleting account has no access to the product. When deletion was initiated from an active partnership, the remaining partner has view-only access to existing shared data and cannot create new shared data.

If the account is recovered during the seven-day period, the prior account and partnership state is restored exactly.

If the account is permanently deleted after the recovery period, all partnership-scoped shared data is permanently deleted and the remaining partner is notified. If the partnership was active when deletion was requested, the remaining partner enters a one-calendar-month cooldown. The deleted account's email address becomes available for a new registration after permanent deletion.

If account deletion is requested while a partnership is already `breakup_pending`, the breakup countdown continues independently and is not reset.

The product must separately define retention for:

- security logs
- abuse-prevention records
- audit events that do not contain deleted private content
- legally required minimal records where applicable

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

The initial architecture is a modular monolith with a separate durable worker.

The runtime consists of:

- React and TypeScript PWA
- Fastify and TypeScript API
- separate durable worker process
- PostgreSQL as the authoritative transactional state store
- private object storage for encrypted media
- WebSocket realtime transport
- WebRTC for voice and video calls
- TURN relay infrastructure for call privacy and restrictive-network fallback
- transactional outbox for reliable side effects
- PostgreSQL-backed scheduled actions for lifecycle deadlines and retries
- reviewed E2EE implementation for protected content before stable release
- centralized domain capability engine
- first-class device model
- account recovery separated from cryptographic recovery
- per-partnership cryptographic epochs
- append-only lifecycle event ledger
- generation-checked lifecycle jobs
- durable deletion manifests
- explicit version compatibility checks

Microservices are intentionally not required for the initial architecture.

Partnership lifecycle operations require strong transactional consistency. Keeping account, request, partnership, cooldown, messaging metadata, and lifecycle logic within one transactional backend avoids unnecessary distributed failure modes.

The API should remain stateless between requests except for database-backed state and explicitly ephemeral connection state.

The durable worker owns:

- breakup deadlines
- breakup reminders
- partner-request expiry
- account-deletion finalization
- email delivery
- push delivery
- deletion and object-purge orchestration
- transactional outbox processing
- retryable maintenance jobs
- deletion manifest processing
- stale-job rejection through generation checks

Product deadlines must never depend only on in-memory timers.

PostgreSQL is authoritative for lifecycle and eligibility decisions.

Provider selection may change. The architecture should avoid unnecessary provider lock-in.

Static TURN credentials must not be embedded in the client. TURN access must use short-lived credentials issued after authenticated call authorization.

Redis is intentionally excluded from the initial architecture. It may be added only if measured production needs justify the additional state system.

The initial deployment should prioritize zero-dollar or near-zero-dollar operation where practical, but privacy and correctness take priority over remaining permanently free.

Potential infrastructure categories include:

- static or edge PWA hosting
- managed or self-hosted PostgreSQL
- private object storage
- email delivery provider
- Web Push or compatible push infrastructure
- TURN relay service or self-hosted TURN
- GitHub Actions for CI

---

## 35. Repository Architecture

The public repository follows this high-level structure:

```text
apps/
  web/
  api/
  worker/

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

- business rules and state transitions belong in `packages/domain`
- API and realtime schemas belong in `packages/contracts`
- database schema, migrations, transaction helpers, and persistence adapters belong in `packages/db`
- cryptographic abstractions belong in `packages/crypto`
- reusable presentation components belong in `packages/ui`
- synthetic test helpers belong in `packages/testkit`
- the worker is a first-class application and not an in-process timer collection
- PostgreSQL is the authoritative source for lifecycle state
- database constraints must protect the one-partnership invariant
- important writes create transactional outbox events in the same database transaction
- deadlines and retries use durable scheduled-action records
- WebSockets are a realtime synchronization mechanism, not the sole source of truth
- local data is partitioned by account, partnership, conversation, and cryptographic context
- every new partnership receives a new security and local-storage namespace
- lifecycle permissions are derived from a centralized capability engine
- sensitive lifecycle transitions append non-content lifecycle events
- scheduled lifecycle actions carry generation or version checks
- cross-system deletion uses durable deletion manifests
- account devices are first-class security principals
- account recovery does not automatically imply E2EE history recovery
- client, API, crypto protocol, and local schema versions are explicit
- two-account transactions use deterministic account-lock ordering
- media is encrypted client-side before upload once stable-release E2EE is active
- no generic shared junk drawer
- no real-user fixtures
- no committed secrets
- no private worklog directory

Canonical architecture documents live in `docs/architecture`, `docs/security`, and `docs/testing`.

The architecture must preserve provider portability. Domain rules must not depend directly on hosting, email, storage, push, or TURN provider SDKs.

---

## 36. Testing Strategy

The project should include:

### Unit tests

For pure domain logic and isolated modules.

### Integration tests

For API, database, storage, calling, email, and cross-package behavior.

### Security regression tests

Mandatory tests should include:

- a user younger than 18 cannot complete registration
- age eligibility cannot be bypassed by changing the client device clock
- registration cannot complete without a unique verified email address
- one verified email address cannot create two active accounts
- email verification codes expire and cannot be replayed
- changing the verified email requires recent reauthentication
- a new email address does not become active until its verification code succeeds
- a successful email change notifies the old email address and revokes other sessions
- verified email changes remain available during breakup_pending
- no account changes are possible during account_deletion_pending because access is revoked
- a username cannot be changed again before one calendar year has elapsed from the previous successful change
- username changes are rejected during active and breakup_pending partnership states
- a released username can be claimed by another eligible account immediately
- a previous username owner cannot reclaim that username during the one-year username-change cooldown
- a user can correct their date of birth once after registration
- a second self-service date-of-birth correction is rejected
- a date-of-birth correction that would make the account ineligible under the 18+ rule is rejected without consuming the correction allowance
- search results expose age but never exact date of birth or email
- a future relationship start date is rejected
- a relationship start-date change notifies the other partner
- a user cannot access another partnership
- a user cannot create two simultaneous partnerships
- partner requests expire after seven days
- a sender can cancel a pending partner request
- more than three requests to the same account within one rolling month are rejected
- a declined request creates a one-hour same-recipient request cooldown
- declining a request does not block the sender
- multiple incoming requests can coexist before partnership creation
- accepting one request invalidates incompatible pending requests
- mutual pending requests automatically create a partnership
- blocking is rejected during active and breakup_pending states
- blocking after final dissolution prevents search discovery, partner requests, and future re-pairing
- a user cannot bypass the three-month cooldown through direct API calls
- breakup initiation places both users into breakup_pending
- the UI identifies the breakup initiator
- breakup_pending users cannot form another partnership
- the breakup initiator can cancel unilaterally during the first hour
- unilateral breakup cancellation is rejected after the one-hour window expires
- initiator cancellation restores the partnership without starting a cooldown
- both users can continue messaging and sending supported media during the reconsideration period
- calls during breakup_pending require explicit consent from both partners
- past messages are visible and repliable during breakup_pending
- past messages cannot be edited, deleted, reacted to, or otherwise modified during breakup_pending
- shared chat nicknames can still be changed during breakup_pending even after a restoration intent exists
- relationship objects are view-only during breakup_pending
- scheduled For You and Future Us content still unlocks at the scheduled time during breakup_pending
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
- final dissolution deletes partnership messages, media, call history, and relationship objects, including content created or unlocked during breakup_pending
- the three-calendar-month cooldown begins only at final dissolution
- cooldown eligibility is calculated to the same clock minute using calendar-month arithmetic
- a new partnership requires fresh explicit consent
- a new partner cannot access previous partnership data
- message deletion leaves a deletion placeholder visible to both partners
- message editing is rejected after 30 minutes
- edited messages display an edited indicator
- the default reaction tray is `❤️ 😂 😭 😮 😡 👍` and an add-emoji path is available
- message reactions work during active state and are blocked on pre-existing messages during breakup_pending
- read receipts cannot be disabled
- typing indicators cannot be disabled
- online and last-seen visibility cannot be disabled
- account deletion immediately revokes the deleting account's sessions and access
- active-partnership account deletion gives the remaining partner view-only access for the recovery period
- the remaining partner cannot form or accept another partnership during account-deletion recovery
- no new shared data can be created during active-partnership account-deletion recovery
- cancelling account deletion restores the exact previous account and partnership state when no earlier breakup deadline already dissolved it
- if the account is recovered during breakup_pending, the original breakup deadline remains unchanged
- if a breakup deadline occurs before account-deletion recovery ends, final dissolution and shared-data deletion happen at the breakup deadline
- breakup reminders and final notices are still sent while account deletion is pending
- recovering an account after an earlier breakup dissolution does not restore deleted partnership data
- permanent deletion from an active partnership starts a one-calendar-month cooldown for the remaining partner
- the deleted email address becomes reusable only after permanent deletion
- permanent account deletion removes all remaining partnership-scoped shared data
- serious breakup and account-deletion events generate minimal email notifications
- E2EE prevents the server from reading protected message, media, relationship-object, and call-media content
- server-visible E2EE metadata is limited to operationally necessary routing, delivery, synchronization, calling, and security data
- future consensual call recordings follow partnership-media authorization and dissolution deletion rules
- attachment IDs cannot cross partnership boundaries
- realtime subscriptions cannot cross partnership boundaries
- unauthorized media retrieval fails
- expired sessions fail
- account changes correctly revoke affected sessions
- capability decisions match route enforcement across lifecycle states
- a stale scheduled action with an old generation cannot mutate newer partnership state
- sensitive lifecycle transitions append the expected non-content lifecycle event
- deletion manifests remain safe and resumable after partial failure
- email-only recovery does not expose historical E2EE plaintext
- revoking a device revokes both authentication and cryptographic authorization
- crypto epoch changes do not leak old active key state
- incompatible client or crypto protocol versions fail closed
- TURN credentials are short-lived and cannot be reused indefinitely

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
2. Verify a unique mandatory registration email through a code.
3. Sign in and recover account access through the verified email.
4. Change the verified email during normal and breakup_pending access only after reauthentication and successful code verification of the new address.
5. Find one another by username and see the allowed public profile information, including age.
6. Send, cancel, expire, decline, and rate-limit partner requests correctly.
7. Enforce a one-hour same-recipient cooldown after a declined request.
8. Support multiple incoming requests and automatically invalidate incompatible requests after partnership creation.
9. Automatically create a partnership from mutual pending requests.
10. Become an active partnership only with consent from both accounts.
11. Store a manually entered relationship start date separate from partnership activation date and reject future dates.
12. Notify the other partner when the relationship start date changes.
13. Exchange text messages reliably.
14. Edit a message for up to 30 minutes with an edited indicator.
15. Delete a message for both users while leaving a deletion placeholder.
16. Use the default reaction tray `❤️ 😂 😭 😮 😡 👍` with an option to add another supported emoji.
17. Use shared Messenger-style chat nicknames visible to both partners.
18. Allow chat nickname changes during active and breakup_pending states, including after restoration intent.
19. Use always-on read receipts, typing indicators, online status, and last seen.
20. Reconnect after losing network access.
21. Exchange supported images, videos, files, and voice messages within configured limits.
22. Make and receive voice and video calls and maintain call history.
23. Receive notifications with previews shown by default and optionally hidden.
24. Receive minimal email notifications for serious breakup, account, and email-change events.
25. Use the full relationship-space feature set defined in this PRD.
26. Allow either partner to initiate breakup and clearly identify the initiator.
27. Allow the breakup initiator to cancel directly during the first hour only.
28. Continue messaging, replying, and sending supported media during the reconsideration period.
29. Require explicit consent from both partners for each call during the reconsideration period.
30. Keep pre-existing messages read-only except for replies during the reconsideration period.
31. Restrict relationship objects to view-only during the reconsideration period.
32. Continue scheduled For You and Future Us releases during the reconsideration period.
33. Prevent blocking during active and breakup_pending partnership states.
34. Prevent a submitted restoration intent from being withdrawn.
35. Show the requester that restoration is waiting and notify the other partner who requested it.
36. Restore the partnership only after both partners explicitly select restore once the one-hour cancellation window has expired.
37. Extend the breakup deadline by three days when exactly one partner selects restore.
38. Reach final dissolution at the correct deadline when mutual restoration does not occur.
39. Permanently delete all partnership content, including call history and content created or unlocked during breakup_pending, at final dissolution.
40. Start the exact three-calendar-month cooldown at breakup final dissolution.
41. Calculate cooldown expiry to the same clock minute using trusted server time.
42. Allow former partners to block each other after final dissolution and enforce that block across search, requests, and future pairing.
43. Prevent either former partner from forming another partnership during cooldown.
44. Allow a future partnership after cooldown only through fresh consent.
45. Immediately remove account access when account deletion is requested.
46. Give the remaining active partner seven days of view-only shared-data access during account-deletion recovery.
47. Prevent the remaining partner from forming or accepting another partnership while account-deletion recovery is active.
48. Restore the exact prior state if account deletion is cancelled before any earlier breakup deadline has dissolved the partnership.
49. Preserve the original breakup deadline if an account is recovered while breakup_pending.
50. If breakup final dissolution occurs first, delete shared data at that earlier breakup deadline and continue the account-deletion recovery process separately.
51. Continue sending breakup deadline emails while account deletion is pending.
52. If permanent account deletion ends an active partnership, delete the shared data and start a one-calendar-month cooldown for the remaining partner.
53. Release the deleted account's email address for new registration after the seven-day recovery period ends in permanent deletion.
54. Be prevented from violating the one-active-partner rule.
55. Demonstrate complete isolation from unrelated accounts and partnerships.

---

## 39. Stable Release Gates

The first stable release should not ship until the project has:

- server-enforced 18+ registration eligibility
- mandatory unique verified-email registration
- verified-email password recovery
- secure verified-email change flow
- verified-email changes allowed during breakup_pending
- no account mutation access during account_deletion_pending
- old-email notification after successful email change
- session revocation after successful email change
- one-account-per-verified-email enforcement
- documented one-person-one-account policy without mandatory government ID verification
- server-enforced one-year username-change eligibility
- username-change blocking during active and breakup_pending states
- immediate old-username release behavior
- server-enforced one-time date-of-birth correction
- secure authentication
- database-enforced partnership exclusivity
- manual relationship start-date support with future-date rejection
- relationship start-date change notifications
- seven-day partner-request expiry
- three-requests-per-recipient monthly limit
- one-hour post-decline same-recipient cooldown
- mutual-request automatic partnership creation
- former-partner blocking only after final dissolution
- server-enforced breakup reconsideration lifecycle
- visible breakup initiator
- one-hour initiator cancellation window
- mutual-consent partnership restoration
- immutable submitted restoration intent
- breakup-period call consent enforcement
- breakup-period message mutation restrictions
- breakup-period nickname changes even after restoration intent
- scheduled relationship-content release during breakup_pending
- tested final-dissolution deletion semantics
- breakup deadline precedence over a later account-deletion recovery deadline
- original breakup deadline preservation after account recovery
- breakup reminder emails even when account deletion is pending
- exact three-calendar-month breakup cooldown calculation
- fresh explicit consent for every new partnership
- seven-day account-deletion recovery state
- immediate access revocation on account-deletion request
- view-only shared-data recovery period for the remaining partner
- partnership ineligibility for the remaining partner during account-deletion recovery
- one-calendar-month cooldown after permanent account deletion ends an active partnership
- deleted-email release after permanent account deletion
- exact-state restoration after account recovery when partnership data has not already been dissolved
- robust authorization
- reliable realtime messaging
- 30-minute message editing
- deletion placeholders
- default reaction set `❤️ 😂 😭 😮 😡 👍` plus add-emoji support
- shared chat nicknames
- always-on read receipts and typing indicators
- always-visible online and last-seen state
- safe media handling
- voice and video calling
- partnership-scoped call history
- configurable notification preview privacy
- minimal email notifications for serious partnership and account events
- full relationship-space feature set defined in this PRD
- reliable offline recovery
- security regression coverage
- documented privacy policy
- documented account deletion behavior
- documented partnership termination behavior
- abuse controls appropriate for public registration
- dependency and secret scanning
- reviewed E2EE for protected messages, media, relationship objects, and call media
- documented E2EE metadata exposure and metadata-minimization policy
- partnership transition isolation verified
- centralized capability model verified
- device enrollment and revocation model verified
- account recovery and cryptographic recovery separation verified
- cryptographic epoch behavior verified
- deletion manifest workflow verified
- lifecycle generation checks verified
- PWA trusted-origin script policy verified
- explicit version compatibility policy verified
- short-lived TURN credential flow verified
- production backup and recovery plan
- formal threat model reviewed against implemented architecture
- data-classification matrix reviewed against implemented storage, logging, providers, and deletion behavior
- release-specific security review

Built-in call recording is explicitly excluded from the first stable release and remains pending post-release design.

Any future built-in call recording must require explicit consent from both participants for every recording session and must follow partnership-media access and deletion rules.

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

These phases describe intended product and engineering sequence, not current implementation status.

Current verified implementation state is tracked in `docs/PROJECT_STATE.md`. Epic status and acceptance gates are tracked in `docs/ROADMAP_EPICS.md`.

A phase item appearing below does not imply that it has been implemented.

### Phase 0: Foundation

- monorepo initialization
- TypeScript configuration
- linting
- formatting
- CI
- test framework
- environment handling
- PostgreSQL foundation
- database invariants
- durable worker foundation
- transactional outbox
- scheduled-action framework
- runtime contract validation
- security baseline
- local partnership-isolation boundary
- centralized capability engine
- deterministic two-account transaction helper
- lifecycle event ledger
- scheduled-action generation checks
- deletion manifest framework
- explicit compatibility versioning
- strict trusted-origin browser execution policy

### Phase 1: Accounts

- registration
- mandatory unique email verification by code
- one-account-per-verified-email enforcement
- one-person-one-account policy
- server-enforced 18+ eligibility
- login
- verified-email password recovery
- secure verified-email change flow
- email change during breakup_pending
- deleted-email release after permanent account deletion
- sessions
- username system
- one-year username-change eligibility
- immediate old-username release
- username-change state restrictions
- one-time post-registration date-of-birth correction
- display-name behavior
- seven-day account-deletion recovery
- immediate access revocation during deletion recovery
- breakup and deletion timer precedence
- one-month post-deletion cooldown for the remaining active partner
- account device model
- device management and revocation
- separation of account recovery from cryptographic recovery
- account settings

### Phase 2: Partnerships

- username discovery with age and allowed profile fields
- seven-day partner-request lifecycle
- request cancellation
- one-hour post-decline same-recipient cooldown
- three-requests-per-recipient monthly limit
- multiple incoming requests
- mutual-request automatic pairing
- one-partner invariant
- partnership creation
- explicit partner consent
- manual relationship start date
- relationship start-date change notifications
- breakup initiation with initiator visibility
- one-hour initiator cancellation window
- seven-day reconsideration period
- breakup-period messaging and call rules
- no blocking during active or breakup_pending states
- irreversible restoration intent
- one-click three-day extension
- mutual-consent restoration
- final dissolution and destructive cleanup
- former-partner blocking after final dissolution
- exact three-calendar-month post-dissolution eligibility policy

### Phase 3: Messaging

- conversation creation
- text messages
- replies
- 30-minute editing
- deletion placeholders
- default reactions `❤️ 😂 😭 😮 😡 👍`
- add-emoji reaction support
- shared partnership chat nicknames
- breakup-period nickname changes including after restoration intent
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
- short-lived TURN credentials
- relay-first TURN privacy
- call history
- push notifications
- serious-event email notifications
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
- metadata-minimization model
- device cryptographic identity
- cryptographic recovery
- partnership crypto epochs
- crypto protocol versioning
- message and relationship-content encryption
- attachment encryption
- call-media encryption
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

The core product and lifecycle rules required for initial architecture are now sufficiently defined.

Remaining decisions are implementation-level or post-release design decisions and do not block the initial domain and database architecture:

1. Which infrastructure providers best satisfy cost, privacy, voice and video calling, email delivery, and portability requirements?
2. What exact reviewed E2EE protocol and key-management design will be adopted?
3. What exact retention periods should apply to bounded security and abuse-prevention metadata?
4. For the post-release call-recording feature, what export formats and optional user-facing deletion controls should be offered in addition to mandatory partnership-lifecycle deletion?
5. Which specific emoji picker implementation and supported Unicode range should back the add-emoji reaction action?

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

The repository has completed the verified F0, F1, F2, and A1 milestones. A1 Accounts and Devices is DONE at 20/20 acceptance gates.

Architecture Baseline 1.0 remains frozen and governed through accepted ADRs and architecture change control.

The verified A1 surface includes migration 0007, account domain rules and contracts, password/session/device/challenge/rate-limit persistence, Fastify authentication and account APIs, account deletion/recovery workers, security-email workers, the expanded A1 verification suites, a Docker-backed A1 PostgreSQL harness, a runnable API server, and the mobile-first account/device web foundation.

A1 verification is complete: all seven migrations apply from zero, database invariants pass, the disposable PostgreSQL acceptance suite passes 27/27, the A1 security suite passes 16/16, the full repository health regression passes, the high-severity dependency audit reports 0 vulnerabilities, and all 20 A1 acceptance gates are closed.

The pure partnership domain state machine and centralized capability engine remain locally verified. Baseline CI and repository-health tooling are configured, while GitHub-hosted CI validation remains pending under V1.

This PRD defines intended product behavior. It is not the implementation-progress source of truth.

Current verified implementation state is tracked in `docs/PROJECT_STATE.md`, and epic completion is governed by `docs/ROADMAP_EPICS.md`.

This PRD may evolve through explicit documented product revisions as implementation proceeds.
