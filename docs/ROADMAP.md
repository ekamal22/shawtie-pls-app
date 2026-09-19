# Roadmap

## Principle

Build lifecycle correctness and security boundaries before storing valuable user content.

## Phase 0: Architecture Foundation

- monorepo configuration
- TypeScript baseline
- linting and formatting
- CI
- PostgreSQL development environment
- domain capability engine: implemented foundation
- database invariants
- transaction helpers
- deterministic two-account locking helper
- durable worker
- transactional outbox
- scheduled actions
- scheduled-action generation tokens: domain behavior implemented, persistence pending
- lifecycle event ledger
- deletion manifest workflow
- runtime contract validation
- API versioning
- client compatibility versioning
- formal threat model: completed
- data classification and handling matrix: completed
- Architecture Baseline 1.0 freeze: completed
- architecture governance and ADR change control: completed
- security headers and browser hardening
- synthetic testkit: initial domain fixtures implemented

## Phase 1: Accounts and Devices

- registration
- age validation
- verified email
- login
- sessions
- password recovery
- secure email change
- account deletion recovery
- device records
- device revocation
- device management UI
- cryptographic recovery boundary
- username rules
- profile rules

## Phase 2: Partnerships

- username discovery
- partner requests
- request rate rules
- reciprocal request auto-pairing
- database-enforced one-partnership occupancy
- manual relationship date
- breakup state machine: pure domain foundation implemented
- restoration
- account-deletion interaction state: pure domain foundation implemented
- one-month and three-month cooldowns: pure domain calculation implemented
- blocking
- lifecycle event ledger coverage

## Phase 3: Messaging

- conversations
- server sequence ordering
- text messages
- replies
- edits
- deletion tombstones
- reactions
- read receipts
- typing
- presence
- shared nicknames
- realtime reconnect
- offline chat outbox

## Phase 4: Media and Calling

- client-side media preparation
- private object storage
- signed media access
- voice messages
- voice calls
- video calls
- short-lived TURN credentials
- relay-first call privacy
- call history
- push notifications
- minimal push payloads

## Phase 5: Relationship Space

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
- relationship signals
- separate relationship offline queue where supported

## Phase 6: E2EE

- reviewed protocol selection
- device identity
- partnership crypto epochs
- session establishment
- message encryption
- attachment encryption
- relationship-object encryption
- call-media review
- encrypted recovery material
- trusted-device enrollment
- device revocation behavior
- metadata minimization
- migration plan
- test vectors
- deletion and cryptographic erasure integration

## Phase 7: Public Readiness

- privacy documentation
- abuse controls
- production backup and deletion handling
- dependency and secret scanning
- deletion manifest operational checks
- security regression
- browser E2E
- physical Android acceptance
- call privacy acceptance
- final security review
- staged public launch

## Post-release

- consensual call recording
- recording export and deletion UX
- native clients if justified
- infrastructure extraction only when measured production needs justify it

Microservices and Redis are not roadmap goals by themselves.


## Completed foundation milestone

The first executable domain milestone is complete:

- centralized capability evaluation
- breakup and restoration state transitions
- account-deletion collision behavior
- calendar-month cooldown calculation
- stale breakup generation rejection
- message mutation capability rules
- 27 passing domain tests in local validation

The threat-model and data-classification milestone is also complete.

Architecture freeze and governance are complete. Architecture Baseline 1.0 is now the implementation baseline.

The next milestone is repository foundation and executable guardrails, followed by PostgreSQL persistence.
