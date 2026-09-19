# Test Strategy

## Purpose

Testing must prove product invariants, not only happy-path UI behavior.

## Test layers

### Unit

Pure domain rules in `packages/domain`.

Use deterministic clocks.

High-value unit coverage includes:

- age eligibility
- username cooldown
- partner-request rate rules
- partner-request expiry
- reciprocal request pairing
- breakup deadlines
- one-hour cancellation
- irreversible restoration intent
- three-day extension
- cooldown calculation
- account deletion collision rules
- message edit window

### Database invariant tests

Run against real PostgreSQL.

Prove:

- one occupied partnership slot per account
- unique verified current email
- idempotency uniqueness
- optimistic concurrency
- transaction rollback behavior
- reciprocal request races
- duplicate worker claims
- stale scheduled-action safety

### Integration

Exercise API plus PostgreSQL plus provider fakes.

Cover:

- registration and email verification
- session lifecycle
- email change
- partner discovery
- partner requests
- partnership formation
- breakup and restore
- account deletion and recovery
- messaging
- media authorization
- relationship items
- notification outbox
- call signaling

### Security regression

Maintain permanent regression tests for every security-relevant defect.

Required classes include:

- cross-partnership access
- guessed resource IDs
- media authorization bypass
- WebSocket channel escalation
- session fixation
- CSRF
- XSS-sensitive output handling
- verification-code replay
- direct API cooldown bypass
- stale worker finalization
- local partnership cache leakage

### E2E browser

Critical journeys:

- registration
- verified email
- login
- partner request
- mutual request
- partnership creation
- messaging
- edit and delete
- reaction
- breakup
- restore
- final dissolution
- account deletion recovery
- permanent deletion

### Physical Android device

Before stable release, validate:

- PWA installation
- background and foreground transitions
- notifications
- IndexedDB persistence
- offline retry
- media capture
- voice recording
- voice call
- video call
- camera and microphone permissions
- reconnection

## Race tests

Explicitly test concurrency.

Examples:

- one account accepts two partners at once
- reciprocal requests cross in flight
- restore arrives as breakup finalization begins
- account recovery races permanent deletion
- two workers claim the same deadline
- message retry arrives after first success

The system must remain correct regardless of request ordering.

## Worker tests

Every job handler must prove idempotency.

Test:

- repeated execution
- stale execution
- partial provider failure
- retry after process restart
- duplicate outbox delivery
- already-completed target state

## Offline tests

Test:

- send while offline
- reconnect and retry
- duplicate prevention
- account switch with queued data
- partnership termination while device is offline
- queued mutation rejected after lifecycle changes
- purge of old partnership namespace

## E2EE tests

After protocol selection, include:

- official or reviewed test vectors where available
- cross-device encryption and decryption
- wrong-partnership failure
- wrong-device failure
- attachment encryption
- key rotation
- device enrollment
- recovery
- partnership termination
- account deletion
- future partnership cannot decrypt previous partnership content

## Call tests

Cover:

- voice
- video
- accept
- reject
- cancel
- missed call
- network interruption
- TURN relay
- relay over TCP or TLS fallback where supported
- breakup_pending explicit acceptance
- account-deletion state rejection

## Acceptance principle

A feature is not complete merely because UI automation passes.

Stable-release evidence must combine:

- unit tests
- PostgreSQL invariant tests
- API integration
- security regression
- browser E2E
- physical-device checks for mobile-critical flows
