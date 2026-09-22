# Threat Model

## Status

Accepted security baseline for foundation implementation.

This document identifies the assets Shawtie pls must protect, the actors and failure modes that can threaten them, the trust boundaries where controls must exist, and the mitigations that must be verified before stable release.

The threat model is a living security document. New architecture decisions, new infrastructure providers, new E2EE protocol choices, or new public features must update this document when they materially change risk.

## Security objectives

Shawtie pls must protect:

1. confidentiality of private communication and relationship content
2. integrity of account, partnership, message, and lifecycle state
3. availability of essential account and communication functions
4. partnership isolation across current, former, and future partnerships
5. device and cryptographic authorization
6. lifecycle correctness for breakup, restoration, cooldown, and account deletion
7. deletion correctness after final dissolution or permanent account deletion
8. minimization of server-visible and provider-visible metadata
9. resistance to account takeover and session theft
10. resistance to abuse of public registration, username search, partner requests, calls, and media

## Core security invariants

The following invariants are security-critical:

- an account occupies at most one partnership slot
- no account can access another partnership without membership authorization
- a former or future partner cannot inherit data from another partnership
- server time controls age, cooldown, edit, breakup, restoration, and deletion deadlines
- stale jobs cannot mutate newer lifecycle state
- account deletion immediately removes account access
- final dissolution immediately removes partnership authorization
- E2EE historical plaintext is not recoverable from email account recovery alone
- a revoked device cannot receive new protected content
- private content is never intentionally written to application logs
- deleted private content never returns to normal application access through backup restore
- a client is never trusted to assert its own capabilities, cooldown, or partnership eligibility

## Assets

### Identity assets

- account ID
- username
- display name
- verified email
- date of birth
- age eligibility state
- account status
- device records
- session records

### Authentication assets

- password hashes
- session identifiers
- verification-code state
- password-reset state
- email-change verification state
- recovery state

### Partnership assets

- partnership ID
- member IDs
- relationship start date
- breakup state
- restore intent
- cooldown state
- blocking state
- lifecycle generation
- lifecycle event records

### Communication assets

- message plaintext on authorized clients
- message ciphertext on the server
- message metadata
- media plaintext on authorized clients
- media ciphertext in storage
- voice-message content
- reaction state
- read receipts
- typing state
- online presence

### Relationship-space assets

- memories
- For You letters
- Future Us content
- saved moments
- locations
- firsts
- reasons
- relationship timeline objects
- private notes
- preview content for locked delivery items
- sealed main content for locked delivery items
- scheduled release state
- R1 mutation keyed fingerprints

### Cryptographic assets

- device private keys
- device public keys
- partnership cryptographic state
- crypto epochs
- attachment keys
- encrypted recovery material
- high-entropy recovery secret
- future call-recording keys

### Operational assets

- database credentials
- object-storage credentials
- email-provider credentials
- push-provider credentials
- TURN credentials
- signing secrets
- CI secrets
- deployment secrets
- logs
- backups
- deletion manifests
- outbox events
- scheduled actions

## Trust boundaries

### Boundary 1: Local device and browser

Trusted for authorized user interaction, but exposed to:

- device theft
- malware
- hostile browser extensions
- shared-device mistakes
- stale cached application code
- XSS running inside the trusted origin

Private plaintext necessarily exists here while content is being viewed.

### Boundary 2: Trusted application origin

The application origin executes code that can access decrypted data.

This boundary must reject arbitrary third-party script execution.

Browser hardening is therefore part of the E2EE security model.

### Boundary 3: API

The API authenticates sessions, evaluates capabilities, validates requests, and enforces authorization.

A client request is always untrusted input.

### Boundary 4: Durable worker

The worker executes deadlines, retries, deletion targets, email, push, and outbox effects.

Database job records are inputs, not unquestioned commands. The worker re-checks authoritative current state.

### Boundary 5: PostgreSQL

PostgreSQL stores authoritative lifecycle state and operational metadata.

Database compromise must not directly reveal E2EE-protected plaintext.

### Boundary 6: Object storage

Object storage contains protected media ciphertext and minimal operational metadata.

Objects are never public by default.

### Boundary 7: Email provider

The email provider receives destination email addresses and minimal security or lifecycle email content.

It must never receive message plaintext or relationship content.

### Boundary 8: Push provider

The push provider receives routing tokens and minimal notification metadata.

Opaque wake-up payloads are preferred.

### Boundary 9: TURN infrastructure

TURN can observe connection metadata and relay encrypted packets.

TURN must not receive plaintext call media.

### Boundary 10: Source repository and CI

The public repository and CI system are part of the software supply chain.

They must not contain production secrets, real user content, or private cryptographic material.

## Threat actors

### Unauthenticated internet attacker

Goals may include:

- account enumeration
- credential stuffing
- registration abuse
- verification-code brute force
- denial of service
- TURN theft
- API exploitation

### Malicious authenticated account

Goals may include:

- unauthorized partnership access
- direct API bypass of cooldowns
- guessed resource access
- request harassment
- upload abuse
- call-signaling abuse

### Malicious current partner

A current partner is authorized to see shared partnership content, so the threat is not ordinary unauthorized access.

Relevant risks include:

- abusive message or call behavior
- deliberate screenshots or external copies
- saving content before later deletion
- attempting to manipulate lifecycle races
- denial of restoration
- repeated partner-request behavior after dissolution where not blocked

The product cannot guarantee deletion of copies deliberately captured outside Shawtie pls.

### Former partner

Goals may include:

- accessing old partnership content after dissolution
- retaining stale WebSocket access
- reusing cached media URLs
- discovering or requesting a blocked account
- recovering old local data after a new partnership begins

### Account takeover attacker

An attacker with a password, session, or compromised email may attempt:

- profile takeover
- email change
- device enrollment
- partner manipulation
- account deletion
- historical content recovery

Historical E2EE content recovery must require more than email recovery alone.

### Stolen-device attacker

A stolen unlocked or compromised device may expose currently available plaintext and local cryptographic state.

Device revocation must prevent future protected content delivery.

### Malicious browser extension or device malware

Such software may access page content, keystrokes, screenshots, or browser storage.

This threat cannot be fully mitigated by the web application.

The product must not claim protection against a fully compromised endpoint.

### XSS or malicious dependency

Hostile code executing in the trusted application origin may access decrypted content.

This is a critical threat because E2EE does not protect plaintext after authorized client decryption.

### Database attacker

An attacker with database access may obtain:

- account metadata
- lifecycle metadata
- message ciphertext
- operational identifiers
- session data depending on storage design

The attacker must not obtain plaintext protected content or client private keys.

### Object-storage attacker

An attacker may obtain encrypted media blobs and object metadata.

The blobs must remain unusable without client-side decryption material.

### Compromised or malicious operator

An operator may have infrastructure-level access.

The design should minimize the amount of private content technically available to an operator.

E2EE is a primary mitigation for protected content.

### Email or push provider

Providers can observe delivery metadata and any content intentionally sent through them.

Payloads must be minimal.

### Network observer or censor

A network observer may observe IP addresses, connection timing, traffic volume, DNS, and destination services even when content is encrypted.

E2EE does not provide traffic-analysis anonymity.

### Race and retry failures

Concurrency, delayed workers, duplicate delivery, stale jobs, and partial failures are treated as adversarial conditions even when no malicious actor is involved.

## Threat register

### T01: Credential stuffing and password guessing

Impact: High

Controls:

- strong password policy
- password hashing
- login rate limiting
- generic authentication errors
- session monitoring
- future optional stronger authentication

Verification:

- authentication integration tests
- rate-limit tests including proxy-spoofing regression
- password-hash configuration review
- session-token rotation race tests
- HMAC key-rotation compatibility tests

### T02: Verification-code brute force or replay

Impact: High

Controls:

- short-lived code
- attempt limit
- send rate limit
- keyed code verifier
- consume-once behavior
- replay rejection

Verification:

- expiry tests
- attempt-limit tests
- replay tests

### T03: Email account compromise leading to historical message exposure

Impact: Critical

Controls:

- account recovery separated from cryptographic recovery
- trusted-device approval or high-entropy recovery secret for historical keys
- device records
- notification of sensitive account changes

Verification:

- email-only recovery cannot decrypt historical E2EE content
- recovery-secret tests
- trusted-device enrollment tests

### T04: Session theft or fixation

Impact: High

Controls:

- opaque server-managed sessions
- HttpOnly cookies
- Secure cookies
- appropriate SameSite policy
- fresh session creation after authentication
- fenced session-token rotation after password reauthentication and sensitive identity changes
- server-side revocation
- fixation protection
- session revocation after sensitive changes
- versioned HMAC verifiers with staged key rotation

Verification:

- fixation regression test
- revoked-session test
- email-change session-revocation test

### T05: CSRF on state-changing operations

Impact: High

Controls:

- strict Origin validation
- CSRF protection
- SameSite cookies
- no state-changing GET routes

Verification:

- CSRF security tests

### T06: XSS in trusted application origin

Impact: Critical

Controls:

- strict Content Security Policy
- no unsafe eval
- avoid unsafe inline script
- output encoding
- runtime schema validation
- Trusted Types where practical
- minimal runtime dependencies
- no arbitrary remote JavaScript
- no third-party advertising scripts
- no third-party analytics with arbitrary origin execution

Verification:

- CSP checks
- dependency review
- XSS security regression
- static analysis where practical

### T07: Malicious or compromised dependency

Impact: Critical

Controls:

- lockfile pinning
- dependency scanning
- minimal dependency surface
- reviewed updates
- protected CI
- no install scripts from unreviewed packages where avoidable

Verification:

- dependency scanning in CI
- lockfile integrity checks

### T08: Cross-partnership IDOR or guessed resource access

Impact: Critical

Controls:

- authorization in data-access predicates
- immutable random IDs
- capability checks
- partnership-scoped resource queries
- short-lived signed media access

Verification:

- cross-partnership API tests
- media authorization tests
- guessed-ID tests

### T08R: Relationship-space premature disclosure or visibility escalation

Impact: Critical

Threats:

- sealed For You/Future Us content returned before release
- Surprise/Proposal sequence reachable through generic item traversal
- Voice Letter media reachable independently of its containing item
- links granting visibility the target did not independently have
- stale scheduled work revealing content after a destructive deadline

Controls:

- separate preview and main content roles
- sealed main content withheld before release
- Surprise/Proposal sequence stored inside protected container content
- Voice Letter visibility inherited from containing item
- links never grant target visibility
- release predicate checks lifecycle, account-deletion pause, and effective destructive deadline
- exact deadline equality belongs to destruction
- release generation and worker claim fencing

Verification:

- pre-release sealed-content denial
- link visibility-escalation tests
- Voice Letter container-visibility tests
- release versus breakup/deletion/deadline races
- late-finalizer regression

### T08S: Relationship-content leakage through operational metadata

Impact: Critical

Threats:

- private content copied to logs, events, queues, traces, analytics, notifications, or idempotency responses
- raw unkeyed private request hashes enabling offline dictionary tests
- precise coordinates emitted to diagnostics or unreviewed providers

Controls:

- logging allowlist
- content-free scheduled payloads
- metadata-only relationship events
- server-keyed domain-separated idempotency fingerprints
- no protected request body in idempotency responses
- coordinates kept inside protected relationship payload
- provider review before map integration

Verification:

- structured log capture
- queue/event/idempotency storage inspection
- raw-hash absence
- coordinate non-leakage

### T08A: Discovery enumeration and partner-request privacy oracle

Impact: High

Controls:

- authenticated exact-match discovery only
- no prefix, fuzzy, paginated directory, or broad account listing
- bounded account and network discovery rate limits
- safe profile projection only
- blocker-hidden search behavior
- generic target-unavailable response for recipient partnership, cooldown, block, deletion, or other safety ineligibility
- stable account ID plus expected username prevents stale username reassignment targeting
- request bodies excluded from routine logs

Verification:

- discovery privacy tests
- block-visibility tests
- abuse-rate-limit tests
- recipient-state oracle regression
- stale username targeting regression

### T08B: Partner-request spam or lifecycle race

Impact: High

Controls:

- three successful sends per pair per rolling calendar month
- exact one-hour cooldown after decline
- sender and network abuse buckets
- deterministic two-account locking for create, cancel, decline, future accept, and block-sensitive paths
- request-create idempotency for lost-response retries, with relationship date included in the fingerprint
- database same-direction pending uniqueness
- exact logical expiry independent of worker timing
- F2 durable expiry scheduling
- either-direction block enforcement
- direct API re-evaluation of both accounts
- snapshot-bound active-request pagination with future-snapshot rejection

Verification:

- same-direction, same-idempotency-key, opposite-direction, cancel/accept, and decline/accept concurrency tests
- exact time-boundary tests
- block and cooldown bypass tests
- create versus account deletion race
- future create versus partnership formation and block-creation races

### T09: Double partnership caused by concurrent requests

Impact: Critical

Controls:

- database-enforced one-slot invariant
- deterministic two-account locking
- transactional partnership creation in the same authoritative request transaction for reciprocal pairing
- accepted-request linkage for lost-response replay
- restrictive accepted-request partnership foreign key
- re-check state after locks are acquired

Verification:

- PostgreSQL race tests
- concurrent acceptance tests
- explicit-accept versus reciprocal-create race
- complete P1 suite rerun with the real P2 coordinator in paired mode

### T10: Cooldown bypass through direct API calls

Impact: High

Controls:

- server-authoritative cooldown
- database state
- centralized capability engine
- trusted server time

Verification:

- direct API bypass tests
- boundary-time tests

### T11: Breakup race creates incorrect restoration or dissolution

Impact: Critical

Controls:

- transactional state machine
- generation values
- expected-generation worker guard
- irreversible restore timestamps
- authoritative persisted deadline

Verification:

- restore versus finalizer race tests
- duplicate restore tests
- exact deadline tests

### T12: Stale worker dissolves a restored partnership

Impact: Critical

Controls:

- expected generation on lifecycle jobs
- current-state re-check inside the authoritative transaction
- idempotent handlers
- stale job rejection
- claim-version fencing for durable acknowledgements

Verification:

- stale-generation regression tests
- reclaimed-job stale-acknowledgement tests

### T12A: Worker crash strands durable work or causes concurrent stale execution

Impact: High to Critical depending work type

Controls:

- recoverable claim leases
- normal claim query reclaims expired processing rows
- monotonically increasing claim-version fencing
- lease renewal checks ownership and claim version
- bounded worker concurrency
- idempotent handlers
- polling remains the correctness path

Verification:

- crash-after-claim tests
- expired-lease reclaim tests
- stale-worker acknowledgement rejection
- lease-renewal ownership tests

### T12B: Durable payload version mismatch causes unsafe worker interpretation

Impact: High

Controls:

- explicit payload version on scheduled actions and outbox events
- dispatch by work type and payload version
- unknown versions fail closed
- rollout compatibility planning

Verification:

- old-worker/new-payload compatibility tests
- unsupported payload-version regression tests

### T13: Account-deletion timer overrides earlier breakup deadline

Impact: High

Controls:

- original breakup deadline remains authoritative
- earliest valid destructive partnership deadline wins
- separate account-deletion lifecycle
- domain and worker checks

Verification:

- existing domain collision tests
- worker integration tests

### T14: Deleted account owner retains access during recovery period

Impact: Critical

Controls:

- immediate session revocation
- account status enforcement
- capability denial
- special recovery endpoint only

Verification:

- deletion-access tests
- session-revocation tests

### T15: Remaining partner creates new data during partner account deletion recovery

Impact: High

Controls:

- view-only effective interaction mode
- centralized capability engine
- API enforcement

Verification:

- capability tests
- API integration tests

### T16: Former partner retains WebSocket or push authorization

Impact: High

Controls:

- partnership-state refresh
- channel removal
- push-routing invalidation
- final-dissolution outbox event

Verification:

- realtime dissolution tests
- revoked-channel tests

### T16A: Client misses an edit, deletion, or reaction to an old message

Impact: High

Controls:

- immutable server sequence is used only for message creation order
- separate durable per-conversation change sequence covers send/edit/delete/reaction mutations
- append-only content-free change rows
- WebSocket delivery remains an invalidation hint rather than the source of truth
- reconnect and polling repair from the canonical HTTP change cursor

Verification:

- edit-old-message after-cursor tests
- delete-old-message after-cursor tests
- reaction-change after-cursor tests
- duplicate delivery and cursor-resume tests

### T17: Local cache leaks old partnership data into a future partnership

Impact: Critical

Controls:

- IndexedDB partitioning by account, partnership, conversation, and crypto epoch
- namespace purge on dissolution
- no reuse of old crypto context
- reconnect purge for devices that were offline

Verification:

- offline namespace isolation tests
- future-partnership local-cache tests

### T17A: New partner learns presence activity from before the current partnership

Impact: Medium to High

Controls:

- presence disclosure requires current partnership authorization
- current-conversation projection suppresses `last_seen_at` older than the partnership `activated_at`
- no presence history table
- final account deletion removes the current presence snapshot

Verification:

- new-partnership pre-activation presence suppression test
- former-partner presence denial test

### T18: Stolen device continues receiving new encrypted content after revocation

Impact: Critical

Controls:

- first-class device records
- session revocation
- cryptographic authorization revocation
- key rotation or epoch transition where required
- no future key delivery to revoked device

Verification:

- device revocation E2EE tests
- revoked-session tests

### T19: Database compromise reveals protected plaintext

Impact: Critical

Controls:

- E2EE message and relationship content
- client-side media encryption
- no client private keys in PostgreSQL
- minimal metadata
- no plaintext content logs

Verification:

- data classification review
- database fixture inspection
- E2EE integration tests

### T19A: Durable private-content fingerprint becomes an offline guessing oracle

Impact: High

Controls:

- private message/reaction/nickname mismatch fingerprints use a server-held keyed construction
- domain-separated/versioned keys
- no ordinary unkeyed digest of private message content
- fingerprints are never logged or returned to clients
- bounded idempotency retention

Verification:

- fingerprint construction tests
- persistence/log scans proving raw content and ordinary message digests are absent

### T20: Object-storage compromise reveals media plaintext

Impact: Critical

Controls:

- encrypt media before upload
- random object identifiers
- private bucket
- signed short-lived access
- encrypted metadata where practical

Verification:

- storage-object inspection
- wrong-key decryption tests
- signed-access authorization tests

### T21: Push provider sees private content

Impact: High

Controls:

- opaque push payloads where practical
- client-side detailed notification rendering after fetch and decrypt
- no private message or relationship plaintext in provider payloads

Verification:

- push payload fixture review
- integration tests

### T22: TURN abuse causes cost or availability damage

Impact: High

Controls:

- short-lived TURN credentials
- authenticated issuance
- call capability checks
- rate limits
- credential expiry

Verification:

- expired TURN credential tests
- unauthorized issuance tests
- load monitoring

### T23: Direct WebRTC exposes peer IP address

Impact: High for privacy

Controls:

- relay-first TURN policy
- document any fallback that permits direct connectivity
- do not claim IP anonymity if direct mode exists

Verification:

- physical-device call test
- ICE candidate inspection where practical

### T24: Network observer infers relationship activity from metadata

Impact: Medium to High

Controls:

- encrypted transport
- metadata minimization
- minimal push payloads
- relay-first calls

Residual risk:

Traffic timing, volume, destination, and IP metadata cannot be fully hidden by the initial architecture.

### T25: Deletion partially fails across systems

Impact: Critical

Controls:

- durable deletion manifest
- target-level status
- immediate authorization revocation
- idempotent cleanup
- retry with backoff
- recoverable target leases
- claim-version fencing
- incomplete-manifest alerting

Verification:

- injected storage failure tests
- worker restart tests
- manifest resume tests

### T26: Backup restore resurrects deleted content

Impact: Critical

Controls:

- backup-retention policy
- deletion timestamp and backup-expiration tracking
- replay deletion state before restored service becomes user-accessible
- no normal access to deleted content

Verification:

- disaster-recovery procedure test before public launch

### T27: Logs expose private content or secrets

Impact: Critical

Controls:

- explicit no-content logging rule
- structured logging allowlist
- redaction
- bounded security-event retention

Verification:

- log fixture review
- tests that sensitive fields are not serialized to logs

### T28: Malicious operator reads content

Impact: Critical

Controls:

- E2EE
- client-side media encryption
- minimal server plaintext
- limited production access
- audit of administrative actions where practical

Residual risk:

Operators may still observe operational metadata and infrastructure-level network information.

### T29: Username discovery and partner requests enable harassment

Impact: Medium to High

Controls:

- exact or normalized username search
- request rate limits
- three requests per rolling month to same recipient
- one-hour cooldown after decline
- blocking after final dissolution
- reporting workflow before broad launch

Verification:

- abuse-rule tests
- rate-limit tests

### T30: Public profile leaks more age information than intended

Impact: Medium

Controls:

- expose derived current age only
- never expose exact date of birth
- avoid email or partnership-history exposure

Verification:

- search-result contract tests

### T31: Unsafe encrypted attachment harms recipient device

Impact: Medium to High

Controls:

- client-side file validation
- size limits
- safe download behavior
- content-disposition controls
- dangerous-file warnings where appropriate

Constraint:

The server cannot reliably malware-scan plaintext that it cannot decrypt.

### T32: User assumes deletion removes external copies held by partner

Impact: Medium

Controls:

- truthful product language
- deletion removes Shawtie-controlled copies and access
- do not claim prevention of screenshots, exports, or external recordings

### T33: Old PWA or protocol version mutates data unsafely

Impact: High

Controls:

- explicit client version
- API version
- crypto protocol version
- local schema version
- minimum supported client policy
- fail closed on unknown critical versions

Verification:

- compatibility tests
- forced-upgrade tests

### T34: Service worker serves incompatible or compromised cached code

Impact: High

Controls:

- controlled service-worker update strategy
- version checks
- integrity-conscious deployment
- fail closed on unsafe incompatibility

Verification:

- interrupted update tests
- stale-client tests

### T35: Call-recording consent bypass after deferred post-stable implementation

Impact: Critical

Controls:

- recording not part of MVP
- fresh explicit consent from both participants for every recording session
- visible recording indicator
- partnership-scoped encrypted storage
- final-dissolution deletion

Verification:

- mandatory security review before feature release

## Abuse and coercion limitations

The service can enforce technical consent for partner formation, calls, restoration actions, and future recording features.

It cannot determine whether a person was coerced outside the application.

The product must not describe technical button consent as proof of freely given real-world consent.

## Endpoint compromise limitations

The security model cannot guarantee confidentiality against:

- a fully compromised operating system
- a malicious browser extension with page access
- screen capture outside the application
- an authorized partner deliberately copying content

Security claims must remain scoped to what the architecture can actually enforce.

## Privacy limitations

E2EE protects content, not all metadata.

Depending on final implementation, infrastructure may still observe:

- account existence
- device identifiers
- partnership routing identifiers
- timestamps
- traffic volume
- ciphertext size
- online or synchronization activity
- IP addresses at infrastructure boundaries
- call signaling state
- TURN connection metadata

Metadata retention must be minimized and documented.

## Required pre-stable-release security evidence

Before stable release, the project must have evidence for:

- cross-partnership authorization isolation
- database partnership uniqueness
- lifecycle race safety
- stale-job rejection
- account deletion lockout
- deletion manifest recovery
- device revocation
- account versus cryptographic recovery separation
- E2EE test vectors and protocol review
- encrypted media storage
- private object authorization
- push metadata minimization
- TURN credential expiry
- browser CSP and trusted-origin restrictions
- dependency and secret scanning
- backup deletion behavior
- physical-device call privacy checks
- security regression suite
- durable messaging mutation-cursor recovery
- private mutation keyed-fingerprint verification
- current-partnership presence privacy

## Review triggers

Re-run or update the threat model when any of the following occurs:

- E2EE protocol is selected or changed
- native mobile client is introduced
- SFU or another call-media architecture is introduced
- third-party analytics is proposed
- public profile scope expands
- group communication is proposed
- server-side searchable content is proposed
- moderation design requires content access
- backup provider or retention policy changes
- account recovery changes
- cryptographic recovery changes
- deferred post-stable call recording enters implementation
- major infrastructure provider changes
