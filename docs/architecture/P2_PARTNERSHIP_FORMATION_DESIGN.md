# P2 Partnership Formation and Relationship Date Architecture and Implementation Design

## Status

REFINED DESIGN, IMPLEMENTATION PENDING

Effective design date: 2026-09-21.

This document is the canonical implementation design for P2 Partnership Formation and Relationship Date.

P2 preserves Architecture Baseline 1.0. It builds on the verified A1 account/session/security substrate, the refined P1 discovery/request contract, the existing partnership state machine, the F2 transaction/outbox primitives, and PostgreSQL-enforced partnership occupancy.

No distributed formation service, asynchronous pairing authority, Redis lock, provider call, or custom cryptographic protocol is introduced. No ADR is required.

Source code, migrations, and tests remain authoritative for behavior that is actually implemented.

## Refinement review

The P2 design was refined before P1 runtime implementation so the cross-epic contract can be correct on the first implementation pass.

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
- creation of a fresh partnership security namespace without pretending S1 E2EE is already implemented
- privacy-safe public error mapping
- P1 production enablement once the formation coordinator exists

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

P1 remains the active runtime epic. P2 runtime integration depends on P1 supplying:

- authenticated partner requests
- deterministic sorted account locks
- logical request-expiry handling
- pair eligibility checks and block/cooldown state
- request invalidation helpers
- reciprocal candidate detection
- request creation idempotency

P2 owns:

- explicit accept
- transactional formation
- reciprocal auto-pair execution
- accepted-request to partnership linkage
- one-slot recheck at formation time
- fresh partnership security namespace creation
- relationship start-date authority
- relationship date updates
- durable in-app partnership notifications required by P2

P3 owns post-formation breakup, restoration, dissolution, account-deletion lifecycle integration, cooldown persistence, and former-partner blocking.

M1 owns primary conversation creation and messaging runtime.

S1 owns the reviewed cryptographic protocol, real key material, device key delivery, cryptographic epochs, rotation, and recovery.

## Cross-epic refinement required before P1 implementation

Every partner request must carry the sender's manually entered proposed relationship start date.

P1 create input becomes conceptually:

~~~text
{
  recipientAccountId,
  expectedUsername,
  relationshipStartDate
}
~~~

`relationshipStartDate` is a calendar date string. P1 validates it against trusted PostgreSQL UTC business date and persists it with the request.

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
- fresh partnership and security-context identifiers
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

Formation is one PostgreSQL transaction.

The transaction either commits all of:

- partnership row
- two membership rows
- accepted request state and accepted partnership linkage
- incompatible request invalidation
- fresh security namespace
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

Relationship-date update locks only the target partnership row after authentication and membership lookup. It never acquires unrelated account-pair locks.

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

The modular-monolith boundary is conceptually:

~~~text
PartnershipFormationCoordinator.formLockedPair(
  executor,
  candidate,
  now
) -> FormationOutcome
~~~

Candidate shape:

~~~text
FormationCandidate {
  accountIds: sorted [accountA, accountB]
  requestIds: [one explicit request] | [two reciprocal requests]
  triggeringRequestId
  relationshipStartDate
  source: explicit_accept | reciprocal_request
  actorAccountId
}
~~~

Requirements:

- `executor` is the caller's current F2 transaction executor
- the coordinator does not start a nested authoritative transaction
- callers already hold the sorted account locks
- candidate IDs are never trusted without re-reading authoritative rows
- request expiry is rechecked using transaction time
- account status, occupancy, cooldown, and pair block state are rechecked
- reciprocal candidates must still be opposite directions for the same two accounts
- explicit acceptance must still identify the authenticated recipient
- the coordinator returns the committed partnership identity to the caller

P1's existing `handleReciprocalCandidate` integration point becomes a thin adapter into this coordinator.

## Explicit acceptance API

~~~text
POST /api/v1/partner-requests/:requestId/accept
~~~

No account ID or relationship date is accepted in the request body.

The member pair and initial date come from the authoritative request row.

Transaction:

1. authenticate with A1
2. begin transaction
3. obtain PostgreSQL transaction time
4. read only immutable request participant IDs needed for lock order
5. lock both accounts in canonical order
6. re-read and lock the request row
7. verify the authenticated account is the recipient
8. lazily expire the request if the exact seven-day deadline has arrived
9. if already accepted by this formation path, replay the same partnership success
10. if otherwise terminal, return request unavailable
11. recheck both accounts, blocks, cooldowns, and occupancy
12. validate the request's relationship start date against trusted server date
13. invoke the formation coordinator
14. commit

Wrong-recipient and unknown-request cases use the same not-found shape.

Accept is not product-rate-limited. Consent and safety actions must not become unavailable because discovery or request-create abuse buckets were exhausted.

## Accept replay and lost responses

`partner_requests` stores `accepted_partnership_id` when accepted.

If the first accept commits but the HTTP response is lost, retrying the same accept by the legitimate recipient returns the same partnership identity.

This makes explicit acceptance naturally idempotent without requiring a separate Idempotency-Key.

An accepted request never creates a second partnership on replay.

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
8. P2 invalidates all other incompatible pending requests for both accounts
9. P2 creates durable partnership-formed notifications
10. P2 returns the pairing outcome to P1
11. P1 stores the final paired response in its existing create idempotency record
12. the single transaction commits

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
  expectedVersion
}
~~~

Rules:

- authenticate with A1
- target partnership ID is explicit and immutable
- verify current membership server-side
- relationship metadata is editable only while lifecycle state is `active`
- `breakup_pending`, account-deletion view-only state, and terminated state reject the mutation
- future dates are rejected using trusted PostgreSQL UTC date
- `expectedVersion` must equal the current partnership `version`
- a successful change increments `version` by one
- relationship date change does not increment lifecycle `generation`
- changing to the already-current date is an idempotent no-op: no version bump and no duplicate notification
- the other partner receives one durable notification after a real committed change

`version` protects mutable partnership metadata from lost updates.

`generation` remains reserved for lifecycle/deadline fencing used by P3 and deletion interactions.

## Relationship metadata capability

The central capability model adds:

~~~text
change_relationship_start_date
~~~

Decision:

- active partnership member: allowed
- breakup_pending: denied with `PARTNERSHIP_METADATA_LOCKED`
- account-deletion view-only state: denied
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
    version,
    otherMember: { accountId, username, displayName }
  }
}
~~~

The response is `Cache-Control: private, no-store`.

It does not expose the internal security-context identifier, cooldown internals, email, DOB, sessions, devices, or cryptographic state.

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

The row stores routing identity and event type only. It does not duplicate relationship dates, private profile content, message content, or crypto material.

Minimal authenticated API:

~~~text
GET  /api/v1/notifications?limit=25&cursor=...
POST /api/v1/notifications/:notificationId/read
~~~

Only the recipient account may read or mark a notification.

Push transport remains a later notification milestone. P2 closure requires durable in-app delivery, not web-push provider integration.

## Fresh partnership security namespace

Every partnership receives a new opaque non-secret:

~~~text
security_context_id uuid
~~~

Rules:

- unique across partnerships
- generated server-side for every new partnership
- never copied from an earlier partnership
- never derived from either username
- not authentication authority
- not cryptographic key material
- not exposed in ordinary partnership API responses

The partnership ID is the local persistence namespace root.

`security_context_id` is the future cryptographic namespace root identifier that S1 will bind to reviewed cryptographic state.

P2 does not create fake keys, fake ratchets, or a fake `partnership_crypto_epochs` row.

`partnership_crypto_epochs` remains unpopulated until S1 provisions real reviewed cryptographic state.

This satisfies isolation now without claiming E2EE before it exists.

## Migration plan

### P1 migration 0008 refinement

Because P1 runtime has not started, migration `0008_partner_discovery_requests_runtime.sql` should include the request field needed by P2:

~~~text
partner_requests.relationship_start_date date NOT NULL
~~~

Fresh request creation always supplies it.

Do not invent a relationship date for legacy accepted rows. If non-disposable pre-P2 data contains accepted requests without a trustworthy manually entered date, migration must fail clearly rather than silently fabricate product history.

P1 indexes and terminal-shape hardening remain otherwise unchanged.

### P2 migration 0009

Reserve:

~~~text
0009_partnership_formation_runtime.sql
~~~

Add to `partnerships`:

~~~text
security_context_id uuid
~~~

Migration sequence:

1. add nullable column
2. deterministically backfill pre-P2 development rows from immutable partnership ID using a domain-separated non-secret UUID derivation
3. add unique constraint/index
4. set NOT NULL

New runtime rows use cryptographically random UUIDs rather than deterministic derivation.

Add to `partner_requests`:

~~~text
accepted_partnership_id uuid null references partnerships(id) on delete set null
~~~

Add accepted-shape protection so new accepted rows require:

- `accepted_at` non-null
- `accepted_partnership_id` non-null
- `relationship_start_date` non-null

Non-accepted request states require `accepted_partnership_id` null.

Create `account_notifications` with recipient/account scoping, unique deduplication key, read timestamp, and partnership/actor references.

Add indexes for:

- accepted request partnership lookup
- account notifications by recipient and creation order
- unread account notifications

Migration 0009 does not create cryptographic key material.

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
- active partnership permits relationship-date edit
- breakup-pending and terminated states deny relationship-date edit
- metadata version conflict is stable

### Database integration tests

Use disposable PostgreSQL 16.

Cover:

- migration 0009 from zero after 0008
- security-context uniqueness
- accepted request requires accepted partnership linkage
- two membership rows commit atomically
- occupied-slot unique index prevents a simultaneous second partnership
- two competing accepts sharing one account produce one partnership
- explicit accept versus reciprocal create produces one partnership
- reciprocal opposite-direction race produces one partnership
- accepted request replay resolves to the same partnership
- all incompatible pending requests become invalidated
- consumed reciprocal requests become accepted, not invalidated
- notification rows are atomic with formation/date update
- relationship-date expected-version race allows one winner
- same-date update is a no-op

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
- two relationship-date updates use the same expectedVersion
- formation races account deletion or block creation through shared account-lock order

### Security regressions

Cover:

- direct API cannot bypass account status, occupancy, cooldown, or block state
- request ID guessing does not reveal counterpart state
- partnership ID guessing cannot read or mutate another partnership
- relationship date never appears in URL query strings or generic logs
- notification rows contain no relationship date, message content, email, DOB, device data, or cryptographic material
- security_context_id is not authentication authority
- no raw cryptographic key material is created or stored by P2
- P1 production paired mode fails closed without coordinator registration

## Proposed local commands

Expected additions:

~~~text
npm run test:partnership-formation
npm run test:p2:postgres
npm run test:p2:api
npm run test:p2:security
npm run test:p2:local
~~~

`test:p2:local` follows the F2/A1 disposable PostgreSQL pattern.

## Implementation sequence

### P2-A Domain, contracts, and cross-epic contract refinement

1. add relationship-date pure validation
2. add partnership-formation types and stable denial codes
3. add `change_relationship_start_date` capability
4. refine P1 create/list contracts with relationshipStartDate
5. refine P1 reciprocal candidate with triggeringRequestId and relationshipStartDate
6. add P2 accept/current/date/notification contracts

Exit gate:

- domain and contract tests pass
- P1 and P2 contract boundary is unambiguous

### P2-B Migration and repositories

1. extend planned P1 migration 0008 with request relationship_start_date
2. add migration 0009
3. add partnership security_context_id
4. add accepted_partnership_id linkage
5. add accepted-shape constraints
6. add account_notifications
7. add formation and partnership repositories
8. add notification repository
9. extend database invariants

Exit gate:

- migrations 0001 through 0009 apply from zero
- invariant suite passes
- new indexes and constraints are inspected

### P2-C Formation coordinator and explicit acceptance

1. implement transaction-scoped coordinator
2. implement explicit accept route
3. recheck P1 eligibility under pair locks
4. create partnership and two members
5. create fresh security_context_id
6. mark accepted request with partnership link
7. invalidate other pending requests
8. append partnership_formed lifecycle event
9. create durable in-app formation notifications
10. implement stable replay

Exit gate:

- explicit acceptance, replay, invalidation, occupancy, and rollback tests pass

### P2-D Reciprocal integration

1. inject coordinator into P1
2. enable paired mode in non-production test first
3. form partnership from reciprocal candidate before P1 commit
4. accept both request rows
5. persist P1 idempotency paired response
6. verify opposite-direction races
7. verify accept-versus-reciprocal race
8. enable production paired mode only after all coordinator tests pass

Exit gate:

- reciprocal formation races produce exactly one partnership
- production fail-closed configuration tests pass

### P2-E Relationship metadata, notification read model, and client

1. current partnership read
2. version-checked relationship-date mutation
3. same-date no-op
4. durable other-partner notification
5. notification list/read endpoints
6. P1 send-request relationship-date UI
7. incoming request date display
8. accept action
9. current partnership state UI
10. relationship date settings UI

Exit gate:

- relationship-date and notification acceptance tests pass
- browser integration proves canonical refresh and no stale-request UI authority

### P2-F Integration closure

1. run complete P2 domain/contract suite
2. run disposable PostgreSQL/API/race/security suite
3. run dependency audit if dependencies changed
4. run full npm run health
5. reconcile docs repo-wide
6. mark only verified P2 gates complete

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
- every formation creates new partnership and security-context identifiers
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
14. reuses an old partnership or security-context identifier
15. uses relationship activation timestamp as the relationship start date
16. permits future relationship dates because the client clock says they are valid
17. increments lifecycle generation for a metadata-only relationship-date edit
18. silently overwrites a concurrent relationship-date change without expectedVersion
19. emits duplicate notifications for a no-op date update
20. exposes private counterpart eligibility reasons in public errors
21. allows guessed partnership or notification IDs to cross account boundaries
22. stores relationship dates or private content in notification routing rows
23. enables P1 production paired mode without the P2 coordinator

## Completion rule

P2 is DONE only when every P2 acceptance gate in `docs/ROADMAP_EPICS.md` is satisfied with committed source, migrations 0008 and 0009, repeatable local PostgreSQL/API/race/security evidence, a committed lockfile, and a green full repository health regression.

Design completion changes P2 from PLANNED to IN_PROGRESS at the design layer. It does not check runtime acceptance gates.

Hosted GitHub Actions verification remains separate under V1.

## Physical-device requirement

P2 does not require Redmi physical-device evidence for epic closure.

Browser/API/PostgreSQL evidence is sufficient. Physical-device acceptance begins with later offline, media, notification-push, calling, and cryptographic milestones.
