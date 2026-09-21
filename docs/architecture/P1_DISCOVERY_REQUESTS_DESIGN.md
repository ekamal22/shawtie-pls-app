# P1 Discovery and Partner Requests Architecture and Implementation Design

## Status

IMPLEMENTED AND LOCALLY VERIFIED

Effective design date: 2026-09-21.

This document is the canonical implementation design for P1 Discovery and Partner Requests.

P1 preserves Architecture Baseline 1.0 and builds on the verified F2 transaction/worker substrate plus the refined A1 account, session, normalization, and security-rate-limit design.

No new trust boundary, lifecycle authority, persistent state system, provider, or dependency direction is introduced. No ADR is required.

Source code, migrations, and tests remain authoritative for behavior that is actually implemented.

## Refinement review

The initial P1 design was reviewed before runtime implementation and the resulting implementation is now locally verified.

The refinement closes ambiguity in:

- create-request idempotency and lost-response retries
- security-rate-limit transaction boundaries
- deterministic lock ordering for cancel and decline
- production enablement before P2 exists
- cross-epic request invalidation hooks
- exact rolling-month boundary counting
- P2 relationship-start-date handoff for both explicit and reciprocal formation
- cursor pagination and response caps
- migration backfill and terminal-shape compatibility
- invalidation reasons for A1, P2, and P3 integration
- cache-control and browser request privacy
- terminal mutation replay behavior
- cleanup and retention for request-attempt evidence

No accepted partnership or request product rule is changed.

## Dependency boundary

A1 and P1 are complete. P1 is now the verified request substrate consumed by P2.

Verified dependency usage:

- P1 domain rules and contracts are implemented
- P1 migration 0008 follows verified A1 migration 0007 and is itself verified
- P1 reuses A1 authenticated sessions
- P1 reuses A1 username normalization
- P1 reuses A1 trusted PostgreSQL business time
- P1 reuses A1 security_rate_limit_buckets
- P1 API integration uses the verified A1 authenticated accounts and sessions
- P2 consumes P1 reciprocal-request detection to perform actual partnership formation
- production user-facing request creation remains disabled until the P2 partnership-formation coordinator is wired, because reciprocal pending requests must auto-pair as one transaction

P1 does not create partnerships.

P2 owns explicit acceptance and transactional partnership formation.

## Production feature-enable boundary

P1 may reach DONE from local domain, PostgreSQL, API, race, security, and browser evidence before P2 is complete.

However, a production-capable application must not expose partner-request creation to end users unless the P2 partnership-formation coordinator is registered.

Reason:

- two opposite pending requests are fresh consent from both users
- the product requires immediate automatic partnership formation
- returning two pending requests without pairing would be a product-rule violation

The application uses an explicit mode:

~~~text
partnerRequestMode =
  disabled
  | request_only_test
  | paired
~~~

Rules:

- production accepts only disabled or paired
- request_only_test is rejected by production configuration validation
- paired requires a registered P2 PartnershipFormationCoordinator
- disabled does not register the create route
- request_only_test exists only for P1 integration tests before P2 is implemented

Production startup or route registration fails closed if paired mode is selected without the P2 coordinator.

Discovery and request read models may be exercised independently in test environments.

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
- capture of the manually entered relationship start date required by P2 formation

P1 does not implement:

- request acceptance
- partnership creation
- ownership of partnership relationship-date state after formation; P1 only captures the manually entered request proposal required by P2
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
created_at > rollingMonthCutoff
AND created_at <= now
~~~

`rollingMonthCutoff` is computed from PostgreSQL transaction time by the shared UTC calendar-month helper, not by database-session timezone arithmetic. This avoids DST or connection-timezone drift.

At the exact one-calendar-month boundary, the older request no longer counts.

Because request creation for a pair is serialized by deterministic account locks, the proposed new request is not yet in the ledger when this query runs. Existing successful attempts with the same PostgreSQL transaction timestamp still count because the upper bound is inclusive.

Cancelled, declined, expired, or later invalidated requests still count because they were successfully sent.

Rejected attempts do not count toward the three-request product limit, though they may contribute to abuse-rate-limit buckets.

## Discovery privacy model

Discovery is authenticated.

There is no unauthenticated username lookup endpoint.

The first version accepts one normalized username query and returns at most one result.

All P1 authenticated responses use Cache-Control: private, no-store.

The discovery query remains in a JSON POST body rather than a URL query string to reduce accidental username exposure in access logs, browser history, intermediary logs, and copied URLs.

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

## External implementation basis

The refinement follows established platform guidance:

- PostgreSQL explicit row locks are appropriate for application-controlled concurrency when MVCC alone is insufficient
- PostgreSQL recommends acquiring locks on multiple objects in a consistent order to reduce deadlocks
- API resource-consumption defenses should enforce server-side limits on request frequency and response size
- an Idempotency-Key convention is appropriate for making non-idempotent POST retries fault-tolerant

These external references support the implementation mechanics. Product rules remain defined by the Shawtie PRD.

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

It follows verified A1 migration 0007.

Migrations 0001 through 0006 remain immutable.

Migration 0008 refines existing request tables rather than replacing them.

### partner_requests additions

Add:

~~~text
expired_at timestamptz
invalidated_reason text
relationship_start_date date
~~~

`relationship_start_date` is the sender's manually entered proposed relationship date. The column remains nullable only for forward compatibility with any pre-P1 legacy rows, but every new P1 request write requires a non-null value. Migration 0008 adds a `CHECK (relationship_start_date IS NOT NULL) NOT VALID` constraint so PostgreSQL enforces the rule for new and updated rows without inventing values for legacy rows. P1 persists it because reciprocal requests may immediately auto-form through P2 without a separate accept screen. P1 validates it against trusted PostgreSQL UTC business date using the shared partnership-domain helper. Any legacy pending row with a null value fails closed and cannot form a partnership.

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
  invalidated_reason non-null
  all other terminal timestamps null
~~~

Existing exact seven-day expires_at constraint remains authoritative.

Allowed invalidation reasons are intentionally small and cross-epic:

~~~text
account_unavailable
partnership_formed
block_created
~~~

The invalidation reason is internal state and is not exposed in the normal request API.

Migration 0008 is forward-safe:

1. add expired_at and invalidated_reason as nullable
2. deterministically backfill existing status = expired rows with expired_at = expires_at
3. reject migration if any other legacy terminal row has an impossible timestamp shape rather than guessing a timestamp
4. add terminal-shape and invalidation-reason constraints after deterministic backfill
5. add indexes and append-only attempt protection

Migration 0008 does not rewrite historical request creation time or expiry time.

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
monthly_limit
sender_ineligible
target_unavailable
duplicate
self_request
target_changed
~~~

New P1 code records generic target_unavailable rather than distinguishing block, recipient occupancy, recipient cooldown, or recipient deletion state in the attempt ledger.

Legacy outcome values already permitted by older migrations remain readable if present, but new writes use the minimized P1 vocabulary.

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

During A1 implementation, the previously auth-specific draft name for the generic rate-limit table was replaced by:

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
GET /api/v1/partner-requests?direction=incoming|outgoing&limit=25&cursor=...
~~~

One direction is requested per page.

Default limit:

~~~text
25
~~~

Maximum limit:

~~~text
50
~~~

Only logically active pending requests are returned:

~~~text
status = pending
AND expires_at > transaction_time
~~~

Order:

~~~text
created_at DESC, id DESC
~~~

The first page captures a PostgreSQL transaction-time `snapshotAt`. Every page in that traversal applies `created_at <= snapshotAt`, so requests created after the traversal begins appear only after a canonical refresh and cannot shift later pages.

The cursor carries `snapshotAt`, the last visible createdAt, requestId, and direction in a versioned base64url envelope.

Cursor version 1 is a canonical JSON payload encoded with base64url. It is not signed because it contains no authority or secret; all fields are schema-validated and re-applied only as query bounds.

The cursor is not a secret, but it is schema-validated, direction-bound, and snapshot-bound. `snapshotAt` must not be later than the current PostgreSQL transaction time. Invalid, mismatched, or future-snapshot cursors fail with VALIDATION_FAILED.

Response:

~~~text
{
  items: [...],
  nextCursor: string | null
}
~~~

Each item exposes:

- requestId
- direction
- counterpart safe profile projection
- relationshipStartDate
- createdAt
- expiresAt

It never exposes counterpart email, exact DOB, partnership history, cooldown, or block metadata.

The list operation does not require a database write merely to clean overdue rows.

P1 does not silently cap a direction at 100 entries. Cursor pagination gives a stable traversal of requests that existed at `snapshotAt`; requests created afterward are intentionally visible on the next canonical refresh. Rows that become terminal during traversal may disappear, which is correct because the list is an active-request view.

### Create partner request

~~~text
POST /api/v1/partner-requests
~~~

Input:

~~~text
recipientAccountId
expectedUsername
relationshipStartDate
~~~

`relationshipStartDate` is required and uses the exact `YYYY-MM-DD` calendar-date format with no timezone component. It is private request/partnership metadata and is never part of public discovery.

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

## Request creation idempotency

POST /api/v1/partner-requests requires an Idempotency-Key header.

The key identifies one logical create attempt for one authenticated sender.

Policy:

- client key length: 16 through 128 ASCII characters
- stored scope: partner_request_create
- successful create or paired responses are retained at least until the original request expires
- denied create responses are retained for at least 24 hours
- request fingerprint includes recipientAccountId, normalized expectedUsername, and canonical relationshipStartDate
- the authenticated account ID is already part of the idempotency-record scope
- same key plus same fingerprint replays the stored HTTP status and response; changing only relationshipStartDate is a different fingerprint
- same key plus different fingerprint fails with IDEMPOTENCY_KEY_REUSED
- idempotency responses never store private recipient-state reasons

The existing F2 idempotency_records table is reused.

Lost-response behavior:

1. client sends a create request
2. server commits the request and idempotency response
3. network response is lost
4. client retries with the same key
5. server replays the original success instead of returning REQUEST_ALREADY_PENDING

Concurrent same-key requests use the unique account/scope/key constraint.

The business transaction attempts to reserve the key after account locks are acquired. If another transaction already committed that key, the second request reloads and replays the completed result. If the first transaction rolled back, the second may acquire the key and proceed.

Cancel and decline are naturally idempotent through terminal request state and do not require an Idempotency-Key in P1.

## Security-rate-limit transaction boundary

Security throttling is intentionally separate from the authoritative request transaction.

Flow:

1. authenticate and validate the request
2. perform a non-locking lookup for an already-completed matching idempotency result; if found, replay it without charging a new partner-request creation bucket
3. the replay remains subject to ordinary infrastructure request-rate protection so one completed key cannot become an unlimited resource-consumption bypass
4. run a short security-rate-limit transaction that atomically consumes account and network buckets
5. commit the rate-limit transaction
6. run the authoritative pair transaction
7. commit the business result and idempotency response

This separation is deliberate.

A malformed, blocked, duplicate, ineligible, or otherwise rejected new logical attempt may still consume abuse budget even though it does not consume the three-successful-request product allowance.

A business rollback does not erase the already-consumed abuse attempt.

Rate-limit bucket locks are therefore never held while account, partnership, or request rows are locked.

A rate-limit storage failure fails closed for request creation rather than silently bypassing the abuse control.

## HTTP and cache semantics

P1 uses stable HTTP behavior:

- unauthenticated: 401
- CSRF/origin rejection: 403
- invalid contract or cursor: 400
- discovery success including no result: 200
- request list: 200
- request create success: 201 for both ordinary created and P2 `paired` outcomes; the response body discriminates the outcome
- completed idempotency replay: original stored status
- product-state conflict such as monthly limit, decline cooldown, duplicate, target changed, or target unavailable: 409
- abuse-rate limit: 429 with Retry-After where a safe bounded retry value exists
- unknown request and wrong request owner: same 404 shape
- cancel or decline of an owned terminal request: 200 with current terminal state

All authenticated P1 responses use:

~~~text
Cache-Control: private, no-store
~~~

P1 does not put usernames, request IDs, or cursors into server-generated redirect URLs.

## Request creation transaction

Request creation is one authoritative F2 transaction.

Order:

1. authenticate sender before entering the business transaction
2. validate boundary input and normalize expectedUsername
3. complete the separate security-rate-limit preflight described above
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
21. reserve or replay the create idempotency record after account locks are held
22. insert partner request with created_at = transaction time
23. set expires_at = created_at + interval '7 days'
24. append request-attempt outcome created
25. insert F2 scheduled action for exact request expiry
26. detect active reciprocal request
27. invoke the P2 coordinator before commit when production pairing is enabled
28. store the public response in the idempotency record
29. commit

The database unique index remains final protection against same-direction duplicate races.

Expected business denials are returned as committed decision results rather than thrown as transaction errors when the transaction intentionally records an attempt or idempotency response.

Unexpected infrastructure failures still roll back the authoritative business transaction.

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

## P2 coordinator interface

P1 integrates with P2 through one transaction-scoped interface.

Conceptually:

~~~text
PartnershipFormationCoordinator.handleReciprocalCandidate(
  executor,
  candidate,
  now
) -> PairingOutcome
~~~

Requirements:

- executor is the current F2 transaction executor
- the coordinator must not start a nested authoritative transaction
- the same sorted account locks remain held
- candidate account IDs and request IDs are revalidated inside the transaction
- no provider call occurs
- pairing outcome is returned to P1 so the final public response can be stored in the same idempotency record
- an unavailable or misconfigured coordinator fails closed before production request creation is enabled

This interface is a modular-monolith boundary, not a network boundary.

## Reciprocal request boundary with P2

P1 detects reciprocal active requests.

It does not create the partnership.

The internal transaction result may include:

~~~text
ReciprocalPairCandidate {
  accountIds sorted
  requestIds sorted
  triggeringRequestId
  relationshipStartDate
  observedAt
}
~~~

The relationship date comes from the triggering second request, whose fresh consent completes the reciprocal pair. P2 revalidates it against trusted server date before formation.

No pairing event is placed on an asynchronous queue as the authority for partnership creation.

When P2 is implemented, the request-creation transaction will pass the reciprocal pair candidate to the P2 partnership-formation coordinator before commit while the same deterministic account locks are still held.

P2 then:

- rechecks pair eligibility
- creates the partnership transactionally using the triggering request's manually entered relationship start date
- marks the reciprocal requests accepted
- invalidates incompatible pending requests
- uses the fresh partnership ID as the new local/future cryptographic namespace root
- writes required lifecycle and durable notification records
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
4. load only the request participant IDs needed to determine lock order
5. lock both request accounts in immutable UUID order
6. re-read and lock the request row
7. verify the locked row still has the same immutable participants
8. return the same not-found response for unknown request and wrong sender
9. if already terminal, return the stable terminal state without overwriting it
10. if pending but transaction time is at or after expires_at, mark expired with expired_at = expires_at and return expired
11. otherwise set status = cancelled
12. set cancelled_at = transaction time
13. commit

Cancellation does not erase the original created attempt from the rolling one-month count.

## Request decline

Decline transaction:

1. authenticate account
2. begin transaction
3. load PostgreSQL transaction time
4. load only the request participant IDs needed to determine lock order
5. lock both request accounts in immutable UUID order
6. re-read and lock the request row
7. verify the locked row still has the same immutable participants
8. return the same not-found response for unknown request and wrong recipient
9. if already terminal, return the stable terminal state without overwriting it
10. if pending but transaction time is at or after expires_at, mark expired with expired_at = expires_at and return expired
11. otherwise set status = declined
12. set declined_at = transaction time
13. commit

Decline does not create a block.

A later request from the same sender is prohibited until the exact one-hour boundary.

## Cross-epic request invalidation hooks

P1 owns request-state invalidation helpers so A1, P2, and P3 do not duplicate partner-request SQL.

The repository exposes transaction-scoped operations such as:

~~~text
invalidatePendingRequestsForAccount(
  executor,
  accountId,
  invalidatedAt,
  reason
)

invalidatePendingRequestsForPair(
  executor,
  accountA,
  accountB,
  invalidatedAt,
  reason
)
~~~

Callers must already hold the relevant account rows in deterministic UUID order.

The invalidation query locks matching pending request rows in immutable request-ID order before updating them.

Required integrations:

### A1 account deletion

In the same authoritative account-deletion transaction, invalidate all pending incoming and outgoing requests for the deleting account with:

~~~text
reason = account_unavailable
~~~

Account recovery does not resurrect those requests.

Fresh consent requires fresh requests.

### P2 partnership formation

In the same partnership-formation transaction, invalidate every other incompatible pending incoming and outgoing request for both newly partnered accounts with:

~~~text
reason = partnership_formed
~~~

The two requests used for reciprocal formation become accepted, not invalidated.

### P3 former-partner block creation

In the same block-creation transaction, invalidate pending requests between the blocked pair in both directions with:

~~~text
reason = block_created
~~~

Invalidation never erases the original created-attempt row, so the successful send still counts in the rolling product limit until it ages out.

These hooks are idempotent and never transition an already terminal request.

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

Request lists use keyset pagination defined in the public API section.

The repository query uses the logical-active predicate and deterministic tuple ordering:

~~~text
ORDER BY created_at DESC, id DESC
~~~

A next page uses:

~~~text
created_at <= snapshot_at
AND (created_at, id) < (cursor_created_at, cursor_id)
~~~

with the same direction and logical-active predicate.

Offset pagination is not used.

## Request-attempt retention and cleanup

Correctness of the three-request rolling product limit depends on successful created-attempt history.

Therefore:

- a created attempt must never be deleted while it can still fall inside any one-month lookback window
- cleanup uses PostgreSQL time
- cleanup retains a small operational safety buffer beyond the one-month product window
- rejected-attempt retention may be shorter or longer according to the security metadata retention policy
- cleanup is asynchronous and never changes request eligibility because eligibility queries only depend on rows still inside the authoritative time window

Cleanup must not mutate retained attempt rows.

## Lock order

P1 extends the A1 business lock order.

For pair operations:

~~~text
1. account rows in immutable UUID order
2. partnership rows when required
3. partner request rows in immutable request-ID order
4. block/cooldown rows when explicitly locked
5. idempotency rows
~~~

Security-rate-limit bucket locks are not part of this rank because they are consumed in a separate short preflight transaction.

A1 authentication lookup happens before the P1 business transaction and is not held as a row lock through the business mutation.

The refined P2 partnership-formation path and P3 block creation must lock the same account pair in the same deterministic order.

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

Expected security/abuse event types are intentionally narrow:

~~~text
partner_discovery_rate_limited
partner_request_rate_limited
~~~

Normal request creation, cancellation, decline, expiry, acceptance, and invalidation are already represented by partner_requests and partner_request_attempts and are not duplicated into the general security-event ledger by default.

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
- send-request action with a fresh idempotency key for each logical attempt
- cursor-paginated outgoing active-request list
- cursor-paginated incoming active-request list
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
- simultaneous same-idempotency-key create
- same idempotency key reused with a different payload
- simultaneous opposite-direction create
- fourth monthly request racing another create
- create at exact one-month cutoff
- create at exact one-hour decline cutoff
- cancel racing expiry
- decline racing expiry
- request create racing P2 partnership formation
- request create racing future P3 block creation
- request create racing account deletion
- cancel or decline racing P2 acceptance

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
- snapshot-bound cursor pagination has no duplication or omission within its initial request set; newly created rows wait for canonical refresh
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
- P1 responses use private no-store cache control
- production route enablement fails closed without the P2 coordinator
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

The top-level local command should reuse the disposable PostgreSQL harness pattern established by F2 and verified through A1.

## Implementation sequence

### P1-A Domain, contracts, migration design, repositories

1. add partner-request domain types and denial codes
2. add exact time-boundary helpers
3. add discovery, cursor, and request contracts, including required relationshipStartDate on request creation
4. keep the shared security_rate_limit_buckets design aligned with A1
5. add migration 0008 after 0007 is present
6. add expired_at and invalidated_reason with forward-safe backfill
7. add discovery repository
8. add partner-request repository
9. add request invalidation helpers for A1/P2/P3
10. harden append-only attempt ledger and retention queries
11. add request expiry scheduled-action repository integration
12. wire existing idempotency_records for create-request replay

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
2. required create-request idempotency key
3. validate relationshipStartDate against trusted PostgreSQL UTC date
4. separate committed security-rate-limit preflight
5. deterministic two-account locking
6. logical pair-request expiry cleanup
7. sender/recipient eligibility
8. either-direction block check
9. duplicate check
10. decline cooldown
11. rolling one-month limit
12. created-attempt append
13. seven-day request insert with relationshipStartDate
14. scheduled expiry insert
15. reciprocal-pair detection
16. P2 coordinator integration point with triggeringRequestId and relationshipStartDate
17. generic target-unavailable mapping
18. persisted idempotency response

Exit gate:

- create, pair-limit, block, duplicate, and race tests pass

### P1-D Cancellation, decline, expiry worker

1. outgoing cancellation with pair-account locking
2. incoming decline with pair-account locking
3. exact expiry worker
4. overdue lazy-expiry behavior
5. terminal-state idempotency
6. cursor-paginated active incoming/outgoing lists
7. cross-epic invalidation helpers

Exit gate:

- cancellation, decline, expiry, and worker tests pass

### P1-E Client foundation and abuse closure

1. exact-search UI
2. safe result card
3. send action with one idempotency key per logical attempt and a required relationship start date
4. cursor-paginated incoming/outgoing request lists showing the proposed relationship date to the participants
5. cancel and decline controls
6. canonical refresh after mutations
7. no-store response verification
8. production/test feature-mode validation
9. abuse/security regression suite

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
- manually entered request relationshipStartDate
- triggering request identity for reciprocal formation

P2 must not reimplement P1 request limits.

P2 acceptance will add:

- explicit acceptance endpoint using the accepted request's relationshipStartDate
- reciprocal automatic formation inside the same transaction using the triggering request's relationshipStartDate
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
15. creates partnership state inside P1 before the registered P2 coordinator owns that transaction
16. uses an asynchronous event as the authority for reciprocal partnership formation
17. duplicates A1 security-rate-limit storage
18. stores private profile content in request-attempt rows
19. treats an overdue pending row as active because the worker has not run
20. lets a stale request mutation overwrite an already terminal state
21. creates provider calls inside the request transaction
22. lets a lost create response turn a retry into a duplicate error instead of replaying by idempotency key
23. holds security-rate-limit bucket locks while pair account locks are held
24. cancel or decline locks only one account in a pair-sensitive mutation
25. silently truncates active request lists instead of paginating them
26. enables production request creation without a P2 coordinator
27. resurrects invalidated requests after account recovery, partnership dissolution, or block removal
28. deletes successful attempt evidence while it can still affect the rolling one-month limit

## Completion rule

P1 is DONE. All 14 P1 acceptance gates in `docs/ROADMAP_EPICS.md` are satisfied with committed source, verified migration 0008, repeatable local database/API/race/security evidence, a committed lockfile, a green full repository health regression, and a zero-high-severity dependency audit.

Closure evidence: eight migrations apply from zero with database invariants green; `npm run test:p1:local` passes 16/16 and emits `P1_LOCAL_POSTGRES_PASS`; final `npm run health` passes with Domain 38/38, Contracts 8/8, API unit/security 11/11, and Worker 4/4.

Hosted GitHub Actions verification remains separate under V1.
