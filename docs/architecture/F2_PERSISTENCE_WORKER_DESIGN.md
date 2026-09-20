# F2 Persistence and Worker Design

## Status

DESIGNED, NOT YET IMPLEMENTED

Effective design date: 2026-09-20.

This document is the implementation design for F2 Persistence and Worker Foundation.

It refines Architecture Baseline 1.0 without changing any frozen architecture decision. No ADR is required because the design keeps PostgreSQL authoritative, preserves the modular monolith plus separate durable worker, keeps the domain package infrastructure-free, uses the accepted transactional outbox and scheduled-action models, and introduces no new trust boundary or persistent state system.

Source code, migrations, and tests remain the authority for what is actually implemented. This document describes the intended F2 runtime shape until implementation evidence exists.

## Goals

F2 must provide a durable transactional substrate for later account, partnership, lifecycle, messaging, relationship, media, and calling work.

It must prove:

- PostgreSQL transaction correctness
- deterministic multi-account locking
- repeatable concurrency regression tests
- safe multi-worker queue claiming
- crash recovery for claimed durable work
- stale-generation protection for lifecycle-sensitive jobs
- transactional outbox atomicity
- duplicate-safe side-effect delivery
- append-only non-content lifecycle event persistence
- deletion-manifest resumption after partial failure
- bounded worker concurrency
- graceful worker shutdown
- server-authoritative time for durable product decisions

F2 builds infrastructure and reusable persistence mechanics. It does not implement user-facing account, partnership, messaging, provider, realtime, or E2EE features.

## Runtime boundary

The target runtime shape is:

```text
apps/api
   |
   | authoritative transaction
   v
packages/db
   |
   +-- pool and transaction kernel
   +-- explicit repositories
   +-- deterministic account locks
   +-- scheduled actions
   +-- outbox events
   +-- lifecycle events
   +-- deletion manifests
   |
   v
PostgreSQL
   ^
   |
   | durable claim
   |
apps/worker
   |
   +-- scheduled-action consumer
   +-- outbox consumer
   +-- deletion-target consumer
   +-- bounded retry and lease recovery
   |
   +--> packages/domain for pure product transitions
```

PostgreSQL stores durable intent.

The worker executes durable intent.

The domain package remains the source for pure product rules and must not gain database, worker, provider, or framework dependencies.

## Database runtime package

F2 turns `packages/db` from schema-only scaffolding into the persistence kernel.

The preferred implementation is a narrow PostgreSQL runtime using `pg` directly rather than an ORM. This preserves visibility into transaction, locking, queue, and SQLSTATE behavior that is already central to the accepted design.

Planned structure:

```text
packages/db/src/
├── index.ts
├── connection/
│   ├── pool.ts
│   ├── transaction.ts
│   └── database-config.ts
├── repositories/
│   ├── accounts.ts
│   ├── partnerships.ts
│   ├── scheduled-actions.ts
│   ├── outbox-events.ts
│   ├── lifecycle-events.ts
│   └── deletion-manifests.ts
├── queries/
│   ├── lock-accounts.ts
│   ├── claim-scheduled-actions.ts
│   ├── claim-outbox-events.ts
│   └── claim-deletion-targets.ts
├── errors/
│   ├── database-error.ts
│   └── postgres-error-codes.ts
└── types/
    ├── query-executor.ts
    └── transaction.ts
```

Do not introduce a generic BaseRepository or an unrestricted application-facing execute-any-SQL abstraction.

Repositories expose explicit persistence operations.

## Transaction kernel

Every authoritative multi-step mutation uses one checked-out database connection for the complete transaction.

The normal transaction isolation level is PostgreSQL `READ COMMITTED`. F2 relies on explicit row locking, uniqueness constraints, check constraints, and authoritative re-checks rather than globally raising isolation for every operation.

The transaction kernel owns retry classification for transaction-level PostgreSQL failures that are safe to replay, including serialization failures and deadlocks. Repositories and handlers must not each invent independent retry loops.

Conceptually:

```text
withTransaction(pool, transaction => {
  authoritative mutation
  lifecycle event
  scheduled action
  outbox event
})
```

The transaction helper owns:

```text
connect
BEGIN
callback
COMMIT
release
```

and on failure:

```text
ROLLBACK
release
rethrow
```

Application code must not switch back to pool-level queries inside an active transaction.

Nested independent transactions are forbidden for one authoritative mutation.

The database runtime must configure defensive timeout policy for application connections. The implementation must define and test bounded values for PostgreSQL `statement_timeout`, `lock_timeout`, and `idle_in_transaction_session_timeout`. Node-side connection and query timeouts may also be used as a secondary safety layer. Exact values remain implementation configuration and must be chosen from test evidence rather than guessed in this design.

The PostgreSQL pool must own an `error` listener for idle-client and backend connection errors, and every checked-out client must be released on both success and failure paths.

## Server-authoritative time

Authoritative mutation time comes from PostgreSQL.

For one authoritative business transaction, use PostgreSQL transaction time semantics so all statements observe one consistent business timestamp. `transaction_timestamp()` or its equivalent `now()` is the normal source for lifecycle transitions, deadlines, cooldown calculations, and audit timestamps within that transaction.

Lease and timeout behavior is different. Lease expiry and renewal need advancing wall-clock semantics, so lease code must use PostgreSQL `clock_timestamp()` or another explicitly advancing PostgreSQL clock where required.

The transaction obtains the appropriate PostgreSQL timestamp and passes business time to pure domain transitions.

Do not make Node process clocks authoritative for lifecycle deadlines, cooldowns, eligibility, finalization, or durable claim expiry.

Client clocks remain display-only.

## Durable work states

F2 standardizes durable work around explicit claim ownership and recoverable leases.

The core lifecycle is:

```text
pending
   |
   | claim
   v
processing
   |
   +--------------------+
   |                    |
success              retryable failure
   |                    |
   v                    v
terminal             pending later
```

If a worker dies while a row is `processing`, an expired lease makes that work reclaimable.

Scheduled actions additionally support `stale`, `cancelled`, and terminal `failed` states.

A stale lifecycle action is not a system failure. It means the aggregate generation changed after the action was scheduled.

## Planned durable-runtime reliability migration

The current verified schema contains five migrations.

F2 plans one forward migration, expected to be named:

`0006_durable_runtime_reliability.sql`

The migration does not exist yet.

Its intended purpose is to make claimed work recoverable after worker crashes.

Planned additions:

### scheduled_actions

Keep `execute_at` as the original product deadline.

Add:

- `available_at` for retry eligibility
- `lease_expires_at` for crash recovery
- `claim_version` as a monotonically increasing fencing token
- `payload_version` for durable payload compatibility

`execute_at` must not be rewritten merely to schedule a retry because that would destroy the original business deadline.

### outbox_events

Keep the existing `available_at`, `claimed_at`, and `claimed_by`.

Add:

- `lease_expires_at`
- `max_attempts`
- `claim_version` as a monotonically increasing fencing token
- `payload_version` for durable payload compatibility

### deletion_targets

Add:

- `available_at`
- `claimed_at`
- `claimed_by`
- `lease_expires_at`
- `claim_version` as a monotonically increasing fencing token

The implementation must also add or adjust indexes for due, reclaimable work.

Exact column defaults and index definitions are implementation details and must be verified with migration and query-plan tests.

## Claim ownership and fencing

Each worker process receives a unique runtime identity.

A durable claim records:

- row ID
- `claimed_by`
- `claimed_at`
- `lease_expires_at`
- `claim_version`

Every successful claim or reclaim increments `claim_version`.

Completion, retry, lease renewal, stale marking, and failure acknowledgement must match both the worker identity and the claim version originally returned by the claim operation.

Conceptually:

```text
WHERE id = claimed_id
  AND claimed_by = worker_id
  AND claim_version = claimed_version
```

This fencing token prevents a stale worker from acknowledging work after another worker has reclaimed the same row, even if timestamps are close or a previous worker resumes late.

## Lease duration and renewal

Handlers should normally finish comfortably inside the configured lease duration.

Long-running handlers may renew a lease through an explicit repository operation. Lease renewal must:

- verify current claim ownership and `claim_version`
- extend from an advancing PostgreSQL clock
- never change the original product deadline
- stop succeeding after another worker has reclaimed the job

Lease renewal is not a substitute for idempotency. Durable handlers remain safe under repeated execution because process death may occur after an external effect but before acknowledgement.

## Queue claiming

Workers claim small batches in short transactions.

The canonical pattern remains PostgreSQL `FOR UPDATE SKIP LOCKED`.

A claim transaction:

1. finds ordinary pending work whose `available_at` is due
2. also considers `processing` work whose lease has expired
3. locks candidates with `SKIP LOCKED`
4. marks or keeps them `processing`
5. records worker ownership and lease expiry
6. increments `claim_version`
7. increments attempt count where the attempt policy requires it
8. commits immediately

Expired claims should be reclaimed directly by the normal claim query rather than requiring correctness to depend on a separate sweeper process.

Do not hold row locks while running domain transitions, provider calls, or deletion handlers.

Polling is the correctness mechanism. F2 may optionally add PostgreSQL `LISTEN/NOTIFY` as a wake-up optimization to reduce idle polling latency, but notifications must never become the durable queue or the only signal that work exists. Workers must still poll because notifications can be missed around startup, reconnect, or listener failure.

## Scheduled-action execution

Claiming and execution are separate transactions.

```text
CLAIM TRANSACTION
find due work
lock with SKIP LOCKED
mark processing
commit

EXECUTION TRANSACTION
verify claim ownership
lock authoritative aggregate
read PostgreSQL time
verify expected generation
run pure domain transition
persist authoritative mutation
append lifecycle event
insert outbox event when required
create deletion manifest when required
mark scheduled action terminal
commit
```

The generation comparison and authoritative mutation must occur in the same transaction.

Never check generation in one transaction and mutate in another.

## Handler registries

The worker uses explicit handler registries instead of one unbounded switch block.

Scheduled-action examples:

```text
partner_request.expire
partnership.breakup.finalize
account.deletion.finalize
relationship.release
```

Outbox examples:

```text
account.security_email
partnership.lifecycle_changed
device.push
```

Deletion-target examples are defined by the deletion architecture and later provider/runtime work.

F2 establishes the registries and contracts. Later epics register product-specific and provider-specific handlers.

## Worker application

Planned worker structure:

```text
apps/worker/src/
├── index.ts
├── main.ts
├── config.ts
├── runtime/
│   ├── worker-application.ts
│   ├── worker-identity.ts
│   ├── poll-loop.ts
│   ├── concurrency-limit.ts
│   ├── retry-policy.ts
│   └── shutdown.ts
├── scheduled/
│   ├── scheduled-consumer.ts
│   ├── scheduled-handler.ts
│   └── scheduled-handler-registry.ts
├── outbox/
│   ├── outbox-consumer.ts
│   ├── outbox-handler.ts
│   └── outbox-handler-registry.ts
└── deletion/
    ├── deletion-consumer.ts
    ├── deletion-handler.ts
    └── deletion-handler-registry.ts
```

The worker runs independent bounded consumers for scheduled actions, outbox events, and deletion targets.

One consumer failure must not silently terminate unrelated consumer loops unless a shared fatal dependency such as the database is unavailable.

## Bounded concurrency

Do not use unbounded `Promise.all` over claimed work.

The worker must define:

- claim batch size
- maximum concurrent handlers
- poll interval
- lease duration
- shutdown grace period

Exact defaults are configuration choices and are not frozen architecture.

Bounded concurrency protects PostgreSQL connection capacity, provider rate limits, process memory, and graceful shutdown behavior.

## Graceful shutdown

On SIGTERM or SIGINT:

1. stop claiming new work
2. allow in-flight handlers to finish within the shutdown grace period
3. ensure incomplete work remains reclaimable through lease expiry
4. close the PostgreSQL pool
5. exit

The worker must not intentionally terminate while an authoritative transaction is partially applied.

## Durable payload compatibility

Scheduled-action and outbox payloads carry an explicit `payload_version`.

Workers must dispatch by both durable work type and payload version.

Unknown or unsupported payload versions fail closed. A worker must not guess how to interpret a newer payload shape.

Rolling deployment compatibility must be considered before an API or worker begins writing a new durable payload version.

Deletion target behavior should use explicit target types and typed target keys. If a deletion target later requires a structured versioned payload, it must adopt the same fail-closed compatibility rule.

See `VERSIONING_AND_COMPATIBILITY.md`.

## Retry policy

Durable handlers classify outcomes as:

- success
- retryable failure
- permanent failure
- stale

Retryable work returns to `pending` with a future `available_at`.

Use bounded exponential backoff with jitter.

The transaction kernel centrally classifies retryable PostgreSQL transaction failures. Worker-level retry policy handles durable job attempts. These layers must not multiply retries accidentally.

Only allowlisted operational error codes belong in durable job rows. Private content, provider payloads, stack traces containing secrets, and arbitrary exception bodies must not be copied into `last_error_code` or metadata fields.

## Transactional outbox

The outbox provides atomic persistence of state change plus side-effect intent.

Example:

```text
BEGIN
update authoritative state
append lifecycle event
insert scheduled action if required
insert outbox event
COMMIT
```

External network delivery occurs only after commit.

Never send email, push, realtime, storage, or other provider traffic inside the authoritative transaction.

Outbox delivery is at-least-once.

The design must not claim exactly-once external delivery.

If the process crashes after external delivery but before acknowledging the outbox row, delivery may repeat. Handlers therefore need duplicate-safe behavior and should use provider idempotency support when available.

F2 can prove outbox mechanics with test delivery adapters without selecting production email, push, or realtime providers.

## Lifecycle event ledger

F2 adds a runtime append primitive for the existing append-only lifecycle event table.

Lifecycle event metadata uses a small allowlist.

Allowed content is limited to identifiers, generation or version numbers, reason codes, timestamps, and other non-content transition metadata required for operations or audit.

Do not serialize complete aggregates, message content, relationship content, media details, secrets, or arbitrary request bodies into lifecycle metadata.

The relational aggregate remains the source of current state. This is not event sourcing.

## Deletion manifest runtime

Deletion targets, not the manifest itself, are the normal unit of worker claiming.

Each target handler is idempotent.

Deleting an already absent object is success.

A manifest may contain targets that complete at different times.

After a target completes, the repository checks whether all targets are complete. If so, the manifest becomes `completed`.

Retryable target failure keeps authorization revoked and returns the target to a future retry.

A permanent or operator-required target failure may place the target and manifest in `failed`, but it must never restore authorization.

A later retry or repair path must be able to resume the incomplete manifest.

## Security ordering for destructive lifecycle events

For final destructive transitions:

```text
BEGIN
revoke authorization
mark authoritative state inaccessible
revoke applicable sessions or access state
create deletion manifest
create deletion targets
append lifecycle event
insert required outbox events
COMMIT
```

Only after this commit does asynchronous physical cleanup begin.

Cleanup failure must never make deleted content reachable again.

## Database error normalization and transaction retry

The database package may normalize PostgreSQL SQLSTATEs that application or worker code needs to classify.

The normal isolation level is `READ COMMITTED`.

The transaction kernel owns bounded retries for safe-to-replay transaction failures such as serialization failure and deadlock detection. A retry restarts the whole authoritative transaction callback using a fresh database transaction. Partial retry from the middle of a failed transaction is forbidden.

Examples include:

- unique violation
- foreign key violation
- check violation
- deadlock detected
- serialization failure
- lock not available

Do not leak raw PostgreSQL errors into the domain package.

Do not collapse every database condition into one opaque generic error when retry or conflict behavior depends on the SQLSTATE.

## Query-plan verification

Queue correctness is not enough if due-work queries degrade into repeated full-table scans.

After the reliability migration exists, F2 must use realistically sized synthetic queue data and PostgreSQL plan inspection to verify that due pending work and expired processing work use the intended indexes.

Query-plan tests should assert useful plan properties without overfitting exact cost numbers that vary by PostgreSQL version or machine.

## Test infrastructure

Reusable database integration utilities belong in `packages/testkit`, which is already permitted to depend on `packages/db`.

Planned testkit structure:

```text
packages/testkit/src/database/
├── test-database.ts
├── migrations.ts
├── fixtures.ts
├── cleanup.ts
└── concurrent-session.ts
```

All fixtures remain synthetic.

## F2 implementation sequence

### F2-A Persistence kernel and race automation

1. add PostgreSQL runtime dependency
2. implement pool, pool error handling, and transaction kernel
3. implement query-executor and transaction types
4. define `READ COMMITTED` transaction policy and bounded whole-transaction retry
5. implement PostgreSQL business-time and lease-time helpers
6. configure defensive PostgreSQL and Node-side timeout policy
7. implement SQLSTATE normalization
8. add the planned durable-runtime reliability migration with fencing tokens and payload versions
9. implement deterministic account-lock repository
10. build reusable disposable-database test harness
11. automate occupied-partnership contention
12. automate scheduled-action `SKIP LOCKED` contention and expired-claim reclaim
13. automate deterministic two-account lock ordering
14. verify queue query plans against realistically sized synthetic data

### F2-B Durable worker runtime

1. worker configuration
2. unique worker identity
3. bounded poll loop
4. optional PostgreSQL wake-up notification layer with polling fallback
5. scheduled-action claim repository
6. scheduled-action consumer
7. handler registry
8. expired-claim reclaim
9. fenced acknowledgement
10. lease renewal for approved long-running handlers
11. retry policy
12. expected-generation guard
13. durable payload-version dispatch
14. graceful shutdown
15. multi-worker integration tests

### F2-C Transactional outbox

1. transactional insert primitive
2. versioned durable payload contract
3. outbox claim and direct expired-claim reclaim
4. delivery handler registry
5. fenced acknowledgement
6. lease renewal where a provider operation justifies it
7. retry and permanent failure
8. duplicate-delivery safety tests
9. state and outbox atomicity tests
10. unsupported payload-version fail-closed tests

### F2-D Lifecycle event persistence

1. append-only repository primitive
2. typed allowlisted metadata
3. transaction integration
4. append-only regression tests
5. private-content exclusion tests

### F2-E Deletion manifest runtime

1. manifest creation primitive
2. target creation
3. target claiming
4. completion
5. retry
6. permanent failure
7. expired-claim recovery
8. manifest completion
9. partial-failure restart test
10. authorization-remains-revoked regression

### F2-F Integration verification

Complete F2 with repeatable local evidence for:

- transaction commit and rollback
- deterministic account locking
- occupied-partnership contention
- multi-worker scheduled claims
- worker crash and direct expired-lease reclaim
- fencing-token rejection of stale acknowledgement
- lease renewal ownership checks
- stale-generation rejection
- unknown durable payload version fails closed
- transaction timeout and transaction-retry behavior
- pool error handling does not become an unhandled process failure
- queue claim queries use intended indexes on realistic synthetic queue sizes
- outbox atomicity and rollback
- outbox deduplication
- duplicate-safe outbox delivery
- lifecycle append-only behavior
- lifecycle private-content exclusion
- deletion partial failure and restart
- graceful shutdown
- full repository health regression

Hosted execution is tracked separately under V1 and does not block F2 implementation or local F2 completion.

## Proposed public database surface

Keep the application-facing `@shawtie/db` surface intentionally small.

Planned capabilities:

```text
createDatabasePool()
closeDatabasePool()

withTransaction()
getDatabaseNow()

lockAccounts()

scheduledActions
  insert
  claim
  renewLease
  complete
  retry
  markStale
  markFailed

outbox
  insert
  claim
  renewLease
  delivered
  retry
  failed

lifecycleEvents
  append

deletionManifests
  create
  addTargets
  claimTargets
  renewTargetLease
  completeTarget
  retryTarget
  failTarget
  completeIfReady
```

Names may change during implementation, but the responsibility boundaries should remain.

## Scope boundary

F2 implements:

- database runtime connection and transaction mechanics
- repository primitives
- durable claim leases and fencing tokens
- direct expired-claim reclaim
- controlled lease renewal
- durable payload versioning
- transaction retry and timeout policy
- retry infrastructure
- scheduled-action runtime
- outbox runtime
- lifecycle event persistence
- deletion workflow runtime
- automated database races
- durable worker process behavior
- local integration verification

F2 does not implement:

- registration
- login or sessions as product flows
- partner-request API behavior
- partnership-formation API behavior
- breakup API routes
- messaging
- realtime WebSockets
- production email or push provider selection
- object-storage provider integration
- user interface
- E2EE

Later epics feed real product operations into the F2 substrate.

## Code-review invariants

Reject an F2 implementation change if it does any of the following:

1. imports infrastructure into `packages/domain`
2. mutates authoritative lifecycle state outside a transaction
3. ignores `expected_generation` for lifecycle-sensitive scheduled work
4. calls an external provider inside an authoritative database transaction
5. commits a required outbox event separately from its authoritative state change
6. claims durable work without crash-recovery semantics
7. acknowledges durable work without verifying claim ownership
8. uses unbounded worker concurrency
9. restores access because deletion cleanup failed
10. places private content into lifecycle, outbox, deletion, or routine operational logs
11. locks multiple accounts in caller-provided order
12. makes a client or Node process clock authoritative over PostgreSQL time
13. acknowledges work using only timestamps without a fencing token
14. requires a separate sweeper for correctness of expired-claim reclaim
15. interprets an unknown durable payload version
16. uses `LISTEN/NOTIFY` as the durable queue rather than an optional wake-up optimization
17. omits defensive database timeout policy or pool error handling
18. adds a queue index without verifying the intended due-work query plan

## Completion rule

F2 is DONE only when every F2 acceptance gate in `docs/ROADMAP_EPICS.md` is satisfied with committed implementation and repeatable local evidence.

Design completion alone does not change F2 from IN_PROGRESS to DONE.
