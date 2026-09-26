# E2EE Architecture

## Status

S1 architecture profile selected. Runtime implementation is not yet complete.

The selected protocol family is RFC 9420 Messaging Layer Security, interpreted using the application architecture in RFC 9750.

OpenMLS compiled to WebAssembly is the implementation baseline for the PWA. S1-A must pin the exact OpenMLS release, source revision, cryptography provider, build flags, and transitive dependency set after security review.

Canonical implementation design:

`../architecture/S1_E2EE_CRYPTO_RECOVERY_DESIGN.md`

## Non-negotiable rules

- do not invent a custom cryptographic protocol
- protected plaintext exists only on authorized clients after S1 activation
- device authentication and device cryptographic trust are distinct
- account recovery and historical cryptographic recovery are distinct
- a new partnership always receives unrelated cryptographic state
- unknown crypto versions fail closed
- there is no plaintext fallback after crypto-required activation

## Protocol profile

S1 uses RFC 9420 MLS for live group key agreement and membership security.

Initial ciphersuite:

`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`

Experimental MLS extensions are not required for first stable release.

Long-lived Shawtie content is encrypted with fresh per-content-version keys rather than retaining old MLS epoch secrets for history.

The default durable-content construction is:

- random 256-bit content key
- AES-256-GCM
- fresh 96-bit nonce
- canonical authenticated context
- device signature over canonical metadata and ciphertext digest

Recovery capsules use RFC 9180 HPKE or an equivalently reviewed profile pinned in S1-A.

## Separation of identities

Each A1 device has independent cryptographic identity material.

Representative logical model:

```text
account
  device A
    MLS identity
    content-signing identity
    local MLS state
  device B
    independent MLS identity
    independent content-signing identity
    independent local MLS state
```

Private device keys must never be stored in PostgreSQL in plaintext.

A server-authenticated device is not automatically a trusted crypto device.

## Partnership cryptographic boundary

Every partnership receives a fresh MLS group.

The partnership ID is an application namespace, not a key.

S1 distinguishes:

- group generation: a complete MLS group instance inside one partnership
- MLS epoch: normal protocol evolution inside one group generation

Normal add/remove/update operations advance the MLS epoch.

A complete group-generation reset is reserved for catastrophic state recovery, incompatible protocol migration, or another explicitly reviewed reset.

A later partnership between the same two accounts must not inherit any old:

- MLS state
- message content keys
- relationship-object content keys
- media content keys
- recovery capsules
- local decryption cache
- notification key state

## Protected content envelope

The `@shawtie/crypto` package owns canonical serialization and envelope processing.

Authenticated context binds at least:

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

Ciphertext substitution across any of these contexts must fail.

## Durable content keys

Each protected content version receives a fresh random content key.

The content key is distributed to current authorized devices inside an MLS-protected application message.

For historical recovery, the same content key receives encrypted per-account recovery capsules. The server cannot decrypt those capsules.

This design deliberately separates live MLS state from long-lived recoverable history.

## Recovery security limitation

Recoverable history and destruction of every historical decryption path are competing goals.

S1 may claim protocol forward secrecy and post-compromise security for live MLS state according to the selected profile.

S1 must not claim unlimited forward secrecy for retained historical content that remains recoverable through the user's Recovery Master Secret.

## R1 preview and sealed-content handoff

R1 preview and sealed main content use separate content keys and distinct authenticated roles.

The intended recipient may receive preview ciphertext when R1 authorizes it.

Before release, the intended recipient must not receive:

- sealed main ciphertext
- the sealed main content key
- an MLS distribution carrying that key
- a recovery path made available through normal recipient reads

The server may retain the authoritative release timestamp required for R1 workers.

## Metadata minimization

Operational metadata may remain server visible when required for routing, ordering, authorization, lifecycle, or recovery control.

Examples include:

- account and device routing IDs
- partnership and conversation IDs
- server receipt time
- immutable message server sequence
- durable change sequence
- delivery and read receipt state
- ciphertext size
- object size
- crypto profile
- group generation
- MLS epoch
- control sequence
- push routing state
- presence and typing routing state
- call signaling metadata

Encrypt descriptive metadata when practical, including:

- filenames
- captions
- attachment descriptions
- reaction values
- chat nicknames
- relationship text
- private notes

Do not claim that E2EE hides all metadata.

## Attachment encryption

The M3 production path is:

```text
select media
  -> validate and preprocess locally
  -> generate random media content key
  -> encrypt locally
  -> upload ciphertext
  -> distribute key through S1 protected-content path
```

Object storage receives ciphertext and opaque object keys.

## Device storage

Persist encrypted/wrapped S1 state in a dedicated versioned IndexedDB crypto namespace.

Prefer non-exportable WebCrypto wrapping keys where browser capabilities permit.

Hostile JavaScript executing in the trusted application origin may still access decrypted state. Browser hardening remains part of the E2EE security boundary.

## Device revocation

Revocation must:

- revoke authentication sessions
- mark the crypto identity revoked
- invalidate unused KeyPackages
- prevent future protected-key delivery
- remove the device from active MLS groups
- advance the MLS epoch
- block protected writes while required rekeying is unresolved

Revocation cannot erase plaintext already copied from an endpoint.

## Device enrollment

A new device must generate its own cryptographic identity.

It becomes cryptographically trusted only after:

- approval from an existing trusted device, or
- proof using authorized recovery material

New-device enrollment must never download plaintext private device keys from the server.

## Recovery

The server may store:

- recovery public keys
- encrypted recovery bundle
- encrypted per-content recovery capsules
- recovery protocol metadata

The server must never possess:

- the Recovery Master Secret
- unencrypted private recovery keys
- protected content keys in plaintext

Email-only account recovery does not restore historical E2EE content.

## Deletion

Final dissolution and permanent account deletion must integrate:

- synchronous authorization revocation
- local MLS/group-state purge
- local content-key purge
- recovery-capsule deletion
- server crypto-control deletion according to retention policy
- message and R1 ciphertext deletion
- encrypted media deletion
- existing P3 physical deletion manifests

Cryptographic erasure complements storage deletion. It does not replace required physical deletion.

## Push metadata

Push payloads remain content-free.

Protected plaintext, content keys, MLS secrets, recovery material, and detailed relationship content must never be placed in push-provider payloads.

## Protocol versioning

Every protected envelope identifies its crypto profile.

Unknown versions fail closed.

Version migration must define:

- read compatibility
- write compatibility
- client upgrade ordering
- group-generation behavior
- recovery behavior
- rollback limitations
- plaintext-retirement rules

## Calls

C1 and C2 retain the verified relay-only WebRTC architecture.

S1 does not add a second call-media encryption system.

Any future SFU or server-side media-processing design requires a new security review.

## S1 review gate

Before S1 implementation leaves S1-A, record:

- exact OpenMLS release and source revision
- exact crypto provider
- exact build features
- ciphersuite
- recovery HPKE profile
- canonical serialization
- device enrollment proofs
- MLS control-stream semantics
- epoch conflict behavior
- group-generation reset behavior
- local-state persistence and locking
- migration/wipe treatment for pre-S1 plaintext
- official protocol vectors
- current security advisories and transitive dependency review
