# Roadmap

## Status

Refreshed: 2026-09-21.

This is the canonical high-level execution roadmap.

Detailed epic acceptance gates remain in `docs/ROADMAP_EPICS.md`. Verified current implementation state remains in `docs/PROJECT_STATE.md`.

An epic is DONE only when its required gates are satisfied with committed evidence.

## Principle

Build identity, lifecycle correctness, authorization, and deletion boundaries before storing valuable private content.

Do not treat design completion, source-code presence, unit tests, or UI behavior alone as epic completion.

## Current snapshot

| Track | Status | Evidence boundary |
| --- | --- | --- |
| F0 Governance and Security Baseline | DONE | architecture, security, product, governance, domain baseline |
| F1 Repository Foundation and Executable Guardrails | DONE | clean lockfile bootstrap and full local health |
| V1 Hosted CI Verification | BLOCKED | intentionally deferred until GitHub Actions capacity returns |
| F2 Persistence and Worker Foundation | DONE | six migrations from zero, 17/17 PostgreSQL integration tests, final full health pass |
| A1 Accounts and Devices | IN_PROGRESS | implementation and core local validation are green at `ceb3d93`; 19/20 acceptance gates are reconciled; canonical A1 evidence-matrix completion remains |
| P1 Discovery and Partner Requests | IN_PROGRESS | refined architecture complete; domain/contracts may overlap after A1 account contracts stabilize |
| P3 Partnership Lifecycle | IN_PROGRESS | pure domain layer verified, persistence and API work pending |
| Remaining pre-release epics | PLANNED | follow dependency order below |

## Milestone summary

| Milestone | Status | Current boundary |
| --- | --- | --- |
| 0 Verified Foundation | DONE | F0, F1, and F2 are locally verified |
| 1 A1 Accounts and Devices | IN_PROGRESS | implementation green; 19/20 acceptance gates reconciled; complete canonical test-matrix evidence still required |
| 2 P1 Discovery and Requests | IN_PROGRESS | refined design complete; runtime implementation follows A1 closure |
| 3 P2 Partnership Formation | PLANNED | depends on A1 plus P1 |
| 4 P3 Partnership Lifecycle | IN_PROGRESS | pure domain layer verified; persistence, API, worker, race, and notification closure remain |
| 5 M1 Messaging Core and R1 Relationship Space | PLANNED | begins after partnership formation and lifecycle capability boundaries stabilize |
| 6 M2 Realtime and Offline Reliability | PLANNED | requires messaging core; physical Android validation begins here |
| 7 M3 Media and Voice Messages | PLANNED | requires realtime/offline substrate |
| 8 C1 Voice and Video Calling | PLANNED | physical-device and TURN verification required |
| 9 S1 E2EE and Cryptographic Recovery | PLANNED | reviewed protocol selection required before implementation |
| 10 R2 Public Readiness | PLANNED | requires all pre-release epics plus V1 |
| Stable Release | BLOCKED | waits on R2 |
| X1 Post-stable Maturity | PLANNED | operational evidence and stabilization after release |
| X2 Deferred Heavy Features | DEFERRED | optional heavy features only after production evidence |
| V1 Hosted CI Verification | BLOCKED | separate verification track; required before R2 closes |

## Immediate execution sequence

1. close the remaining A1 acceptance-evidence gap against the canonical test matrix
2. run the explicit dependency audit on the current lockfile
3. rerun `npm run test:a1:local` and `npm run health`
4. mark A1 DONE only after gate 20 is supported by complete committed evidence
5. begin P1-A runtime implementation
6. keep V1 separate until GitHub Actions capacity returns

## Execution graph

```text
F0 DONE
  |
F1 DONE
  |
F2 DONE
  |
  +---------------------------+
  |                           |
  v                           v
A1 Accounts + Devices      P1 Discovery + Requests
  |                           |
  +-------------+-------------+
                |
                v
        P2 Partnership Formation
                |
                v
        P3 Lifecycle + Deletion
                |
        +-------+--------+
        |                |
        v                v
   M1 Messaging      R1 Relationship Space
        |
        v
   M2 Realtime + Offline
        |
    +---+---+
    |       |
    v       v
  M3 Media  C1 Calling
    |       |
    +---+---+
        |
        v
 S1 E2EE + Crypto Recovery
        |
        v
 R2 Public Readiness
        |
        v
  STABLE RELEASE
        |
        v
 X1 Post-stable Maturity
        |
        v
 X2 Deferred Heavy Features

V1 Hosted CI runs as a separate verification track and must be DONE before R2 closes.
```

# Milestone 0: Verified Foundation

Status: DONE.

Completed foundation:

- F0 Governance and Security Baseline
- F1 Repository Foundation and Executable Guardrails
- F2 Persistence and Worker Foundation
- Architecture Baseline 1.0 freeze
- architecture change governance
- PostgreSQL transaction kernel
- deterministic account locking
- durable worker
- recoverable leases and fencing
- transactional outbox
- scheduled actions
- lifecycle event persistence
- deletion manifest runtime
- six ordered migrations
- disposable PostgreSQL test harness
- 17/17 F2 PostgreSQL integration suite
- final full repository health regression

No foundation work should be reopened without concrete implementation evidence that requires it.

# Milestone 1: A1 Accounts and Devices

Status: IN_PROGRESS. IMPLEMENTED AND CORE VALIDATION GREEN; ACCEPTANCE COVERAGE PENDING.

Canonical design:

`docs/architecture/A1_ACCOUNTS_DEVICES_DESIGN.md`

A1-A through A1-E runtime work is committed. The current branch has a green full repository health run and a green disposable PostgreSQL A1 run. A1-F remains open because the canonical A1 test matrix is broader than the committed integration/security coverage.

## A1-A: Domain, contracts, migration, repositories

Committed implementation:

- account domain types and stable denial codes
- server-date age rules
- username and password policy constants
- A1 boundary schemas
- migration `0007_accounts_devices_runtime.sql`
- registration intents
- password credentials
- account email additions
- challenge state and active-challenge uniqueness
- session token-generation fencing
- device handle verifiers
- PostgreSQL security rate-limit buckets
- append-only typed security events
- durable security-email delivery records
- account/auth repositories

Exit evidence:

- migration plan passes
- all seven migrations apply from zero
- database invariants pass
- account domain tests pass
- contract tests pass
- challenge-attempt and uniqueness races pass

## A1-B: Authentication security kernel

Committed implementation:

- Argon2id password service
- versioned HMAC key ring
- domain-separated verifier subkeys
- opaque revocable session tokens
- fenced session rotation
- production and loopback-development cookie policies
- device-handle identification
- Fastify authentication plugin
- exact-origin validation
- Fetch Metadata rejection
- custom-header CSRF protection
- trusted-proxy allowlist behavior
- PostgreSQL-backed deterministic rate limiting
- security-safe error mapping
- startup validation for security-critical configuration

Exit evidence:

- session fixation regression passes
- current token rotates after reauthentication
- stale concurrent rotation fails
- raw session tokens do not exist in PostgreSQL
- raw email codes do not exist in PostgreSQL or outbox payloads
- proxy spoofing cannot choose network rate-limit identity
- production insecure-cookie configuration fails startup
- HMAC key rotation tests pass

## A1-C: Registration and login

Committed implementation:

- registration start
- verification challenge creation
- durable verification email outbox
- resend and supersession
- provider-neutral email delivery port
- fake test email adapter
- transactional registration completion
- account/profile/password/email/device/session creation
- generic login failures
- real or dummy Argon2id verification
- device creation or safe reuse
- fresh session issuance
- logout
- session introspection

Exit evidence:

- exact 18th birthday boundary passes
- client clock cannot bypass age eligibility
- verification expiry and replay tests pass
- registration username/email races fail safely
- login and logout pass
- revoked and expired sessions fail
- registration-intent password hash is scrubbed after completion

## A1-D: Recovery and sensitive account changes

Committed implementation:

- password recovery
- password reset and all-session revocation
- password reauthentication
- verified email change
- durable old-email security notification
- current-session rotation
- other-session revocation
- profile display name update
- one-year username change
- active and breakup-pending username restriction
- one-time date-of-birth correction

Exit evidence:

- recovery-start response does not enumerate accounts
- password reset revokes every active session
- email change requires recent reauthentication and new-email verification
- old email notification is durable
- old username releases immediately
- rejected under-18 DOB correction does not consume the allowance

## A1-E: Account deletion and devices

Committed implementation:

- deletion request
- immediate account lockout
- all-session revocation
- seven-day recovery challenge
- account recovery
- generation-guarded account deletion finalizer
- complete account-deletion-specific partnership persistence path
- partnered deletion and recovery race handling
- device list
- device rename
- device revoke
- current-device logout
- account recovery versus crypto recovery regression

Important boundary:

A1 must not enable partnered account deletion until the account-deletion-specific partnership path is correct end to end. This work may close individual P3 gates but does not complete P3.

Exit evidence:

- account access disappears immediately after deletion request
- recovery succeeds before the exact deadline
- recovery fails at the exact deadline
- breakup/deletion deadline precedence remains correct
- current device revocation immediately removes authentication
- email-only account recovery does not create historical E2EE trust

## A1-F: Integration closure

Verified on the current A1 branch:

- migration plan passes with seven migrations
- all seven migrations apply from zero
- database invariants pass
- `npm run test:a1:local` passes 9/9 integration tests and reports `A1_LOCAL_POSTGRES_PASS`
- `npm run health` passes repository health, typecheck, builds, lint, Prettier, dependency-direction checks, and all 44 current unit/contract/security/worker tests
- the final account-deletion/breakup precedence PostgreSQL defect is fixed in `ceb3d93`
- 19 of 20 A1 acceptance gates are reconciled against committed behavior evidence

Remaining before A1 may be marked DONE:

- complete the canonical A1 verification matrix where current committed tests are still thinner than the design, including challenge expiry/attempt/rate-limit cases, ownership/race cases, logout and revoked-cookie rejection, session expiry/fencing, username API acceptance, device-list/revocation acceptance, and the remaining browser-security negative paths
- run an explicit `npm audit --audit-level=high` against the current committed lockfile
- rerun `npm run test:a1:local` and `npm run health` after the coverage additions
- check the twentieth A1 gate only when the complete integration and security evidence is committed

A1 is therefore not reopened at the implementation layer. The remaining work is acceptance-evidence closure.
**REDMI PHONE REQUIRED: NO for A1 closure.**

A1 may be completed with browser/API/PostgreSQL evidence. Device records in A1 are server security principals, not yet the physical-device cryptographic acceptance gate.

# Milestone 2: P1 Discovery and Requests

Status: IN_PROGRESS at the design layer.

Canonical design:

`docs/architecture/P1_DISCOVERY_REQUESTS_DESIGN.md`

Safe parallelization:

- P1 domain rules and contracts may begin alongside A1-A once shared account identifiers and username normalization are stable.
- P1 migration 0008 follows A1 migration 0007.
- P1 full API integration waits until A1-C provides real authenticated accounts and sessions.
- P1 reuses the generalized A1 PostgreSQL-backed security-rate-limit primitive rather than inventing an independent limiter.
- P1 detects reciprocal active requests; P2 owns the same-transaction partnership formation coordinator.
- Production request creation remains fail-closed until that P2 coordinator is registered.
- P1 create uses explicit idempotency, pair-wide deterministic locks, cursor-paginated request lists, and cross-epic invalidation hooks.

Implement:

- exact username discovery
- safe public-profile projection
- seven-day request expiry
- cancellation
- decline
- three requests per recipient per rolling month
- one-hour post-decline cooldown
- multiple incoming requests
- reciprocal request detection
- active-block enforcement
- abuse controls

Exit evidence is defined by the P1 gates in `ROADMAP_EPICS.md`.

**REDMI PHONE REQUIRED: NO.**

# Milestone 3: P2 Partnership Formation

Status: PLANNED.

Depends on A1 plus P1.

Implement:

- explicit acceptance
- reciprocal-request automatic formation
- deterministic two-account locking
- transactional one-slot enforcement
- incompatible request invalidation
- relationship start date
- fresh partnership namespace
- notification outbox

Exit evidence:

- one-way acceptance works
- reciprocal request race produces exactly one partnership
- database occupancy invariant survives concurrent formation
- future relationship date is rejected
- fresh partnership creates fresh local and crypto namespace identifiers

**REDMI PHONE REQUIRED: NO.**

# Milestone 4: P3 Partnership Lifecycle, Deletion, and Cooldowns

Status: IN_PROGRESS at the pure-domain layer.

A1-E is allowed to advance the account-deletion-specific subset.

Complete:

- persisted breakup initiation
- one-hour cancellation
- restore intent
- day-10 extension
- mutual restoration
- worker finalization
- stale generation rejection
- breakup/deletion deadline precedence
- final dissolution
- deletion manifest creation
- one-month and three-month cooldown persistence
- former-partner blocking
- serious lifecycle email notifications

Closure requires API, database, worker, race, and security evidence.

**REDMI PHONE REQUIRED: NO.**

# Milestone 5: M1 Messaging Core and R1 Relationship Space

Status: PLANNED.

These may overlap after P2 and the required P3 lifecycle capability rules are stable.

## M1 Messaging Core

Implement:

- primary partnership conversation
- text messages
- replies
- server sequence
- idempotent send
- 30-minute edit window
- deletion tombstones
- reactions
- read receipts
- typing
- presence
- shared nicknames

## R1 Relationship Space

Implement the first-stable relationship feature set defined by the PRD, including:

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

Both must obey partnership isolation and P3 lifecycle capabilities.

**REDMI PHONE REQUIRED: NO for core closure.**

# Milestone 6: M2 Realtime and Offline Reliability

Status: PLANNED.

Implement:

- authenticated WebSocket
- server-derived channel membership
- reconnect
- canonical resynchronization
- IndexedDB partitioning
- offline mutation queues
- duplicate-safe retry
- lifecycle-aware queued mutation rejection
- service-worker compatibility handling

**REDMI PHONE REQUIRED: YES.**

Physical Redmi validation is required for mobile PWA lifecycle behavior, background/foreground transitions, IndexedDB persistence, offline retry, reconnect, and service-worker update behavior.

# Milestone 7: M3 Media and Voice Messages

Status: PLANNED.

Implement:

- images
- short video
- selected files
- voice messages
- client-side media preparation
- private object storage
- signed access
- attachment authorization
- deletion-manifest integration
- E2EE-compatible media path

**REDMI PHONE REQUIRED: YES.**

Physical Redmi validation is required for media selection, camera access, microphone permission, voice recording, upload, playback, background/foreground transitions, and mobile storage behavior.

# Milestone 8: C1 Voice and Video Calling

Status: PLANNED.

Implement:

- call signaling
- voice and video
- accept/reject/cancel
- missed calls
- call history
- short-lived TURN credentials
- relay-first privacy
- TURN/TCP or TURN/TLS fallback where supported
- breakup-pending explicit call consent

**REDMI PHONE REQUIRED: YES, MANDATORY.**

Physical-device voice/video calls, permission handling, reconnection, foreground/background behavior, TURN relay behavior, and network interruption tests are required.

# Milestone 9: S1 E2EE and Cryptographic Recovery

Status: PLANNED.

Implement only after reviewed protocol selection.

Includes:

- device cryptographic identities
- per-partnership roots and crypto epochs
- message encryption
- relationship-object encryption
- attachment encryption
- trusted-device enrollment
- encrypted recovery material
- high-entropy recovery secret
- device revocation
- metadata minimization
- protocol compatibility
- lifecycle cryptographic deletion

Email-only recovery must remain unable to decrypt historical protected content.

**REDMI PHONE REQUIRED: YES, MANDATORY.**

At least one physical Android device must participate in enrollment, revocation, key persistence, recovery, app restart, and future-content denial tests.

# Milestone 10: R2 Public Readiness

Status: PLANNED.

Requires all pre-release epics plus V1.

Complete:

- hosted CI verification
- dependency and secret scanning
- privacy documentation
- abuse controls
- production provider configuration
- backup/restore deletion safety
- observability
- browser E2E
- deletion operational recovery
- security regression
- migration/release runbook
- final security review
- staged release

**REDMI PHONE REQUIRED: YES, MANDATORY.**

Final supported mobile PWA acceptance must pass on the Redmi or another explicitly approved physical Android device.

# Verification Track: V1 Hosted CI

Status: BLOCKED.

V1 is independent of feature development but required before R2 closes.

When GitHub Actions capacity returns:

1. run Baseline CI without a skip marker or manually dispatch it
2. verify hosted `npm ci`
3. verify hosted `npm run ci:baseline`
4. verify hosted dependency audit
5. record workflow evidence in `PROJECT_STATE.md`
6. mark V1 DONE only after all six V1 gates pass

# Post-stable: X1 Maturity

After stable release:

- production reliability follow-up
- incident learning
- storage and bandwidth measurement
- media deletion and backup-expiry cost measurement
- call usage and quality measurement
- optimization only from measured evidence
- native clients only if justified
- infrastructure extraction only if measured need justifies it

# Deferred: X2 Heavy Features

Call recording remains outside stable release and outside X1.

Only reconsider it after post-stable evidence supports:

- real user demand
- acceptable storage and bandwidth cost
- privacy and legal treatment
- retention policy
- deletion behavior
- backup expiry
- E2EE design
- explicit consent model

Redis and microservices are not roadmap goals by themselves.
