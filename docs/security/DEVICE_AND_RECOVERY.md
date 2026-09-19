# Device and Recovery Architecture

## Purpose

Account authentication recovery and E2EE content-key recovery are separate security problems.

Recovering an account through email must not automatically grant access to historical encrypted content.

## Account recovery

Account recovery restores access to the Shawtie pls account.

It may use:

- verified email
- verification challenge
- password reset
- future stronger authentication methods

Successful account recovery can restore:

- account identity
- profile access
- server-authorized session
- access to server-visible metadata permitted by policy

It does not automatically restore historical E2EE decryption keys.

## Cryptographic recovery

Historical protected content requires cryptographic recovery.

Approved design directions include:

- approval from an existing trusted device
- client-encrypted key backup protected by a high-entropy recovery secret

The server may store encrypted recovery material.

The server must not possess the recovery secret required to decrypt it.

## Device model

Each authorized client device has a durable device record.

Representative fields:

```text
id
account_id
display_name
created_at
last_seen_at
revoked_at
crypto_identity_public_key
crypto_protocol_version
```

Authentication sessions reference a device where practical.

## Device revocation

Revoking a device must:

- revoke its active sessions
- reject future session refresh
- revoke its cryptographic authorization
- prevent new partnership key delivery to that device
- trigger required key rotation or epoch transition according to the E2EE protocol

Device revocation is one logical security operation even if several storage actions are required.

## Device enrollment

A new device must not obtain plaintext private keys from the server.

Enrollment should use one of:

- approval by an already trusted device
- recovery secret based restoration
- another reviewed cryptographic enrollment mechanism

## Lost device behavior

A user who loses a device should be able to:

1. authenticate from another trusted or recovered device
2. view authorized device list
3. revoke the lost device
4. rotate affected cryptographic state when required
5. keep the lost device from receiving future decryptable content

## Account takeover limitation

Email compromise may allow an attacker to attempt account takeover.

The architecture must prevent email recovery alone from automatically exposing historical E2EE plaintext.

This separation limits the impact of email compromise.

## Recovery UX

The product must clearly distinguish:

- account recovered
- encrypted history recovered

A user should not be told that all history is restored until the required cryptographic recovery succeeds.

## Deletion

Permanent account deletion destroys device authorization and server-held encrypted recovery material according to the deletion architecture.

Deleted recovery material must not allow the permanently deleted account to be reconstructed.
