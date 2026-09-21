# Capability Model

## Purpose

Shawtie pls has many state-dependent rules. The same state can affect messaging, calls, profile changes, relationship objects, partner requests, blocking, restoration, and account actions.

These rules must not be reimplemented independently in UI components, API handlers, worker jobs, and tests.

## Decision

`packages/domain` owns an authoritative capability engine.

Conceptually:

```text
getAccountCapabilities(...)
getPartnershipCapabilities(...)
getConversationCapabilities(...)
```

Inputs are authoritative state plus trusted server time.

Outputs are explicit capabilities and denial reasons.

Example:

```text
canSendMessage
canReply
canEditMessage
canDeleteMessage
canReact
canSendMedia
canStartCall
callRequiresExplicitAcceptance
canCreateRelationshipObject
canEditRelationshipObject
canChangeNickname
canChangeEmail
canChangeUsername
canChangeRelationshipStartDate
canInitiateBreakup
canSubmitRestoreIntent
canCancelBreakup
canBlock
canFormPartnership
```

## Requirements

The capability engine must:

- be pure domain logic
- not import React
- not import Fastify
- not query PostgreSQL directly
- not call storage, email, push, or provider SDKs
- accept trusted state as input
- accept trusted server time when time affects a rule
- return stable denial codes
- be exhaustively unit-tested across lifecycle states

## API enforcement

API routes still enforce each operation individually.

The capability engine is not permission data sent by the browser and trusted by the server.

The API:

1. authenticates the account
2. loads authoritative state
3. evaluates the capability
4. rejects denied operations
5. performs the mutation transactionally

A1 extends this pattern to sensitive account actions.

Examples:

- verified email change requires active account access plus recent strong reauthentication
- username change uses the central `change_username` capability and authoritative partnership state
- account deletion requires active account access and recent reauthentication before the deletion transaction revokes all sessions
- account recovery uses the dedicated recovery path rather than treating a deletion-pending account as ordinarily authenticated
- device revocation is account-owned and does not depend on client-provided authorization state

Authentication state, recent reauthentication, and device ownership are API security prerequisites. Partnership-dependent eligibility remains in the pure capability engine rather than being copied into route handlers.

P2 adds the `change_relationship_start_date` capability. It is allowed for authenticated members while the partnership is `active` or `breakup_pending`, denied during account-deletion view-only state, and denied after termination or for non-members. Relationship-date validity still uses trusted server date in the P2 domain helper.

P3 refines the lifecycle capability surface with `initiate_breakup` and exact non-overlapping time windows. Breakup initiation is allowed only for an active member with no account-deletion overlay. Unilateral cancellation is allowed only to the initiator while trusted `now < initiator_cancel_until`. Restore intent is denied before that boundary, opens at exact equality with the cancellation deadline, and remains available only while trusted `now < final_deadline`. These rules are implemented and locally verified as part of the closed P3 lifecycle domain, API, worker, race, and security matrix.

Former-partner blocking is allowed only from a terminated source partnership and must derive the target from that historical partnership rather than trusting a client-provided account ID.

## UI use

The client may receive a server-derived capability snapshot for presentation.

This can determine whether controls are visible or disabled.

The client capability snapshot is advisory only. The server always re-evaluates before mutation.

## Worker use

Worker jobs must re-evaluate relevant domain state before destructive or lifecycle-sensitive actions.

A scheduled job may have been created under an earlier state and must not assume that its old capability still exists.

## Testing

Maintain matrix tests for important state combinations.

Examples:

- active partnership
- breakup_pending before one hour
- breakup_pending after one hour
- breakup_pending with one restore intent
- account_deletion_pending
- terminated partnership
- active block
- cooldown active
- cooldown expired

A product rule is not considered fully implemented until the capability engine and route-level enforcement agree.
