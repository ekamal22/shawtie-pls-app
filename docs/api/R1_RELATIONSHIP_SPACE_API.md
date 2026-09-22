# R1 Relationship Space API

## Status

This is the canonical R1 HTTP API design.

R1 architecture and runtime API implementation are present on `feat/r1-relationship-space`. Executed closure evidence remains pending, so this document does not claim the API is verified until the R1 test gates run successfully.

Base path:

`/api/v1/relationship-space`

Every successful or error response that can reveal private relationship-space state must include:

`Cache-Control: private, no-store`

All endpoints require authenticated account access unless explicitly stated otherwise. There are no public relationship-space endpoints.

## Authority and privacy rules

1. The authenticated account never supplies an authoritative partnership ID for normal current-space operations.
2. The server derives the current immutable partnership namespace from authoritative membership.
3. Resource lookup is constrained by both item ID and current partnership ID.
4. Unknown, deleted, unreleased-to-caller, and foreign-partnership item IDs use the same not-found shape where exposing the distinction would leak existence.
5. Client capability state is advisory only.
6. Mutation bodies are schema-validated and excluded from request logging.
7. Protected content is never copied into errors, events, queue payloads, notifications, analytics, traces, or idempotency response metadata.
8. Coordinates are protected content and receive no special logging exception.
9. Server time controls release deadlines and lifecycle boundaries.
10. All shared mutable objects use optimistic versions.

## Common types

### RelationshipSpaceMode

```text
active
breakup_pending_view_only
account_deletion_view_only
terminated_or_unavailable
```

### RelationshipItemKind

```text
memory
remember_this
first
place
for_you
future_us
love
someday
our_year
anniversary
surprise
reunion
proposal
relationship_signal
```

### Occurrence

No date component is fabricated.

```json
{
  "precision": "day",
  "year": 2026,
  "month": 9,
  "day": 22
}
```

Allowed shapes:

- day: year, month, day
- month: year, month, day null
- year: year, month null, day null
- unknown: year null, month null, day null
- null: no occurrence supplied

### ReleaseProjection

```json
{
  "mode": "scheduled",
  "generation": 3,
  "unlockAt": "2026-12-31T21:00:00.000Z",
  "releasedAt": null,
  "state": "locked"
}
```

Modes:

- `immediate`
- `scheduled`
- `recipient_open`
- `creator_reveal`

States:

- `locked`
- `released`

Only For You and Future Us own R1 release schedules.

### RelationshipItem

Representative projection:

```json
{
  "itemId": "uuid",
  "kind": "memory",
  "creatorAccountId": "uuid",
  "version": 4,
  "createdAt": "2026-09-22T12:00:00.000Z",
  "updatedAt": "2026-09-22T12:10:00.000Z",
  "occurrence": {
    "precision": "month",
    "year": 2025,
    "month": 11,
    "day": null
  },
  "storyIncluded": true,
  "release": null,
  "featureState": null,
  "contentSchemaVersion": 1,
  "preview": null,
  "content": {
    "title": "The month we met",
    "note": "..."
  },
  "references": [],
  "links": []
}
```

`partnershipId` is not required in normal client item projections because current-space authority is already derived by the server.

The server may include it in internal repository types, but it is not a client authorization input.

### Private unreleased projection

Release-gated items separate preview from sealed main content.

Before release:

- the creator may read preview and main content while authorized
- the intended partner may receive only the preview fields allowed for that kind
- main `content` is returned as null to the intended partner
- the API never returns the sealed development payload or sealed ciphertext to the intended partner before release
- a guessed unreleased item ID that has no partner-visible preview uses the normal not-found response

After release, both currently authorized partners may read preview and main content.

For `recipient_open`, the preview is the user-facing reason to open, such as "Open when you need reassurance." The server never evaluates whether that condition is true.

For `creator_reveal`, Surprise and Proposal may expose an optional teaser preview while keeping the sequence content sealed until the creator reveals it.

This split is preserved by S1: encrypted preview may be returned before release, but encrypted main content is withheld until release.

### Feature state

Feature-specific server-readable state is projected explicitly rather than hidden in arbitrary strings.

Someday:

```json
{
  "type": "someday",
  "state": "soon",
  "completedAt": null
}
```

Relationship signal:

```json
{
  "type": "relationship_signal",
  "signalKind": "thinking_of_you"
}
```

Reunion:

```json
{
  "type": "reunion",
  "targetDate": "2026-12-20"
}
```

Our Year or Anniversary curation:

```json
{
  "type": "curation",
  "curationType": "our_year",
  "anchorYear": 2026
}
```

## Protected content payloads

R1 contracts are typed by item kind.

The examples below describe logical API fields. Before S1 they are development plaintext submitted to the server. After S1 the transport contract changes to the reviewed encrypted envelope while preserving the surrounding item metadata semantics.

### memory

```json
{
  "title": "string",
  "note": "optional string"
}
```

### remember_this

```json
{
  "title": "optional string",
  "snapshotText": "optional string",
  "note": "optional string"
}
```

A remembered message snapshot is submitted explicitly by the authorized client. The R1 server does not fetch and copy the M1 message body.

### first

```json
{
  "title": "string",
  "note": "optional string"
}
```

### place

```json
{
  "title": "string",
  "note": "optional string",
  "latitude": 41.0082,
  "longitude": 28.9784
}
```

Coordinates are optional. If supplied they remain protected content.

### for_you

Preview:

```json
{
  "title": "optional string",
  "conditionLabel": "optional string"
}
```

Main content:

```json
{
  "body": "string"
}
```

A condition label is display text only. It does not create an autonomous condition evaluator.

`conditionLabel` is presentation text for `recipient_open`. The intended partner decides when to open it; the server never interprets the condition.

### Voice Letter attachment

Voice Letter is not a standalone relationship-item kind.

A voice recording is represented as an external reference:

```json
{
  "referenceType": "media",
  "referenceId": "uuid",
  "role": "voice_letter",
  "position": 0
}
```

The containing relationship item owns visibility and release semantics. M3 owns recording, upload, object access, and deletion of the binary media.

Until an M3 media resolver is registered, runtime requests containing media or voice-letter references are rejected rather than storing unverifiable IDs.

### future_us

Preview:

```json
{
  "title": "optional string",
  "conditionLabel": "optional string"
}
```

Main content:

```json
{
  "body": "optional string"
}
```

### love

```json
{
  "category": "reason",
  "text": "string"
}
```

Category values are presentation semantics such as `reason`, `noticed`, and `remembered`. They are not scores.

### someday

```json
{
  "title": "string",
  "note": "optional string"
}
```

Its lifecycle state is supplied separately in typed feature state.

### our_year

```json
{
  "title": "optional string",
  "note": "optional string"
}
```

Selection and order use same-partnership curation links.

### anniversary

```json
{
  "title": "optional string",
  "note": "optional string"
}
```

### surprise

Preview:

```json
{
  "title": "optional string"
}
```

Main content:

```json
{
  "intro": "optional string",
  "steps": [
    {
      "type": "text",
      "text": "..."
    }
  ]
}
```

The protected main payload owns the logical sequence. External media references may carry a matching step position. Generic relationship-item links are not private sequence steps.

### reunion

```json
{
  "title": "optional string",
  "note": "optional string"
}
```

The manual target date is typed feature state. Prepared items use `prepared_content` links.

### proposal

Preview:

```json
{
  "title": "optional string"
}
```

Main content:

```json
{
  "intro": "optional string",
  "steps": [
    {
      "type": "text",
      "text": "..."
    }
  ]
}
```

The protected main payload owns the logical sequence. External media references may carry a matching step position. There is no yes/no response field.

### relationship_signal

```json
{
  "sharedFeelingText": "optional string"
}
```

The explicit signal code is typed feature state.

## Common mutation rules

### expectedVersion

Every mutation of an existing relationship item carries:

```json
{
  "expectedVersion": 4
}
```

If the current version differs and the request is not an exact completed idempotency replay:

`409 VERSION_CONFLICT`

A successful semantic mutation increments the item version exactly once.

### Idempotency-Key

Every state-changing R1 endpoint requires:

`Idempotency-Key: <opaque-client-key>`

This includes create, update, delete, recipient-open, creator-reveal, curation changes, story changes, and shared-state changes.

The API stores only operation metadata. It never stores the protected request body in the idempotency response.

To detect accidental key reuse safely, the request fingerprint is a domain-separated server-keyed HMAC over the canonical request, account ID, partnership ID, operation type, target item ID where present, and expected version where present.

A raw unkeyed hash of private R1 content must not be persisted.

Exact completed replay returns the original status and metadata result without reapplying the mutation. Replay is bounded to 24 hours by default and is not available after final partnership dissolution.

Same key plus different keyed fingerprint:

`409 IDEMPOTENCY_KEY_REUSED`

### Lifecycle authorization

Normal user-driven mutation is permitted only in `active`.

During `breakup_pending_view_only`:

- reads continue
- a scheduled For You/Future Us release configured before breakup may continue only while trusted time is strictly before the effective destructive deadline
- create, update, delete, recipient-open, creator-reveal, reschedule, signal creation, curation edits, and Someday/reunion state changes are denied

During `account_deletion_view_only`:

- authorized view-only access continues for the remaining partner according to P3
- all unreleased delivery transitions are paused, including scheduled release
- create, update, delete, recipient-open, creator-reveal, reschedule, signal creation, curation edits, and shared-state changes are denied
- original `unlockAt` and release generation are preserved
- recovery wakes due paused scheduled work only if no destructive deadline has arrived

At or after a controlling breakup or permanent account-deletion deadline, release is denied even if lifecycle-finalizer execution is late.

After termination:

- no relationship-space read, mutation, or idempotency receipt replay is authorized

### Date and time authority

R1 uses the same trusted PostgreSQL UTC business-date convention as P2.

- historical occurrence dates may not be in the future
- a new or changed reunion target date must be today or later
- `scheduled.unlockAt` must be strictly later than trusted transaction time
- exact equality with a destructive partnership deadline belongs to destruction, not content release

### Content schema version

Each item kind has an explicit supported `contentSchemaVersion`.

Unknown versions fail closed.

During pre-S1 development, server contracts validate plaintext preview/main shapes. After S1, the authorized client validates plaintext before encryption while the server validates the outer kind/version/envelope metadata without requiring plaintext access.

### Defensive request bounds

Initial R1 ceilings:

- combined preview plus main development JSON: 64 KiB
- references per item: 32
- saved curation links per item: 100
- Surprise/Proposal logical steps: 50
- list page size: default 30, maximum 100
- latitude range: -90 through 90
- longitude range: -180 through 180

Exact string caps are kind-specific contract constants.

## GET /relationship-space

Returns the private Relationship Home read model.

### Success

`200`

```json
{
  "space": {
    "mode": "active",
    "relationshipStartDate": "2025-11-15",
    "serverDate": "2026-09-22",
    "relationshipDuration": {
      "years": 0,
      "months": 10,
      "days": 7
    },
    "capabilities": {
      "view": true,
      "create": true,
      "edit": true,
      "delete": true,
      "manualRelease": true,
      "curate": true,
      "sendSignal": true
    },
    "recentItems": [],
    "upcomingReleases": [],
    "reunion": null,
    "anniversary": {
      "date": "2026-11-15",
      "savedCurationItemId": null
    },
    "recentSignals": []
  }
}
```

Relationship duration derives from the P3 manually entered relationship start date. It does not use partnership activation time.

The home response is bounded. Full collections use list endpoints.

If there is no current authorized partnership:

```json
{
  "space": null
}
```

This is `200`, matching the current-partnership read-model style.

## GET /relationship-space/items

Lists items visible to the caller.

### Query

```text
limit
cursor
kind
sort
storyOnly
year
```

Rules:

- `limit`: default 30, maximum 100
- `kind`: optional stable item kind
- `sort`: `created_desc` or `occurred_asc`
- `storyOnly=true`: only explicit Our Story members
- `year`: optional four-digit occurrence-year filter
- combinations not supported by the contract are rejected rather than silently ignored

### Success

`200`

```json
{
  "items": [],
  "nextCursor": null
}
```

### Snapshot-bound cursor

The cursor is opaque to the client and versioned internally.

For created-order pagination it carries only operational metadata comparable to:

```json
{
  "v": 1,
  "snapshotAt": "2026-09-22T12:00:00.000Z",
  "createdAt": "2026-09-20T10:00:00.000Z",
  "itemId": "uuid",
  "queryShape": "opaque-non-content-filter-key"
}
```

Occurrence-order cursors additionally carry normalized date sort components and the final item ID tie-breaker.

A cursor never contains item content, coordinates, titles, notes, relationship signals, or message snapshots.

A cursor created for a different query shape is rejected.

The cursor also carries a server-keyed integrity binding over the authenticated account, authoritative partnership, and query shape. Tampering or reusing a cursor after moving into a different partnership returns `400 INVALID_CURSOR`.

New items created after `snapshotAt` do not appear in an already-started snapshot traversal.

## POST /relationship-space/items

Creates one relationship item.

Requires `Idempotency-Key`.

### Request

Representative:

```json
{
  "kind": "place",
  "contentSchemaVersion": 1,
  "preview": null,
  "content": {
    "title": "Where we first talked",
    "note": "..."
  },
  "occurrence": {
    "precision": "day",
    "year": 2025,
    "month": 11,
    "day": 18
  },
  "storyIncluded": true,
  "release": null,
  "featureState": null,
  "references": [],
  "links": []
}
```

Fields not applicable to the selected kind are rejected.

### Release create shape

Scheduled For You example:

```json
{
  "kind": "for_you",
  "contentSchemaVersion": 1,
  "preview": {
    "title": "Open this on New Year's Eve",
    "conditionLabel": null
  },
  "content": {
    "body": "..."
  },
  "occurrence": null,
  "storyIncluded": false,
  "release": {
    "mode": "scheduled",
    "unlockAt": "2026-12-31T21:00:00.000Z"
  },
  "featureState": null,
  "references": [],
  "links": []
}
```

Scheduled release time is interpreted and persisted using trusted server semantics. A client clock never causes early release.

### Recipient-open For You shape

```json
{
  "kind": "for_you",
  "contentSchemaVersion": 1,
  "preview": {
    "title": "For a hard day",
    "conditionLabel": "Open when you need reassurance"
  },
  "content": {
    "body": "..."
  },
  "occurrence": null,
  "storyIncluded": false,
  "release": {
    "mode": "recipient_open",
    "unlockAt": null
  },
  "featureState": null,
  "references": [],
  "links": []
}
```

The intended partner may see the preview but not `content` until they explicitly open it while the partnership is active.

### Creator-reveal Surprise shape

```json
{
  "kind": "surprise",
  "contentSchemaVersion": 1,
  "preview": {
    "title": "I made something for you"
  },
  "content": {
    "intro": "...",
    "steps": [
      {
        "type": "text",
        "text": "..."
      }
    ]
  },
  "occurrence": null,
  "storyIncluded": false,
  "release": {
    "mode": "creator_reveal",
    "unlockAt": null
  },
  "featureState": null,
  "references": [],
  "links": []
}
```

### Someday create shape

```json
{
  "kind": "someday",
  "contentSchemaVersion": 1,
  "content": {
    "title": "Watch the northern lights",
    "note": null
  },
  "occurrence": null,
  "storyIncluded": false,
  "release": null,
  "featureState": {
    "type": "someday",
    "state": "someday"
  },
  "references": [],
  "links": []
}
```

### Relationship signal create shape

```json
{
  "kind": "relationship_signal",
  "contentSchemaVersion": 1,
  "preview": null,
  "content": {
    "sharedFeelingText": null
  },
  "occurrence": null,
  "storyIncluded": false,
  "release": null,
  "featureState": {
    "type": "relationship_signal",
    "signalKind": "hug"
  },
  "references": [],
  "links": []
}
```

Signals are accepted only from an explicit request. No API creates them from activity analysis.

### Success

`201`

```json
{
  "itemId": "uuid",
  "version": 1,
  "createdAt": "2026-09-22T12:00:00.000Z"
}
```

The idempotency response record stores only this metadata, not the submitted content.

## GET /relationship-space/items/:itemId

Returns one visible item.

### Success

`200`

Returns the full caller-authorized `RelationshipItem` projection.

### Not found privacy

All of the following use the same response:

- random unknown UUID
- item owned by another partnership
- item deleted by the current partnership
- unreleased creator-private item guessed by the intended recipient

`404 RELATIONSHIP_ITEM_NOT_FOUND`

The response must not reveal which condition occurred.

## PATCH /relationship-space/items/:itemId

Requires `Idempotency-Key`.

Applies one version-checked item mutation.

### Request

The request is a typed patch, not arbitrary JSON merge.

Representative:

```json
{
  "expectedVersion": 4,
  "content": {
    "title": "Updated title",
    "note": "Updated note"
  },
  "occurrence": {
    "precision": "month",
    "year": 2025,
    "month": 11,
    "day": null
  },
  "storyIncluded": true
}
```

Only fields valid for the item's kind may appear.

### Schedule change

Before release, the creator may update a pending release while active:

```json
{
  "expectedVersion": 2,
  "release": {
    "mode": "scheduled",
    "unlockAt": "2027-01-01T09:00:00.000Z"
  }
}
```

The new `unlockAt` must be strictly later than trusted transaction time.

A schedule change:

- increments item version
- increments release generation
- cancels the old pending durable action
- creates the new generation's action in the same transaction

### Someday state change

```json
{
  "expectedVersion": 3,
  "featureState": {
    "type": "someday",
    "state": "completed"
  }
}
```

The server sets `completedAt` from trusted server time.

### Curation or sequence links

A container update may replace the complete ordered link set as one versioned mutation:

```json
{
  "expectedVersion": 5,
  "links": [
    {
      "linkType": "curation",
      "targetItemId": "uuid",
      "position": 0
    },
    {
      "linkType": "curation",
      "targetItemId": "uuid",
      "position": 1
    }
  ]
}
```

Every linked target is verified to belong to the same current partnership and to be independently visible to both current partners. A link never grants target visibility.

Replacing the ordered set atomically avoids partial curation reorder state. Surprise and Proposal sequence steps are not represented with generic item links.

### Success

`200`

Returns content-free mutation metadata containing the item ID, new version, and trusted update timestamp. The browser refetches the canonical authorized item projection after the mutation. This keeps idempotency response metadata free of protected relationship content.

### Conflict

`409 VERSION_CONFLICT`

The error may include the current version number, but never the current private content body.

## DELETE /relationship-space/items/:itemId

Requires `Idempotency-Key`.

Hard-deletes one item and all R1 child state.

### Request

```json
{
  "expectedVersion": 4
}
```

### Success

`204`

No body.

Deletion:

- cancels a pending release action
- deletes the root item
- cascades supporting R1 state
- cascades relationship events
- leaves no R1 content-bearing history
- causes later detail reads to return the normal not-found response

An exact retry within the retained idempotency window replays `204` even though the item row is already gone. After receipt expiry, canonical lookup returns the normal privacy-safe not-found behavior.

If the deleted item was a target of surviving curation links, the deletion transaction first removes those incoming links and increments each surviving curation owner version once. It does not silently rely on target-side cascading that would mutate a saved curation behind its optimistic version.

## POST /relationship-space/items/:itemId/release

Requires `Idempotency-Key`.

Performs an explicit manual release transition.

It is used for:

- `recipient_open` on For You or Future Us
- `creator_reveal` on Surprise or Proposal

It is never used for scheduled release. Scheduled release is worker-driven.

### Request

```json
{
  "expectedVersion": 2
}
```

### recipient_open rules

- caller must be the non-creator intended partner
- partnership must be active
- item kind must be For You or Future Us
- release mode must be `recipient_open`
- item must not already be released
- expected version must match unless this is an exact completed replay

### creator_reveal rules

- caller must be the creator
- partnership must be active
- item kind must be Surprise or Proposal
- release mode must be `creator_reveal`
- item must not already be released
- expected version must match unless this is an exact completed replay

### Success

`200`

Returns the released item projection with incremented version and trusted `releasedAt`.

Exact retry replays the original release metadata without applying release twice.

During breakup or account-deletion view-only state:

`409 RELATIONSHIP_SPACE_VIEW_ONLY`

## Reference contract

References are part of create/update payloads.

Representative message provenance reference:

```json
{
  "referenceType": "message",
  "referenceId": "uuid",
  "role": "source",
  "position": 0
}
```

Representative media attachment reference:

```json
{
  "referenceType": "media",
  "referenceId": "uuid",
  "role": "attachment",
  "position": 0
}
```

Representative Voice Letter reference:

```json
{
  "referenceType": "media",
  "referenceId": "uuid",
  "role": "voice_letter",
  "position": 0
}
```

Rules:

- references never grant access
- a reference type is accepted only when its runtime resolver is registered
- before verified M1 integration, Remember This may omit the message reference and preserve only the explicit R1 snapshot
- before M3 integration, media and voice-letter references are rejected
- when a resolver exists, the resource must independently authorize to the same partnership
- disappearance of a previously valid loose source reference does not delete the R1 item
- R1 does not require M1 schema changes
- M3 owns actual media transport and object access
- reference IDs, roles, and positions are operational metadata and must not be combined with protected content in logs

## Story curation through item mutation

`storyIncluded` is exposed as an item-level contract field for convenience.

Implementation maps it to `relationship_story_members`.

Changing it:

- requires `expectedVersion`
- modifies story membership and increments item version atomically
- is available only during active lifecycle
- does not change the item's occurrence date
- never assigns a date to an undated item

## Precision-aware chronological ordering

Any R1 endpoint that promises chronological occurrence order uses one total ordering rule:

1. `occurredYear`
2. year-only entries before known months in that year
3. `occurredMonth`
4. month-only entries before exact days in that month
5. `occurredDay`
6. item ID as final tie-breaker
7. unknown/undated entries in a separate trailing group

Null components are ordering sentinels only and are never rendered as fabricated dates.

Occurrence-order cursors carry explicit null/precision information so pagination uses the same order as the first page.

## GET /relationship-space/experiences/this-day

Returns the deterministic This Day in Us view.

### Query

`on=YYYY-MM-DD`

The supplied calendar date selects the month/day being viewed. It is presentation input, not a security boundary.

### Eligibility

Only visible R1 items with `precision=day` and matching explicit month/day are eligible.

No month-only, year-only, or unknown item is assigned a day.

### Success

`200`

```json
{
  "on": "2026-09-22",
  "items": []
}
```

The result is bounded and chronological by year, then item ID tie-breaker.

## GET /relationship-space/experiences/our-year/:year

Returns the deterministic annual recap candidate set plus any saved curation.

### Params

`year`: validated four-digit year supported by the domain date bounds.

### Success

`200`

```json
{
  "year": 2026,
  "savedCuration": null,
  "candidates": []
}
```

If a saved `our_year` item exists, `savedCuration` contains its authorized item projection and ordered linked items.

Candidate rules use:

- explicit occurrence year
- feature eligibility
- release visibility
- chronological ordering

Candidate rules do not use:

- message frequency
- likes or reactions
- time spent
- response latency
- sentiment
- location frequency
- popularity
- engagement scoring

## GET /relationship-space/experiences/anniversary

Returns the anniversary experience for a requested calendar date context.

### Query

`on=YYYY-MM-DD`

If omitted, server current date may be used only for deciding whether an anniversary card is currently relevant. Relationship anniversary itself always derives from P3 `relationshipStartDate`.

### Success

`200`

```json
{
  "relationshipStartDate": "2025-11-15",
  "anniversaryDate": "2026-11-15",
  "savedCuration": null,
  "eligibleItems": []
}
```

No activation timestamp is substituted for the relationship start date.

For a February 29 relationship start date, a non-leap-year anniversary is February 28 under the documented last-valid-day-of-month rule.

## Surprise, Proposal, and Reunion reads

These experiences use the ordinary item detail endpoint.

A `surprise` or `proposal` detail response returns its protected sequence from the container content only after release. Before release, the intended partner receives only any authorized preview and never the sealed sequence.

A `reunion` detail response returns:

- manual target date
- protected content
- `prepared_content` links

The API does not expose device distance or inferred travel state.

## Relationship signal semantics

Relationship signals are ordinary R1 items with explicit typed signal state.

They have no hidden creation API.

A signal:

- is created only by the authenticated caller
- records the caller as creator
- is immutable after creation
- may be deleted by its creator during active lifecycle
- may contain explicit user-supplied feeling text only when the user deliberately submits it

There is no API for:

- inferred mood
- sentiment score
- relationship score
- response score
- compatibility
- breakup risk
- streak state

## Stable error model

Representative R1 codes:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_RELATIONSHIP_ITEM` | Contract or feature-shape validation failed |
| 400 | `INVALID_OCCURRENCE` | Date precision/components are inconsistent |
| 400 | `INVALID_REFERENCE` | Reference type/role/shape is invalid |
| 400 | `INVALID_ITEM_LINK` | Link type/order/shape is invalid |
| 401 | `AUTH_REQUIRED` | Authentication missing or invalid |
| 404 | `RELATIONSHIP_ITEM_NOT_FOUND` | Item unknown, deleted, foreign, or not visible to caller |
| 409 | `NO_CURRENT_PARTNERSHIP` | Mutation requires a current partnership |
| 409 | `RELATIONSHIP_SPACE_VIEW_ONLY` | Breakup or account-deletion overlay blocks user mutation |
| 409 | `PARTNERSHIP_TERMINATED` | Authoritative partnership no longer permits access/mutation |
| 409 | `VERSION_CONFLICT` | expectedVersion is stale |
| 409 | `ITEM_ALREADY_RELEASED` | Mutation conflicts with monotonic release state |
| 409 | `RELEASE_NOT_ALLOWED` | Item kind/mode/caller does not support requested release |
| 409 | `REFERENCE_TYPE_UNAVAILABLE` | Message/media resolver required for this reference type is not registered |
| 409 | `ITEM_IMMUTABLE_AFTER_RELEASE` | Released delivery content cannot be edited |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Reserved for invalid reuse if runtime adopts structural fingerprint enforcement |
| 422 | `RELEASE_TIME_INVALID` | Schedule violates release contract |
| 422 | `REFERENCE_PARTNERSHIP_MISMATCH` | Authorized reference resolves outside current partnership |
| 422 | `LINK_PARTNERSHIP_MISMATCH` | Link target is not in current partnership |

Privacy rule: when a reference or link target identifier itself could reveal a foreign resource, the external response should prefer the same generic invalid/not-found shape rather than confirming the foreign partnership.

The API must not return private content in `details`, validation issue values, or exception messages.

## Cache and browser transport

Every R1 route sets:

`Cache-Control: private, no-store`

R1 core does not depend on service-worker caching for private API responses.

The browser may keep current-page data in memory.

M2 later defines IndexedDB and offline queue behavior under the partnership namespace. R1 APIs remain canonical after M2.

## Worker release is not an HTTP backdoor

The scheduled release worker calls repositories/domain logic directly inside the existing durable transaction model.

There is no unauthenticated worker HTTP endpoint.

Scheduled-action payload version 1 is intentionally content-free:

```json
{}
```

The action carries operational routing only in durable scheduled-action columns:

- action type
- aggregate type
- aggregate ID
- original execute time
- retry/availability time
- expected release generation
- deduplication key
- payload version

If account deletion starts, the original execute time remains unchanged while availability may be postponed until recovery. Recovery may wake an already-due action early. The worker still rejects release at or after any controlling destructive deadline.

## API test obligations

R1 API closure must execute tests proving:

- every private route emits `private, no-store`
- no current partnership returns the documented home shape
- active create/list/detail/update/delete succeed
- all state-changing endpoints require Idempotency-Key
- exact lost-response replay works for create, update, delete, recipient-open, creator-reveal, curation, and shared-state mutations
- same idempotency key plus different private request returns `IDEMPOTENCY_KEY_REUSED`
- private fingerprints are keyed and no raw request-content hash is persisted
- stale expectedVersion returns exactly `VERSION_CONFLICT`
- simultaneous permitted partner mutations cannot silently overwrite
- creator-owned content denies partner edits/deletes
- foreign, random, deleted, and unreleased hidden item IDs produce indistinguishable not-found responses where required
- intended recipient may receive preview but cannot retrieve sealed main content before release
- recipient-open succeeds only for intended partner while active
- creator-reveal succeeds only for creator while active
- release makes sealed content visible exactly once
- scheduled unlockAt equal to/past trusted transaction time is rejected at create/reschedule
- breakup rejects user mutations while a preconfigured scheduled release can continue strictly before destructive deadline
- account-deletion view-only rejects all user mutations and pauses scheduled release
- account recovery wakes due paused releases with original unlockAt and release generation intact
- release at exact destructive deadline is denied even if lifecycle finalization is late
- restoration preserves item IDs, versions, and pending schedule identity
- final dissolution denies reads and receipt replay before cleanup completion
- deleted items cannot be recovered through references, events, or curation tables
- deleting a curation target updates surviving owner versions explicitly
- Remember This survives original source disappearance
- Remember This does not cause the server to fetch/copy M1 plaintext
- message references are rejected before M1 resolver registration
- media and Voice Letter references are rejected before M3 resolver registration
- a Voice Letter cannot surface independently of its containing item's visibility
- cross-partnership links and references fail closed
- location coordinates never appear in structured logs or error output
- occurrence dates reject future historical dates
- reunion target date rejects dates before trusted UTC today
- February 29 anniversary uses February 28 in non-leap years
- chronological mixed-precision ordering is deterministic without fake dates
- unknown content schema versions fail closed
- Surprise/Proposal sealed sequences are not reachable through generic item links
- derived experience results are deterministic and do not use engagement or sentiment inputs
- relationship signals can be created only by explicit user requests

## Completion statement

This document defines the R1 API surface only.

No endpoint in this document is claimed implemented until the R1 runtime slices and executable acceptance evidence exist.
