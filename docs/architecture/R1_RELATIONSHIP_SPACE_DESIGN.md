# R1 Relationship Space Design

## Status

R1 Relationship Space is `IN_PROGRESS`.

Architecture and implementation design are complete in this document. Runtime implementation has not started on this branch. No R1 acceptance gate may be closed from design text alone.

Branch:

`feat/r1-relationship-space`

Verified starting point:

`ac7423d0966fa65993dc3955799835b3abd49c23`

Migration ownership:

- M1 owns `0011_messaging_core_runtime.sql`
- M1 owns `0012_messaging_interaction_runtime.sql`
- R1 owns `0013_relationship_space_runtime.sql`
- R1 owns `0014_relationship_space_interaction_runtime.sql`

R1 does not merge, copy, or redefine M1 messaging persistence. R1 is designed against the same verified P3 baseline and uses loose references where a future message or media resource may be associated with a relationship object.

## Purpose

Relationship Space is the private shared area for one immutable partnership namespace. It is not a social network, engagement surface, or behavioral analysis system.

The design covers:

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
- explicit relationship signals

This document is authoritative for R1 architecture. The HTTP surface is specified separately in `../api/R1_RELATIONSHIP_SPACE_API.md`.

## Non-negotiable invariants

1. The immutable `partnership_id` is the relationship-space namespace root.
2. A later partnership between the same two accounts is a different namespace.
3. Username, display name, current-partner pointers, or any mutable account field never authorize relationship-space access.
4. Every protected read and mutation derives current membership and lifecycle state from authoritative server state.
5. Cross-partnership guessed identifiers fail with the same unknown-resource shape as identifiers that do not exist.
6. Relationship content never enters routine logs, lifecycle events, security events, outbox payloads, scheduled-action payloads, analytics, notifications, error traces, or idempotency response metadata.
7. Precise place coordinates are protected relationship content. They are never operational logging or analytics fields.
8. No feature infers relationship quality, compatibility, emotional state, sentiment, breakup risk, responsiveness, or a love score.
9. No feature adds followers, public feeds, rankings, streaks, advertising, passive location history, or background geofencing.
10. Final partnership dissolution revokes authorization synchronously before physical cleanup completes.
11. Stable release remains blocked until S1 replaces development plaintext with reviewed E2EE for protected relationship content.
12. Runtime code may not claim R1 encryption exists before S1.

## Existing substrate retained

Migration 0004 already provides:

- `relationship_items`
- `relationship_events`
- `media_objects`

The existing `relationship_items` row already has:

- immutable item ID
- `partnership_id`
- creator account ID
- kind
- lifecycle
- optimistic `version`
- occurrence date fields
- `unlock_at`
- `encrypted_payload`
- `ciphertext_version`
- creation, update, and deletion timestamps

R1 retains `relationship_items` as the common aggregate root. It does not replace the table with a second generic object store.

The refinement is deliberately split:

- common identity, lifecycle, content envelope, occurrence metadata, release state, and version stay on the root item
- feature semantics that the server must query or enforce are normalized into supporting tables
- protected prose, private notes, coordinates, condition labels, captions, and similar content remain in one protected payload owned by the item
- relationships between R1 objects are represented explicitly
- references to future M1 or M3 resources remain loose and do not require schema changes in those milestones

## Authoritative versus derived model

| Product feature | Authoritative persistence | Derived behavior |
| --- | --- | --- |
| Relationship Home | No independent home row | Bounded aggregate of current partnership state, recent eligible R1 items, schedule state, reunion state, and deterministic experience cards |
| Our Story | `relationship_story_members` plus referenced `relationship_items` | Chronological projection using explicit occurrence precision |
| Remember This | `relationship_items(kind=remember_this)` plus optional loose source reference | Source availability is advisory; preserved snapshot remains an independent R1 object |
| Firsts | `relationship_items(kind=first)` | Timeline/list projection |
| Places We Became Us | `relationship_items(kind=place)` | Map/list rendering is client behavior; no background tracking |
| For You | `relationship_items(kind=for_you)` with release state | Scheduled visibility transition |
| Voice Letters | `relationship_items(kind=voice_letter)` plus optional media reference | Binary recording/upload belongs to M3 |
| Future Us | `relationship_items(kind=future_us)` with release state | Scheduled visibility transition |
| Love | `relationship_items(kind=love)` | Private collection/list |
| Someday | Item plus `relationship_someday_state` | Lists grouped by explicit state |
| This Day in Us | No independent authoritative row | Deterministic date-based query over eligible R1 objects |
| Our Year | Optional `our_year` curation item plus `relationship_curations` and ordered links | Candidate recap is derived from eligible items for the selected year |
| Anniversary Experience | Optional `anniversary` curation item plus `relationship_curations` and ordered links | Anniversary date derives from P3 relationship start date |
| Surprise Mode | `relationship_items(kind=surprise)` plus ordered links | Client reveals linked steps in saved order |
| Until We're Together Again | Reunion item plus `relationship_reunion_state` | Countdown derives from manually entered target date |
| Proposal Mode | `relationship_items(kind=proposal)` plus ordered links | Client presents the saved sequence; no gamified yes/no state |
| Relationship signals | Item plus `relationship_signal_state` | Chronological explicit signal projection only |

Derived views are disposable read models. They never become an alternate authority for content or lifecycle.

## Relationship item kinds

R1 supports these stable domain kinds:

`memory`  
`remember_this`  
`first`  
`place`  
`for_you`  
`voice_letter`  
`future_us`  
`love`  
`someday`  
`our_year`  
`anniversary`  
`surprise`  
`reunion`  
`proposal`  
`relationship_signal`

New kinds require a forward migration or an explicitly versioned compatibility change. Arbitrary strings are not accepted by the R1 contracts.

## Migration 0013: relationship space runtime

`0013_relationship_space_runtime.sql` refines the existing item root without rewriting migrations 0001 through 0010.

### relationship_items additions

Planned additions:

```text
content_schema_version integer not null default 1
development_plaintext_payload jsonb
occurred_year smallint
occurred_month smallint
occurred_day smallint
release_mode text
release_generation bigint not null default 1
released_at timestamptz
```

The existing `unlock_at` column remains the authoritative trusted-server release time for date/time based releases. It is not duplicated into another table.

The existing `encrypted_payload` and `ciphertext_version` remain reserved for S1.

### Content representation invariant

At most one protected-content representation may be populated:

- pre-S1 R1 development writes `development_plaintext_payload`
- post-S1 protected writes use `encrypted_payload` plus `ciphertext_version`
- the two representations may never be populated together

Metadata-only rows may have neither representation.

Pre-S1 code must not write plaintext into `encrypted_payload`.

### Occurrence precision

R1 does not fabricate dates.

The existing `occurred_precision` remains the precision discriminator, but R1 normalizes date components:

| Precision | year | month | day |
| --- | --- | --- | --- |
| day | required | required | required |
| month | required | required | null |
| year | required | null | null |
| unknown | null | null | null |
| null | null | null | null |

Migration 0013 backfills only components that are actually supported by the legacy `occurred_date` plus precision. For a legacy month value it keeps year and month but does not create a meaningful day. For a legacy year value it keeps only the year.

After R1 starts writing, the normalized component columns are authoritative for R1 occurrence semantics. The legacy `occurred_date` column remains compatibility substrate and is not used to invent missing precision.

### Release state

`release_mode` is null for ordinary relationship objects.

For `for_you` and `future_us`, it is one of:

- `immediate`
- `scheduled`
- `labelled_manual`

Rules:

- immediate: `released_at` is set in the create transaction and `unlock_at` is null
- scheduled: `unlock_at` is required; `released_at` starts null
- labelled_manual: `unlock_at` is null; the private condition label lives only in the protected payload; release requires an explicit user action while mutation capability is available
- `release_generation` is positive and advances whenever a pending release schedule is changed or superseded
- a scheduled action uses the item ID as its aggregate ID and the release generation as its generation fence
- once released, the protected payload and references of For You and Future Us are immutable in R1; deletion remains a separate active-state operation

There is no autonomous condition evaluator. R1 never turns a behavioral or emotional observation into a release.

### Indexes

0013 adds indexes for:

- active partnership feed ordered by `created_at, id`
- active occurrence queries by partnership and normalized date components
- active unreleased scheduled items by partnership and `unlock_at`
- active kind queries used by bounded feature lists

The existing 0010 scheduled-action aggregate index remains sufficient for action lookup.

### relationship_someday_state

```text
item_id
partnership_id
state
completed_at
```

Allowed states:

- `someday`
- `soon`
- `completed`

`completed_at` is present only for `completed`.

The state is explicit user-created product state, not engagement scoring.

### relationship_signal_state

```text
item_id
partnership_id
signal_kind
```

Allowed signal kinds:

- `i_need_you`
- `call_me_when_you_can`
- `i_need_reassurance`
- `shared_feeling`
- `thinking_of_you`
- `kiss`
- `hug`

Any user-entered description of a shared feeling stays in the protected payload. The server stores only the explicit signal code needed for product semantics.

### relationship_reunion_state

```text
item_id
partnership_id
target_date
```

The date is manually supplied and validated with trusted server date logic. No location field exists.

### relationship_curations

```text
item_id
partnership_id
curation_type
anchor_year
```

Allowed curation types:

- `our_year`
- `anniversary`

Each partnership has at most one saved curation of a given type and anchor year. The curation item owns any private title or note through its protected payload.

## Migration 0014: interaction runtime

`0014_relationship_space_interaction_runtime.sql` owns relationships between items, loose external references, explicit story membership, and event hardening.

### relationship_item_references

Purpose: future-compatible references to resources owned by another milestone without changing that milestone's schema.

Representative fields:

```text
id
partnership_id
item_id
reference_type
reference_id
role
position
created_at
```

Allowed `reference_type` values:

- `message`
- `media`

Allowed roles:

- `source`
- `attachment`

The table intentionally has no foreign key to M1 messages or M3 transport tables.

Authorization rules still require the referenced resource, when resolved, to belong to the same partnership. A missing original resource is rendered as unavailable rather than causing the R1 object to disappear.

### Remember This source rule

Remember This must survive the original message's removal without making a hidden server-side copy.

The server never copies a message body out of M1 storage.

Instead:

1. the authorized client explicitly creates a new Remember This item
2. the preserved snapshot is submitted as the new R1 item's protected content
3. an optional loose message reference records provenance only
4. after S1, the client encrypts the R1 snapshot before submission
5. deleting the original message does not delete the independent R1 object
6. deleting the R1 item deletes its independent protected snapshot

Before S1 this means the explicitly created R1 snapshot is server-readable development content. It exists only in the authoritative R1 payload and is not copied into operational metadata.

### relationship_item_links

Purpose: same-partnership links between R1 objects.

Representative fields:

```text
partnership_id
owner_item_id
target_item_id
link_type
position
created_at
```

Allowed link types:

- `curation`
- `sequence_step`
- `prepared_content`

Composite foreign keys bind both item IDs to the same partnership. This prevents an item from linking into another partnership even if a UUID is guessed.

Uses:

- Our Year and Anniversary ordered selections use `curation`
- Surprise and Proposal sequences use `sequence_step`
- reunion prepared content uses `prepared_content`

A sequence step is another ordinary R1 item. R1 therefore does not introduce a second content-bearing step table that S1 would also need to encrypt.

### relationship_story_members

Purpose: explicit user curation for Our Story.

Representative fields:

```text
partnership_id
item_id
added_by_account_id
created_at
```

An item may appear at most once in Our Story. Display order is deterministic from occurrence precision and date components, not from an engagement algorithm.

Undated items may be explicitly included and appear in an `Undated` group. R1 never assigns them a fake date.

### relationship_events hardening

The existing `relationship_events` table remains minimal metadata only.

R1 uses event types such as:

- `item_created`
- `item_updated`
- `item_released`
- `someday_state_changed`
- `story_membership_changed`

Rows may contain only the existing columns:

- event ID
- partnership ID
- optional item ID
- event type
- optional actor account ID
- item version
- created timestamp

There is no JSON content field.

0014 adds:

- positive item-version validation when a version is present
- same-partnership integrity between an event and its item
- insert-time actor membership validation where an actor is present, without adding a restrictive actor foreign key that could interfere with permanent account deletion
- a trigger that rejects UPDATE of retained relationship events

DELETE remains allowed because item deletion and final dissolution must be able to remove event rows.

## Protected content and the pre-S1 boundary

R1 contains highly sensitive relationship content.

### Temporarily server-readable before S1

During development only, private feature payloads are stored in:

`relationship_items.development_plaintext_payload`

Examples include:

- letter bodies
- memory text
- private notes
- place names when treated as private content
- exact coordinates
- condition labels
- affectionate observations
- saved-message snapshots
- proposal or surprise wording
- optional explicit shared-feeling text

### Never duplicated into

Protected content must not be duplicated into:

- `relationship_events`
- `partnership_lifecycle_events`
- security events
- outbox payloads
- scheduled-action payloads
- account notifications
- idempotency response bodies
- error details or traces
- routine application logs
- analytics

Request logging must not log R1 mutation bodies.

### S1 transition

S1 must:

1. implement a reviewed relationship-object encryption envelope
2. have authorized clients encrypt protected payloads before upload
3. write ciphertext only to the existing `encrypted_payload`
4. write the reviewed protocol identifier to `ciphertext_version`
5. stop all new `development_plaintext_payload` writes
6. migrate development data only through a reviewed client-side re-encryption flow or wipe it
7. prove that stable-release data inspection finds no protected R1 plaintext in PostgreSQL, logs, queues, providers, or object storage

R1 does not insert fake `partnership_crypto_epochs`. Real epochs begin only when S1 provisions reviewed cryptographic state.

## Location privacy

Places We Became Us is explicit only.

The protected place payload may contain:

- user-entered title
- explicitly selected coordinates
- optional note
- optional private descriptive fields

Occurrence date uses the common precision model.

R1 does not:

- poll device location
- request background location for this feature
- store location history
- create geofences
- infer visits
- publish coordinates to analytics

If a map provider is introduced later, provider exposure requires separate review. R1 core does not require one.

## Lifecycle model

### Active

Authorized current partners may read eligible R1 content.

Creation, edit, delete, story curation, schedule changes, manual labelled release, and feature-specific actions are allowed only where the feature's own rules permit them.

### breakup_pending

All user-driven R1 mutation capability is view-only:

- no new R1 object
- no edit
- no user delete
- no story curation changes
- no Someday state change
- no manual labelled release
- no schedule change
- no relationship signal creation

A For You or Future Us item that was already configured with a date/time release before breakup still releases at its trusted-server schedule. That visibility transition is not a new relationship object.

No other feature receives an implicit breakup exception.

### Restoration

Restoration keeps the same immutable partnership ID.

Therefore:

- the same R1 namespace remains
- items are not copied
- versions are not reset
- schedules are not recreated
- already released items remain released
- pending valid schedules remain pending
- active-state mutation capability returns
- no duplicate release action is created

### Account-deletion view-only overlay

R1 remains readable to the partner who still has account access according to P3 authorization.

Normal R1 mutation is disabled.

For R1, a date/time release that was already durably configured before the account-deletion overlay continues for For You and Future Us. This is treated as a state transition on an existing object, not creation of new shared content. No manual release, schedule creation, reschedule, edit, or delete is allowed while the overlay exists.

If the account is recovered before final dissolution, the same namespace and item versions remain.

### Final dissolution

The P3 canonical dissolution transaction remains authoritative.

R1 does not create a second termination path.

Ordering:

1. P3 locks and transitions the partnership to `terminated`
2. occupied membership authorization is released according to P3
3. pending R1 relationship-item release actions are cancelled where still pending
4. the cancellation helper updates `scheduled_actions` where `aggregate_type = 'relationship_item'` and `aggregate_id` belongs to a current `relationship_items` row for the dissolving partnership; this runs before relational item cleanup removes the lookup rows
5. the partnership deletion manifest already used by P3 remains the destructive workflow root
6. after commit, no R1 API read or mutation is authorized
7. the existing `partnership_relational_content` deletion target removes `relationship_events` and `relationship_items`
8. all R1 supporting rows disappear through foreign-key cascade
9. processing scheduled workers re-check terminated state and finish as stale/no-op rather than releasing content
10. a future partnership receives a new partnership ID and cannot query the old namespace

No R1 table requires a new deletion target because all new authoritative relational rows are descendants of `relationship_items`. If runtime implementation introduces storage outside that relational tree, the deletion manifest must be extended before R1 can close.

## Item deletion

Relationship items do not use a user-visible tombstone.

A successful user delete while active:

1. authenticates current membership
2. locks current partnership lifecycle
3. locks the item
4. checks `expectedVersion`
5. confirms feature-specific delete capability
6. cancels the pending release action if present
7. hard-deletes the item
8. cascades its R1 child state, links, references, story membership, and relationship events
9. commits

Because protected content has a single authoritative item payload, deletion does not leave a content-bearing historical version table.

Operational scheduled-action rows may retain opaque IDs and status according to queue retention, but they never contain relationship content.

## Feature mutation semantics

### Shared mutable content

Memory, Remember This, Firsts, Places, Love, Someday, saved curations, and ordinary shared container metadata use optimistic concurrency.

Either current partner may edit shared items unless the feature is creator-private by design.

### Creator-private before reveal

For You, Future Us, Surprise, Proposal, and their unreleased/private preparation state are visible and mutable only to the creator before reveal, subject to lifecycle capability.

The partner receives no protected payload for an unreleased item.

### Released For You and Future Us

Release is monotonic.

Once released:

- both authorized partners may read it
- protected content and references are immutable in R1
- active-state deletion remains available to the creator
- a repeated scheduled release is a no-op

### Relationship signals

Signals are explicit, user-triggered, and immutable after creation. They may be removed by their creator while active.

No signal is generated by message frequency, typing, presence, response time, location, sentiment, or any hidden model.

## Scheduling architecture

R1 uses the existing `scheduled_actions` runtime.

For a scheduled For You or Future Us item:

```text
action_type: relationship_item_release
aggregate_type: relationship_item
aggregate_id: item_id
execute_at: relationship_items.unlock_at
expected_generation: relationship_items.release_generation
payload_version: 1
payload: {}
deduplication_key: relationship-release:<itemId>:g:<releaseGeneration>
```

The payload is intentionally empty. It does not contain the letter body, title, note, coordinates, release label, partner name, or any other protected content.

### Worker execution

The handler:

1. validates action type and payload version through the existing registry
2. reads the item only to discover immutable partnership ID and current release generation
3. treats a missing/deleted item as stale
4. checks the generic expected-generation fence
5. locks authoritative partnership lifecycle before locking the item row
6. re-reads the item under lock
7. re-checks item lifecycle, kind, release mode, release generation, `unlock_at`, and `released_at`
8. re-evaluates current P3 lifecycle state
9. releases only when the current state permits the preconfigured release
10. sets `released_at`, increments item `version`, and appends minimal relationship event metadata
11. lets the existing durable consumer complete the claimed action

The handler never trusts the persisted job as an instruction that bypasses current state.

Unknown payload versions fail closed through the existing scheduled handler registry.

### Reschedule and cancellation

Changing a pending schedule while active:

1. locks partnership then item
2. checks expected item version
3. increments `release_generation`
4. updates `unlock_at`
5. cancels the prior pending action
6. inserts the new generation's action with a new deduplication key
7. increments item version
8. commits atomically

Deleting the item cancels a pending action before deleting the item.

Breakup and account-deletion overlays do not increment `release_generation`, so an already configured permitted release remains valid.

Final dissolution extends the P3 dissolution transaction with a narrow R1 cancellation helper. The helper cancels pending scheduled actions whose aggregate is a relationship item currently owned by that partnership. It runs before the deletion manifest is processed, while relationship-item rows still exist. It does not change P3 lifecycle authority. Any already-processing release is fenced by the authoritative partnership lifecycle re-check and becomes stale/no-op if termination committed first.

## Optimistic concurrency and lock order

Every shared R1 mutation uses `relationship_items.version`.

Mutation requests carry `expectedVersion`.

If the current version differs, the API returns:

`409 VERSION_CONFLICT`

R1 never silently uses last-write-wins for shared relationship content.

### Lock order

R1 follows the existing P3 ordering:

1. authentication/session checks outside or at transaction boundary as appropriate
2. authoritative current partnership lookup
3. canonical P3 account locks only when the operation already requires multi-account locking
4. partnership lifecycle row
5. relationship item rows in immutable ID order when more than one item is involved
6. R1 child rows
7. scheduled action or idempotency rows required by the same mutation

A scheduled-release worker never acquires account locks after acquiring the partnership lock.

### Race outcomes

| Race | Authoritative result |
| --- | --- |
| Partner A edit vs Partner B edit | One item-row lock wins; the other sees changed version and receives `VERSION_CONFLICT` |
| Update vs delete | Lock order linearizes; delete first yields not-found, update first may commit then delete must use the newer version |
| Release vs content edit | Both lock partnership then item. If edit commits first, worker re-checks latest generation/version state. If release commits first, released delivery content is immutable and edit is denied |
| Release vs schedule edit | Schedule edit increments release generation. A worker holding the old generation becomes stale |
| Release vs breakup initiation | Partnership lock linearizes. A preconfigured For You/Future Us date release remains permitted after breakup; normal mutation does not |
| Release vs account deletion | Partnership lock linearizes. Preconfigured date release remains permitted; all user-driven mutations are denied |
| Release vs restoration | Same namespace and release generation; released state is monotonic, so no duplicate release |
| Release vs final dissolution | If release commits first it is immediately subject to subsequent dissolution deletion. If termination commits first the worker sees terminated and does not release |
| Create vs breakup | Breakup first causes create denial; create first commits a valid object that becomes view-only |
| Update/delete vs breakup | Breakup first denies mutation; mutation first may commit and the resulting object then becomes view-only |
| Mutation vs final dissolution | Termination first denies access. Mutation first commits only before authorization is revoked, after which cleanup deletes it |
| Duplicate scheduled claims | Existing `SKIP LOCKED`, lease, and claim-version fencing allow only the current claim owner to acknowledge |
| Deletion target crash/reclaim | Existing F2 deletion lease and claim-version fencing retries idempotently |
| Account recovery | Same non-terminated partnership namespace and item versions remain; no item recreation occurs |
| Guessed foreign item ID | Same `RELATIONSHIP_ITEM_NOT_FOUND` response as an unknown ID |

Persisted committed state, not request arrival time, determines the result.

## Idempotency

R1 create requests require `Idempotency-Key`.

The existing `idempotency_records` substrate is reused with an R1-specific scope.

Stored idempotency data is limited to:

- account ID
- R1 operation scope
- opaque idempotency key
- response status
- response metadata containing item ID and version only
- timestamps and expiry

The protected request body is never copied into `response_body`.

R1 does not require a content-derived fingerprint to make duplicate create safe. Reuse of the same key within the scope identifies the same logical create and replays the original metadata result. A caller creating different content must use a new key.

Version-checked update and delete operations are naturally duplicate-safe at the state boundary and do not store private response bodies.

## Relationship events

`relationship_events` are operational synchronization metadata, not a content history.

They never contain:

- letter text
- memory text
- notes
- coordinates
- signal free text
- media plaintext
- content payload fragments

Item hard deletion cascades its events. Final dissolution deletes every remaining partnership relationship event.

This means R1 has no hidden event-sourced content archive.

## Cross-partnership authorization

Every item query is constrained by both:

- item ID
- authoritative current partnership ID

The repository does not:

1. load an item globally by ID
2. return a different error for foreign partnership
3. authorize from creator username or other mutable identity

Internal item links use same-partnership composite foreign keys.

Loose message/media references are never authorization grants. Resolution independently verifies the referenced resource's partnership.

## Relationship Home

Relationship Home is a bounded aggregate query, not a stored document.

It may return:

- current relationship-space lifecycle mode
- relationship duration derived from P3 `relationship_start_date`
- recent eligible relationship items
- upcoming or newly released For You/Future Us metadata the caller is allowed to see
- active manual reunion date
- deterministic anniversary eligibility
- recent explicit relationship signals
- links to feature sections

It does not rank by engagement.

It does not calculate a relationship score.

The home response is always `Cache-Control: private, no-store`.

## Derived experiences

### Our Story

Our Story selects only items explicitly present in `relationship_story_members`.

Sort rules:

1. exact day items by full date
2. month-precision items by year and month
3. year-precision items by year
4. unknown/undated items in a separate undated group
5. item ID is the deterministic final tie-breaker

The UI never displays an invented day or month.

### This Day in Us

This Day in Us is derived from eligible released items whose explicit occurrence precision contains the requested month and day.

Only `day` precision is eligible for exact day resurfacing.

Month, year, and unknown precision are not coerced into an exact anniversary date.

### Our Year

The server derives a candidate set from eligible R1 items whose explicit occurrence data belongs to the requested year.

It may apply only deterministic eligibility and chronological ordering.

No engagement score, message count score, reaction score, sentiment score, or responsiveness score is used.

If the partners save a curation, the `our_year` curation item and ordered `curation` links become authoritative for that saved selection.

### Anniversary Experience

The anniversary calendar date derives only from the manually entered P3 relationship start date.

The experience can combine explicitly eligible or saved R1 items.

A saved anniversary curation is optional and versioned.

### Surprise Mode

Surprise is a private creator-owned container before reveal.

Its sequence is an ordered set of `sequence_step` links to R1 items.

R1 does not persist a behavioral completion score. Client progress through a reveal is presentation state unless a later requirement explicitly needs durable progress.

### Until We're Together Again

The target date is user-entered.

The countdown is deterministic calendar arithmetic.

No device location, distance, travel inference, or geofence is consulted.

### Proposal Mode

Proposal Mode is an intentional private sequence leading to an in-person proposal.

It has no persisted yes/no decision mechanic and no engagement score.

## Browser architecture

R1 adds a dedicated feature root:

`apps/web/src/features/relationship-space/`

Planned structure:

```text
relationship-space/
  api.ts
  model.ts
  RelationshipSpacePanel.tsx
  home/
    RelationshipHome.tsx
  items/
    RelationshipItemList.tsx
    RelationshipItemDetail.tsx
    RelationshipItemEditor.tsx
    RelationshipItemCard.tsx
  experiences/
    OurStory.tsx
    ThisDayInUs.tsx
    OurYear.tsx
    AnniversaryExperience.tsx
    SequenceExperience.tsx
    ReunionExperience.tsx
  kinds/
    feature-registry.ts
    editors/
    projections/
```

The kind registry maps stable item kinds to explicit contract schemas and feature adapters. It is not a catch-all arbitrary JSON renderer.

### Browser state

The browser keeps the current R1 view keyed by current `partnershipId`.

Lifecycle modes:

- `active`
- `breakup_pending_view_only`
- `account_deletion_view_only`
- `terminated_or_no_current_space`

The server capability snapshot controls presentation only. Every mutation is re-authorized by the server.

When a refreshed current partnership ID changes or disappears, R1 in-memory state is discarded before the new namespace is rendered.

R1 core does not implement the M2 IndexedDB relationship outbox or offline mutation queue. M2 later adds local persistence under the already documented account/partnership namespace rules.

R1 core also does not require WebSockets. It may refetch after local mutations and on foreground/visibility refresh. M2 later carries `relationship.changed` invalidations without changing R1 authority.

## M1 coordination boundary

M1 owns:

- migrations 0011 and 0012
- conversations and messages
- message edit/delete/reaction state
- receipts, presence, typing, and nicknames
- messaging API and browser module

R1 owns:

- migrations 0013 and 0014
- relationship item runtime and feature-specific R1 state
- relationship-space API
- scheduled relationship release handler
- relationship-space browser module

R1 must not:

- add columns to M1 message tables for Remember This
- add a foreign key from M1 messages to R1
- change M1 message deletion semantics
- reuse 0011 or 0012
- cherry-pick M1 runtime into the R1 design branch

Likely shared files during runtime are:

- `packages/contracts/src/index.ts`
- `packages/db/src/index.ts`
- `apps/api/src/application.ts`
- `apps/worker/src/runtime/worker-application.ts` or its registry assembly
- `apps/web/src/app/App.tsx`
- root `package.json`
- roadmap and state documents

Changes to those files must be minimal and append-oriented.

## Boundaries deferred to later milestones

### M2

Owns:

- WebSocket relationship invalidations
- reconnect resynchronization transport
- IndexedDB namespace storage
- offline relationship mutation queue
- physical-device offline/reconnect acceptance

### M3

Owns:

- actual media upload
- actual voice recording transport
- object-store authorization
- attachment binary lifecycle

R1 only owns media/reference associations.

### S1

Owns:

- reviewed E2EE protocol
- client-side relationship-object encryption
- crypto epochs
- cryptographic device enrollment/recovery
- migration or wiping of pre-S1 plaintext
- stable-release proof that protected content is not server-readable

## Implementation slices

### R1-A Domain model and contracts

- stable item kinds
- feature-specific contract schemas
- normalized date precision
- optimistic version rules
- release semantics
- explicit capability refinements
- cursor contracts
- private projection rules
- derived experience contracts

### R1-B Migrations 0013 and 0014 plus repositories

- root item refinement
- supporting feature tables
- references and same-partnership links
- story membership
- event hardening
- indexes and invariants
- item CRUD repository
- schedule repository integration
- deletion-safe cascades

### R1-C Relationship Home and core CRUD API

- home aggregate
- list/detail/create/update/delete
- create idempotency
- expectedVersion conflict handling
- lifecycle authorization
- privacy-safe unknown-resource behavior

### R1-D Scheduled content

- For You
- Future Us
- immediate, scheduled, and labelled-manual release modes
- release generation fencing
- retry-safe scheduled handler
- breakup/account-deletion/final-dissolution behavior
- schedule edit/cancel semantics

### R1-E Structured relationship features

- Our Story
- Remember This
- Firsts
- Places We Became Us
- Someday
- Love
- explicit relationship signals
- reunion date state
- reference/link integrity

### R1-F Derived and curated experiences

- This Day in Us
- Our Year
- Anniversary Experience
- Surprise Mode
- Until We're Together Again
- Proposal Mode
- deterministic selection and ordering only

### R1-G Browser Relationship Space

- responsive relationship home
- feature navigation
- create/edit flows
- private unreleased views
- lifecycle view-only modes
- schedule rendering
- derived experience rendering
- namespace reset behavior

### R1-H Lifecycle, race, deletion, and security hardening

Required matrix includes:

- concurrent partner edits
- update versus delete
- scheduled release versus edit
- scheduled release versus schedule edit
- scheduled release versus breakup initiation
- scheduled release versus account deletion
- scheduled release versus final dissolution
- restoration versus release
- create/update/delete versus breakup
- mutation versus final dissolution
- account recovery preserving the same namespace
- guessed cross-partnership IDs
- cross-partnership internal links
- loose-reference authorization
- duplicate scheduled claims
- deletion target crash/reclaim
- pre-S1 plaintext non-duplication
- coordinate log/analytics exclusion

### R1-I Closure harness and docs

Planned commands, which do not exist until implemented:

```text
npm run test:relationship-space
npm run test:r1:security
npm run test:r1:postgres
npm run test:r1:local
npm run health
npm audit --audit-level=high
```

R1 closure evidence must include the canonical migration sequence through 0014 after M1 migrations 0011 and 0012 are available from the verified integration baseline. R1 must not create substitute 0011 or 0012 files.

## Acceptance evidence required

R1 remains IN_PROGRESS until executed evidence proves all of the following:

1. migrations 0001 through 0014 apply from zero in canonical order
2. database invariants pass
3. P1, P2, and P3 regression surfaces remain green
4. R1 domain and contract tests pass
5. CRUD and derived API integration tests pass
6. private responses use no-store
7. optimistic conflicts return stable `VERSION_CONFLICT`
8. foreign and unknown item IDs are indistinguishable
9. breakup and account-deletion view-only states reject user mutations
10. preconfigured For You/Future Us releases obey lifecycle rules
11. stale release generations cannot unlock content
12. duplicate claims cannot release twice
13. restoration preserves schedule and object identity
14. final dissolution synchronously ends authorization
15. partnership relational cleanup deletes all R1 authoritative rows
16. scheduled rows retained for operations contain no private content
17. item deletion leaves no protected content in an alternate R1 table
18. deletion crash/reclaim is retry-safe
19. future partnership namespaces cannot read old R1 data
20. coordinates never enter logs, analytics, events, or queue payloads
21. Remember This does not depend on original message existence and does not server-copy M1 content
22. explicit signals remain user-triggered and no emotion inference exists
23. derived experiences use deterministic rules without engagement scoring
24. browser lifecycle modes match server authority
25. browser production build passes
26. full repository health passes
27. high-severity dependency audit passes

## Design risks intentionally bounded

### Pre-S1 plaintext

R1 runtime can be developed before S1 only with explicit development plaintext storage. This is not stable-release security. Stable release remains blocked until S1 migration and inspection evidence close the boundary.

### Parallel M1 migration availability

R1 owns 0013 and 0014 but does not fabricate 0011 or 0012. The final clean 0001 through 0014 closure run can occur only after verified M1 migrations are available through the integration baseline.

### Media and voice transport

Voice Letters and photo/media associations can be modeled in R1 before M3, but real binary transport and object-storage proof are not R1 completion evidence.

### Account-deletion scheduled release interpretation

R1 treats an already configured date/time release as a visibility transition of an existing object and therefore permits it during the P3 account-deletion view-only overlay. This decision is deliberately narrow: no user-driven relationship-space mutation is enabled. If product policy later chooses to pause such releases, the PRD, worker behavior, and acceptance matrix must change together.

## Completion statement

This document completes R1 architecture and implementation design only.

R1 runtime implementation has not started.

No migration 0013 or 0014 source file, R1 repository, R1 API handler, R1 worker handler, R1 browser feature, or R1 closure harness is claimed to exist until it is actually implemented and verified.
