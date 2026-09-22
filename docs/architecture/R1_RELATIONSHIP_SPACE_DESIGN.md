# R1 Relationship Space Design

## Status

R1 Relationship Space is `IN_PROGRESS`.

Architecture and implementation design are complete in this document, including the second-pass edge-semantics refinement. R1 source implementation is isolated-green at verification checkpoint `0b863c5` across domain, contracts, migrations, repositories, API, worker, browser, security tests, integration tests, database invariants, and the dedicated local closure harness. Final integrated closure evidence remains pending on the real M1 migrations 0011/0012, so R1 is not DONE.

Branch:

`feat/r1-relationship-space`

Verified starting point:

`ac7423d0966fa65993dc3955799835b3abd49c23`

### Current implementation state

Runtime source implementation is isolated-green at checkpoint `0b863c5`.

The current branch contains the R1 domain/contracts, migrations 0013/0014, database repositories and invariants, private API, durable release worker, lifecycle integration, responsive browser implementation, security tests, API/worker integration tests, and the dedicated local R1 harness.

This does **not** mean R1 is closed. Executed isolated evidence includes domain/contracts 16/16, R1 security 13/13, disposable PostgreSQL migrations and invariants PASS, API/worker integration 68/68 with `R1_LOCAL_POSTGRES_PASS`, P1/P2/P3 security regressions green, typecheck/build/lint/dependency checks green, and the high-severity dependency audit at 0 vulnerabilities. `format:check` still reports style drift in 15 R1 files. Final integrated closure also requires the real M1-owned migrations 0011/0012 and a strict full-health run; R1 does not copy them.

Migration ownership:

- M1 owns `0011_messaging_core_runtime.sql`
- M1 owns `0012_messaging_interaction_runtime.sql`
- R1 owns `0013_relationship_space_runtime.sql`
- R1 owns `0014_relationship_space_interaction_runtime.sql`

R1 does not merge, copy, or redefine M1 messaging persistence. R1 is implemented against the same verified P3 baseline and uses loose references where a future message or media resource may be associated with a relationship object.

For isolated R1 branch testing only, `test:r1:local` opts into `SHAWTIE_MIGRATION_RESERVATIONS=0011,0012`. This lets the migration-plan checker acknowledge the two M1-owned numbers without creating placeholder SQL files. Normal `health` and integrated `test:r1:postgres` runs remain strict and require the real M1 migrations before R1 can close.

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
- protected prose, private notes, coordinates, captions, and similar content remain in a protected main payload owned by the item; release-gated items may also have a separate protected preview payload that is safe to expose before release
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
| Voice Letters | Voice recording is a `media` reference with role `voice_letter` attached to an intentional R1 item | Binary recording/upload belongs to M3; R1 does not create a second standalone voice-letter content aggregate |
| Future Us | `relationship_items(kind=future_us)` with release state | Scheduled visibility transition |
| Love | `relationship_items(kind=love)` | Private collection/list |
| Someday | Item plus `relationship_someday_state` | Lists grouped by explicit state |
| This Day in Us | No independent authoritative row | Deterministic date-based query over eligible R1 objects |
| Our Year | Optional `our_year` curation item plus `relationship_curations` and ordered links | Candidate recap is derived from eligible items for the selected year |
| Anniversary Experience | Optional `anniversary` curation item plus `relationship_curations` and ordered links | Anniversary date derives from P3 relationship start date |
| Surprise Mode | `relationship_items(kind=surprise)` with creator-owned protected sequence payload and release state | Client reveals the saved sequence after creator reveal; media references may be step-positioned |
| Until We're Together Again | Reunion item plus `relationship_reunion_state` | Countdown derives from manually entered target date |
| Proposal Mode | `relationship_items(kind=proposal)` with creator-owned protected sequence payload and release state | Client presents the saved sequence after creator reveal; no gamified yes/no state |
| Relationship signals | Item plus `relationship_signal_state` | Chronological explicit signal projection only |

Derived views are disposable read models. They never become an alternate authority for content or lifecycle.

## Relationship item kinds

R1 supports these stable domain kinds:

`memory`  
`remember_this`  
`first`  
`place`  
`for_you`  
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

Implemented additions:

```text
content_schema_version integer not null default 1
development_preview_payload jsonb
development_plaintext_payload jsonb
encrypted_preview_payload bytea
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

R1 distinguishes a protected preview from protected main content.

The preview exists only when a locked delivery experience needs to show a teaser before the sealed content is available. Examples include a For You condition label or a Surprise title.

Pre-S1 development fields:

- `development_preview_payload`
- `development_plaintext_payload`

S1 fields:

- `encrypted_preview_payload`
- the existing `encrypted_payload`
- the existing `ciphertext_version`, which identifies the reviewed protocol used by both envelopes for that item

An item is in exactly one content-storage mode:

- development mode may populate the development preview and/or development main payload and must leave both encrypted payload columns null
- encrypted mode may populate the encrypted preview and/or encrypted main payload and must leave both development payload columns null
- metadata-only rows may leave all four content columns null

R1 never writes plaintext into an encrypted field.

Before release, the intended recipient may receive only the protected preview representation that the current authorization rules permit. The sealed main payload is not returned to that recipient before release. The creator may read both while active and while their account remains authorized.

This preview/main split is an S1 handoff requirement as well as a pre-S1 API rule. S1 must preserve the ability for the server to withhold sealed ciphertext while still returning separately encrypted preview ciphertext.

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

R1 uses the same trusted PostgreSQL UTC calendar date convention as P2 for date validation.

For historical occurrence kinds such as memory, Remember This, Firsts, Places, and Love, a supplied occurrence date may not be in the future. Future intentions belong in Someday, Future Us, reunion state, Surprise, or Proposal rather than being represented as a memory that has already happened.

Relationship signals do not accept client-supplied occurrence time. Their ordering uses trusted `created_at`.

### Release state

`release_mode` is null for ordinary relationship objects.

R1 supports four explicit release modes:

- `immediate`
- `scheduled`
- `recipient_open`
- `creator_reveal`

Allowed mode by kind:

| Kind | Allowed release modes |
| --- | --- |
| `for_you` | immediate, scheduled, recipient_open |
| `future_us` | immediate, scheduled, recipient_open |
| `surprise` | immediate, creator_reveal |
| `proposal` | immediate, creator_reveal |
| every other kind | null only |

Rules:

- immediate: `released_at` is set in the create transaction and `unlock_at` is null
- scheduled: `unlock_at` is required, must be strictly later than trusted transaction time at creation/reschedule, and `released_at` starts null
- recipient_open: `unlock_at` is null; the intended partner sees only the authorized preview and explicitly opens the item while active
- creator_reveal: `unlock_at` is null; the creator prepares the experience privately and explicitly reveals it while active
- `release_generation` is positive and advances whenever a pending scheduled release is changed or superseded
- a scheduled action uses item ID as aggregate ID and release generation as its generation fence
- scheduled release always delivers the latest committed protected content for that generation; scheduling does not freeze a separate content revision
- once a delivery item is released, its protected preview, main payload, and external references are immutable in R1; active-state deletion remains a separate operation according to the ownership matrix

There is no autonomous condition evaluator. `recipient_open` means the recipient decides when a displayed condition label applies. R1 never infers that a condition has become true.

Manual recipient-open and creator-reveal transitions are user mutations. They are denied during `breakup_pending` and account-deletion view-only states.

Only a preconfigured `scheduled` release receives the breakup exception defined by the PRD.

### Indexes

0013 adds indexes for:

- active partnership feed ordered by `created_at, id`
- active occurrence queries by partnership and normalized date components
- active unreleased scheduled items by partnership and `unlock_at`
- active kind queries used by bounded feature lists

The existing 0010 scheduled-action aggregate index remains sufficient for action lookup.

### Root-row and foreign-key hardening

Migration 0013 also adds a unique key on:

`relationship_items(id, partnership_id)`

Every R1 child table that stores `item_id` plus `partnership_id` uses a composite foreign key to that pair.

This is required so database integrity, not only service code, prevents an R1 child row from naming an item in another partnership.

0013 adds legacy-safe checks for new or updated rows covering:

- supported R1 kind values
- positive `content_schema_version`
- positive `release_generation`
- valid normalized occurrence shapes
- valid release-mode/kind combinations
- release timestamp shape
- development versus encrypted content-mode exclusivity

The root identity fields are immutable after insert:

- `id`
- `partnership_id`
- `creator_account_id`
- `kind`
- `created_at`

R1 repositories never update those fields. Migration hardening must reject an attempted update of immutable identity fields.

The legacy `lifecycle` column remains compatibility substrate. R1 writes only `active` rows and hard-deletes user-deleted items rather than transitioning them to a retained `deleted` content row.

`content_schema_version` is interpreted by kind. Unknown versions fail closed in the client and, while plaintext development mode exists, at the API boundary. S1 later keeps the same version identifier while moving plaintext validation to the authorized client before encryption.

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

The date is manually supplied and validated with trusted PostgreSQL UTC calendar-date logic. A new or changed reunion target must be today or later. No location field exists.

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
- `voice_letter`

The table intentionally has no foreign key to M1 messages or M3 transport tables.

A reference type is accepted only when a runtime resolver for that external resource type is registered. Before verified M1 integration, Remember This may be created from an explicit client snapshot without a persisted message reference. Before M3, media and voice-letter references are contract/schema capability only and are rejected by runtime rather than accepting an unverifiable UUID.

When a resolver is available, authorization requires the referenced resource to belong to the same partnership at create/update time. A loose reference is provenance or attachment metadata, never an authorization grant.

If a previously valid source later disappears, the R1 item remains. The source is rendered unavailable rather than causing the R1 item to disappear.

### Voice Letter rule

Voice Letter is not a standalone `relationship_items.kind`.

It is a media reference with:

```text
reference_type = media
role = voice_letter
```

attached to an intentional relationship item such as For You, Future Us, Surprise, Proposal, Love, or another supported container.

This keeps binary ownership and transport in M3, keeps release visibility owned by the containing relationship item, and prevents a voice recording attached to an unreleased letter from becoming visible through an independent top-level R1 item.

R1 may close its Voice Letter data-model contract before M3, but end-to-end recording, upload, retrieval, and deletion evidence belongs to M3.

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

Purpose: explicit links from a curation or reunion container to existing same-partnership R1 items.

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
- `prepared_content`

Uses:

- Our Year and Anniversary ordered selections use `curation`
- reunion may link already-existing eligible shared content with `prepared_content`

Surprise and Proposal do not use generic relationship-item links for private sequence steps. Their multi-step sequence is part of the container's protected main payload, with external media references optionally carrying step positions. This prevents an unreleased private step from becoming reachable as an ordinary top-level item.

Database rules:

- owner and target are bound to the same partnership through composite foreign keys
- owner deletion may cascade its outgoing links
- target deletion is restrictive, not a silent cascade that mutates a surviving curation behind its version token
- deleting a target with incoming links first locks surviving owner items in immutable ID order, removes those incoming links, increments each surviving owner version once, appends minimal relationship event metadata, and then deletes the target
- a link never grants visibility to the target

At selection time, a curation target must already be independently visible to both current partners. A later link never bypasses the target's own visibility rule.

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

During development only, private feature payloads are stored in the explicit development columns:

- `relationship_items.development_preview_payload`
- `relationship_items.development_plaintext_payload`

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
3. encrypt preview and main content separately where a release-gated item has both roles
4. write preview ciphertext only to `encrypted_preview_payload` and main ciphertext only to the existing `encrypted_payload`
5. write the reviewed protocol identifier to `ciphertext_version`
6. stop all new development-preview and development-main plaintext writes
7. migrate development data only through a reviewed client-side re-encryption flow or wipe it
8. bind at least partnership ID, item ID, item kind, content schema version, and payload role (preview or main) into the reviewed authenticated-encryption context
9. prove that stable-release data inspection finds no protected R1 plaintext in PostgreSQL, logs, queues, providers, or object storage

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

Creation, creator/content edits, permitted shared-state edits, delete, story curation, schedule changes, recipient-open, creator-reveal, and feature-specific actions are allowed only where the feature policy matrix permits them.

### breakup_pending

All user-driven R1 mutation capability is view-only:

- no new R1 object
- no edit
- no user delete
- no story curation changes
- no Someday state change
- no recipient-open or creator-reveal
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

Unlike `breakup_pending`, account deletion has no product rule that explicitly authorizes scheduled relationship-content delivery while one partner is locked out. R1 therefore takes the privacy-conservative rule:

- unreleased scheduled relationship content is paused during the account-deletion overlay
- recipient-open and creator-reveal are denied
- schedule creation/reschedule, edit, delete, curation, shared-state changes, and signals are denied
- the original `unlock_at`, `execute_at`, and release generation are preserved; pausing does not rewrite product time
- when account deletion starts, a narrow R1 integration hook moves due/future pending relationship-release work to an availability time no earlier than `recover_until`
- if recovery happens earlier, the recovery path wakes any release whose original `unlock_at` is already due
- after recovery, a due release may proceed only if the partnership still exists and no controlling breakup/final-dissolution deadline has arrived
- if permanent account deletion or an earlier breakup dissolves the partnership, the pending release is cancelled and deleted with the relationship space

If the account is recovered before final dissolution, the same namespace, item versions, original schedule time, and release generation remain.

When breakup and account deletion overlap, the account-deletion pause wins while the deletion overlay exists. Recovery returns control to the normal active or breakup rule without manufacturing a new schedule.

### Destructive deadline precedence

A scheduled relationship release is never allowed merely because the lifecycle worker that performs destruction is late.

The release predicate must inspect the authoritative P3 deadlines.

At trusted execution time:

- if a controlling breakup final deadline has arrived, release is denied even if the persisted partnership row has not yet been transitioned to `terminated`
- if a controlling permanent account-deletion deadline has arrived, release is denied
- if both destructive paths exist, P3's existing earlier-deadline precedence determines the effective destructive boundary
- at exact equality with the effective destructive deadline, destruction wins and release does not occur

Therefore a release due before a breakup deadline may occur while the partnership is still valid, but a delayed worker may not reveal it after that destructive deadline.

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

R1 separates creator-owned authored content from pair-mutable shared state.

| Feature | Read while normally shared | Protected content edit | Shared state edit | Delete | Release behavior |
| --- | --- | --- | --- | --- | --- |
| Memory | both | creator | none | creator | none |
| Remember This | both | creator | none | creator | none |
| First | both | creator | none | creator | none |
| Place | both | creator | none | creator | none |
| Love | both | creator | none | creator | none |
| Someday | both | creator | either partner may change Someday/Soon/Completed | creator | none |
| Our Year curation | both | either partner | either partner may replace curation order | either partner | none |
| Anniversary curation | both | either partner | either partner may replace curation order | either partner | none |
| Reunion | both | either partner | either partner may change target date/prepared-content links | either partner | none |
| For You | creator until release, then both; recipient may see preview | creator before release | schedule owned by creator | creator | immediate, scheduled, recipient_open |
| Future Us | creator until release, then both; recipient may see preview | creator before release | schedule owned by creator | creator | immediate, scheduled, recipient_open |
| Surprise | creator until reveal, then both; recipient may see preview | creator before reveal | reveal owned by creator | creator | immediate or creator_reveal |
| Proposal | creator until reveal, then both; recipient may see preview | creator before reveal | reveal owned by creator | creator | immediate or creator_reveal |
| Relationship signal | both after creation | immutable | none | creator | immediate on explicit creation |

Every state-changing operation still uses optimistic versioning even when only the creator is permitted to author the content. Versioning protects multi-device retries, curation races, shared Someday/reunion state, and future client concurrency.

### Released delivery items

Release is monotonic.

Once For You, Future Us, Surprise, or Proposal is released:

- both authorized partners may read the main protected content
- protected preview, main content, and external references are immutable in R1
- active-state deletion remains available only to the actor allowed by the matrix
- repeated exact release requests replay through idempotency rather than applying release twice

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
2. loads the current release generation; a missing item returns generation sentinel `0`, which makes the generic generation guard mark the action stale rather than permanently fail it
3. loads immutable partnership ID for the still-existing item
4. locks authoritative partnership lifecycle before locking the item row
5. re-reads the item under lock
6. re-checks item lifecycle, kind, release mode, release generation, `unlock_at`, and `released_at`
7. verifies trusted `now >= unlock_at`
8. evaluates the current P3 lifecycle, account-deletion overlay, and destructive deadlines
9. pauses rather than releases if account deletion currently blocks delivery
10. denies release at or after the controlling destructive deadline even if finalization work is late
11. releases only when the current state permits the preconfigured scheduled release
12. sets `released_at`, increments item `version`, and appends minimal relationship-event metadata
13. lets the existing durable consumer complete the claimed action

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

Breakup does not increment `release_generation`, so an already configured scheduled release keeps the same identity. Account deletion also preserves the generation and original schedule time, but pauses availability until recovery or destructive cancellation.

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
| Release vs account deletion | Account-deletion overlay pauses unreleased content. Recovery may wake the same generation if its original unlock time is due and no destructive deadline has arrived |
| Release vs restoration | Same namespace and release generation; released state is monotonic, so no duplicate release |
| Release vs final dissolution | Effective destructive deadline wins at equality and also when finalization is late. A release that committed strictly before the deadline may exist briefly and is then deleted; at/after the deadline the worker must not release |
| Create vs breakup | Breakup first causes create denial; create first commits a valid object that becomes view-only |
| Update/delete vs breakup | Breakup first denies mutation; mutation first may commit and the resulting object then becomes view-only |
| Mutation vs final dissolution | Termination first denies access. Mutation first commits only before authorization is revoked, after which cleanup deletes it |
| Duplicate scheduled claims | Existing `SKIP LOCKED`, lease, and claim-version fencing allow only the current claim owner to acknowledge |
| Deletion target crash/reclaim | Existing F2 deletion lease and claim-version fencing retries idempotently |
| Account recovery | Same non-terminated partnership namespace and item versions remain; no item recreation occurs |
| Guessed foreign item ID | Same `RELATIONSHIP_ITEM_NOT_FOUND` response as an unknown ID |

Persisted committed state, not request arrival time, determines the result.

## Idempotency and lost-response safety

Every R1 mutation requires `Idempotency-Key`:

- create
- update
- delete
- recipient-open
- creator-reveal
- story membership changes when exposed separately
- curation/shared-state mutations

R1 reuses the existing `idempotency_records` table without changing its schema.

R1 scopes each record as:

`r1:<partnershipId>:<operation>`

and includes the same partnership ID inside the keyed fingerprint input.

R1 stores:

- account ID
- partnership-bound operation scope
- opaque idempotency key
- a server-keyed request fingerprint
- response status
- response metadata containing only opaque IDs, versions, and release timestamps when applicable
- timestamps and bounded expiry

The protected request body is never copied into `response_body`.

### Private request fingerprint

R1 must not store a raw unkeyed SHA-256 hash of a private relationship-content request because low-entropy content could be dictionary-tested from a database leak.

Instead the API computes a domain-separated HMAC over a canonical representation containing:

- authenticated account ID
- partnership ID
- operation type
- target item ID when present
- expected version when present
- normalized request body

The fingerprint byte string encodes the server-key version followed by the HMAC output. The key version must remain available for at least the idempotency retention period.

The runtime may extend the existing domain-separated server keyring with an R1 idempotency-fingerprint label. It must not introduce a new plaintext secret in source control.

### Replay order

An exact completed replay:

- authenticates the account
- validates that the receipt belongs to that account and partnership
- verifies the keyed fingerprint
- returns the stored metadata result without reapplying the mutation
- may replay across a later non-terminated view-only transition because replay is not a new relationship mutation
- never returns a partnership-scoped receipt after final dissolution

The same key with a different fingerprint returns:

`409 IDEMPOTENCY_KEY_REUSED`

Default R1 receipt retention is 24 hours. After expiry, clients refetch canonical state rather than expecting an old mutation receipt to exist forever.

This closes lost-response ambiguity for PATCH, DELETE, and manual release instead of relying on version conflict behavior to guess whether the caller's previous attempt committed.

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

## Cursor integrity

R1 list cursors are versioned base64url-encoded structured cursors validated at the API boundary.

They are pagination state, not authorization tokens, and now carry a server-keyed `r1-cursor-binding` value. The binding covers authenticated account ID, authoritative partnership ID, and normalized query shape.

Every cursor decoder validates:

- supported cursor version
- `snapshotAt` is valid and not in the future
- query-shape discriminator matches the current filters and sort mode
- keyed binding matches the current account, partnership, and query shape
- occurrence sort components satisfy the documented precision/null ordering
- item ID is a UUID
- cursor length is bounded

Tampered cursors and cursors copied into a future partnership fail with `INVALID_CURSOR`. Authorization is still independently re-applied to every database query.

## Cross-partnership authorization

Every item query is constrained by both:

- item ID
- authoritative current partnership ID

The repository does not:

1. load an item globally by ID
2. return a different error for foreign partnership
3. authorize from creator username or other mutable identity

Internal item links use same-partnership composite foreign keys, and link visibility never overrides target visibility.

Loose message/media references are never authorization grants. Resolution independently verifies the referenced resource's partnership.

## Relationship Home

Relationship Home is a bounded aggregate query, not a stored document.

It may return:

- current relationship-space lifecycle mode
- relationship duration derived from P3 `relationship_start_date` against trusted PostgreSQL UTC calendar date
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

Sort rules use one precision-aware total order without fabricating dates:

1. all dated items sort by `occurred_year`
2. within a year, year-only items sort before known months
3. within a known month, month-only items sort before exact days
4. exact days then sort by day
5. item ID is the deterministic final tie-breaker
6. unknown/undated items appear in a separate Undated group after the dated timeline

Null month/day components are ordering sentinels only. The UI never displays an invented day or month.

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

For a February 29 relationship start date, a non-leap-year anniversary uses February 28, following a last-valid-day-of-month rule. This rule is deterministic domain logic and must have boundary tests.

The experience can combine explicitly eligible or saved R1 items.

A saved anniversary curation is optional and versioned.

### Surprise Mode

Surprise is a private creator-owned container before reveal.

Its ordered text/structure sequence lives inside the protected main payload. Optional external media/voice references may include a step position. Generic links to independently visible R1 items are not used as private sequence steps.

The creator may reveal it only while active. After reveal, the sequence is immutable. R1 does not persist a behavioral completion score. Client progress through a reveal is presentation state unless a later requirement explicitly needs durable progress.

### Until We're Together Again

The target date is user-entered.

The countdown is deterministic calendar arithmetic.

No device location, distance, travel inference, or geofence is consulted.

### Proposal Mode

Proposal Mode is an intentional private creator-owned sequence leading to an in-person proposal.

Its sequence uses the same protected-payload model as Surprise and becomes shared only through creator reveal while active.

It has no persisted yes/no decision mechanic and no engagement score.

## Defensive bounds

R1 contracts use explicit safety ceilings so one private object cannot become an unbounded request, database row, cursor, or response.

Initial design ceilings:

- combined development preview plus main JSON payload: 64 KiB before transport encoding
- external references per item: 32
- saved curation links per curation item: 100
- Surprise or Proposal logical steps inside the protected payload: 50
- relationship-space page size: default 30, maximum 100
- latitude: -90 through 90
- longitude: -180 through 180

Exact string-field limits belong in the kind-specific contracts. Binary media never counts against the JSON payload ceiling because M3 owns binary transport.

S1 may define a slightly larger ciphertext ceiling to account for authenticated-encryption overhead, but it must preserve a bounded plaintext-equivalent product limit.

## Browser architecture

R1 adds a dedicated feature root:

`apps/web/src/features/relationship-space/`

Implemented structure:

```text
relationship-space/
  api.ts
  model.ts
  RelationshipSpacePanel.tsx
```

The current R1 browser intentionally keeps feature composition in one mobile-first `RelationshipSpacePanel.tsx` rather than creating speculative subdirectories. It already contains the implemented home aggregate, item cards/editing, release controls, Our Story filtering, derived experiences, saved curations, reunion planning, signals, occurrence-precision entry, and schedule rescheduling. A later UI-only refactor may split these components without changing the R1 API or authority model.

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

R1 owns only media/reference association semantics. Runtime acceptance of a media or voice-letter reference requires an M3 resolver; R1 does not accept unverifiable external IDs before that integration exists.

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
- references, same-partnership curation links, and reference-resolver availability gates
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
- immediate, scheduled, recipient-open, and creator-reveal release modes
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

Implemented closure commands:

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
2. database invariants pass, including composite same-partnership foreign keys and immutable root identity
3. P1, P2, and P3 regression surfaces remain green
4. R1 domain and contract tests pass
5. CRUD and derived API integration tests pass
6. private responses use no-store
7. all state-changing R1 endpoints have exact lost-response idempotency
8. private request fingerprints are server-keyed and raw relationship-content hashes are not persisted
9. optimistic conflicts return stable `VERSION_CONFLICT`
10. foreign, deleted, unreleased-to-caller, and unknown item IDs are indistinguishable where required
11. creator-owned authored content and pair-mutable shared state follow the feature policy matrix
12. breakup rejects user mutations while allowing only the explicit preconfigured scheduled-release exception
13. account-deletion overlay pauses all unreleased delivery transitions
14. recovery wakes due paused releases without changing original unlock time or release generation
15. destructive lifecycle deadline wins over release at exact equality and when finalization is late
16. stale release generations cannot unlock content
17. missing-item generation lookup makes durable release work stale rather than permanently failed
18. duplicate claims cannot release twice
19. recipient-open exposes preview but not sealed main content before explicit open
20. creator-reveal keeps Surprise and Proposal main content unavailable before reveal
21. restoration preserves schedule, item identity, versions, and original release generation
22. final dissolution synchronously ends authorization and prevents idempotency receipt replay
23. final dissolution makes old R1 idempotency receipts unreplayable; bounded receipts expire without exposing protected content
24. scheduled rows retained for operations contain no private content
25. user item deletion leaves no protected content in an alternate R1 table
26. deletion of a linked target explicitly updates surviving curation owners and versions rather than silently cascading
27. deletion crash/reclaim is retry-safe
28. future partnership namespaces cannot read old R1 data
29. occurrence precision never fabricates missing dates and future historical occurrences are rejected
30. February 29 anniversary behavior follows the documented last-valid-day rule
31. coordinates never enter logs, analytics, events, queue payloads, or unreviewed providers
32. Remember This does not depend on original message existence and does not server-copy M1 content
33. message references are rejected until a verified M1 resolver exists
34. media and voice-letter references are rejected until a verified M3 resolver exists
35. Voice Letters inherit the containing item's visibility and cannot surface as standalone R1 content
36. explicit signals remain user-triggered and no emotion inference exists
37. This Day in Us, Our Story, Our Year, and Anniversary use deterministic precision-aware ordering without engagement scoring
38. Surprise and Proposal sequence content cannot become visible through generic item-link traversal
39. reunion target date uses trusted UTC date, remains manual, and has no location surveillance
40. unknown content schema versions and durable payload versions fail closed
41. browser lifecycle modes match server authority
42. browser production build passes
43. full repository health passes
44. high-severity dependency audit passes

## Design risks intentionally bounded

### Pre-S1 plaintext

R1 runtime can be developed before S1 only with explicit development plaintext storage. This is not stable-release security. Stable release remains blocked until S1 migration and inspection evidence close the boundary.

### Parallel M1 migration availability

R1 owns 0013 and 0014 but does not fabricate 0011 or 0012. The final clean 0001 through 0014 closure run can occur only after verified M1 migrations are available through the integration baseline.

### Media and voice transport

Voice Letters and photo/media associations can be modeled in R1 before M3, but real binary transport and object-storage proof are not R1 completion evidence.

### Account-deletion scheduled release interpretation

R1 now resolves this boundary conservatively: account-deletion view-only pauses unreleased relationship-content delivery. This differs from breakup, where the PRD explicitly keeps scheduled For You and Future Us releases moving.

Recovery preserves original product time and release generation and wakes work that became due while paused. Permanent deletion or an earlier breakup cancels it.

This rule must stay synchronized across the PRD, worker design, API contract, tests, and P3 integration hook.

## Completion statement

R1 architecture, implementation design, and runtime source surfaces are implemented and isolated-green on `feat/r1-relationship-space`.

Current source checkpoint:

`0b863c5`

Implemented source includes:

- migrations 0013 and 0014
- relationship-space domain policy and contracts
- database repositories and invariants
- private Relationship Space API routes and service
- keyed mutation receipts and keyed partnership-bound cursors
- durable scheduled release handling and release-generation fencing
- account-deletion pause and recovery wake integration
- P3 dissolution cancellation integration
- responsive Relationship Space browser flows including curations, reunion planning, partial occurrence precision, and rescheduling
- R1 security, API integration, worker integration, and local PostgreSQL harnesses

R1 remains `IN_PROGRESS`. Isolated executable evidence is green, but final closure requires the real M1 migrations 0011/0012, the strict canonical 0001 through 0014 run, a green full repository-health gate, and resolution of the recorded formatting drift.
