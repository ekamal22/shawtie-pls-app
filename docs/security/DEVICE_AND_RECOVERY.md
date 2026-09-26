# Device and Recovery Architecture

## Purpose

Account authentication recovery and cryptographic content recovery are separate security problems.

Recovering an account through verified email must not automatically grant access to historical protected plaintext.

Canonical S1 design:

`../architecture/S1_E2EE_CRYPTO_RECOVERY_DESIGN.md`

Implementation status: S1 device trust, recovery setup/proof, HPKE recovery capsules, device revocation/rekey, and recovery-authorized group reset are implemented in source on `feat/s1-e2ee-crypto-recovery` at `c85fdb1`. Executed S1-J closure and physical-device evidence remain pending.

## Account recovery

Account recovery restores Shawtie account access.

It may restore:

- account identity
- profile access
- server-authorized session
- server-visible metadata allowed by policy
- access to device and recovery controls

It does not automatically restore historical protected-content keys.

After email-only recovery, protected history may remain in `CRYPTO_RECOVERY_REQUIRED` or `CRYPTO_HISTORY_UNAVAILABLE` state.

## Device model

Every authorized client device has a durable A1 device record and, after S1 enrollment, a separate cryptographic identity.

Representative S1 fields include:

```text
device_id
crypto_device_id
crypto_protocol_version
mls_credential_public_data
content_signing_public_key
trust_state
revoked_at
```

Private device keys remain client-side only.

A valid A1 session does not by itself prove cryptographic trust.

## Trusted-device enrollment

A new device:

1. authenticates through A1
2. generates a new local crypto identity
3. proves possession of the generated public keys
4. publishes bounded MLS KeyPackage inventory
5. remains crypto-untrusted
6. receives approval from an existing trusted device, or proves authorized recovery possession
7. joins current partnership MLS groups
8. becomes trusted only after the cryptographic state transition succeeds

An existing trusted device may approve enrollment with its device signing authority.

Device identity keys are never copied from one device to another.

## Recovery Master Secret

S1 uses a high-entropy Recovery Master Secret generated on an authorized client.

The Recovery Master Secret:

- is random and high entropy
- is never derived from email, password, or verification codes
- is never uploaded to the server
- is never logged or placed in telemetry
- protects the encrypted account recovery bundle

The server stores only the encrypted recovery bundle and public recovery material.

## Recovery bundle

The encrypted recovery bundle contains the account recovery private material and protocol metadata required to restore access to historical recovery capsules.

It does not contain ordinary device identity private keys for every device.

A user may possess the same account recovery capability on multiple trusted devices, but each device still has independent runtime identity and MLS state.

## Historical recovery capsules

Each protected content key receives a per-account recovery capsule encrypted to the account recovery public key.

The server can store the capsule but cannot decrypt it.

After valid Recovery Master Secret restoration, the client can recover the private recovery key and decrypt authorized historical content keys.

This avoids retaining old MLS epoch secrets solely for historical recovery.

## Trusted-device restoration

If an existing trusted device remains available, it may authorize the new device and transfer the account recovery capability or a bounded historical-key bundle through an end-to-end protected transfer.

The transfer must bind:

- source trusted device
- destination crypto-device identity
- account
- protocol version
- one-time enrollment transaction

A lost response must not authorize a second unrelated destination.

## Recovery-secret restoration

A recovery-secret flow is:

1. authenticate the account
2. download encrypted recovery material
3. decrypt locally using the Recovery Master Secret
4. prove possession of the recovery authorization key
5. establish the new independent device identity as recovery-authorized
6. restore authorized historical content keys from recovery capsules
7. rejoin the current MLS group or trigger a reviewed group-generation reset if current group state cannot be recovered

The Recovery Master Secret never crosses the network.

## Device revocation

Revoking a device must:

- revoke its A1 sessions
- mark its crypto identity revoked
- reject unused KeyPackages
- prevent new content-key delivery
- require removal from active MLS groups
- advance affected MLS epochs
- block new protected writes while required rekeying is incomplete

Revocation prevents future protected access after rotation.

It does not remotely erase plaintext or keys already copied from the revoked device.

## Lost device behavior

A user with another trusted device or the Recovery Master Secret should be able to:

1. authenticate
2. inspect the authorized device list
3. revoke the lost device
4. complete required MLS removal/rotation
5. verify that the lost device cannot decrypt new protected content
6. continue using recoverable historical content

A user with email access only may recover the account but not the protected history.

## Group-state loss

If current MLS group state is irrecoverable but the user has valid historical recovery material, the partnership may create a new cryptographic group generation.

The partnership ID remains unchanged.

Historical objects continue using their existing content keys and recovery capsules.

Future content uses the new group generation.

## Account takeover limitation

Email compromise may permit account recovery attempts.

Email recovery alone must not:

- mark a new device crypto-trusted
- recover the Recovery Master Secret
- decrypt the recovery bundle
- decrypt historical recovery capsules
- silently create an authorized replacement MLS identity

## Recovery UX boundary

UX8 must distinguish:

- account recovered
- device authenticated
- device cryptographically trusted
- encrypted history recovered
- encrypted history unavailable
- rekey required

The product must not say that all history is restored until cryptographic recovery succeeds.

## Deletion

Permanent account deletion destroys:

- device cryptographic authorization
- server-held encrypted recovery bundle
- recovery public state
- account recovery capsules
- current partnership crypto membership
- local recovery state on clients that observe deletion

Partnership final dissolution destroys partnership-scoped recovery capsules and protected content through P3 deletion.

## Security limitation

Possession of a valid Recovery Master Secret plus retained server ciphertext and recovery capsules may expose the user's recoverable historical content.

That tradeoff is intentional and must be documented. Recoverable history must not be marketed as having unlimited forward secrecy.
