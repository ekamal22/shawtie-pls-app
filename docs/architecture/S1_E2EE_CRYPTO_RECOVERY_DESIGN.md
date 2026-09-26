# S1 E2EE and Cryptographic Recovery Design

## Status

Implementation-ready architecture design.

S1 runtime implementation has not started. The selected protocol family is Messaging Layer Security as specified by RFC 9420 and the MLS architecture in RFC 9750. OpenMLS compiled to WebAssembly is the implementation baseline for the PWA. The exact OpenMLS release, cryptography provider, build flags, and transitive dependency set must be pinned and reviewed in S1-A before production code is accepted.

S1 must not invent a custom cryptographic protocol.

## Goals

S1 adds end-to-end protection without replacing the product authority already proven by A1, P3, M1, R1, M2, M3, C1, or C2.

The design must provide:

- independent cryptographic identity for every authorized device
- fresh cryptographic state for every partnership
- MLS epoch transitions for membership and security rotation
- encrypted M1 messages, reactions, and chat nicknames
- encrypted R1 relationship content with separate preview and sealed roles
- client-side encrypted M3 media and descriptors
- trusted-device enrollment
- cryptographic device revocation
- high-entropy cryptographic recovery independent from email recovery
- metadata minimization
- protocol versioning
- cryptographic erasure integrated with P3 physical deletion
- physical Android acceptance before S1 can close

## Protocol profile

### Messaging layer

Use RFC 9420 MLS with the RFC 9750 application architecture.

Initial ciphersuite profile:

`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`

OpenMLS is the implementation baseline because it implements RFC 9420 and supports WebAssembly builds through its JavaScript/WASM configuration.

The exact OpenMLS release and crypto provider are an S1-A security-freeze decision. Experimental MLS extensions are not required for the first stable release.

### Durable protected content

MLS is the live group-security layer. Long-lived Shawtie objects use independent content-encryption keys so recoverable history does not require retention of old MLS secrets.

For every protected content version:

- generate a fresh random 256-bit content-encryption key
- encrypt the payload with AES-256-GCM
- use a fresh 96-bit nonce
- authenticate the canonical envelope context as AAD
- never reuse a content key across versions or unrelated objects

The content key is delivered to current authorized devices through an MLS-protected key-distribution application message.

### Recovery capsules

Recoverable historical content uses client-generated recovery material. A high-entropy Recovery Master Secret never reaches the server.

The account owns recovery public keys. The corresponding private recovery material is encrypted locally under a key derived from the Recovery Master Secret.

Each protected content key also receives a per-account recovery capsule using RFC 9180 HPKE or an equivalently reviewed HPKE implementation profile frozen in S1-A.

The server stores only encrypted recovery bundles and encrypted recovery capsules.

## Device model

An application account may have multiple authorized devices. Every crypto-capable device has independent key material.

A device owns:

- immutable A1 device identity
- S1 crypto-device identity
- MLS credential and signing material
- content-signing key
- MLS KeyPackages
- local MLS group state
- local wrapped content-key cache
- local control-stream cursor

Private device keys never exist in PostgreSQL in plaintext.

A logged-in device is not automatically a cryptographically trusted device.

## Partnership model

Every partnership receives a fresh MLS group.

The application partnership ID remains the namespace root but is never a key or authentication proof.

Two separate counters are used:

- `group_generation`: a complete MLS group generation inside the partnership
- `mls_epoch`: normal MLS epoch advancement inside one group generation

Normal membership changes, device revocation, and security updates advance the MLS epoch.

A new group generation is reserved for catastrophic group-state recovery, incompatible protocol migration, or another explicitly reviewed reset case.

A later partnership between the same two accounts always gets unrelated MLS group state and cannot inherit historical keys from the previous partnership.

## Protected envelope

Every encrypted Shawtie payload uses canonical serialization owned by `@shawtie/crypto`.

The authenticated envelope context binds at least:

- crypto profile
- partnership ID
- group generation
- MLS epoch
- content type
- content ID
- content version
- payload role
- sender crypto-device ID
- content schema version

The sender signs the canonical envelope metadata and ciphertext digest with the device content-signing key.

Recipients verify:

1. device authorization
2. content signature
3. key-distribution authorization
4. authenticated envelope context
5. ciphertext integrity
6. payload schema after decryption

Moving ciphertext between partnerships, objects, versions, or payload roles must fail authentication.

## R1 preview and sealed content

R1 preview content and sealed main content are separate cryptographic payloads.

They use different content keys and distinct authenticated payload roles:

- `relationship_preview`
- `relationship_main`

Before release, the server may return preview ciphertext when R1 authorizes it. The intended recipient must not receive sealed main ciphertext or the associated key distribution before authoritative release.

The server may retain the authoritative unlock time required by R1 workers without decrypting either payload.

## M1 integration

M1 retains ownership of:

- message IDs
- immutable message server sequence
- durable change sequence
- reply topology
- edit windows
- content versions
- delete tombstones
- reactions as domain objects
- delivery and read receipts
- authorization

S1 changes protected representation only.

Message edits generate a fresh content key and ciphertext for the new content version.

Reaction values and partnership chat nicknames become protected payloads. The server may retain only the structural metadata required to enforce authorization and lifecycle behavior.

## M2 integration

Encryption happens before an outbound operation enters the M2 durable browser outbox.

A retry replays identical encrypted request bytes. It must not regenerate:

- content key
- nonce
- MLS key-distribution payload
- content signature

MLS state mutation and frozen outbound operation persistence must be committed atomically in IndexedDB before network transmission.

Only one browser context may mutate one device's MLS group state at a time. Use an exclusive Web Locks lock keyed by partnership and crypto-device identity.

The service worker may replay a previously frozen encrypted operation but must not independently advance MLS group state.

## M3 integration

M3 keeps its media lifecycle and storage authority.

The production flow is:

1. validate and preprocess media locally
2. generate a random media content key
3. encrypt locally
4. upload ciphertext only
5. distribute the content key through the S1 protected-content path
6. keep filenames, captions, and descriptive metadata encrypted where practical

Object storage receives opaque object keys and ciphertext only.

The existing test-only crypto adapter must be impossible to enable in production once S1 closes.

## Calls

S1 does not redesign C1 or C2.

The existing one-to-one WebRTC call substrate uses endpoint media protection and relay-only TURN. TURN relays may observe connection metadata but do not terminate protected audio/video.

Any future SFU or server-side media-processing architecture requires a new security review.

## Device enrollment

Normal new-device enrollment:

1. authenticate through A1
2. generate new local device cryptographic identity
3. publish public identity and bounded KeyPackage inventory
4. remain `crypto_untrusted`
5. receive approval signed by an existing trusted device, or prove possession of authorized recovery material
6. add the new device to current partnership MLS groups
7. deliver Welcome/control data
8. mark the device cryptographically trusted only after proof and state installation succeed

The server must never distribute plaintext private device keys.

## Device revocation

A1 device revocation and S1 cryptographic revocation are one logical security operation.

Revocation must:

- revoke authentication sessions
- mark the crypto identity revoked
- invalidate unused KeyPackages
- block new protected-key delivery
- require removal from active MLS groups
- advance the affected MLS epoch
- fail closed for new protected writes while a required removal commit is unresolved

A revoked device may retain plaintext or keys it already extracted. Shawtie must not claim remote erasure of data already copied by a compromised endpoint.

## Recovery

Account recovery and cryptographic recovery remain separate.

Email-only recovery may restore:

- account identity
- profile access
- server-visible metadata allowed by policy
- device-management access

Email-only recovery must not restore protected historical plaintext.

### Recovery Master Secret

Generate a high-entropy random Recovery Master Secret on an authorized client.

The secret:

- is client generated
- is never uploaded
- is never logged
- is not derived from email, password, or verification codes
- is used locally to derive a recovery-bundle encryption key

The encrypted recovery bundle contains only the private recovery material required for cryptographic restoration and protocol metadata.

### Trusted-device restoration

An existing trusted device may authorize a new device and transfer the account recovery capability or selected historical key material through an end-to-end protected transfer. Device identity keys remain independent.

### Recovery-secret restoration

A recovered client:

1. authenticates normally
2. downloads the encrypted recovery bundle
3. decrypts it locally with the Recovery Master Secret
4. proves recovery-key possession to the server
5. becomes recovery-authorized
6. decrypts authorized historical recovery capsules
7. restores current MLS access or triggers a reviewed group-generation reset if current group state is unavailable

The server never learns the Recovery Master Secret.

## Recovery and forward secrecy tradeoff

Recoverable long-lived history and strict destruction of every historical key are competing properties.

S1 may claim MLS forward secrecy and post-compromise security for live group state according to the selected protocol profile.

It must not claim that retained recoverable historical ciphertext has unlimited forward secrecy. Compromise of a user's Recovery Master Secret plus retained recovery capsules may expose that user's recoverable history.

This limitation must be explicit in the security model and UX8 copy.

## Crypto control plane

The API acts as the MLS Delivery Service and application Authentication Service enforcement point without holding protected plaintext keys.

Persist an ordered partnership crypto-control stream for:

- KeyPackage publication and consumption
- proposals
- commits
- Welcome data
- group information required by clients
- device membership changes
- group-generation resets

Every state-changing control request carries expected group generation and expected MLS epoch.

The server accepts one authoritative transition. A stale competing transition fails with `CRYPTO_EPOCH_CONFLICT`.

## Local crypto vault

Use a dedicated versioned IndexedDB crypto namespace.

Persist:

- device crypto identity
- wrapped private state
- OpenMLS serialized group state
- group generation
- processed control cursor
- pending cryptographic operations
- recovered content-key cache
- recovery metadata

Prefer a non-exportable WebCrypto wrapping key where supported.

This does not protect against malicious JavaScript executing in the trusted Shawtie origin. Browser hardening remains part of the E2EE boundary.

## Database ownership

S1 reserves:

- `0019_s1_device_crypto_runtime.sql`
- `0020_s1_partnership_crypto_runtime.sql`
- `0021_s1_protected_content_runtime.sql`

### 0019

Owns device and recovery control-plane state such as:

- account recovery public roots
- device crypto identities
- device approval evidence
- device KeyPackages
- encrypted recovery bundles

It must contain no private device key and no Recovery Master Secret.

### 0020

Owns partnership MLS control-plane state such as:

- partnership crypto groups
- group generation
- current epoch
- crypto membership
- ordered control messages
- required rekey state

There is exactly one authoritative group for a partnership and group generation.

### 0021

Owns protected-content integration:

- encrypted M1 protected fields
- encrypted reactions and nicknames
- encrypted R1 preview/main payloads
- production M3 key-envelope integration
- protected-content key references
- per-account recovery capsules
- retirement constraints for pre-S1 plaintext

## API boundary

The dedicated S1 surface should remain narrow:

- `POST /crypto/devices/enroll`
- `POST /crypto/devices/:id/key-packages`
- `GET /crypto/partnerships/:id/state`
- `GET /crypto/partnerships/:id/control?after=<cursor>`
- `POST /crypto/partnerships/:id/bootstrap`
- `POST /crypto/partnerships/:id/commits`
- `POST /crypto/recovery/setup`
- `GET /crypto/recovery/bundle`
- `POST /crypto/recovery/challenge`
- `POST /crypto/recovery/prove`

Existing A1 revocation remains the user-facing device-revocation authority.

## Failure vocabulary

Stable S1 failures include:

- `CRYPTO_NOT_INITIALIZED`
- `CRYPTO_DEVICE_UNTRUSTED`
- `CRYPTO_KEY_PACKAGE_REQUIRED`
- `CRYPTO_GROUP_NOT_READY`
- `CRYPTO_GROUP_BOOTSTRAP_CONFLICT`
- `CRYPTO_EPOCH_CONFLICT`
- `CRYPTO_REKEY_REQUIRED`
- `CRYPTO_GROUP_RESET_REQUIRED`
- `CRYPTO_UNSUPPORTED_PROTOCOL`
- `CRYPTO_UNSUPPORTED_CIPHERSUITE`
- `CRYPTO_CIPHERTEXT_INVALID`
- `CRYPTO_SIGNATURE_INVALID`
- `CRYPTO_HISTORY_UNAVAILABLE`
- `CRYPTO_RECOVERY_REQUIRED`
- `CRYPTO_RECOVERY_FAILED`

There is no plaintext fallback error path.

## Pre-S1 plaintext retirement

Do not perform fake server-side E2EE migration.

For development-only protected plaintext, the preferred first-stable path is:

1. inventory legacy protected plaintext
2. generate a migration report
3. wipe or reseed synthetic/development protected content
4. activate crypto-required mode
5. enforce schema and API constraints that reject plaintext protected writes

If real user content exists before S1 activation, migration requires explicit authorized client-side re-encryption before legacy plaintext is deleted.

Once a partnership is crypto-required, protected plaintext writes fail closed.

## Implementation slices

### S1-A Protocol and security freeze

- pin exact OpenMLS release and source revision
- select reviewed crypto provider
- freeze ciphersuite and HPKE profile
- review current advisories and transitive dependencies
- freeze canonical serialization and envelope schemas
- freeze recovery and group-reset rules
- update threat model and data classification

### S1-B Crypto package and local vault

- OpenMLS WASM adapter
- canonical serialization
- device identity
- content signing
- local wrapping and crypto storage
- official protocol test vectors

### S1-C Device crypto runtime

- migration 0019
- enrollment API
- trusted-device state
- KeyPackage inventory
- recovery public roots

### S1-D Partnership crypto control plane

- migration 0020
- MLS bootstrap
- ordered control stream
- epoch CAS
- multi-device membership
- conflict handling

### S1-E M1 and M2 protected messaging

- migration 0021 message portions
- message encryption
- edit encryption
- reaction encryption
- nickname encryption
- frozen encrypted offline operations
- realtime canonical refetch compatibility

### S1-F R1 and M3 protected content

- R1 preview and sealed envelopes
- media production key envelopes
- encrypted descriptors
- release withholding
- object-store ciphertext verification

### S1-G Enrollment, revocation, and rekey

- trusted-device approval
- device removal
- fail-closed rekey-required state
- group-generation reset
- concurrency and stale-epoch coverage

### S1-H Cryptographic recovery

- Recovery Master Secret
- encrypted recovery bundle
- recovery possession proof
- HPKE recovery capsules
- trusted-device historical restoration
- email-only recovery separation

### S1-I Plaintext retirement

- legacy inventory
- development wipe/reseed or authorized client migration
- crypto-required cutoff
- test-only crypto removal from production paths

### S1-J Closure

- protocol vectors
- adversarial unit and integration suites
- PostgreSQL raw inspection
- object-storage raw inspection
- log/outbox/push plaintext scans
- browser E2E
- Xiaomi Redmi Note 9S physical acceptance
- final security review

## Closure gates

S1 is DONE only when:

- exact protocol/library/provider versions are reviewed and pinned
- no custom cryptographic protocol is introduced
- every trusted device has independent crypto identity
- every partnership has fresh unrelated crypto state
- epoch and group-generation transitions are race tested
- protected M1 and R1 plaintext is absent from server storage
- M3 object storage contains ciphertext only
- email-only account recovery cannot decrypt history
- trusted-device and Recovery Master Secret restoration pass
- revoked devices cannot decrypt future protected content after rotation
- a later partnership cannot decrypt a former partnership
- deletion combines cryptographic erasure with P3 physical cleanup
- unknown crypto versions fail closed
- official or reviewed protocol vectors pass
- raw PostgreSQL, object-storage, logs, outbox, and push inspection finds no protected plaintext
- browser closure passes
- physical Redmi Note 9S acceptance passes
- final security review passes

## References

- RFC 9420, The Messaging Layer Security Protocol
- RFC 9750, The Messaging Layer Security Architecture
- RFC 9180, Hybrid Public Key Encryption
- OpenMLS documentation and security advisories
