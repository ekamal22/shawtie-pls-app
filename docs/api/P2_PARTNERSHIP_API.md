# P2 Partnership Formation API

## Status

IMPLEMENTED AND LOCALLY VERIFIED

This document describes the authenticated HTTP surface implemented by P2 Partnership Formation and Relationship Date.

Runtime source is locally closed on `feat/p2-partnership-formation` at commit `fa2301d0`. P2 is DONE at all 11 acceptance gates with domain/contracts 14/14, security 5/5, disposable PostgreSQL/API/worker integration 27/27 with `P2_LOCAL_POSTGRES_PASS`, nine migrations from zero, passing database invariants, full repository health, and 0 high-severity dependency-audit vulnerabilities.

All P2 responses that expose partnership, request, or notification state use:

~~~text
Cache-Control: private, no-store
~~~

Authentication, session cookies, origin/CSRF enforcement, and browser-security policy reuse the A1 security boundary.

## Public denial codes

P2 exposes the hardened stable denial vocabulary:

~~~text
REQUEST_NOT_FOUND
REQUEST_NOT_AVAILABLE
PARTNERSHIP_UNAVAILABLE
RELATIONSHIP_DATE_FUTURE
PARTNERSHIP_METADATA_LOCKED
VERSION_CONFLICT
~~~

Internal occupancy, block, cooldown, request-terminal, and race details are not exposed as additional partner-specific public reasons.

## Explicit request acceptance

~~~http
POST /api/v1/partner-requests/:requestId/accept
~~~

The route accepts no request body. Partnership authority is derived from the authenticated account and the authoritative request row.

Successful first acceptance:

~~~json
{
  "outcome": "formed",
  "partnershipId": "uuid"
}
~~~

Retention-scoped lost-response replay of the same accepted request:

~~~json
{
  "outcome": "already_accepted",
  "partnershipId": "same-uuid"
}
~~~

Rules:

- only the request recipient may explicitly accept
- sender and recipient account rows are locked in canonical order before the request row
- an expired or otherwise terminal request cannot form a partnership
- both accounts are rechecked for active status, occupancy, cooldown, and active block state
- the request's persisted `relationshipStartDate` becomes the initial partnership relationship date
- the accepted request stores `accepted_partnership_id`
- its still-pending expiry action is cancelled
- incompatible pending requests touching either new member are invalidated
- one durable `partnership_formed` notification is created for the original sender
- the occupied-slot database invariant remains the final defense against a simultaneous second partnership

## Reciprocal automatic formation

Reciprocal formation occurs through the existing P1 create route:

~~~http
POST /api/v1/partner-requests
~~~

When a valid opposite pending request exists and the application is running in `paired` mode, P1 invokes P2's transaction-scoped coordinator before the request-creation transaction commits.

Successful paired response:

~~~json
{
  "outcome": "paired",
  "requestId": "triggering-request-uuid",
  "partnershipId": "uuid"
}
~~~

The triggering second request supplies the initial relationship date. Both reciprocal requests are marked accepted with the same partnership ID, both still-pending expiry actions are cancelled, and the earlier requester receives the durable formation notification.

The standalone historical P1 local harness remains in `request_only_test` mode. P2 closure separately reruns the P1 integration surface using the real coordinator in `paired` mode.

## Current partnership

~~~http
GET /api/v1/partnerships/current
~~~

No active or breakup-pending partnership:

~~~json
{
  "partnership": null
}
~~~

Current partnership:

~~~json
{
  "partnership": {
    "partnershipId": "uuid",
    "lifecycleState": "active",
    "activatedAt": "2026-09-21T12:00:00.000Z",
    "relationshipStartDate": "2025-11-15",
    "metadataVersion": 1,
    "capabilities": {
      "changeRelationshipStartDate": true
    },
    "otherMember": {
      "accountId": "uuid",
      "username": "partner",
      "displayName": "Partner"
    }
  }
}
~~~

The response is an allowlisted projection. It does not expose the other member's email, date of birth, device state, eligibility internals, or cryptographic state.

## Relationship start-date mutation

~~~http
PATCH /api/v1/partnerships/:partnershipId/relationship-start-date
Content-Type: application/json
~~~

Request:

~~~json
{
  "relationshipStartDate": "2025-11-15",
  "expectedMetadataVersion": 3
}
~~~

Response:

~~~json
{
  "partnershipId": "uuid",
  "relationshipStartDate": "2025-11-15",
  "metadataVersion": 4,
  "changed": true
}
~~~

Rules:

- both current member accounts are locked before the partnership row
- the authenticated account must be a current member
- trusted PostgreSQL server date rejects a future relationship date
- a real value change requires `expectedMetadataVersion` to match the authoritative partnership metadata version
- a successful real change increments partnership `version` exactly once
- lifecycle `generation` is not incremented for this metadata-only mutation
- if the requested date already equals the authoritative date, the operation is an idempotent no-op and returns the current version even when the submitted expected version is stale
- account-deletion view-only state returns `PARTNERSHIP_METADATA_LOCKED`
- a real committed change creates exactly one durable notification for the non-acting partner

## Notification list

~~~http
GET /api/v1/notifications?limit=25&cursor=<optional>
~~~

Response:

~~~json
{
  "items": [
    {
      "notificationId": "uuid",
      "eventType": "partnership_formed",
      "actorAccountId": "uuid",
      "partnershipId": "uuid",
      "createdAt": "2026-09-21T12:00:00.000Z",
      "readAt": null
    }
  ],
  "nextCursor": null
}
~~~

P2 event types are:

~~~text
partnership_formed
relationship_start_date_changed
~~~

Pagination is bounded and snapshot-based. The first page fixes `snapshotAt`; later cursor pages remain inside that snapshot so newly created notifications cannot shift an in-progress traversal.

Notification rows intentionally store routing metadata only. They do not persist relationship dates, message or media content, email, date of birth, device data, secrets, or cryptographic material.

## Mark notification read

~~~http
POST /api/v1/notifications/:notificationId/read
~~~

The route accepts no request body.

Response:

~~~json
{
  "notificationId": "uuid",
  "readAt": "2026-09-21T12:01:00.000Z"
}
~~~

Only the recipient account may mark the notification read. The operation is idempotent: later retries preserve the original `readAt` timestamp.

## Transaction and race guarantees

P2's committed implementation is designed around these boundaries:

- explicit acceptance locks the pair before the request
- reciprocal formation runs inside P1's existing create transaction and pair locks
- accept, cancel, decline, account deletion, and competing formation paths serialize through the same canonical account-lock order
- accepted requests cannot be expired by a later worker
- a still-pending expiry action is cancelled during formation
- an already-processing expiry action keeps its claim, re-reads the accepted terminal request, and becomes a safe no-op
- relationship metadata mutation locks member accounts before the partnership row
- the occupied-slot unique index on current partnership membership is the database backstop against double partnership

These guarantees are implemented in source and verified by the green local P2 matrix. Hosted GitHub Actions verification remains separate under V1.
