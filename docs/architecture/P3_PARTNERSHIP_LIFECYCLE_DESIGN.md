# P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns Architecture and Implementation Design

## Status

HARDENED DESIGN, P3-A THROUGH P3-H SOURCE IMPLEMENTED, CLOSURE VERIFICATION PENDING

Design branch:

~~~text
feat/p3-partnership-lifecycle
~~~

Branch base:

~~~text
main @ 04b5229
~~~

Effective design date: 2026-09-21.

This document is the canonical implementation design for P3 Partnership Lifecycle, Breakup, Deletion, and Cooldowns.

P3 preserves Architecture Baseline 1.0 and the verified P2 transaction, occupancy, metadata-version, notification, and partnership-ID namespace boundaries. It reuses the F2 worker, scheduled-action, lifecycle-ledger, outbox, and deletion-manifest substrate and the verified A1 account-deletion authority.

No new distributed service, cache, lock service, trust boundary, or provider is introduced. No ADR is required because the design implements already accepted ADR-007 durable deletion manifests and ADR-008 lifecycle generation guards without changing their architectural decisions.

Source code and executed tests remain authoritative for runtime behavior. This document defines the implementation target and closure evidence.

## Design goals

P3 must make partnership lifecycle transitions correct even when API requests, account deletion, worker deadlines, retries, and later feature modules race.

The primary goals are:

- one authoritative breakup process per partnership
- exact one-hour unilateral cancellation boundary
- exact seven-day and ten-day breakup deadlines
- irreversible restoration intent
- one and only one three-day extension
- mutual restoration of the same partnership
- stale worker fencing
- exact breakup and account-deletion deadline precedence
- synchronous authorization revocation before asynchronous deletion
- exact calendar-month cooldown persistence
- former-partner blocking only after final dissolution
- durable serious-event in-app and email notices
- no duplicate lifecycle authority
- no weakening of P2 partnership isolation or one-partner occupancy

## Existing verified substrate

P3 starts from verified runtime rather than designing from an empty repository.

### F2 substrate

P3 reuses:

- PostgreSQL READ COMMITTED authoritative transactions
- bounded whole-transaction retry
- trusted PostgreSQL business time
- deterministic account locking
- scheduled actions with payload versions
- claim leases and claim-version fencing
- expected-generation stale-job protection
- append-only partnership lifecycle events
- transactional outbox
- deletion manifests and resumable deletion targets
- disposable PostgreSQL test infrastructure

### A1 substrate

A1 already owns:

- account deletion request
- immediate account access revocation
- session revocation
- exact seven-day account recovery deadline
- account recovery
- account-deletion generation
- account-deletion finalizer
- breakup versus account-deletion deadline precedence fallback
- permanent account authentication cleanup
- security email delivery infrastructure

P3 must integrate with this authority. It must not create a second account-deletion state machine.

### P1 substrate

P1 already enforces active blocks in:

- username discovery
- partner-request creation

It also exposes pending-request invalidation with reason:

~~~text
block_created
~~~

P3 creates and removes former-partner blocks. P1 remains the discovery and request enforcement owner.

### P2 substrate

P2 already owns:

- explicit and reciprocal partnership formation
- deterministic pair locking
- database-backed one-partner occupancy
- current partnership read
- relationship-start-date metadata
- durable account notifications
- metadata versioning
- account-deletion view-only detection
- fresh partnership-ID namespace

P3 preserves the P2 rule:

~~~text
partnership.version = mutable partnership metadata version
partnership.generation = lifecycle generation
~~~

A relationship-date edit increments metadata version only.

A lifecycle transition increments lifecycle generation only.

P3 must not turn lifecycle transitions into metadata-version changes.

## Refinement findings before runtime implementation

The pre-implementation review found several important integration issues that P3 must resolve deliberately.

### Breakup cancellation lacks a persisted terminal state

The existing breakup table has:

- restored_at
- dissolved_at

but no correct field for a one-hour unilateral cancellation.

Using restored_at for cancellation would be semantically false, while leaving both fields null would leave the process covered by the open-process unique index forever.

P3 migration 0010 therefore adds:

~~~text
cancelled_at
superseded_at
~~~

cancelled_at means the breakup was cancelled by the initiator during the one-hour window.

superseded_at means another destructive lifecycle, currently permanent partner-account deletion, terminated the partnership before that breakup process reached its own final deadline.

### Restoration timing needs runtime refinement

The product requirement says mutual restoration occurs after the one-hour unilateral cancellation window has expired.

The existing pure helper does not yet reject restore intent inside that first hour.

P3-A will refine the domain rule:

~~~text
now < initiator_cancel_until
  -> restore intent rejected with RESTORE_WINDOW_NOT_OPEN

now >= initiator_cancel_until
and now < final_deadline
  -> restore intent may be submitted
~~~

At the exact one-hour boundary:

- unilateral cancellation is no longer allowed
- restoration intent becomes allowed

This removes overlap and avoids hidden timer-driven restoration behavior.

### Breakup deadlines must use breakup-process generation

Account deletion has a separate lifecycle generation and may coexist with an existing breakup.

A breakup finalizer must therefore be fenced by the current breakup process generation, not by an unrelated account-deletion generation and not by mutable partnership metadata version.

Scheduled breakup work uses:

~~~text
aggregate_type = breakup_process
aggregate_id = breakup_process.id
expected_generation = breakup_process.generation
~~~

The first restoration intent increments the breakup generation when it extends the deadline.

Cancellation, restoration, or process supersession makes previously scheduled work stale.

### Account deletion already has a partnership termination path

A1 contains fallback partnership-finalization logic for permanent account deletion and earlier-breakup precedence.

P3 must not add a second competing implementation.

P3 introduces one canonical partnership-dissolution kernel and refactors both:

- P3 breakup finalization
- A1 account-deletion partnership finalization

to use that same kernel.

The legacy A1 breakup-precedence scheduled handler remains registered for compatibility with already persisted actions, but new P3-capable account deletion does not need to schedule a second breakup finalizer. If an older precedence action and the P3 breakup finalizer both exist, both converge through the same idempotent dissolution kernel.

### Partnership deletion manifests are not yet created by the account-deletion termination path

The current A1 permanent-deletion path creates an account deletion manifest, but the shared partnership needs its own deletion manifest when the partnership is destroyed.

The canonical P3 dissolution kernel creates the partnership-scoped deletion manifest in the same authoritative transaction that revokes partnership authorization.

### Expired eligibility rows can remain open

account_partner_eligibility uses a unique open row per account.

A past cooldown can remain unresolved even after eligible_at has passed. P2 correctly allows formation after the timestamp, but a later breakup could then fail to insert the next cooldown because the old row is still structurally open.

P3 closes this gap with explicit cooldown hygiene:

1. under the account lock, resolve any open eligibility row whose eligible_at is at or before trusted now
2. successful partnership formation resolves expired prior cooldown rows for both accounts
3. creation of a new cooldown first resolves expired rows
4. an overlapping active cooldown at a point where a new partnership is already occupied is treated as an invariant violation, not silently ignored

## P3 ownership boundary

P3 owns:

- breakup initiation
- breakup cancellation
- restoration intent
- mutual restoration
- breakup deadline reminders
- breakup finalization
- canonical partnership dissolution
- partnership-scoped deletion manifest creation
- breakup cooldown persistence
- account-deletion partnership-dissolution integration
- former-partner block creation and removal
- former-partnership safety-history read model
- durable lifecycle notifications
- serious lifecycle email orchestration
- P3 browser lifecycle controls
- P3 API, database, worker, race, and security verification

P3 does not own:

- account authentication deletion or recovery mechanics
- partner discovery implementation
- partner request implementation
- partnership formation
- messaging runtime
- relationship-space runtime
- media provider implementation
- realtime transport
- push provider delivery
- E2EE protocol design

Later modules consume P3 lifecycle authority.

## State model

P3 continues the existing orthogonal state model.

### Partnership lifecycle

~~~text
active
breakup_pending
terminated
~~~

### Account state

~~~text
active
deletion_pending
deleted
~~~

### Effective interaction mode

Derived server-side:

~~~text
normal
breakup_restricted
account_deletion_view_only
none
~~~

The account-deletion overlay is not a fourth partnership lifecycle enum.

This prevents state explosion and preserves the current schema.

## Lifecycle generation rules

P3 makes generation rules explicit.

### Metadata mutation

Relationship-start-date mutation:

- increments partnership.version
- does not increment partnership.generation

### Breakup initiation

- lifecycle active -> breakup_pending
- partnership.generation increments by one
- new breakup_process.generation equals the new lifecycle generation
- partnership.version is unchanged

### First restoration intent

- lifecycle remains breakup_pending
- final deadline changes from day 7 to day 10
- partnership.generation increments by one
- breakup_process.generation increments to the same new value
- partnership.version is unchanged

### Second restoration intent

- lifecycle breakup_pending -> active
- partnership.generation increments by one
- breakup process receives restored_at
- partnership.version is unchanged

### One-hour cancellation

- lifecycle breakup_pending -> active
- partnership.generation increments by one
- breakup process receives cancelled_at
- partnership.version is unchanged

### Final dissolution

- lifecycle breakup_pending or active-with-permanent-partner-deletion -> terminated
- partnership.generation increments by one
- partnership.version is unchanged
- current membership slots are released synchronously

Account deletion uses its own account_deletion_requests.generation for its scheduled account finalizer.

## Lock order

All P3 transactions involving a partnership use the same global order established by P2.

~~~text
1. immutable member account rows in sorted UUID order
2. partnership row
3. breakup process row
4. restore-intent, cooldown, block, notification, scheduled-action, and outbox rows
~~~

A route may perform a non-locking pre-read to discover immutable member IDs.

After acquiring account locks it must re-read and validate authoritative state before mutation.

Never lock a partnership first and then attempt to acquire its account rows.

This order is also used when account deletion interacts with a partnership.

## Trusted time boundaries

All business decisions use trusted PostgreSQL time.

### Cancellation

~~~text
now < initiator_cancel_until
~~~

At equality, cancellation is expired.

### Restoration intent

~~~text
now >= initiator_cancel_until
and
now < final_deadline
~~~

At equality with final_deadline, restoration is expired.

### Breakup finalization

~~~text
now >= final_deadline
~~~

The persisted final_deadline, not worker execution time, becomes terminated_at and cooldown created_at.

### Cooldowns

Breakup:

~~~text
eligible_at = terminated_at + interval '3 months'
~~~

Permanent partner-account deletion:

~~~text
eligible_at = terminated_at + interval '1 month'
~~~

PostgreSQL calendar-month arithmetic is authoritative and preserves the clock time while clamping invalid target month days.

## Migration 0010 design

P3 adds:

~~~text
0010_partnership_lifecycle_runtime.sql
~~~

Migrations 0001 through 0009 are immutable P3 input.

P3 security tests pin the verified migration 0009 content so P3-only behavior cannot be implemented by rewriting P2 history.

### Breakup process terminal markers

Add:

~~~text
breakup_processes.cancelled_at timestamptz
breakup_processes.superseded_at timestamptz
~~~

Replace the existing terminal-exclusivity check with a legacy-safe constraint requiring at most one terminal marker among:

~~~text
restored_at
dissolved_at
cancelled_at
superseded_at
~~~

Rebuild breakup_processes_one_open so an open process requires every terminal marker to be null.

New writes must also enforce:

- cancelled_at is before initiator_cancel_until
- restored_at is at or after initiator_cancel_until and before final_deadline
- dissolved_at equals final_deadline
- terminal timestamps cannot precede initiated_at

Legacy-sensitive hardening checks should use NOT VALID where existing rows cannot be proven safely from historical data.

### Cooldown shape hardening

Add a legacy-safe check:

~~~text
reason = breakup_dissolution
  -> eligible_at = created_at + interval '3 months'

reason = partner_account_deleted
  -> eligible_at = created_at + interval '1 month'
~~~

The existing one-open-eligibility index remains.

### Block-source hardening

New active blocks must have a source partnership.

Add a legacy-safe source-link check requiring source_partnership_id for new and updated block rows.

Cross-table proof that the source partnership is terminated and contains both accounts remains an authoritative transaction check because PostgreSQL CHECK constraints cannot safely enforce that relationship.

### Former-history query index

Add an index supporting the authenticated former-partnership list:

~~~text
partnership_members(account_id, released_at DESC, partnership_id)
WHERE released_at IS NOT NULL
~~~

### Scheduled-action aggregate cancellation index

Add an index supporting cancellation of pending partnership-scoped work by aggregate:

~~~text
scheduled_actions(aggregate_type, aggregate_id)
WHERE status = 'pending'
~~~

### Partnership deletion manifest uniqueness

Add a partial unique index allowing one destructive partnership manifest per partnership subject.

This prevents duplicate physical-cleanup workflows after worker retry or competing finalizers.

## Persistence repositories

P3 adds repository primitives rather than embedding SQL in route handlers.

Representative operations:

~~~text
loadPartnershipLifecycleParticipants
lockPartnershipLifecycle
insertBreakupProcess
lockOpenBreakupProcess
lockBreakupProcessById
listBreakupRestoreIntents
insertBreakupRestoreIntent
extendBreakupDeadline
markBreakupCancelled
markBreakupRestored
markBreakupSuperseded
markBreakupDissolved
loadBreakupGeneration
terminatePartnershipAndReleaseMembers
resolveExpiredPartnerEligibility
insertPartnerCooldown
listFormerPartnerships
insertFormerPartnerBlock
removeFormerPartnerBlock
loadFormerPartnershipPair
cancelPendingScheduledActionsForAggregate
createPartnershipDeletionManifestIfAbsent
deletePartnershipRelationalContent
deletePartnershipCryptoState
~~~

Repository methods receive a QueryExecutor when they participate in an authoritative transaction.

## Breakup initiation transaction

API operation:

~~~text
POST /api/v1/partnerships/:partnershipId/breakup
~~~

The route requires an Idempotency-Key.

Request body is empty.

The client cannot supply:

- initiator identity
- partner identity
- timestamps
- deadlines
- generation
- cooldown
- notification recipients

Transaction:

1. authenticate
2. pre-read immutable member IDs
3. lock both member accounts in sorted order
4. lock partnership
5. recheck membership and both account states
6. require lifecycle active
7. require no account-deletion overlay
8. use PostgreSQL transaction time
9. increment partnership lifecycle generation only
10. insert one breakup process
11. set lifecycle_state = breakup_pending
12. schedule day-7 partnership_breakup_finalize
13. schedule a deadline reminder for final_deadline minus two days
14. append breakup_started lifecycle event
15. create durable breakup_started in-app notices
16. queue minimal serious-event emails
17. persist idempotency response
18. commit

Initial breakup fields:

~~~text
initiated_at = now
initiator_cancel_until = now + 1 hour
base_deadline = now + 7 days
final_deadline = base_deadline
~~~

The breakup finalizer and reminder use breakup process generation.

## One-hour cancellation transaction

API operation:

~~~text
POST /api/v1/partnerships/:partnershipId/breakups/:breakupId/cancel
~~~

The route requires an Idempotency-Key.

Transaction:

1. authenticate
2. derive and lock both member accounts
3. lock partnership
4. lock the specified breakup process
5. require it to be the current open process
6. require actor to be the initiator
7. require no account-deletion overlay
8. require now strictly before initiator_cancel_until
9. mark cancelled_at = now
10. set partnership lifecycle active
11. increment partnership generation
12. cancel still-pending finalizer and reminder actions for that breakup
13. append breakup_cancelled lifecycle event
14. create durable in-app notices
15. persist idempotency response
16. commit

A finalizer or reminder already processing is not stolen. The process is no longer open and the generation fence makes the claimed work stale.

No cooldown is created.

## Restoration intent transaction

API operation:

~~~text
POST /api/v1/partnerships/:partnershipId/breakups/:breakupId/restore
~~~

The route requires an Idempotency-Key.

Transaction:

1. authenticate
2. lock member accounts in canonical order
3. lock partnership
4. lock current breakup process
5. require no account-deletion overlay
6. require lifecycle breakup_pending
7. require now at or after initiator_cancel_until
8. require now strictly before final_deadline
9. reject a new logical intent if this actor already has an intent
10. insert the immutable actor intent

Then one of two paths executes.

### First intent

If the other member has not submitted intent:

1. set final_deadline = initiated_at + 10 days
2. increment partnership generation
3. set breakup process generation to the new generation
4. cancel still-pending old day-7 finalizer and reminder
5. schedule the day-10 finalizer with the new breakup generation
6. schedule a reminder at the new final deadline minus two days
7. append restoration_intent_submitted lifecycle event
8. notify the other partner in-app
9. queue minimal restoration-request email for the other partner
10. return breakup_pending with the day-10 deadline

The deadline extends only once because the actor intent is unique and the next valid intent is the second-member restoration path.

### Second intent

If the other member already submitted intent:

1. mark the breakup process restored_at = now
2. set lifecycle active
3. increment partnership generation
4. leave partnership.version unchanged
5. cancel still-pending finalizer and reminder work
6. append restoration_intent_submitted
7. append partnership_restored
8. notify both partners in-app
9. queue minimal restoration emails for both
10. return the same partnership in active state

No cooldown is created and no partnership namespace changes.

## Breakup reminders

P3 uses one deterministic reminder point:

~~~text
final_deadline - 2 days
~~~

Reminder work is generation-fenced.

When the first restoration intent extends the final deadline:

- an undelivered old reminder is cancelled
- a new day-10 reminder is scheduled
- an old reminder that already executed is historical truth and is not retracted

The reminder email and in-app notice include only the event and authoritative deadline.

They do not include message, media, relationship-object, or private profile content.

If an account is deletion_pending, breakup reminder email remains allowed because the PRD requires breakup deadline notices to continue while account deletion is pending.

## Breakup finalizer worker

Scheduled action:

~~~text
action_type = partnership_breakup_finalize
aggregate_type = breakup_process
aggregate_id = breakupId
payload_version = 1
expected_generation = breakupProcess.generation
~~~

Handler:

1. validate payload version
2. load current open breakup generation
3. stale the action if generation differs or the process is no longer open
4. load member IDs
5. lock both member accounts
6. lock partnership
7. lock breakup process
8. recheck generation and lifecycle
9. require trusted now at or after final_deadline
10. call the canonical partnership-dissolution kernel with reason breakup and effectiveAt = final_deadline
11. complete the scheduled action

If the first restoration intent wins first, the day-7 action is stale.

If the second restoration intent wins first, all breakup finalizers are stale.

If the worker wins at the exact deadline, a later restoration request is expired.

## Canonical partnership-dissolution kernel

There is exactly one authoritative implementation for destructive partnership termination.

Inputs:

~~~text
partnershipId
reason = breakup | partner_account_deleted
effectiveAt
optional breakupProcessId
actorAccountId or null
~~~

The caller must already hold canonical account and partnership locks.

The kernel:

1. validates current partnership state
2. determines whether this is a new transition or an idempotent already-terminated observation
3. terminates the partnership at effectiveAt
4. increments partnership generation only
5. releases both current membership slots at effectiveAt
6. closes the breakup process:
   - dissolved_at for breakup
   - superseded_at for partner_account_deleted when an open breakup exists
7. creates cooldown rows using effectiveAt
8. resolves any expired prior eligibility row before creating the new cooldown
9. cancels other still-pending partnership scheduled actions
10. appends partnership_dissolved lifecycle evidence
11. creates the partnership deletion manifest
12. creates durable final-dissolution account notices
13. queues minimal serious-event emails
14. returns the authoritative termination result

The kernel performs no external provider call.

### Breakup cooldown

For breakup dissolution, both members receive:

~~~text
reason = breakup_dissolution
created_at = effectiveAt
eligible_at = effectiveAt + 3 calendar months
~~~

### Permanent partner-account deletion cooldown

For partner_account_deleted, only the remaining non-deleted member receives:

~~~text
reason = partner_account_deleted
created_at = effectiveAt
eligible_at = effectiveAt + 1 calendar month
~~~

The deleting account does not receive the one-month cooldown because the account is being permanently deleted.

## Account deletion integration

P3 preserves A1 as account-deletion owner.

### Request while partnership is active

A1 continues to:

- set deleting account to deletion_pending
- revoke sessions immediately
- invalidate pending partner requests
- schedule account_deletion_finalize
- preserve seven-day account recovery
- send the deleting account its existing security email

P3 integration adds:

- canonical pair locking when a current partnership exists
- remaining-partner account_deletion_started in-app notice
- remaining-partner minimal serious email
- current partnership projection enters account_deletion_view_only

No partnership generation change is required merely to begin the overlay.

### Request while breakup is already pending

The persisted breakup deadline and restore intents remain unchanged.

No new P3 breakup deadline is created.

New account-deletion requests no longer need a second normal breakup finalizer. The P3 breakup worker remains authoritative.

The legacy account_deletion_breakup_precedence_finalize handler remains for old persisted actions and delegates to the canonical dissolution kernel.

### Recovery

Account recovery remains A1 authority.

If the partnership still exists:

- account returns active
- account-deletion view-only overlay disappears
- active partnership returns to normal mode, or
- breakup_pending returns with its original breakup process, deadline, generation, and prior restore intent intact
- remaining partner receives an account_recovered in-app notice

If the partnership already dissolved at an earlier breakup deadline:

- account recovery may restore the account
- it does not recreate the partnership
- it does not recreate shared data
- breakup cooldown remains authoritative

### Permanent deletion

At account_deletion_finalize:

1. lock the deleting account and current partner if any
2. lock pending account-deletion request by account-deletion generation
3. if no current partnership remains, finalize the account only
4. if a current partnership remains, compare destructive deadlines
5. if the breakup deadline is due and is earlier, call canonical dissolution as breakup with effectiveAt equal to breakup final deadline
6. otherwise call canonical dissolution as partner_account_deleted with effectiveAt equal to account deletion recover_until
7. finalize account deletion state
8. create the existing account deletion manifest

This guarantees the earliest valid destructive partnership deadline wins.

## Authorization revocation before cleanup

The canonical dissolution transaction synchronously:

- sets partnership lifecycle to terminated
- releases both current membership slots
- increments lifecycle generation

Every current and future mutation authorization query must reject the old partnership after that commit.

The deletion manifest is created in the same transaction, but physical cleanup is asynchronous.

P3 therefore satisfies the security ordering:

~~~text
authorization revoked
then
cleanup retries
~~~

Realtime transport does not exist yet in P3. P3's realtime-revocation gate means the authoritative membership and lifecycle state used by future realtime authorization is synchronously severed before cleanup. M2 must consume this authority and add live socket disconnection behavior.

## Partnership deletion manifest

P3 creates one partnership-scoped deletion manifest per dissolved partnership.

Reason:

~~~text
breakup_dissolution
or
partner_account_deleted
~~~

Initial executable P3 targets are limited to systems that actually exist and have handlers.

### partnership_relational_content

Deletes private partnership content while retaining the minimal lifecycle shell required for safety, cooldown provenance, former-partner blocking, and audit.

Current relational content includes:

- conversations
- messages and message versions
- message reactions and receipts
- relationship items and relationship events
- media-object metadata
- call sessions, participants, and events

The handler is idempotent.

### partnership_crypto_state

Deletes any partnership_crypto_epochs or other P3-era cryptographic placeholder rows if present.

P3 does not create E2EE keys or epochs.

Real S1 key-envelope cleanup extends this target when S1 exists.

### Retained lifecycle shell

P3 does not delete:

- partnerships terminal identity
- released partnership_members
- breakup process terminal metadata
- restore-intent audit rows
- account_partner_eligibility
- partnership_blocks
- append-only lifecycle events

These rows are minimal lifecycle and safety metadata, not shared content.

They are needed to enforce cooldown provenance, permit later former-partner blocking, and investigate lifecycle races.

Their bounded retention policy remains a separate privacy-retention decision. They must never contain message, media, relationship-object, email, DOB, or cryptographic secret content.

Later M3, M2, R1, and S1 milestones must extend the manifest builder and handlers before they close if they introduce new partnership-scoped storage systems.

## Serious lifecycle notices

P3 reuses the existing durable account notification table for in-app lifecycle events.

P3 extends the allowlisted event types with:

~~~text
breakup_started
breakup_cancelled
restoration_requested
partnership_restored
breakup_deadline_reminder
partnership_dissolved
partner_account_deletion_started
partner_account_recovered
partner_account_deleted
~~~

Notification rows remain routing metadata only.

They must not store:

- breakup private commentary
- message content
- media content
- relationship-object content
- relationship start date
- email address
- date of birth
- device data
- secrets
- cryptographic material

### Recipient rules

breakup_started:
- durable notice for both partners

breakup_cancelled:
- durable notice for both partners

restoration_requested:
- notice to the other partner only

partnership_restored:
- notice to both partners

breakup_deadline_reminder:
- notice to both partners

partnership_dissolved:
- notice to both former partners

partner_account_deletion_started:
- notice to the remaining partner

partner_account_recovered:
- notice to the remaining partner only if the partnership still exists

partner_account_deleted:
- notice to the remaining partner

The deleting account receives no in-app notice after permanent deletion because account access is already revoked.

Blocking does not notify the blocked account.

### Email delivery

P3 reuses the verified security-email delivery/outbox pipeline for serious lifecycle mail because it already provides:

- durable delivery records
- at-least-once outbox delivery
- minimal template parameters
- retry behavior
- provider calls outside authoritative transactions

P3 adds a shared lifecycle-notice writer so the partnerships module and A1 account-deletion module do not duplicate email orchestration.

Required serious email templates include:

- breakup_started
- breakup_deadline_reminder
- restoration_requested
- partnership_restored
- partnership_dissolved
- partner_account_deletion_started
- account_permanently_deleted
- partner_account_deleted

At permanent account deletion, the A1/P3 integration snapshots and queues the deleting account's final `account_permanently_deleted` email before authentication/email cleanup can remove account-owned delivery source data. The remaining partner receives the separate minimal `partner_account_deleted` notice.

Breakup cancellation and account recovery may remain in-app only unless product requirements later require email.

Email parameters are limited to the event and important deadline.

## Current partnership read model

P3 extends:

~~~text
GET /api/v1/partnerships/current
~~~

Representative projection:

~~~text
{
  partnership: {
    partnershipId,
    lifecycleState,
    interactionMode,
    activatedAt,
    relationshipStartDate,
    metadataVersion,
    generation,
    breakup: null | {
      breakupId,
      initiatedBy: self | partner,
      initiatedAt,
      initiatorCancelUntil,
      baseDeadline,
      finalDeadline,
      selfRestoreIntentAt,
      partnerRestoreIntentAt
    },
    accountDeletion: null | {
      deletingMember: self | partner,
      recoverUntil
    },
    capabilities: {
      changeRelationshipStartDate,
      initiateBreakup,
      cancelBreakup,
      submitRestoreIntent,
      viewSharedData
    },
    otherMember
  }
}
~~~

The projection contains server-derived capabilities.

Client countdowns are presentation only. The client clock never authorizes a transition.

## Former partnership read model

P3 adds an authenticated, snapshot-bound list:

~~~text
GET /api/v1/partnerships/former?limit=25&cursor=...
~~~

It returns only partnerships in which the authenticated account was a member and whose current membership was released.

Representative safe projection:

~~~text
{
  partnershipId,
  terminatedAt,
  terminationReason,
  formerPartner: {
    accountId,
    username,
    displayName
  } | null,
  blockedByMe
}
~~~

If the former account has been permanently deleted, the API may return formerPartner = null or a generic deleted-account projection rather than exposing stale private profile data.

Former history is private and uses:

~~~text
Cache-Control: private, no-store
~~~

## Former-partner blocking

Create:

~~~text
POST /api/v1/partnerships/:partnershipId/block
~~~

Remove:

~~~text
DELETE /api/v1/partnerships/:partnershipId/block
~~~

The client never supplies the blocked account ID.

The server derives the other account from the historical partnership.

### Block creation transaction

1. authenticate
2. load historical pair
3. lock both account rows in canonical order
4. lock source partnership
5. verify actor was a member
6. verify source partnership is terminated
7. verify target is the other source member
8. reject if actor and target currently share another active or breakup-pending partnership
9. insert or replay actor -> former-partner block
10. invalidate pending requests in both directions with reason block_created
11. append privacy-safe lifecycle/security evidence if required
12. commit

No notification or email is sent to the blocked account.

### Block removal

Only the blocker may remove the active directional block.

Removal sets removed_at and does not restore old requests or old partnership data.

A future partnership still requires:

- cooldown expiry
- no active block in either direction
- fresh explicit consent
- a fresh partnership ID

P1 discovery and request creation and P2 formation remain the enforcement points for active blocks.

## Cooldown lifecycle

P3 treats account_partner_eligibility as durable provenance, not a permanent unresolved lock.

### Creation

A new cooldown:

1. runs under the account lock
2. resolves any expired open row
3. rejects an overlapping still-active cooldown as an invariant violation
4. inserts the new source partnership, reason, created_at, and eligible_at

### Expiry

Cooldown expiry is logical at eligible_at.

No worker is required for correctness.

P1/P2 eligibility checks compare trusted server time to eligible_at.

### Formation cleanup

Successful P2 formation, while account locks are already held, resolves any expired open eligibility rows for both newly partnered accounts.

This ensures a later P3 dissolution can create a new cooldown cleanly.

## API denial and privacy mapping

P3 uses stable public codes.

Representative vocabulary:

~~~text
PARTNERSHIP_UNAVAILABLE
BREAKUP_NOT_AVAILABLE
BREAKUP_WINDOW_EXPIRED
RESTORE_WINDOW_NOT_OPEN
BREAKUP_DEADLINE_EXPIRED
RESTORE_INTENT_ALREADY_SUBMITTED
ACCOUNT_LOCKED
BLOCK_NOT_AVAILABLE
VALIDATION_FAILED
IDEMPOTENCY_KEY_REUSED
~~~

Privacy rules:

- unknown partnership and non-member use the same not-found behavior
- block creation never accepts an arbitrary target account
- account-deletion details of unrelated accounts are never exposed
- cooldown, block, occupancy, and former-partner history remain private
- lifecycle events and emails contain no private shared content

## Idempotency and replay

All user-triggered P3 lifecycle mutations require the existing Idempotency-Key convention.

Scopes are command-specific.

Representative scopes:

~~~text
partnership.breakup.initiate
partnership.breakup.cancel
partnership.breakup.restore
partnership.block.create
partnership.block.remove
~~~

Fingerprints bind:

- authenticated actor
- partnership ID
- breakup process ID where applicable
- action type

No deadline or recipient is accepted from the client.

A lost successful response replays the stored response.

A reused key with a different fingerprint returns the existing deterministic idempotency-key-reused behavior.

Durable process state remains the canonical authority after idempotency retention expires.

## Browser behavior

P3 web UI extends the existing PartnershipPanel.

### Active

Show:

- relationship information
- breakup action
- existing metadata edit controls

Breakup requires explicit confirmation.

### Breakup pending during first hour

Show:

- initiator identity
- authoritative final deadline
- cancellation-window countdown
- Cancel Breakup only to the initiator
- Restore control disabled until the exact one-hour boundary

### Breakup pending after first hour

Show:

- Restore Partnership
- waiting state if self already submitted
- whether partner restore intent is present
- authoritative final deadline
- day-10 extension immediately after first intent

Restore intent has no withdraw button.

### Account deletion view-only

Remaining partner sees:

- view-only state banner
- authoritative recovery deadline
- no shared mutation controls
- no new partnership control

### Terminated

Current partnership disappears.

Former partnership history exposes blocking controls where valid.

Client state always refreshes from canonical API responses after mutation.

## Race matrix

P3 closure requires real database concurrency tests for at least:

1. breakup initiation versus account-deletion request
2. two concurrent breakup-initiation requests
3. cancellation versus account-deletion request
4. first restore intent versus day-7 finalizer
5. second restore intent versus day-10 finalizer
6. both partners submitting first restore intent concurrently
7. restoration versus account-deletion request
8. breakup finalizer versus account-deletion finalizer
9. breakup finalizer versus account recovery
10. final dissolution versus P2 relationship-date mutation
11. block creation versus partner-request creation
12. block creation versus partnership formation
13. block removal versus partner-request creation
14. duplicate scheduled finalizer claims
15. deletion target crash and reclaim after authorization is already revoked

Every race test must assert persisted end state, not only HTTP status.

## Required persisted-state assertions

Tests must verify:

- partnership lifecycle state
- partnership generation
- metadata version unchanged by lifecycle-only transitions
- breakup process terminal marker
- breakup process generation
- exact final deadline
- immutable restore-intent rows
- scheduled-action status
- released_at on both membership rows
- exact cooldown created_at and eligible_at
- termination reason and terminated_at
- one partnership deletion manifest
- expected deletion targets
- lifecycle event type and aggregate version
- exact notification recipient
- serious-email delivery target and template
- active block direction
- incompatible request invalidation
- no second occupied partnership slot

## Security regressions

P3 security tests must prove:

- no client-supplied partner identity in breakup or block mutations
- no client-supplied deadlines
- no client-supplied lifecycle generation
- no provider call inside authoritative lifecycle transactions
- migration 0009 remains unchanged
- lifecycle event metadata is allowlisted and content-free
- account notification rows remain routing-only
- serious email parameters contain no private shared content
- blocked account is not notified of block creation
- old partnership ID is not authorization for current partnership data
- final dissolution denies all shared mutations before deletion targets complete
- stale scheduled work cannot mutate restored or superseded lifecycle state
- P3 does not create fake E2EE keys or epochs

## Test commands

P3 implementation adds:

~~~text
npm run test:partnership-lifecycle
npm run test:p3:security
npm run test:p3:postgres
npm run test:p3:api
npm run test:p3:local
~~~

test:partnership-lifecycle covers domain and contracts.

test:p3:security covers source/security regressions and immutable prior migration checks.

test:p3:postgres runs database invariants plus API, worker, race, deletion, P1 block, and P2 formation regression surfaces against disposable PostgreSQL 16.

test:p3:local owns the complete clean-container P3 matrix and emits:

~~~text
P3_LOCAL_POSTGRES_PASS
~~~

P3 closure also requires:

~~~text
npm run health
npm audit --audit-level=high
~~~

Because P3 changes the A1 account-deletion integration and P2 eligibility cleanup, closure must rerun relevant A1, P1, and P2 integration surfaces rather than relying only on new P3 tests.

## Implementation sequence

### P3-A Domain and contract refinement

Implement:

- initiate_breakup capability
- RESTORE_WINDOW_NOT_OPEN boundary
- exact non-overlapping cancel/restore time rules
- lifecycle response types
- breakup mutation contracts
- expanded current-partnership projection
- former-partnership contracts
- block/unblock contracts
- P3 notification event types

Exit evidence:

- pure lifecycle tests cover every exact boundary
- contract tests reject client authority over identity, deadlines, and generation
- existing P2 metadata semantics remain unchanged

### P3-B Migration 0010 and repositories

Implement:

- cancelled_at and superseded_at
- terminal marker constraints
- rebuilt open-breakup index
- cooldown duration hardening
- block-source hardening
- former-history index
- scheduled aggregate-cancellation index
- partnership deletion-manifest uniqueness
- lifecycle repositories
- cooldown hygiene
- block repositories
- former-history repositories
- partnership content deletion repository
- database invariants

Exit evidence:

- migrations 0001 through 0010 apply from zero
- migration 0009 checksum remains unchanged
- invariant suite passes
- catalog checks prove indexes and constraints

### P3-C Breakup API and current read model

Implement:

- breakup initiation
- one-hour cancellation
- restore intent
- mutual restoration
- idempotency
- extended current partnership projection
- durable in-app lifecycle notices
- serious lifecycle email helper

Exit evidence:

- API integration proves exact time boundaries
- lost-response replay is stable
- metadata version is not changed by lifecycle transitions

### P3-D Deadline worker and reminder integration

Implement:

- partnership_breakup_finalize handler
- partnership_breakup_deadline_reminder handler
- breakup-process generation loader
- stale-action behavior
- day-7 to day-10 rescheduling
- worker registry wiring

Exit evidence:

- day-7 finalization with zero intents
- day-10 finalization with one intent
- stale day-7 finalizer after extension
- stale finalizer after mutual restoration
- reminder generation fencing

### P3-E Canonical dissolution and A1 deletion integration

Implement:

- canonical dissolution kernel
- synchronous membership release
- exact cooldown creation
- partnership deletion manifest
- relational-content deletion handler
- crypto-state deletion handler
- account-deletion finalizer delegation
- legacy breakup-precedence handler delegation
- remaining-partner account deletion notices
- account-recovery partnership notice

Stop scheduling new duplicate A1 breakup-precedence actions once P3's normal breakup finalizer exists.

Keep the legacy handler registered and convergent for persisted compatibility.

Exit evidence:

- earlier breakup deadline beats later account deletion
- earlier permanent account deletion beats later breakup
- account recovery preserves an existing breakup when it is still alive
- recovery after breakup dissolution does not recreate partnership
- authorization is revoked before deletion target completion
- deletion manifest resumes after worker failure

### P3-F Cooldowns and former-partner blocking

Implement:

- expired cooldown resolution
- P2 formation cleanup of expired cooldown rows
- former partnership list
- block create
- block remove
- pending request invalidation on block
- P1 discovery/request regression
- P2 formation regression

Exit evidence:

- exact three-calendar-month breakup cooldown
- exact one-calendar-month account-deletion cooldown
- a second future cooldown can be created after an old cooldown expired
- blocked former partner cannot discover, request, or pair
- unblock does not bypass cooldown or fresh consent
- active current partners cannot block each other through an old partnership record

### P3-G Browser lifecycle UI

Implement:

- breakup confirmation
- initiator and deadlines
- cancellation countdown
- restore waiting state
- day-10 extension refresh
- account-deletion view-only banner
- former partnership history
- block and unblock controls
- lifecycle notification rendering

Exit evidence:

- UI never authorizes from client clock
- canonical refresh follows every mutation
- irreversible restoration intent has no withdraw path
- no stale current partnership UI remains after dissolution

### P3-H Integration closure

Run:

1. domain and contract suite
2. P3 security suite
3. migrations 0001 through 0010 from zero
4. database invariants
5. API and worker integration
6. complete race matrix
7. A1 account-deletion regressions
8. P1 block/discovery/request regressions
9. P2 formation and metadata regressions
10. deletion-manifest retry/reclaim tests
11. full npm run health
12. npm audit --audit-level=high
13. repo-wide documentation reconciliation
14. close only evidence-backed P3 gates
15. merge feat/p3-partnership-lifecycle to main only after all required gates are green

## Acceptance gate mapping

### Pure domain transitions

Already present as a verified baseline, with P3-A refinement required for the one-hour restore-open boundary.

### Pure capability rules

Already present as a verified baseline, with P3-A additions for initiate_breakup and refined restoration timing.

### Breakup initiation persists atomically

P3-C.

### One-hour cancellation persists and invalidates stale scheduled work

P3-C and P3-D.

### First restore intent extends exactly once

P3-C and P3-D.

### Restoration intent cannot be withdrawn

P3-B and P3-C.

### Second restore intent restores the same partnership

P3-C.

### Worker finalizes at day 7 and day 10

P3-D and P3-E.

### Stale finalizer cannot dissolve newer state

P3-D generation fencing.

### Account deletion collision rules

P3-E using the canonical dissolution kernel and A1 authority.

### Exact cooldowns

P3-E and P3-F.

### Authorization revocation before cleanup

P3-E synchronous termination and membership release before deletion target processing.

### Deletion manifest

P3-E.

### Former-partner blocking

P3-F.

### Serious-event emails

P3-C, P3-D, and P3-E using the verified durable email/outbox substrate.

### API, database, worker, race, and security tests

P3-H.

## Review invariants

Reject a P3 implementation if it:

1. creates a second account-deletion state machine
2. implements breakup finalization in more than one authoritative kernel
3. uses client time for lifecycle deadlines
4. allows cancel at or after the exact one-hour boundary
5. allows restore intent before the one-hour boundary
6. allows restore intent at or after final deadline
7. permits restoration intent withdrawal
8. allows repeated three-day extensions
9. fences breakup workers with metadata version
10. rewrites migrations 0001 through 0009
11. changes partnership metadata version for lifecycle-only transitions
12. allows a stale worker to terminate a restored partnership
13. lets physical deletion complete before authorization is revoked
14. deletes the minimal lifecycle shell needed for cooldown and former-block safety before an explicit retention design replaces it
15. silently ignores an overlapping active cooldown
16. leaves expired cooldown rows able to block creation of later cooldown records
17. permits blocking an arbitrary account that is not the other member of a terminated source partnership
18. notifies the blocked account of block creation
19. allows an old terminated partnership record to block a current active partner through the historical block route
20. exposes former-partner history publicly
21. stores private shared content in notifications, lifecycle events, email parameters, or deletion manifests
22. performs email or provider calls inside the authoritative transaction
23. creates fake E2EE keys or epochs
24. treats asynchronous cleanup completion as the moment authorization ends
25. marks P3 DONE without executed PostgreSQL, API, worker, race, security, health, and audit evidence

## Physical-device requirement

P3 does not require Redmi physical-device evidence for epic closure.

P3 is server lifecycle, persistence, browser, and durable-worker work.

Physical Android acceptance begins with the later device-sensitive realtime, media, calling, and cryptographic milestones.
