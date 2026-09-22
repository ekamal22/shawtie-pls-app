# E2EE Architecture

## Status

Architecture boundary accepted. Exact protocol and library selection remains an implementation decision that requires dedicated review.

## Non-negotiable rule

Do not invent a custom cryptographic protocol.

Use a reviewed, maintained protocol or construction with an implementation appropriate to the supported browser environment.

## Separation of identities

Application authentication and cryptographic identity are separate concepts.

An account may have multiple authorized devices.

Each device should have its own cryptographic identity material.

Logical model:

```text
account
  device A
    device identity keys
    session state
  device B
    device identity keys
    session state
```

Private key material must never be stored in PostgreSQL in plaintext.

## Authentication recovery is not key recovery

Verified-email account recovery must not automatically reveal historical encrypted content.

Account access and cryptographic history recovery are separate.

Historical key recovery requires:

- an already trusted device, or
- client-encrypted recovery material protected by a high-entropy recovery secret, or
- another reviewed cryptographic recovery design

The server must not possess the secret required to decrypt client recovery material.

## Partnership cryptographic boundary

Every partnership receives a new cryptographic context.

A later partnership between the same two accounts must still use new partnership cryptographic state.

Each partnership also has an explicit cryptographic epoch.

The epoch supports reviewed key rotation, device revocation, and protocol migration within the same partnership.

P2 uses the fresh immutable partnership ID itself as the namespace identifier before S1 cryptography is implemented. The partnership ID is not a key, does not prove encryption exists, and must not be used as authentication authority. S1 later binds reviewed cryptographic state to that partnership namespace.

P2 does not create a second security namespace identifier and must not insert a fake cryptographic epoch merely to satisfy namespace creation. Real `partnership_crypto_epochs` begin only when the reviewed S1 protocol provisions actual cryptographic state.

A new partnership always starts from a new cryptographic root and must never inherit:

- old message keys
- old attachment keys
- old relationship-object keys
- old local decryption state
- old notification encryption state
- old call-recording keys
- old crypto epochs as active key material

## Package boundary

`packages/crypto` exposes high-level operations such as:

```text
encryptMessage
decryptMessage
encryptAttachment
decryptAttachment
encryptRelationshipObject
decryptRelationshipObject
rotateSession
destroyPartnershipState
```

The rest of the application should not manipulate low-level nonces, ratchets, or key schedules directly.

## Protected content

The server must not receive plaintext for:

- message bodies
- image contents
- video contents
- file contents
- voice-message contents
- relationship-object contents
- For You letters
- Future Us contents
- memory captions and private notes
- call media
- deferred post-stable call recordings, if ever implemented

## R1 preview and sealed-content handoff

R1 defines two protected relationship-content roles:

- preview content that may be visible before release
- sealed main content that must remain unavailable to the intended recipient until release

S1 must preserve this distinction cryptographically and at the API projection boundary.

Requirements:

- preview and main content are encrypted separately when both exist
- the reviewed protocol authenticates item ID, partnership ID, item kind, content schema version, and payload role
- preview ciphertext cannot be substituted for main ciphertext or vice versa
- the server may return preview ciphertext before release
- the server must withhold sealed main ciphertext from the intended recipient before release
- creator-authorized reads may receive both while product state allows editing
- release state is server-authoritative metadata and does not require the server to decrypt either envelope
- final dissolution destroys relationship-object cryptographic access along with normal P3 deletion
- S1 migration either client-reencrypts or wipes all pre-S1 development preview/main plaintext

## Metadata minimization

Some server-visible metadata is operationally necessary.

Potentially visible metadata includes:

- account and device routing IDs
- opaque partnership and conversation IDs
- server receipt time
- delivery state
- synchronization sequence
- ciphertext size
- encrypted-object identifier
- object size
- push token and routing state
- presence and typing routing state
- call signaling state
- bounded security metadata

Descriptive metadata should be encrypted when practical.

Examples:

- filenames
- captions
- attachment descriptions
- relationship text
- reaction content where the protocol and product model allow it

Do not claim that E2EE hides all metadata.

## Attachment encryption

Recommended flow:

```text
select file
validate locally
resize or compress when appropriate
generate random media key
encrypt locally
upload ciphertext
send encrypted descriptor through conversation
```

The object store receives ciphertext and a random object key.

The encrypted descriptor carries decryption material through the E2EE channel.

## Device storage

Use browser-supported secure primitives and IndexedDB for persisted encrypted state.

Prefer non-exportable WebCrypto key material where it fits the selected protocol and recovery design.

The threat model must recognize that a compromised browser origin can access decrypted application state.

## Device revocation

A device record is a first-class security principal.

Revocation must:

- revoke authentication sessions
- stop future partnership key delivery
- revoke cryptographic authorization
- trigger required rotation or epoch transition according to the reviewed protocol

## Device enrollment

New-device enrollment must not be implemented by simply downloading plaintext private keys from the server.

Acceptable future patterns include:

- approval from an existing trusted device
- client-encrypted key backup protected by a high-entropy recovery secret

## Recovery

Plan for encrypted key backup so device loss does not necessarily destroy years of content.

The server may store encrypted recovery material but must not possess the recovery secret required to decrypt it.

## Deletion

At final dissolution:

- delete partnership cryptographic state locally
- delete decryptable server-held encrypted key envelopes where applicable
- invalidate device authorization for that partnership
- delete encrypted media objects
- delete ciphertext message and relationship data according to product deletion rules

Cryptographic erasure complements storage deletion. It does not replace required data deletion.

## Push metadata

Push services should receive opaque routing data whenever practical.

Protected message plaintext, media plaintext, relationship content, and cryptographic keys must not be placed in provider push payloads.

Detailed previews should be produced client-side after authenticated fetch and decryption where platform capabilities permit.

## Protocol versioning

Encrypted envelopes identify their crypto protocol version.

Unknown protocol versions fail closed.

Protocol migration must define read compatibility, write compatibility, device upgrade ordering, recovery, and rollback limits.

## Calls

Use WebRTC with end-to-end protected media appropriate to the chosen topology.

TURN relays may observe connection metadata but must not receive plaintext audio or video.

If an SFU is introduced later, the E2EE design must be reviewed again.

## Protocol review gate

Before implementation of stable-release E2EE, document:

- selected protocol
- selected library
- browser support
- device model
- prekey or session setup
- multi-device behavior
- crypto epoch model
- device revocation behavior
- key rotation
- recovery
- backup
- attachment encryption
- partnership termination
- account deletion
- migration from pre-E2EE development data
- test vectors
- failure behavior

Stable release must not proceed on an improvised or partially reviewed cryptographic design.
