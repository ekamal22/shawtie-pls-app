# ADR-005: Centralized Capability Engine

## Status

Accepted.

## Context

Shawtie pls has many state-dependent rules across messaging, calls, restoration, account deletion, blocking, profile changes, partner requests, and relationship objects.

Duplicating these rules across API routes, UI components, and worker handlers would create policy drift.

## Decision

Create a centralized capability engine in `packages/domain`.

It receives authoritative state and trusted server time and returns explicit capabilities and stable denial reasons.

Examples include:

- canSendMessage
- canEditMessage
- canSendMedia
- canStartCall
- canCreateRelationshipObject
- canChangeNickname
- canChangeEmail
- canSubmitRestoreIntent
- canCancelBreakup
- canBlock
- canFormPartnership

The API remains authoritative and re-evaluates capabilities before every protected mutation.

The client may use server-derived capability snapshots only for presentation.

## Consequences

Benefits:

- one source for lifecycle permission logic
- easier exhaustive testing
- reduced divergence between UI and server
- easier security review

Costs:

- capability inputs and outputs must be designed carefully
- domain changes require capability matrix updates
- route-specific validation still remains necessary

## Testing

Maintain matrix tests across account, partnership, breakup, deletion, cooldown, device, and time-dependent states.
