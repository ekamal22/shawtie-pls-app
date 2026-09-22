# P2 Partnership Formation and Relationship Date Architecture and Implementation Design

## Status

IMPLEMENTED AND LOCALLY VERIFIED

Effective design date: 2026-09-21.

This document is the canonical implementation design for P2 Partnership Formation and Relationship Date.

P2 preserves Architecture Baseline 1.0. It builds on the verified A1 account/session/security substrate, the refined P1 discovery/request contract, the existing partnership state machine, the F2 transaction/outbox primitives, and PostgreSQL-enforced partnership occupancy.

No distributed formation service, asynchronous pairing authority, Redis lock, provider call, or custom cryptographic protocol is introduced. No ADR is required.

Source code, migrations, and tests remain authoritative for behavior that is actually implemented.

## Refinement review

The P2 design was originally refined before P1 runtime implementation, then implemented against the locally verified P1 runtime seam without reopening its public contract. P1 and P2 are both DONE locally.

The refinement closes ambiguity in:

- how a manually entered relationship start date exists when reciprocal requests auto-pair without a separate accept screen
- explicit acceptance versus reciprocal automatic formation
- the exact transaction boundary shared with P1
- deterministic account and request lock ordering
- one-partner occupancy under competing accepts and reciprocal races
- stable replay after a successful accept response is lost
- invalidation of incompatible pending requests
- separation of partnership metadata versioning from lifecycle generation fencing
- relationship-date concurrent edits and no-op behavior
- relationship-date notification durability without requiring push infrastructure yet
- use of the fresh partnership ID itself as the local and future cryptographic namespace without pretending S1 E2EE is already implemented
- privacy-safe public error mapping
- P1 production enablement once the formation coordinator exists
- cancellation of request-expiry scheduled actions after successful formation
- accept versus cancel/decline terminal-state races
- legacy-safe migration 0009 constraints over committed migration 0008
- relationship-date lost-response retry semantics

No accepted product rule is changed.

## Product rules preserved

P2 preserves the PRD rules that:

- a partnership requires fresh consent from both accounts
- a one-way request requires explicit recipient acceptance
- two opposite pending requests constitute fresh consent and create a partnership automatically
- an account can occupy at most one active partnership slot
- active, breakup-pending, and account-deletion-pending partnership states occupy that slot
- other incompatible pending requests are invalidated when a partnership forms
- the relationship start date is manually entered and is separate from activation time
- the relationship start date may be today or earlier, never future
- either partner may later update the relationship start date while partnership metadata is editable
- the other partner receives a notification when that date changes
- every new partnership has a fresh isolated local and cryptographic security context
- a later partnership between the same accounts must never reuse the previous partnership namespace or cryptographic state

## Dependency boundary

A1 is complete.

P1 runtime implementation is locally verified and DONE. P2 runtime integration uses that verified substrate supplying:

- authenticated partner requests
- deterministic sorted account locks
- logical request-expiry handling
- pair eligibility checks and block/cooldown state
- request invalidation helpers
- reciprocal candidate detection
- request creation idempotency
- the committed `PartnershipFormationCoordinator.handleReciprocalCandidate(executor, candidate, now)` seam
- one `partner_request_expire` scheduled action per newly created request

P2 owns:

- explicit accept
- transactional formation
- reciprocal auto-pair execution
- accepted-request to partnership linkage
- one-slot recheck at formation time
- fresh partnership-ID namespace creation without a redundant security identifier
- relationship start-date authority
- relationship date updates
- durable in-app partnership notifications required by P2

P3 owns post-formation breakup, restoration, dissolution, account-deletion lifecycle integration, cooldown persistence, and former-partner blocking.

M1 owns the primary-conversation provisioning hook and messaging runtime. That hook executes inside the existing P2 formation transaction after authoritative partnership identity and membership are established; it does not redefine P2 consent, occupancy, request-consumption, or relationship-date authority.

S1 owns the reviewed cryptographic protocol, real key material, device key delivery, cryptographic epochs, rotation, and recovery.

## Cross-epic contract now implemented by P1

Every new partner request carries the sender's manually entered proposed relationship start date. This is now implemented by P1 migration 0008, contracts, repositories, API, and client flow.

P1 create input becomes conceptually:

~~~text
{
  recipientAccountId,
  expectedUsername,
  relationshipStartDate
}
~~~

`relationshipStartDate` is an exact `YYYY-MM-DD` calendar date with no timezone component. P1 validates it against trusted PostgreSQL UTC business date and persists it with the request.

Reason: the second reciprocal request may immediately trigger P2 formation. There is no later accept screen from which P2 could obtain a manually entered date.

Initial-date rule:

- explicit one-way acceptance uses the accepted request's proposed date
- reciprocal automatic formation uses the triggering second request's proposed date
- the triggering request is the fresh consent that completes the reciprocal pair
- the choice is deterministic and never depends on request ID sort order
- either partner may update the date later through the P2 relationship-date mutation

P1 request lists expose the proposed relationship start date only to the sender and recipient. It is not part of public discovery.

## Goals

P2 must provide:

- explicit acceptance for one-way requests
- reciprocal auto-pairing in the same authoritative transaction as the second request
- deterministic concurrency behavior
- database-enforced one-partner occupancy
- accepted-request linkage to the resulting partnership
- incompatible pending-request invalidation
- trusted relationship start-date validation
- version-checked relationship date updates
- durable notification to the other partner after a committed date change
- a fresh partnership identifier that is the local namespace root and future S1 cryptographic namespace
- stable replay for already accepted requests
- privacy-safe failure behavior
- complete PostgreSQL, API, race, and security evidence

## Non-goals

P2 does not implement:

- breakup or restoration runtime
- final dissolution
- cooldown creation
- former-partner blocking
- primary chat conversation creation
- messaging
- realtime transport
- push transport
- media
- calls
- E2EE key agreement
- cryptographic key epochs
- cryptographic recovery
- fuzzy discovery

## Authoritative time semantics

P2 uses PostgreSQL transaction time for authoritative mutations.

The authoritative relationship calendar date is:

~~~text
transaction_timestamp() at time zone UTC -> date
~~~

A relationship start date is valid when:

~~~text
relationshipStartDate <= trustedServerDate
~~~

At exactly today's UTC calendar date, the value is valid.

Client device clocks and browser timezone do not affect acceptance.

PostgreSQL CHECK constraints must not use CURRENT_DATE as a future-date invariant because the validity of an existing row would change as wall time advances. Future-date rejection is transaction logic backed by integration tests.

## Consent model

### Explicit acceptance

For one pending request A -> B:

- A has expressed consent by creating the request
- B expresses fresh consent by calling the accept endpoint while the request is logically pending
- P2 forms the partnership only after rechecking both accounts and the request under locks

### Reciprocal automatic formation

For active requests A -> B and B -> A:

- both accounts have independently expressed fresh consent
- the transaction creating the second direction invokes P2 before commit
- P2 revalidates both request rows and both accounts while the same sorted account locks remain held
- P2 forms exactly one partnership in that transaction

An asynchronous event is never the authority for reciprocal formation.

Silence, old requests, expired requests, old partnerships, or prior acceptance never count as current consent.

## Central formation invariant

Formation is one PostgreSQL transaction. For reciprocal pairing, it is the same transaction already opened by P1 for creation of the triggering second request.

The transaction either commits all of:

- partnership row
- two membership rows
- accepted request state and accepted partnership linkage
- incompatible request invalidation
- cancellation of still-pending expiry jobs for consumed requests
- fresh partnership-ID namespace
- partnership-formed lifecycle record
- required durable in-app notifications

or commits none of them.

No external email, push, object-storage, realtime, or cryptographic provider call occurs inside the transaction.

## Lock order

P2 follows the repository lock hierarchy.

For formation:

1. determine the two immutable account IDs
2. sort account IDs by the existing canonical UUID ordering
3. lock both account rows in that order
4. lock participating request rows in request-ID order
5. re-read occupancy, cooldown, block, request, and account state
6. create partnership and dependent rows
7. accept consumed request rows
8. invalidate remaining incompatible pending requests using the P1 helper
9. append notification rows and lifecycle evidence
10. commit

P2 never acquires security-rate-limit bucket locks while account locks are held. P1 performs its abuse-rate-limit preflight before the business transaction.

Relationship-date update first loads the immutable member IDs, locks both member account rows in canonical UUID order, then locks the partnership row. This reuses the A1 lock rank and serializes the mutation with account deletion or other account-state transitions that can make the partnership view-only. After locking, it re-reads account status, account-deletion overlay state, lifecycle state, membership, and metadata version before changing the date.

## One-partner occupancy

Application checks are not the final authority.

The existing partial unique index remains the database defense:

~~~text
UNIQUE(account_id) WHERE released_at IS NULL
~~~

The existing maximum-two-members trigger remains defense in depth.

P2 still rechecks occupancy after account locks because it needs a stable business decision and privacy-safe error mapping before inserts.

If a uniqueness violation nevertheless occurs, the transaction rolls back and the public result maps to a safe partnership-unavailable outcome.

## Formation sources

P2 recognizes two internal sources:

~~~text
explicit_accept
reciprocal_request
~~~

The source is audit metadata, not a different partnership type.

Both sources create the same active partnership shape.

## Transaction-scoped coordinator

P1 now exposes this committed seam:

~~~text
PartnershipFormationCoordinator.handleReciprocalCandidate(
  executor,
  candidate,
  now
) -> { partnershipId }
~~~

The committed P1 candidate contains:

~~~text
ReciprocalPairCandidate {
  accountIds: sorted [accountA, accountB]
  requestIds: sorted [requestA, requestB]
  triggeringRequestId
  relationshipStartDate
  observedAt
}
~~~

P2 implements that exact interface through the committed transaction-scoped coordinator. P1 did not require a contract change.

Internally, P2 uses one common primitive:

~~~text
formLockedPair(
  executor,
  {
    accountIds,
    requestIds,
    triggeringRequestId,
    relationshipStartDate,
    source,
    actorAccountId
  },
  now
) -> FormationOutcome
~~~

The reciprocal adapter derives `source = reciprocal_request` and derives the actor from the authoritative triggering request after re-reading it. The explicit-accept path calls the same internal primitive with `source = explicit_accept` and the authenticated recipient as actor.

Requirements:

- `executor` is the caller's current F2 transaction executor
- the coordinator never starts a nested authoritative transaction
- reciprocal callers already hold the sorted account locks
- explicit accept acquires the same account locks before invoking the common primitive
- every candidate ID, direction, date, and actor relation is re-read from authoritative request rows
- `now` from PostgreSQL transaction time is authoritative
- `candidate.observedAt` is diagnostic only and must match the same transaction-time observation; it never overrides `now`
- request expiry is rechecked using transaction time
- account status, occupancy, cooldown, and pair block state are rechecked
- reciprocal candidates must still be opposite directions for the same two accounts
- the triggering request must be one of the candidate request IDs and its persisted relationship date must equal the proposed initial date
- explicit acceptance must still identify the authenticated recipient
- the coordinator returns only the resulting partnership identity to P1

This adapter design lets P2 integrate with the verified P1 code without reopening the P1 public interface.
## Explicit acceptance API

~~~text
POST /api/v1/partner-requests/:requestId/accept
~~~

No account ID or relationship date is accepted in the request body.

The member pair and initial date come from the authoritative request row. Accepting the request is consent to form the partnership; the proposed relationship date is mutable partnership metadata rather than a separate bilateral-consent gate, because the PRD allows either partner to update it later without approval.

Transaction:

1. authenticate with A1
2. begin transaction
3. obtain PostgreSQL transaction time
4. read only immutable request participant IDs needed for lock order
5. lock both accounts in canonical order
6. re-read and lock the request row
7. verify the authenticated account is the recipient
8. lazily expire the request if the exact seven-day deadline has arrived
9. if already accepted by this formation path, replay the same partnership identity while retained
10. if otherwise terminal, return request unavailable
11. recheck both accounts, blocks, cooldowns, and occupancy
12. validate the request's relationship start date against trusted server date
13. invoke the formation coordinator
14. commit

Wrong-recipient and unknown-request cases use the same not-found shape.

Accept is not product-rate-limited. Consent and safety actions must not become unavailable because discovery or request-create abuse buckets were exhausted.

Successful explicit accept uses HTTP 200:

~~~text
{
  outcome: "formed" | "already_accepted",
  partnershipId
}
~~~

A lost-response replay returns the same partnership ID. The client never treats the replay body as current lifecycle authority.

## Accept replay and lost responses

`partner_requests` stores `accepted_partnership_id` when accepted.

If the first accept commits but the HTTP response is lost, retrying the same accept by the legitimate recipient returns the same partnership identity.

This makes explicit acceptance naturally idempotent without requiring a separate Idempotency-Key.

An accepted request never creates a second partnership on replay. Replay returns the original formation identity, not a claim that the partnership is still active; the client refreshes `GET /api/v1/partnerships/current` for current lifecycle state.

Replay guarantees are retention-scoped. Explicit accept replays through the retained accepted request and its `accepted_partnership_id`. Reciprocal P1 create replay uses P1's retained idempotency record. After those bounded records are legitimately purged, clients use `GET /api/v1/partnerships/current` as canonical state rather than expecting an old mutation request to remain replayable forever.

## Reciprocal request transaction

P1 creates the second request only after its existing preflight and pair checks.

Before that transaction commits:

1. P1 identifies the active opposite request
2. P1 creates a reciprocal candidate with both request IDs
3. the triggering request's manually entered relationship date is selected
4. P2 revalidates both rows under lock
5. P2 rechecks pair formation eligibility
6. P2 creates one partnership
7. P2 marks both reciprocal requests accepted with the same partnership ID
8. P2 cancels still-pending `partner_request_expire` scheduled actions for both accepted requests
9. P2 invalidates all other incompatible pending requests for both accounts
10. P2 creates durable partnership-formed notifications
11. P2 returns the pairing outcome to P1
12. P1 stores the final paired response in its existing create idempotency record
13. the single transaction commits

P1's paired create response remains HTTP 201 and includes:

~~~text
{
  outcome: "paired",
  requestId,
  partnershipId
}
~~~

The response is persisted in the existing P1 idempotency record before commit.

Exactly one opposite-direction transaction can be the formation transaction because both directions serialize on the same sorted account locks.

## Competing race behavior

### Explicit accept versus reciprocal create

If explicit accept wins first, the later reciprocal create observes occupied accounts and cannot create another request or partnership.

If reciprocal create wins first, the later explicit accept sees the already accepted request and replays the same partnership success.

### One account accepts two partners concurrently

Both transactions contend on the common account lock.

The first successful formation occupies the slot and invalidates incompatible requests. The second cannot form.

### Two recipients accept requests from the same sender

The shared sender account lock serializes both transactions. Only one formation can commit.

### Accept versus cancel or decline

Accept, sender cancel, and recipient decline all acquire the same two account locks and then the request row.

The first terminal transition to commit wins:

- if cancel commits first, accept returns request unavailable
- if decline commits first, accept returns request unavailable
- if accept commits first, later cancel or decline observes the accepted terminal row and cannot rewrite it
- no race may produce both a partnership and a cancelled/declined source request

### Expiry worker versus formation

P1 schedules `partner_request_expire` before the reciprocal coordinator runs.

On successful formation, P2 cancels any still-pending expiry action whose aggregate is a consumed request. If an expiry action was already claimed and is processing, P2 does not steal or rewrite the worker claim. Request-row locking serializes the race: after formation commits, the worker re-reads a terminal accepted request and completes as a no-op.

### Database defense

Even if application ordering regresses, the occupied-slot unique index prevents a second current membership.

## Incompatible request invalidation

After consumed request rows are marked accepted, P2 calls P1's transaction-scoped invalidation helper for both newly partnered accounts with:

~~~text
reason = partnership_formed
~~~

Every other still-pending incoming or outgoing request involving either account becomes invalidated.

The accepted request rows are no longer pending and are therefore not invalidated.

Invalidation never deletes request-attempt evidence and never resurrects later if the partnership ends.

Fresh future consent requires fresh requests.

## Relationship start date

The initial relationship start date is copied from the request proposal chosen by the consent rule above.

It is not copied from `activated_at`.

The partnership row continues to store:

~~~text
relationship_start_date date NOT NULL
activated_at timestamptz NOT NULL
~~~

These fields have different meanings.

## Relationship date update

API:

~~~text
PATCH /api/v1/partnerships/:partnershipId/relationship-start-date
~~~

Input:

~~~text
{
  relationshipStartDate,
  expectedMetadataVersion
}
~~~

Rules:

- authenticate with A1
- target partnership ID is explicit and immutable
- verify current membership server-side
- relationship metadata is editable while lifecycle state is `active` or `breakup_pending`
- account-deletion view-only state and terminated state reject the mutation
- future dates are rejected using trusted PostgreSQL UTC date
- `expectedMetadataVersion` must equal the current partnership `version`
- a successful change increments `version` by one
- relationship date change does not increment lifecycle `generation`
- changing to the already-current date is an idempotent no-op: no version bump and no duplicate notification; this equality check occurs before version-conflict rejection so a lost-response retry of a successful update can return the current metadata version
- the other partner receives one durable notification after a real committed change

`version` protects mutable partnership metadata from lost updates. For a real value change, `expectedMetadataVersion` must match. For a retry whose requested date already equals the authoritative current date, return success with the current `metadataVersion` even if the submitted expected version is now stale.

`generation` remains reserved for lifecycle/deadline fencing used by P3 and deletion interactions.

## Relationship metadata capability

The central capability model adds:

~~~text
change_relationship_start_date
~~~

Decision:

- active partnership member: allowed
- breakup_pending partnership member: allowed
- account-deletion view-only state: denied with `PARTNERSHIP_METADATA_LOCKED`
- terminated or non-member: denied
- inactive/deletion-pending actor account: denied

The client may use a server-derived capability for presentation, but the API always re-evaluates authoritative state.

## Current partnership read model

P2 adds an authenticated current-partnership read so clients do not infer state from requests.

~~~text
GET /api/v1/partnerships/current
~~~

Response:

~~~text
{
  partnership: null | {
    partnershipId,
    lifecycleState,
    activatedAt,
    relationshipStartDate,
    metadataVersion,
    capabilities: { changeRelationshipStartDate: boolean },
    otherMember: { accountId, username, displayName }
  }
}
~~~

`capabilities.changeRelationshipStartDate` is an advisory server-derived presentation hint from the central capability model. The mutation endpoint always re-evaluates authoritative state.

The response is `Cache-Control: private, no-store`.

It does not expose cooldown internals, email, DOB, sessions, devices, or cryptographic state.

## Durable in-app notifications

P2 needs a real notification for relationship-date changes before the later push milestone exists.

P2 therefore introduces a minimal provider-neutral `account_notifications` persistence primitive.

Representative fields:

~~~text
id uuid primary key
recipient_account_id uuid not null
actor_account_id uuid null
partnership_id uuid null
event_type text not null
deduplication_key text not null unique
created_at timestamptz not null
read_at timestamptz null
~~~

P2 event types initially include:

~~~text
partnership_formed
relationship_start_date_changed
~~~

Recipient semantics are exact:

- explicit accept: the accepting recipient receives the HTTP result; the original sender receives one `partnership_formed` notification
- reciprocal auto-pair: the triggering requester receives the paired HTTP result; the account that sent the earlier opposite request receives one `partnership_formed` notification
- relationship-date change: only the non-acting partner receives `relationship_start_date_changed`

Deterministic deduplication keys are:

~~~text
partnership-formed:<partnershipId>:<recipientAccountId>
relationship-start-date-changed:<partnershipId>:<metadataVersion>:<recipientAccountId>
~~~

The row stores routing identity and event type only. It does not duplicate relationship dates, private profile content, message content, or crypto material.

Minimal authenticated API:

~~~text
GET  /api/v1/notifications?limit=25&cursor=...
POST /api/v1/notifications/:notificationId/read
~~~

Notification list pagination reuses P1's versioned snapshot-bound keyset cursor pattern: the first page captures `snapshotAt`, later pages are bound to that snapshot, future-snapshot cursor values are rejected, and newly created notifications appear after canonical refresh rather than shifting an in-progress traversal.

Only the recipient account may read or mark a notification. Mark-read is idempotent: the first successful mutation sets `read_at`; later retries leave the original read timestamp unchanged.

Push transport remains a later notification milestone. P2 closure requires durable in-app delivery, not web-push provider integration.

## Fresh partnership security namespace

P2 does not create a second namespace identifier.

The fresh immutable `partnershipId` already is the namespace root for:

- server partnership-scoped authorization
- IndexedDB partitioning
- future conversation and relationship-space ownership
- future S1 cryptographic context binding

A later partnership between the same two accounts receives a different partnership ID and therefore a different namespace.

The partnership ID is an identifier, not key material and not authentication authority. P2 does not create fake keys, fake ratchets, or a fake `partnership_crypto_epochs` row. Real cryptographic roots and epochs begin only when S1 provisions the reviewed protocol.

Using one immutable namespace identifier avoids redundant security identifiers that could drift out of sync while still satisfying fresh local and future cryptographic isolation.

## Migration plan

### P1 migration 0008 substrate

P1 migration `0008_partner_discovery_requests_runtime.sql` is committed and locally verified.

It already provides:

- nullable legacy-compatible `relationship_start_date`
- new pending-row relationship-date enforcement
- persisted `expired_at`
- terminal-shape hardening
- request-attempt outcome/index hardening
- append-only request-attempt behavior
- request list/pair indexes

P2 must treat migration 0008 as verified P1-owned substrate. Do not rewrite migration 0008 during P2 implementation merely to add P2 behavior; any future schema correction must be forward-only under the migration policy.

P2 accept and reciprocal-formation paths fail closed on any retained legacy pending row whose relationship date is absent.
### P2 migration 0009

Committed migration:

~~~text
0009_partnership_formation_runtime.sql
~~~

Migration 0009 does not add a second partnership namespace column. The existing random immutable partnership ID is the namespace root.

Add to `partner_requests`:

~~~text
accepted_partnership_id uuid null references partnerships(id)
~~~

Use the default restrictive foreign-key behavior for `accepted_partnership_id`; a partnership tombstone cannot be physically removed while retained accepted-request evidence still references it. A future bounded-retention purge must remove or archive dependent request evidence first rather than silently nulling the replay identity.

Migration 0008 already enforces the accepted timestamp shape. Migration 0009 adds linkage without fabricating history:

~~~text
CHECK (status <> 'accepted' OR accepted_partnership_id IS NOT NULL) NOT VALID
CHECK (status = 'accepted' OR accepted_partnership_id IS NULL) NOT VALID
~~~

These `NOT VALID` constraints protect every new or updated row while allowing any pre-P2 legacy accepted evidence to remain untouched until an explicit retention/migration policy handles it.

New P2-accepted rows therefore require:

- `accepted_at` non-null through the existing 0008 terminal-shape constraint
- `accepted_partnership_id` non-null through 0009
- `relationship_start_date` non-null through the P1/P2 formation boundary

Non-accepted new or updated request states require `accepted_partnership_id` null.

Create `account_notifications` with recipient/account scoping, unique deduplication key, read timestamp, and partnership/actor references.

Add indexes for:

- accepted request partnership lookup
- account notifications by recipient and creation order
- unread account notifications

No new index is required for expiry-job cancellation because P1's scheduled-action deduplication key is unique and the consumed request IDs are already known.

Migration 0009 does not create cryptographic key material or an additional security namespace identifier.

## Package structure

### Domain

~~~text
packages/domain/src/partnership/
├── formation.ts
├── relationship-date.ts
├── capabilities.ts
├── state-machine.ts
├── time.ts
└── types.ts
~~~

Pure responsibilities:

- trusted-date relationship-date validation
- formation denial vocabulary
- formation-source semantics
- relationship metadata capability decision
- version-conflict semantics

### Contracts

~~~text
packages/contracts/src/partnerships/
├── formation.ts
├── relationship-date.ts
├── current.ts
└── notifications.ts
~~~

### Database

~~~text
packages/db/src/repositories/
├── partnership-formation.ts
├── partnerships.ts
└── account-notifications.ts
~~~

P2 reuses the P1 partner-request repository and invalidation helpers instead of duplicating request SQL.

### API

~~~text
apps/api/src/modules/partnerships/
├── routes/
│   ├── current.ts
│   └── relationship-date.ts
├── partnership-formation-coordinator.ts
└── partnership-service.ts

apps/api/src/modules/partner-requests/routes/
└── accept.ts

apps/api/src/modules/notifications/
├── list.ts
└── read.ts
~~~

## Repository operations

Representative repository operations:

~~~text
loadRequestParticipantsForLockOrder
lockPartnerRequestsById
loadFormationEligibilityForAccounts
insertPartnership
insertPartnershipMembers
markRequestsAccepted
cancelPendingRequestExpiryActions
loadCurrentPartnershipForAccount
lockPartnershipForMetadataUpdate
updateRelationshipStartDateIfVersion
insertAccountNotification
listAccountNotifications
markAccountNotificationRead
~~~

Every repository method receives an executor. The transaction owner is the application service/coordinator.

## Public error model

Stable P2 codes include:

~~~text
REQUEST_NOT_FOUND
REQUEST_NOT_AVAILABLE
PARTNERSHIP_UNAVAILABLE
RELATIONSHIP_DATE_FUTURE
PARTNERSHIP_METADATA_LOCKED
VERSION_CONFLICT
~~~

Privacy mapping:

- wrong recipient and unknown request use the same not-found response
- sender blocked, sender unavailable, sender occupied, sender cooldown, or stale reciprocal state do not expose detailed counterpart state
- cross-partnership guessed IDs do not reveal membership

Internal logs and tests may distinguish causes through typed internal outcomes without returning them publicly.

## Cache and browser security

All P2 authenticated reads and mutations inherit A1 cookie, origin, Fetch Metadata, and CSRF protections.

Partnership, request-accept, and notification responses use:

~~~text
Cache-Control: private, no-store
~~~

No state-changing GET route exists.

Relationship dates are private partnership metadata and must not appear in routine access logs or URL query strings.

## Lifecycle evidence

Formation appends one `partnership_formed` lifecycle event with:

- partnership ID
- actor where applicable
- aggregate generation 1
- metadata source `explicit_accept` or `reciprocal_request`

The lifecycle metadata does not include relationship date or private profile content.

Relationship-date edits are ordinary versioned metadata mutations, not lifecycle-generation transitions.

## P1 production-mode closure

When the P2 coordinator is registered:

- P1 `partnerRequestMode = paired` becomes valid
- production request creation may be enabled
- reciprocal requests form in the same transaction
- `request_only_test` remains forbidden in production
- `disabled` remains a valid operational kill switch

Startup fails closed if paired mode is configured but the coordinator is absent.

## Client behavior

P1 send-request UI includes a required relationship start-date field.

Before send:

- show that the date is the relationship date, not the request date
- reject future dates locally for immediate feedback
- still rely on server validation

Incoming request UI shows the proposed relationship start date.

Accepting a request requires an explicit accept action.

After formation:

- refresh current partnership canonically
- discard incompatible request cards returned invalid by the server
- initialize local partnership storage under the new partnership ID only
- never reuse caches from an earlier partnership even if the other member is the same account

Relationship settings expose date change only when the server capability permits it.

## Test architecture

### Domain tests

Cover:

- today is accepted as relationship date
- tomorrow is rejected
- client timezone does not affect trusted-date decision
- reciprocal initial date selects the triggering request proposal
- active and breakup-pending partnerships permit relationship-date edit
- account-deletion view-only and terminated states deny relationship-date edit
- metadata version conflict is stable

### Database integration tests

Use disposable PostgreSQL 16.

Cover:

- migration 0009 from zero after 0008
- fresh partnership-ID namespace isolation
- accepted request requires accepted partnership linkage
- two membership rows commit atomically
- occupied-slot unique index prevents a simultaneous second partnership
- two competing accepts sharing one account produce one partnership
- explicit accept versus reciprocal create produces one partnership
- accept versus sender-cancel produces one terminal outcome
- accept versus recipient-decline produces one terminal outcome
- reciprocal opposite-direction race produces one partnership
- accepted request replay resolves to the same partnership while retained
- accepted requests cancel their still-pending expiry actions
- a concurrently processing expiry action becomes a safe terminal no-op
- all incompatible pending requests become invalidated
- consumed reciprocal requests become accepted, not invalidated
- notification rows are atomic with formation/date update
- relationship-date expectedMetadataVersion race allows one winner
- same-date update is a no-op, including lost-response retry with the previous expectedMetadataVersion

### API integration tests

Cover:

- sender cannot accept own outgoing request
- wrong account cannot accept guessed request ID
- logically expired request cannot be accepted
- normal one-way request remains pending until recipient accepts
- explicit accept returns active partnership
- reciprocal request returns paired outcome
- current partnership read returns only safe fields
- future request relationship date is rejected
- future relationship-date update is rejected
- either active partner can update date
- non-member cannot update date
- relationship-date change creates one notification for the other partner
- notification list is account-scoped
- read mutation cannot mark another account's notification

### Race tests

Mandatory races:

- A receives requests from B and C; B and C accept concurrently
- A sends to B while B accepts A's earlier request
- A and B create reciprocal requests concurrently
- same accept request retried after lost response
- two relationship-date updates use the same expectedMetadataVersion
- formation races account deletion or block creation through shared account-lock order

### Security regressions

Cover:

- direct API cannot bypass account status, occupancy, cooldown, or block state
- request ID guessing does not reveal counterpart state
- partnership ID guessing cannot read or mutate another partnership
- relationship date never appears in URL query strings or generic logs
- notification rows contain no relationship date, message content, email, DOB, device data, or cryptographic material
- partnershipId is not authentication authority or key material
- no redundant security namespace ID and no raw cryptographic key material are created or stored by P2
- P1 production paired mode fails closed without coordinator registration

## Local verification commands

Committed commands:

~~~text
npm run test:partnership-formation
npm run test:p2:postgres
npm run test:p2:api
npm run test:p2:security
npm run test:p2:local
~~~

`test:p2:local` follows the F2/A1/P1 disposable PostgreSQL pattern and also reruns the P1 integration surface with the real coordinator in `paired` mode.

## Implemented source sequence and verified exit evidence

### P2-A Domain and contracts

Committed source includes relationship-date validation, formation types, stable denial codes, the centralized `change_relationship_start_date` capability, the existing P1 relationship-date/reciprocal handoff contract, and P2 accept/current/date/notification contracts.

Verified exit evidence:

- P2 domain/contracts pass 14/14
- the verified P1/P2 contract boundary remains intact without reopening P1

### P2-B Migration and repositories

Committed source consumes migration 0008 unchanged, adds migration 0009, accepted-request partnership linkage, legacy-safe `NOT VALID` linkage-shape constraints, `account_notifications`, formation/partnership/notification repositories, expiry-action cancellation, and database invariants.

Verified exit evidence:

- migrations 0001 through 0009 apply from zero
- database invariant suite passes
- migration and catalog checks pass
- migration 0008 remains unchanged at SHA-256 `94e2d22ceff3b73fc990fc07810cabedea097d7440a571c54c00ec185bebd18e`

### P2-C Formation coordinator and explicit acceptance

Committed source includes the transaction-scoped coordinator, recipient accept route, pair-locked eligibility rechecks, partnership and two-member creation, fresh partnership-ID namespace creation, accepted-request linkage, pending-expiry cancellation, incompatible-request invalidation, lifecycle evidence, deterministic formation notification, and retention-scoped stable replay.

Verified exit evidence:

- explicit acceptance, replay, invalidation, occupancy, rollback, accept-versus-cancel, and accept-versus-decline coverage passes
- persisted-state assertions verify the partnership-formation lifecycle event

### P2-D Reciprocal integration

Committed source registers the P2 coordinator in the application, forms from reciprocal candidates before the P1 transaction commits, accepts both source requests, cancels still-pending expiry actions, persists the P1 paired idempotency response, and retains fail-closed configuration checks when paired mode lacks a coordinator.

The standalone historical `test:p1:local` harness remains request-only. P2 closure separately reruns the P1 integration surface with the real coordinator in `paired` mode.

Verified exit evidence:

- reciprocal formation races produce exactly one partnership
- explicit-accept versus reciprocal-create converges on one partnership
- already-processing expiry work observes accepted request state and becomes a safe no-op
- production fail-closed configuration tests pass

### P2-E Relationship metadata, notification read model, and client

Committed source includes current-partnership reads, `expectedMetadataVersion` relationship-date mutation with canonical account-then-partnership locking, same-date lost-response no-op behavior, durable other-partner notification, notification list/read endpoints, request/accept/current-partnership browser flows, and relationship-date editing UI.

Verified exit evidence:

- relationship-date and notification acceptance coverage passes
- persisted-state assertions verify metadata edits leave lifecycle generation unchanged
- persisted-state assertions verify exact other-partner notification routing
- notification pagination remains snapshot-bound
- browser/API integration preserves canonical refresh and does not grant stale request UI authority

### P2-F Integration closure

Local closure is complete at commit `fa2301d0aab2e74aeac20336a4d675728922779e`.

Verified matrix:

1. P2 domain/contracts: 14/14 PASS
2. P2 security: 5/5 PASS
3. disposable PostgreSQL/API/worker integration: 27/27 PASS with `P2_LOCAL_POSTGRES_PASS`
4. migrations: 9/9 applied from zero
5. database invariants: PASS
6. full `npm run health`: PASS, including Domain 45/45, Contracts 15/15, API unit/security 16/16, Worker 4/4, typecheck, builds, lint, Prettier, and dependency checks
7. `npm audit --audit-level=high`: 0 vulnerabilities

The final test-quality review found missing persisted-state assertions rather than a production defect. Those assertions were added and the full verification remained green.

## Acceptance mapping

The ROADMAP_EPICS P2 gates remain canonical.

Implementation evidence must specifically prove:

- one-way request requires recipient acceptance
- reciprocal pending requests auto-form
- formation is one transaction
- database occupancy prevents a second partnership
- incompatible requests are invalidated
- relationship start date is manually supplied through request consent data
- future relationship dates are rejected by trusted server date
- either active partner can update the date
- the other partner receives durable in-app notification
- every formation creates a fresh partnership identifier and never reuses an old local or cryptographic namespace
- concurrency tests prove one-partner occupancy

## Review invariants

Reject a P2 implementation if it:

1. forms a partnership asynchronously after the authoritative request transaction
2. forms without fresh consent from both accounts
3. trusts a client-supplied account pair rather than deriving members from authoritative request state
4. trusts client time for relationship-date validity
5. forms from an expired request
6. forms while either account is inactive, occupied, blocked, or cooldown-ineligible
7. acquires pair account locks in inconsistent order
8. duplicates P1 request-limit or request-expiry logic instead of reusing the P1 boundary
9. marks reciprocal source requests invalidated instead of accepted
10. leaves incompatible pending requests active after formation
11. relies only on application checks for one-partner occupancy
12. starts provider calls inside the formation transaction
13. creates an E2EE epoch or key schedule before S1 protocol review
14. reuses an old partnership identifier or any old local/cryptographic namespace
15. uses relationship activation timestamp as the relationship start date
16. permits future relationship dates because the client clock says they are valid
17. increments lifecycle generation for a metadata-only relationship-date edit
18. silently overwrites a concurrent relationship-date change without expectedMetadataVersion
19. rejects a lost-response retry solely because the successful prior update advanced metadataVersion while the requested date already matches
20. emits duplicate notifications for a no-op date update
21. exposes private counterpart eligibility reasons in public errors
22. allows guessed partnership or notification IDs to cross account boundaries
23. stores relationship dates or private content in notification routing rows
24. leaves accepted-request expiry jobs pending without intentionally handling the race
25. rewrites committed P1 migration 0008 for P2-only behavior
26. enables P1 production paired mode without the P2 coordinator

## Completion rule

P2 is DONE. Every P2 acceptance gate in `docs/ROADMAP_EPICS.md` is satisfied with committed source, migrations 0008 and 0009, repeatable local PostgreSQL/API/worker/race/security evidence, a committed lockfile, a green full repository health regression, and a zero-high-severity dependency audit. Closure evidence includes P2 domain/contracts 14/14, security 5/5, nine migrations from zero with database invariants green, and the disposable integration matrix 27/27 with `P2_LOCAL_POSTGRES_PASS`.

Hosted GitHub Actions verification remains separate under V1.

## Physical-device requirement

P2 does not require Redmi physical-device evidence for epic closure.

Browser/API/PostgreSQL evidence is sufficient. Physical-device acceptance begins with later offline, media, notification-push, calling, and cryptographic milestones.
