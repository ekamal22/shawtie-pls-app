# P1 Discovery and Partner Requests Architecture and Implementation Design

## Status

DESIGNED, IMPLEMENTATION PENDING

Effective design date: 2026-09-21.

This document is the canonical implementation design for P1 Discovery and Partner Requests.

P1 preserves Architecture Baseline 1.0 and builds on the verified F2 transaction/worker substrate plus the refined A1 account, session, normalization, and security-rate-limit design.

No new trust boundary, lifecycle authority, persistent state system, provider, or dependency direction is introduced. No ADR is required.

Source code, migrations, and tests remain authoritative for behavior that is actually implemented.

## Dependency boundary

P1 may be designed now and partially implemented in parallel with A1.

Implementation dependencies are:

- P1 domain rules and contracts may begin immediately
- P1 migration 0008 follows planned A1 migration 0007
- P1 reuses A1 authenticated sessions
- P1 reuses A1 username normalization
- P1 reuses A1 trusted PostgreSQL business time
- P1 reuses A1 security_rate_limit_buckets
- P1 full API integration waits for A1-C authenticated accounts and sessions
- P2 consumes P1 reciprocal-request detection to perform actual partnership formation

P1 does not create partnerships.

P2 owns explicit acceptance and transactional partnership formation.

## Goals

P1 must provide:

- exact authenticated username discovery
- privacy-safe public profile projection
- exact server-authoritative request expiry
- request creation
- sender cancellation
- recipient decline
- rolling one-calendar-month pair limit
- exact one-hour post-decline cooldown
- multiple incoming requests
- same-direction duplicate rejection
- self-request rejection
- active block enforcement
- sender and recipient partnership-eligibility checks
- durable expiry scheduling
- reciprocal-request detection for P2
- durable abuse controls
- deterministic race behavior
- no broad account enumeration
- repeatable PostgreSQL, API, race, and security verification

P1 does not implement:

- request acceptance
- partnership creation
- relationship start date
- incompatible request invalidation after partnership formation
- push or realtime request delivery
- fuzzy discovery
- contact upload
- phone-number discovery
- recommendation or ranking
- public directory browsing
- dating-style discovery

## Authoritative product rules

P1 preserves the current PRD:

- discovery is by username
- first-version discovery is exact or normalized exact match
- broad public enumeration is avoided
- safe result fields are username, display name, optional avatar, optional bio, and current age
- exact date of birth and email are never exposed
- a block hides the blocker from the blocked former partner's normal username search
- pending requests expire exactly seven days after creation
- sender may cancel before acceptance
- recipient may decline
- decline does not create a block
- at most three successfully created requests from one sender to one recipient may occur in any rolling one-month period
- decline creates an exact one-hour same-pair cooldown
- multiple incoming requests may coexist
- self-request is rejected
- duplicate same-direction pending request is rejected
- either-direction active block rejects request creation
- both accounts must be eligible for a future partnership
- reciprocal active requests represent consent from both accounts and must trigger P2 automatic pairing
- silence or prior consent never substitutes for fresh consent

## Exact time semantics

P1 uses PostgreSQL transaction time.

### Request expiry

A request is logically pending only while:

~~~text
status = pending
AND transaction_time < expires_at
~~~

At:

~~~text
transaction_time >= expires_at
~~~

the request is expired even if the scheduled expiry worker has not yet persisted status = expired.

Worker delay must never extend the seven-day product window.

Any mutating operation that locks an overdue pending request may lazily transition it to expired before returning.

The persisted expired_at value is the original expires_at deadline, not the later worker execution time.

### One-hour decline cooldown

A new request is blocked while:

~~~text
transaction_time < last_declined_at + interval '1 hour'
~~~

At the exact one-hour boundary, a new request is allowed if all other rules pass.

### Rolling one-month request limit

Only successfully created requests count toward the product limit.

For a proposed request at transaction time now, count prior created attempts where:

~~~text
created_at > now - interval '1 month'
AND created_at < now
~~~

At the exact one-calendar-month boundary, the older request no longer counts.

Cancelled, declined, expired, or later invalidated requests still count because they were successfully sent.

Rejected attempts do not count toward the three-request product limit, though they may contribute to abuse-rate-limit buckets.

## Discovery privacy model

Discovery is authenticated.

There is no unauthenticated username lookup endpoint.

The first version accepts one normalized username query and returns at most one result.

No prefix, fuzzy, wildcard, phonetic, typo-tolerant, popularity-ranked, or paginated account search exists in P1.

Discovery result:

~~~text
accountId
username
displayName
age
bio nullable
avatar nullable or omitted until media support exists
~~~

accountId is an opaque transport identifier used by the authenticated client to target a later partner request. It is not a public-facing username substitute and should not be displayed as profile data.

The result never contains:

- email
- exact date of birth
- session state
- device state
- IP metadata
- partnership history
- former partners
- current partnership state
- cooldown state
- request-limit state
- block state
- security metadata

Age is calculated from date_of_birth using the same trusted UTC server-date rule as A1.

### Search visibility

Discovery returns no result when:

- username does not exist
- account status is not active
- query resolves to the authenticated account itself
- the target account has actively blocked the authenticated account

The current PRD specifically requires the blocker to disappear from the blocked former partner's search results.

P1 does not add a stronger symmetric discovery-hiding rule without a product decision.

If the authenticated account previously blocked the target, the target may still be discoverable under the current PRD, but request creation remains prohibited because either-direction block prevents requests.

Search does not reveal whether the target is currently partnered or in a partnership cooldown.

## Stable target identity

Username is mutable.

A search result therefore returns both:

~~~text
accountId
username
~~~

Partner-request creation accepts:

~~~text
recipientAccountId
expectedUsername
~~~

The request transaction locks the recipient account and verifies that the current normalized username still matches expectedUsername.

If the username changed after discovery, request creation fails with TARGET_CHANGED and the client must search again.

This prevents a stale search result from accidentally targeting a different username owner after an old username is released and later reclaimed.

## Runtime architecture

~~~text
React PWA
   |
   | authenticated HTTPS
   v
Fastify API
   |
   +-- A1 session authentication
   +-- boundary validation
   +-- P1 application services
   +-- P1 pure domain rules
   |
   v
@shawtie/db
   |
   +-- accounts
   +-- profiles
   +-- partnership occupancy
   +-- partner eligibility cooldown
   +-- former-partner blocks
   +-- partner requests
   +-- request attempt ledger
   +-- A1 security rate-limit buckets
   +-- F2 scheduled actions
   |
   v
PostgreSQL

Durable worker
   |
   +-- partner request expiry handler
~~~

PostgreSQL is authoritative.

The client never decides:

- whether an account is eligible
- whether the request limit is reached
- whether decline cooldown is active
- whether a block is active
- whether a request is expired
- whether a reciprocal request is valid

## Package structure

### Domain

Target:

~~~text
packages/domain/src/partner-requests/
├── types.ts
├── time.ts
├── eligibility.ts
└── transitions.ts
~~~

Pure responsibilities:

- exact expiry boundary
- exact decline-cooldown boundary
- rolling-month cutoff helper
- stable request denial reasons
- request state transition eligibility
- pair eligibility composition

Infrastructure does not enter packages/domain.

### Contracts

Target:

~~~text
packages/contracts/src/partner-requests/
├── discovery.ts
├── requests.ts
└── common.ts
~~~

### Database

Target:

~~~text
packages/db/src/repositories/
├── partner-discovery.ts
└── partner-requests.ts
~~~

P1 uses the existing deterministic account-lock helper.

### API

Target:

~~~text
apps/api/src/modules/partner-requests/
├── routes/
│   ├── discovery.ts
│   ├── list.ts
│   ├── create.ts
│   ├── cancel.ts
│   └── decline.ts
└── services/
    ├── discovery-service.ts
    └── partner-request-service.ts
~~~

### Worker

Target:

~~~text
apps/worker/src/partner-requests/
└── expire-partner-request-handler.ts
~~~

## P1 migration

P1 reserves:

~~~text
0008_partner_discovery_requests_runtime.sql
~~~

It follows planned A1 migration 0007.

Migrations 0001 through 0006 remain immutable.

Migration 0008 refines existing request tables rather than replacing them.

### partner_requests additions

Add:

~~~text
expired_at timestamptz
~~~

Add a terminal-shape constraint.

Expected shapes:

~~~text
pending:
  accepted_at null
  declined_at null
  cancelled_at null
  expired_at null
  invalidated_at null

accepted:
  accepted_at non-null
  all other terminal timestamps null

declined:
  declined_at non-null
  all other terminal timestamps null

cancelled:
  cancelled_at non-null
  all other terminal timestamps null

expired:
  expired_at non-null
  all other terminal timestamps null

invalidated:
  invalidated_at non-null
  all other terminal timestamps null
~~~

Existing exact seven-day expires_at constraint remains authoritative.

Add indexes for:

- sender pending lookup
- recipient pending lookup
- exact pair pending lookup
- declined pair lookup
- expiry worker lookup if the scheduled-action path needs supporting request access

### partner_request_attempts hardening

The attempt ledger remains the durable pair-limit and abuse-evidence source.

Extend allowed outcomes to cover explicit P1 decisions such as:

~~~text
created
rate_limited
decline_cooldown
blocked
ineligible
duplicate
self_request
target_changed
~~~

The public API need not expose these internal outcome distinctions.

Add a partial pair/time index for:

~~~text
outcome = created
~~~

so the rolling product limit reads only successfully sent requests.

Make attempt rows append-only while retained.

Retention must never delete a created attempt before it can no longer affect the rolling one-month rule.

Longer abuse-metadata retention remains governed by the security metadata policy.

## A1 rate-limit primitive refinement

Before A1 runtime implementation, the previously auth-specific draft name for the generic rate-limit table is replaced by:

~~~text
security_rate_limit_buckets
~~~

The table was not yet implemented, so this is a design refinement rather than a migration.

A1 authentication and P1 abuse controls share the same persistence primitive with different scope values.

P1 does not create Redis or an in-memory-only limiter.

## P1 abuse-rate limits

Product limits and abuse limits are different.

The three-request rolling pair limit and one-hour decline cooldown are product rules.

The following are default abuse controls and remain configurable.

### Exact discovery

Per authenticated account:

~~~text
60 searches / 10 minutes
~~~

Per privacy-preserving network key:

~~~text
180 searches / 10 minutes
~~~

### Request creation

Per authenticated sender:

~~~text
30 creation attempts / 1 hour
~~~

Per privacy-preserving network key:

~~~text
120 creation attempts / 1 hour
~~~

The network key uses the trusted-proxy and network-prefix rules defined by A1.

Rate-limited API responses use HTTP 429 with a stable RATE_LIMITED body and a bounded retry hint.

### Safety actions are not product-rate-limited

Sender cancellation and recipient decline are safety/control actions.

P1 does not block cancel or decline because the account exhausted discovery or request-creation abuse buckets.

Infrastructure-level denial-of-service protection may still exist outside product logic.

## Public API

All routes use /api/v1 and A1 authentication.

### Exact username discovery

~~~text
POST /api/v1/discovery/username
~~~

Input:

~~~text
username
~~~

Response:

~~~text
{
  result: null | {
    accountId,
    username,
    displayName,
    age,
    bio
  }
}
~~~

Absent, self, inactive, deleted, deletion-pending, or hidden-by-target-block results all use the same null result shape.

Discovery is read-only but remains JSON-only.

### List active partner requests

~~~text
GET /api/v1/partner-requests
~~~

Response:

~~~text
{
  incoming: [...],
  outgoing: [...]
}
~~~

Only logically active pending requests are returned:

~~~text
status = pending
AND expires_at > transaction_time
~~~

Each entry exposes:

- requestId
- direction
- counterpart safe profile projection
- createdAt
- expiresAt

It never exposes counterpart email, exact DOB, partnership history, cooldown, or block metadata.

The list operation does not require a database write merely to clean overdue rows.

### Create partner request

~~~text
POST /api/v1/partner-requests
~~~

Input:

~~~text
recipientAccountId
expectedUsername
~~~

Response may represent:

~~~text
created
reciprocal_pair_ready
~~~

P1 does not return the internal reason for recipient-side unavailability.

### Cancel outgoing request

~~~text
POST /api/v1/partner-requests/:requestId/cancel
~~~

Only the sender may cancel.

### Decline incoming request

~~~text
POST /api/v1/partner-requests/:requestId/decline
~~~

Only the recipient may decline.

P1 has no accept endpoint.

Acceptance and partnership creation belong to P2.

## Request creation transaction

Request creation is one authoritative F2 transaction.

Order:

1. authenticate sender before entering the business transaction
2. validate boundary input
3. apply account/network abuse-rate-limit buckets
4. begin authoritative transaction
5. load PostgreSQL transaction time
6. lock sender and recipient accounts in immutable UUID order
7. confirm both account rows exist
8. reject self request
9. confirm sender account is active
10. confirm recipient account is active
11. verify recipient current username equals expectedUsername
12. load sender and recipient current partnership occupancy
13. load open partner-eligibility cooldown rows
14. load active blocks in either direction
15. lock pending request rows for this account pair
16. lazily expire pair requests whose expires_at is at or before transaction time
17. reject same-direction active duplicate
18. check latest sender-to-recipient decline cooldown
19. count prior successfully created pair attempts inside the rolling calendar month
20. evaluate both accounts for prospective partnership eligibility
21. insert partner request with created_at = transaction time
22. set expires_at = created_at + interval '7 days'
23. append request-attempt outcome created
24. insert F2 scheduled action for exact request expiry
25. detect active reciprocal request
26. return reciprocal-pair signal to the application service
27. commit

The database unique index remains final protection against same-direction duplicate races.

## Eligibility and public denial mapping

The service separates internal denial reason from public response.

### Sender-side conditions

The authenticated sender may receive a specific stable denial for their own state, for example:

- ACCOUNT_LOCKED
- PARTNERSHIP_OCCUPIED
- COOLDOWN_ACTIVE
- REQUEST_MONTHLY_LIMIT
- REQUEST_DECLINE_COOLDOWN
- REQUEST_ALREADY_PENDING
- REQUEST_SELF
- TARGET_CHANGED

### Recipient-side conditions

The API does not reveal whether the recipient is:

- partnered
- in cooldown
- deletion pending
- blocking the sender
- otherwise safety-ineligible

These map to:

~~~text
TARGET_UNAVAILABLE
~~~

This avoids turning the request endpoint into a hidden partnership-status or block-status oracle.

## Pair eligibility

P1 reuses the central capability model for fundamental form-partnership eligibility.

For each account, the service loads authoritative account, occupancy, cooldown, and relevant block state.

A P1-specific pure helper composes:

- sender form-partnership capability
- recipient form-partnership capability
- pair request limit
- pair decline cooldown
- duplicate request state
- exact request timing

P1 must not copy a second incompatible implementation of occupancy or cooldown rules into route handlers.

## Reciprocal request boundary with P2

P1 detects reciprocal active requests.

It does not create the partnership.

The internal transaction result may include:

~~~text
ReciprocalPairCandidate {
  accountIds sorted
  requestIds sorted
  observedAt
}
~~~

No pairing event is placed on an asynchronous queue as the authority for partnership creation.

When P2 is implemented, the request-creation transaction will pass the reciprocal pair candidate to the P2 partnership-formation coordinator before commit while the same deterministic account locks are still held.

P2 then:

- rechecks pair eligibility
- creates the partnership transactionally
- marks the reciprocal requests accepted
- invalidates incompatible pending requests
- creates fresh partnership namespace state
- writes required outbox/lifecycle records
- commits once

This prevents a second partnership or asynchronous pairing race.

Until P2 is wired, P1 may be locally verified as a request subsystem, but public product enablement of reciprocal requests must not claim complete product behavior.

## Simultaneous opposite-direction requests

Both request transactions lock the same two account rows in the same UUID order.

Therefore:

- one transaction proceeds first
- it creates one direction
- the second proceeds afterward
- it sees the first pending request
- it creates the opposite direction if all rules still pass
- exactly the second committed request observes reciprocal-pair readiness

When P2 exists, the second transaction performs the auto-pair operation before commit.

## Same-direction duplicate race

Two simultaneous same-direction requests also serialize on the same account pair locks.

The second transaction observes the first pending request and returns REQUEST_ALREADY_PENDING.

The partial unique index remains defense in depth.

## Request cancellation

Cancellation transaction:

1. authenticate account
2. begin transaction
3. load PostgreSQL transaction time
4. lock sender account
5. lock request row
6. return not found if the authenticated account is not the sender
7. if already terminal, return stable terminal-state result
8. if pending but transaction time is at or after expires_at, mark expired with expired_at = expires_at and return expired
9. otherwise set status = cancelled
10. set cancelled_at = transaction time
11. commit

Cancellation does not erase the original created attempt from the rolling one-month count.

## Request decline

Decline transaction:

1. authenticate account
2. begin transaction
3. load PostgreSQL transaction time
4. lock recipient account
5. lock request row
6. return not found if the authenticated account is not the recipient
7. if already terminal, return stable terminal-state result
8. if pending but transaction time is at or after expires_at, mark expired with expired_at = expires_at and return expired
9. otherwise set status = declined
10. set declined_at = transaction time
11. commit

Decline does not create a block.

A later request from the same sender is prohibited until the exact one-hour boundary.

## Request expiry worker

Every successfully created request gets a scheduled action.

Representative scheduled action:

~~~text
action_type: partner_request_expire
aggregate_type: partner_request
aggregate_id: request_id
execute_at: request.expires_at
payload_version: 1
deduplication_key: partner-request-expire:<request_id>
~~~

The expiry handler:

1. locks and verifies the scheduled claim using F2 fencing
2. locks the request
3. loads PostgreSQL transaction time
4. if request is no longer pending, complete the scheduled action as a no-op
5. if transaction time is before expires_at, retry at expires_at
6. otherwise set status = expired
7. set expired_at = expires_at
8. complete the scheduled action in the same authoritative transaction
9. commit

Correctness never depends on the worker running at the exact deadline because every API read and mutation uses logical expiry.

## Request list projection

Incoming and outgoing lists use a bounded deterministic order:

~~~text
created_at DESC, id DESC
~~~

P1 returns at most 100 active requests per direction in one response.

This is a safety cap, not a product limit on receiving requests.

No offset pagination is required for P1 because current product constraints should keep practical request volume low. If real production evidence requires pagination, add cursor pagination without changing request semantics.

## Lock order

P1 extends the A1 business lock order.

For pair operations:

~~~text
1. account rows in immutable UUID order
2. partnership rows when required
3. partner request rows in immutable request-ID order
4. block/cooldown rows when explicitly locked
5. lower-ranked A1 session/device/challenge/idempotency/rate-limit rows when the operation requires them
~~~

A1 authentication lookup happens before the P1 business transaction and is not held as a row lock through the business mutation.

Future P2 partnership formation and P3 block creation must lock the same account pair in the same deterministic order.

## Security and privacy

P1 treats discovery and request creation as abuse-sensitive authenticated surfaces.

Requirements:

- exact search only
- authenticated search only
- no broad account list
- no target relationship-status disclosure
- no target cooldown disclosure
- no target block disclosure
- no exact DOB disclosure
- no email disclosure
- no session/device disclosure
- no request outcome detail that reveals recipient private state
- generic TARGET_UNAVAILABLE mapping for recipient-side ineligibility
- privacy-preserving rate-limit keys
- no request bodies in routine logs
- no usernames or display names in security event metadata unless an explicitly allowlisted event requires them
- request-attempt ledger contains identifiers and outcome codes, not private profile content

## Security events

Expected minimal security/abuse event types include:

~~~text
partner_discovery_rate_limited
partner_request_rate_limited
partner_request_created
partner_request_cancelled
partner_request_declined
partner_request_expired
~~~

High-volume successful discovery is not written to the security-event ledger.

The request-attempt table is the durable pair-specific abuse record.

## Error model

Representative public codes:

~~~text
VALIDATION_FAILED
AUTH_REQUIRED
RATE_LIMITED
REQUEST_SELF
REQUEST_ALREADY_PENDING
REQUEST_MONTHLY_LIMIT
REQUEST_DECLINE_COOLDOWN
TARGET_CHANGED
TARGET_UNAVAILABLE
REQUEST_NOT_FOUND
REQUEST_NOT_PENDING
REQUEST_EXPIRED
CONFLICT
~~~

Internal denial codes may be more specific than public target-facing responses.

## Web client boundary

P1 client UI requires:

- exact username search box
- one-result profile card
- send-request action
- outgoing active-request list
- incoming active-request list
- cancel outgoing action
- decline incoming action
- exact expiresAt display
- stable generic target-unavailable handling

The client never:

- infers eligibility from search visibility
- calculates authoritative request expiry from its own clock
- calculates decline cooldown from its own clock
- calculates monthly request count
- assumes that a shown request is still pending at mutation time

Until realtime is implemented, the client may refresh canonical request state after mutations and on page focus.

## Test architecture

### Pure domain tests

Cover:

- exact seven-day expiry boundary
- exact one-hour decline-cooldown boundary
- rolling one-calendar-month cutoff
- sender eligibility
- recipient eligibility
- self request
- duplicate request
- public target-unavailable mapping

### Database tests

Use disposable PostgreSQL.

Cover:

- migration 0008 from zero after 0007
- terminal timestamp shape
- one pending same-direction invariant
- created-attempt partial index
- rolling pair-count query
- decline cooldown query
- append-only request attempts
- outgoing/incoming pending query plans
- logically expired pending rows excluded from list query

### Race tests

Cover:

- simultaneous same-direction create
- simultaneous opposite-direction create
- fourth monthly request racing another create
- create at exact one-month cutoff
- create at exact one-hour decline cutoff
- cancel racing expiry
- decline racing expiry
- request create racing future P2 partnership formation
- request create racing future P3 block creation
- request create racing account deletion

Expected result: one serializable product outcome under READ COMMITTED plus explicit locks and database constraints.

### API integration tests

Cover:

- authenticated exact discovery
- no unauthenticated discovery
- normalized exact username match
- at most one result
- no result for self
- no result for inactive/deleted target
- blocker hidden from blocked account
- no exact DOB/email/session/history leakage
- current age uses trusted server date
- request create
- sender cancel
- recipient decline
- decline does not create block
- duplicate rejection
- self rejection
- three-per-month limit
- exact one-hour cooldown
- target-unavailable generic mapping
- multiple incoming requests
- request list hides overdue logical requests
- scheduled expiry persists expired state
- reciprocal pair signal emitted exactly once in the serialized opposite-direction race

### Security regressions

Cover:

- discovery cannot enumerate by prefix or pagination
- search rate limiting
- request-creation rate limiting
- arbitrary X-Forwarded-For cannot bypass network bucket
- target block status not exposed
- target partnership/cooldown status not exposed
- cancel and decline remain available despite discovery/create abuse bucket exhaustion
- request body is absent from routine logs
- direct API call cannot bypass occupancy, cooldown, pair limit, block, or decline cooldown
- stale username/accountId pair cannot target a new username owner
- overdue pending row cannot be cancelled or declined as if still active

## Proposed local commands

Expected additions:

~~~text
npm run test:partner-requests
npm run test:p1:postgres
npm run test:p1:api
npm run test:p1:security
npm run test:p1:local
~~~

The top-level local command should reuse the disposable PostgreSQL harness pattern established by F2 and planned for A1.

## Implementation sequence

### P1-A Domain, contracts, migration design, repositories

1. add partner-request domain types and denial codes
2. add exact time-boundary helpers
3. add discovery and request contracts
4. generalize planned A1 auth rate-limit table name to security_rate_limit_buckets before A1 migration lands
5. add migration 0008 after 0007 is present
6. add discovery repository
7. add partner-request repository
8. harden attempt ledger
9. add request expiry scheduled-action repository integration

Exit gate:

- domain and contract tests pass
- migration 0008 applies from zero after 0007
- database invariants and query-plan checks pass

### P1-B Discovery

1. exact normalized username lookup
2. authenticated safe projection
3. age derivation from trusted server date
4. self suppression
5. blocker-hidden behavior
6. discovery rate limits
7. privacy regression tests

Exit gate:

- discovery acceptance and privacy tests pass

### P1-C Request creation

1. stable target accountId plus expectedUsername contract
2. deterministic two-account locking
3. logical pair-request expiry cleanup
4. sender/recipient eligibility
5. either-direction block check
6. duplicate check
7. decline cooldown
8. rolling one-month limit
9. created-attempt append
10. seven-day request insert
11. scheduled expiry insert
12. reciprocal-pair detection
13. generic target-unavailable mapping

Exit gate:

- create, pair-limit, block, duplicate, and race tests pass

### P1-D Cancellation, decline, expiry worker

1. outgoing cancellation
2. incoming decline
3. exact expiry worker
4. overdue lazy-expiry behavior
5. terminal-state idempotency
6. active incoming/outgoing lists

Exit gate:

- cancellation, decline, expiry, and worker tests pass

### P1-E Client foundation and abuse closure

1. exact-search UI
2. safe result card
3. send action
4. incoming/outgoing request list
5. cancel and decline controls
6. canonical refresh after mutations
7. abuse/security regression suite

Exit gate:

- browser component/integration tests pass
- direct API bypass tests pass

### P1-F Integration closure

1. run complete P1 local PostgreSQL/API/security suite
2. run new dependency audit if dependencies changed
3. run full npm run health
4. reconcile docs repo-wide
5. mark only verified P1 gates complete

P1 closure does not make P2 complete.

## P2 handoff contract

P1 hands P2:

- deterministic account locks
- active request rows
- request attempt history
- recipient safe identity
- reciprocal pair candidate
- exact request expiration semantics

P2 must not reimplement P1 request limits.

P2 acceptance will add:

- explicit acceptance endpoint
- reciprocal automatic formation inside the same transaction
- occupied-slot recheck
- incompatible request invalidation
- relationship date
- new partnership namespace and security context

## Physical-device requirement

P1 does not require physical-device evidence for epic closure.

Browser/API/PostgreSQL evidence is sufficient.

Mobile usability still matters, but Redmi-specific acceptance begins with later PWA offline/media/calling/crypto milestones.

## Review invariants

Reject a P1 implementation change if it:

1. allows unauthenticated discovery
2. adds broad or fuzzy discovery without a product/privacy review
3. exposes exact date of birth or email in discovery
4. exposes recipient partnership, cooldown, or block state through detailed request errors
5. trusts client time for request expiry, cooldown, or monthly limits
6. relies on the expiry worker running exactly on time for correctness
7. counts rejected attempts toward the three-successful-request product limit
8. removes a successful request from the monthly count because it was later cancelled, declined, expired, or invalidated
9. allows cancel or decline to be blocked by discovery/create product abuse buckets
10. identifies request target only by a mutable username without stable account identity
11. creates a request after expectedUsername no longer matches the target account
12. checks block or occupancy only in the client
13. performs pair-sensitive mutations without deterministic account locking
14. allows more than one same-direction active pending request
15. creates partnership state inside P1
16. uses an asynchronous event as the authority for reciprocal partnership formation
17. duplicates A1 security-rate-limit storage
18. stores private profile content in request-attempt rows
19. treats an overdue pending row as active because the worker has not run
20. lets a stale request mutation overwrite an already terminal state
21. creates provider calls inside the request transaction

## Completion rule

P1 is DONE only when every P1 acceptance gate in docs/ROADMAP_EPICS.md is satisfied with committed source, migration 0008, repeatable local database/API/race/security evidence, a committed lockfile, and a green full repository health regression.

Design completion changes P1 from PLANNED to IN_PROGRESS. It does not check any runtime acceptance gate.

Hosted GitHub Actions verification remains separate under V1.
