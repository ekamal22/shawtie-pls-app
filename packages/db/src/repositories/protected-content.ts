import type { QueryExecutor } from "../types/query-executor.ts";

export type ProtectedContentType =
  | "message"
  | "message_reaction"
  | "partnership_nickname"
  | "relationship_item"
  | "media";

export type ProtectedPayloadRole =
  | "message_body"
  | "reaction_value"
  | "nickname_value"
  | "relationship_preview"
  | "relationship_main"
  | "media_content";

export interface PartnershipCryptoPolicy {
  readonly partnershipId: string;
  readonly cryptoProfile: string | null;
  readonly cryptoRequiredFrom: Date | null;
  readonly groupGeneration: number | null;
}

export async function loadPartnershipCryptoPolicy(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<PartnershipCryptoPolicy | null> {
  const result = await executor.query<{
    id: string;
    crypto_profile: string | null;
    crypto_required_from: Date | null;
    crypto_group_generation: number | null;
  }>(
    `SELECT id, crypto_profile, crypto_required_from, crypto_group_generation
     FROM partnerships
     WHERE id = $1
       AND lifecycle_state <> 'terminated'
     LIMIT 1`,
    [partnershipId],
  );
  const row = result.rows[0];
  return row
    ? {
        partnershipId: row.id,
        cryptoProfile: row.crypto_profile,
        cryptoRequiredFrom: row.crypto_required_from,
        groupGeneration: row.crypto_group_generation,
      }
    : null;
}

export interface PartnershipRecoveryRecipient {
  readonly accountId: string;
  readonly recoveryKeyVersion: number;
  readonly recoveryHpkePublicKey: Buffer;
}

export async function listPartnershipRecoveryRecipients(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<readonly PartnershipRecoveryRecipient[]> {
  const result = await executor.query<{
    account_id: string;
    recovery_key_version: number;
    recovery_hpke_public_key: Buffer;
  }>(
    `SELECT members.account_id,
            recovery.recovery_key_version,
            recovery.recovery_hpke_public_key
     FROM partnership_members AS members
     JOIN account_crypto_recovery AS recovery
       ON recovery.account_id = members.account_id
      AND recovery.replaced_at IS NULL
     WHERE members.partnership_id = $1
       AND members.released_at IS NULL
     ORDER BY members.account_id`,
    [partnershipId],
  );
  return result.rows.map((row) => ({
    accountId: row.account_id,
    recoveryKeyVersion: row.recovery_key_version,
    recoveryHpkePublicKey: row.recovery_hpke_public_key,
  }));
}

export interface InsertProtectedContentKey {
  readonly id: string;
  readonly partnershipId: string;
  readonly contentType: ProtectedContentType;
  readonly contentId: string;
  readonly contentVersion: bigint;
  readonly payloadRole: ProtectedPayloadRole;
  readonly contentSchemaVersion: number;
  readonly cryptoProfile: string;
  readonly groupGeneration: number;
  readonly mlsEpoch: bigint;
  readonly senderCryptoDeviceId: string;
  readonly nonce: Buffer;
  readonly keyDistributionMessage: Buffer;
  readonly ciphertextSha256: Buffer;
  readonly contentSignature: Buffer;
  readonly createdAt: Date;
  readonly recoveryCapsules: readonly {
    readonly accountId: string;
    readonly recoveryKeyVersion: number;
    readonly hpkeEncapsulation: Buffer;
    readonly hpkeCiphertext: Buffer;
  }[];
}

export async function insertProtectedContentKey(
  executor: QueryExecutor,
  input: InsertProtectedContentKey,
): Promise<void> {
  await executor.query(
    `INSERT INTO protected_content_keys (
       id, partnership_id, content_type, content_id, content_version,
       payload_role, content_schema_version, crypto_profile, group_generation, mls_epoch,
       sender_crypto_device_id, nonce, key_distribution_message,
       ciphertext_sha256, content_signature, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      input.id,
      input.partnershipId,
      input.contentType,
      input.contentId,
      input.contentVersion.toString(),
      input.payloadRole,
      input.contentSchemaVersion,
      input.cryptoProfile,
      input.groupGeneration,
      input.mlsEpoch.toString(),
      input.senderCryptoDeviceId,
      input.nonce,
      input.keyDistributionMessage,
      input.ciphertextSha256,
      input.contentSignature,
      input.createdAt,
    ],
  );

  for (const capsule of input.recoveryCapsules) {
    await executor.query(
      `INSERT INTO content_key_recovery_capsules (
         content_key_id, account_id, recovery_key_version,
         hpke_encapsulation, hpke_ciphertext, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.id,
        capsule.accountId,
        capsule.recoveryKeyVersion,
        capsule.hpkeEncapsulation,
        capsule.hpkeCiphertext,
        input.createdAt,
      ],
    );
  }
}

export async function deleteProtectedContentKey(
  executor: QueryExecutor,
  contentKeyId: string,
): Promise<void> {
  await executor.query("DELETE FROM protected_content_keys WHERE id = $1", [contentKeyId]);
}

export interface ProtectedContentKeyRecord {
  readonly id: string;
  readonly partnershipId: string;
  readonly contentType: ProtectedContentType;
  readonly contentId: string;
  readonly contentVersion: bigint;
  readonly payloadRole: ProtectedPayloadRole;
  readonly contentSchemaVersion: number;
  readonly cryptoProfile: string;
  readonly groupGeneration: number;
  readonly mlsEpoch: bigint;
  readonly senderCryptoDeviceId: string;
  readonly nonce: Buffer;
  readonly keyDistributionMessage: Buffer;
  readonly ciphertextSha256: Buffer;
  readonly contentSignature: Buffer;
  readonly recoveryCapsules: readonly {
    readonly accountId: string;
    readonly recoveryKeyVersion: number;
    readonly hpkeEncapsulation: Buffer;
    readonly hpkeCiphertext: Buffer;
  }[];
}

export async function loadProtectedContentKey(
  executor: QueryExecutor,
  contentKeyId: string,
): Promise<ProtectedContentKeyRecord | null> {
  const result = await executor.query<{
    id: string;
    partnership_id: string;
    content_type: ProtectedContentType;
    content_id: string;
    content_version: string | number | bigint;
    payload_role: ProtectedPayloadRole;
    content_schema_version: number;
    crypto_profile: string;
    group_generation: number;
    mls_epoch: string | number | bigint;
    sender_crypto_device_id: string;
    nonce: Buffer;
    key_distribution_message: Buffer;
    ciphertext_sha256: Buffer;
    content_signature: Buffer;
  }>(
    `SELECT
       id, partnership_id, content_type, content_id, content_version,
       payload_role, content_schema_version, crypto_profile, group_generation, mls_epoch,
       sender_crypto_device_id, nonce, key_distribution_message,
       ciphertext_sha256, content_signature
     FROM protected_content_keys
     WHERE id = $1
     LIMIT 1`,
    [contentKeyId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const capsules = await executor.query<{
    account_id: string;
    recovery_key_version: number;
    hpke_encapsulation: Buffer;
    hpke_ciphertext: Buffer;
  }>(
    `SELECT account_id, recovery_key_version, hpke_encapsulation, hpke_ciphertext
     FROM content_key_recovery_capsules
     WHERE content_key_id = $1
     ORDER BY account_id`,
    [contentKeyId],
  );
  return {
    id: row.id,
    partnershipId: row.partnership_id,
    contentType: row.content_type,
    contentId: row.content_id,
    contentVersion: BigInt(row.content_version),
    payloadRole: row.payload_role,
    contentSchemaVersion: row.content_schema_version,
    cryptoProfile: row.crypto_profile,
    groupGeneration: row.group_generation,
    mlsEpoch: BigInt(row.mls_epoch),
    senderCryptoDeviceId: row.sender_crypto_device_id,
    nonce: row.nonce,
    keyDistributionMessage: row.key_distribution_message,
    ciphertextSha256: row.ciphertext_sha256,
    contentSignature: row.content_signature,
    recoveryCapsules: capsules.rows.map((capsule) => ({
      accountId: capsule.account_id,
      recoveryKeyVersion: capsule.recovery_key_version,
      hpkeEncapsulation: capsule.hpke_encapsulation,
      hpkeCiphertext: capsule.hpke_ciphertext,
    })),
  };
}


export async function loadProtectedContentKeys(
  executor: QueryExecutor,
  contentKeyIds: readonly string[],
): Promise<ReadonlyMap<string, ProtectedContentKeyRecord>> {
  if (contentKeyIds.length === 0) return new Map();
  const uniqueIds = [...new Set(contentKeyIds)];
  const keys = await executor.query<{
    id: string;
    partnership_id: string;
    content_type: ProtectedContentType;
    content_id: string;
    content_version: string | number | bigint;
    payload_role: ProtectedPayloadRole;
    content_schema_version: number;
    crypto_profile: string;
    group_generation: number;
    mls_epoch: string | number | bigint;
    sender_crypto_device_id: string;
    nonce: Buffer;
    key_distribution_message: Buffer;
    ciphertext_sha256: Buffer;
    content_signature: Buffer;
  }>(
    `SELECT
       id, partnership_id, content_type, content_id, content_version,
       payload_role, content_schema_version, crypto_profile, group_generation, mls_epoch,
       sender_crypto_device_id, nonce, key_distribution_message,
       ciphertext_sha256, content_signature
     FROM protected_content_keys
     WHERE id = ANY($1::uuid[])`,
    [uniqueIds],
  );
  const capsules = await executor.query<{
    content_key_id: string;
    account_id: string;
    recovery_key_version: number;
    hpke_encapsulation: Buffer;
    hpke_ciphertext: Buffer;
  }>(
    `SELECT
       content_key_id, account_id, recovery_key_version,
       hpke_encapsulation, hpke_ciphertext
     FROM content_key_recovery_capsules
     WHERE content_key_id = ANY($1::uuid[])
     ORDER BY content_key_id, account_id`,
    [uniqueIds],
  );
  const capsulesByKey = new Map<string, ProtectedContentKeyRecord["recoveryCapsules"][number][]>();
  for (const capsule of capsules.rows) {
    const list = capsulesByKey.get(capsule.content_key_id) ?? [];
    list.push({
      accountId: capsule.account_id,
      recoveryKeyVersion: capsule.recovery_key_version,
      hpkeEncapsulation: capsule.hpke_encapsulation,
      hpkeCiphertext: capsule.hpke_ciphertext,
    });
    capsulesByKey.set(capsule.content_key_id, list);
  }
  return new Map(
    keys.rows.map((row) => [
      row.id,
      {
        id: row.id,
        partnershipId: row.partnership_id,
        contentType: row.content_type,
        contentId: row.content_id,
        contentVersion: BigInt(row.content_version),
        payloadRole: row.payload_role,
        cryptoProfile: row.crypto_profile,
        groupGeneration: row.group_generation,
        mlsEpoch: BigInt(row.mls_epoch),
        senderCryptoDeviceId: row.sender_crypto_device_id,
        nonce: row.nonce,
        keyDistributionMessage: row.key_distribution_message,
        ciphertextSha256: row.ciphertext_sha256,
        contentSignature: row.content_signature,
        recoveryCapsules: capsulesByKey.get(row.id) ?? [],
      } satisfies ProtectedContentKeyRecord,
    ]),
  );
}
