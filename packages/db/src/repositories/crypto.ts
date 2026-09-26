import type { QueryExecutor } from "../types/query-executor.ts";

export type CryptoTrustState = "pending" | "trusted" | "revoked";
export type CryptoKeyPackageState = "available" | "reserved" | "consumed" | "revoked";
export type CryptoGroupStatus = "active" | "superseded" | "destroyed";
export type CryptoControlKind = "add" | "remove" | "update" | "reset";

export interface DeviceCryptoIdentity {
  readonly cryptoDeviceId: string;
  readonly deviceId: string;
  readonly accountId: string;
  readonly cryptoProfile: string;
  readonly mlsSigningPublicKey: Buffer;
  readonly contentSigningPublicKey: Buffer;
  readonly trustState: CryptoTrustState;
  readonly approvedByCryptoDeviceId: string | null;
  readonly approvedAt: Date | null;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

interface DeviceCryptoIdentityRow {
  crypto_device_id: string;
  device_id: string;
  account_id: string;
  crypto_profile: string;
  mls_signing_public_key: Buffer;
  content_signing_public_key: Buffer;
  trust_state: CryptoTrustState;
  approved_by_crypto_device_id: string | null;
  approved_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

function mapIdentity(row: DeviceCryptoIdentityRow): DeviceCryptoIdentity {
  return {
    cryptoDeviceId: row.crypto_device_id,
    deviceId: row.device_id,
    accountId: row.account_id,
    cryptoProfile: row.crypto_profile,
    mlsSigningPublicKey: row.mls_signing_public_key,
    contentSigningPublicKey: row.content_signing_public_key,
    trustState: row.trust_state,
    approvedByCryptoDeviceId: row.approved_by_crypto_device_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

const identityColumns = `
  crypto_device_id, device_id, account_id, crypto_profile,
  mls_signing_public_key, content_signing_public_key, trust_state,
  approved_by_crypto_device_id, approved_at, created_at, revoked_at
`;

export async function loadDeviceCryptoIdentityByDevice(
  executor: QueryExecutor,
  accountId: string,
  deviceId: string,
): Promise<DeviceCryptoIdentity | null> {
  const result = await executor.query<DeviceCryptoIdentityRow>(
    `SELECT ${identityColumns}
     FROM device_crypto_identities
     WHERE account_id = $1 AND device_id = $2
     LIMIT 1`,
    [accountId, deviceId],
  );
  return result.rows[0] ? mapIdentity(result.rows[0]) : null;
}

export async function loadDeviceCryptoIdentity(
  executor: QueryExecutor,
  cryptoDeviceId: string,
): Promise<DeviceCryptoIdentity | null> {
  const result = await executor.query<DeviceCryptoIdentityRow>(
    `SELECT ${identityColumns}
     FROM device_crypto_identities
     WHERE crypto_device_id = $1
     LIMIT 1`,
    [cryptoDeviceId],
  );
  return result.rows[0] ? mapIdentity(result.rows[0]) : null;
}

export async function lockDeviceCryptoIdentity(
  executor: QueryExecutor,
  cryptoDeviceId: string,
): Promise<DeviceCryptoIdentity | null> {
  const result = await executor.query<DeviceCryptoIdentityRow>(
    `SELECT ${identityColumns}
     FROM device_crypto_identities
     WHERE crypto_device_id = $1
     FOR UPDATE`,
    [cryptoDeviceId],
  );
  return result.rows[0] ? mapIdentity(result.rows[0]) : null;
}

export async function listAccountCryptoDevices(
  executor: QueryExecutor,
  accountId: string,
): Promise<readonly DeviceCryptoIdentity[]> {
  const result = await executor.query<DeviceCryptoIdentityRow>(
    `SELECT ${identityColumns}
     FROM device_crypto_identities
     WHERE account_id = $1
     ORDER BY created_at, crypto_device_id`,
    [accountId],
  );
  return result.rows.map(mapIdentity);
}

export async function countTrustedCryptoDevices(
  executor: QueryExecutor,
  accountId: string,
): Promise<number> {
  const result = await executor.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM device_crypto_identities
     WHERE account_id = $1
       AND trust_state = 'trusted'
       AND revoked_at IS NULL`,
    [accountId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function insertDeviceCryptoIdentity(
  executor: QueryExecutor,
  input: {
    readonly cryptoDeviceId: string;
    readonly deviceId: string;
    readonly accountId: string;
    readonly cryptoProfile: string;
    readonly mlsSigningPublicKey: Buffer;
    readonly contentSigningPublicKey: Buffer;
    readonly trustState: "pending" | "trusted";
    readonly approvedAt: Date | null;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO device_crypto_identities (
       crypto_device_id, device_id, account_id, crypto_profile,
       mls_signing_public_key, content_signing_public_key, trust_state,
       approved_at, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.cryptoDeviceId,
      input.deviceId,
      input.accountId,
      input.cryptoProfile,
      input.mlsSigningPublicKey,
      input.contentSigningPublicKey,
      input.trustState,
      input.approvedAt,
      input.createdAt,
    ],
  );

  await executor.query(
    `UPDATE account_devices
     SET crypto_identity_public_key = $3,
         crypto_protocol_version = $4,
         updated_at = $5
     WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL`,
    [
      input.deviceId,
      input.accountId,
      input.mlsSigningPublicKey,
      input.cryptoProfile,
      input.createdAt,
    ],
  );
}

export async function markCryptoDeviceTrusted(
  executor: QueryExecutor,
  input: {
    readonly cryptoDeviceId: string;
    readonly approvedByCryptoDeviceId: string | null;
    readonly approvedAt: Date;
  },
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE device_crypto_identities
     SET trust_state = 'trusted',
         approved_by_crypto_device_id = $2,
         approved_at = $3
     WHERE crypto_device_id = $1
       AND trust_state = 'pending'
       AND revoked_at IS NULL`,
    [input.cryptoDeviceId, input.approvedByCryptoDeviceId, input.approvedAt],
  );
  return result.rowCount === 1;
}

export async function insertCryptoDeviceApproval(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly targetCryptoDeviceId: string;
    readonly approverCryptoDeviceId: string | null;
    readonly approvalKind: "trusted_device" | "recovery";
    readonly approvalSignature: Buffer | null;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO device_crypto_approvals (
       id, account_id, target_crypto_device_id, approver_crypto_device_id,
       approval_kind, approval_signature, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.id,
      input.accountId,
      input.targetCryptoDeviceId,
      input.approverCryptoDeviceId,
      input.approvalKind,
      input.approvalSignature,
      input.createdAt,
    ],
  );
}

export async function insertCryptoKeyPackage(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly cryptoDeviceId: string;
    readonly keyPackage: Buffer;
    readonly keyPackageSha256: Buffer;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO device_key_packages (
       id, crypto_device_id, key_package, key_package_sha256, created_at
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key_package_sha256) DO NOTHING`,
    [
      input.id,
      input.cryptoDeviceId,
      input.keyPackage,
      input.keyPackageSha256,
      input.createdAt,
    ],
  );
}

export interface AvailableCryptoKeyPackage {
  readonly keyPackageId: string;
  readonly cryptoDeviceId: string;
  readonly accountId: string;
  readonly keyPackage: Buffer;
}

export async function listPartnershipCryptoDevices(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<readonly DeviceCryptoIdentity[]> {
  const result = await executor.query<DeviceCryptoIdentityRow>(
    `SELECT
       identities.crypto_device_id,
       identities.device_id,
       identities.account_id,
       identities.crypto_profile,
       identities.mls_signing_public_key,
       identities.content_signing_public_key,
       identities.trust_state,
       identities.approved_by_crypto_device_id,
       identities.approved_at,
       identities.created_at,
       identities.revoked_at
     FROM device_crypto_identities AS identities
     JOIN partnership_members AS members
       ON members.account_id = identities.account_id
      AND members.partnership_id = $1
      AND members.released_at IS NULL
     ORDER BY identities.account_id, identities.created_at, identities.crypto_device_id`,
    [partnershipId],
  );
  return result.rows.map(mapIdentity);
}

export async function listPartnershipTrustedCryptoDevices(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<readonly DeviceCryptoIdentity[]> {
  const result = await executor.query<DeviceCryptoIdentityRow>(
    `SELECT
       identities.crypto_device_id,
       identities.device_id,
       identities.account_id,
       identities.crypto_profile,
       identities.mls_signing_public_key,
       identities.content_signing_public_key,
       identities.trust_state,
       identities.approved_by_crypto_device_id,
       identities.approved_at,
       identities.created_at,
       identities.revoked_at
     FROM device_crypto_identities AS identities
     JOIN partnership_members AS members
       ON members.account_id = identities.account_id
      AND members.partnership_id = $1
      AND members.released_at IS NULL
     JOIN account_devices AS devices
       ON devices.id = identities.device_id
      AND devices.revoked_at IS NULL
     WHERE identities.trust_state = 'trusted'
       AND identities.revoked_at IS NULL
     ORDER BY identities.account_id, identities.created_at, identities.crypto_device_id`,
    [partnershipId],
  );
  return result.rows.map(mapIdentity);
}

export async function listAvailablePartnershipKeyPackages(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<readonly AvailableCryptoKeyPackage[]> {
  const result = await executor.query<{
    id: string;
    crypto_device_id: string;
    account_id: string;
    key_package: Buffer;
  }>(
    `SELECT DISTINCT ON (identities.crypto_device_id)
       packages.id, identities.crypto_device_id, identities.account_id, packages.key_package
     FROM device_crypto_identities AS identities
     JOIN partnership_members AS members
       ON members.account_id = identities.account_id
      AND members.partnership_id = $1
      AND members.released_at IS NULL
     JOIN device_key_packages AS packages
       ON packages.crypto_device_id = identities.crypto_device_id
      AND packages.state = 'available'
     WHERE identities.trust_state = 'trusted'
       AND identities.revoked_at IS NULL
     ORDER BY identities.crypto_device_id, packages.created_at, packages.id`,
    [partnershipId],
  );
  return result.rows.map((row) => ({
    keyPackageId: row.id,
    cryptoDeviceId: row.crypto_device_id,
    accountId: row.account_id,
    keyPackage: row.key_package,
  }));
}

export async function lockAvailableCryptoKeyPackage(
  executor: QueryExecutor,
  keyPackageId: string,
): Promise<AvailableCryptoKeyPackage | null> {
  const result = await executor.query<{
    id: string;
    crypto_device_id: string;
    account_id: string;
    key_package: Buffer;
  }>(
    `SELECT packages.id, packages.crypto_device_id, identities.account_id, packages.key_package
     FROM device_key_packages AS packages
     JOIN device_crypto_identities AS identities
       ON identities.crypto_device_id = packages.crypto_device_id
     WHERE packages.id = $1
       AND packages.state = 'available'
       AND identities.trust_state = 'trusted'
       AND identities.revoked_at IS NULL
     FOR UPDATE OF packages`,
    [keyPackageId],
  );
  const row = result.rows[0];
  return row
    ? {
        keyPackageId: row.id,
        cryptoDeviceId: row.crypto_device_id,
        accountId: row.account_id,
        keyPackage: row.key_package,
      }
    : null;
}

export async function consumeCryptoKeyPackage(
  executor: QueryExecutor,
  keyPackageId: string,
  partnershipId: string,
  consumedAt: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE device_key_packages
     SET state = 'consumed',
         reserved_partnership_id = $2,
         consumed_at = $3
     WHERE id = $1 AND state = 'available'`,
    [keyPackageId, partnershipId, consumedAt],
  );
  return result.rowCount === 1;
}

export interface CryptoRecoveryRecord {
  readonly id: string;
  readonly accountId: string;
  readonly cryptoProfile: string;
  readonly recoveryKeyVersion: number;
  readonly recoveryHpkePublicKey: Buffer;
  readonly recoveryAuthPublicKey: Buffer;
  readonly encryptedBundle: Buffer;
  readonly createdByCryptoDeviceId: string;
  readonly createdAt: Date;
}

interface CryptoRecoveryRow {
  id: string;
  account_id: string;
  crypto_profile: string;
  recovery_key_version: number;
  recovery_hpke_public_key: Buffer;
  recovery_auth_public_key: Buffer;
  encrypted_bundle: Buffer;
  created_by_crypto_device_id: string;
  created_at: Date;
}

function mapRecovery(row: CryptoRecoveryRow): CryptoRecoveryRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    cryptoProfile: row.crypto_profile,
    recoveryKeyVersion: row.recovery_key_version,
    recoveryHpkePublicKey: row.recovery_hpke_public_key,
    recoveryAuthPublicKey: row.recovery_auth_public_key,
    encryptedBundle: row.encrypted_bundle,
    createdByCryptoDeviceId: row.created_by_crypto_device_id,
    createdAt: row.created_at,
  };
}

export async function loadCurrentCryptoRecovery(
  executor: QueryExecutor,
  accountId: string,
): Promise<CryptoRecoveryRecord | null> {
  const result = await executor.query<CryptoRecoveryRow>(
    `SELECT
       id, account_id, crypto_profile, recovery_key_version,
       recovery_hpke_public_key, recovery_auth_public_key, encrypted_bundle,
       created_by_crypto_device_id, created_at
     FROM account_crypto_recovery
     WHERE account_id = $1 AND replaced_at IS NULL
     LIMIT 1`,
    [accountId],
  );
  return result.rows[0] ? mapRecovery(result.rows[0]) : null;
}

export async function replaceCryptoRecovery(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly cryptoProfile: string;
    readonly recoveryKeyVersion: number;
    readonly recoveryHpkePublicKey: Buffer;
    readonly recoveryAuthPublicKey: Buffer;
    readonly encryptedBundle: Buffer;
    readonly createdByCryptoDeviceId: string;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `UPDATE account_crypto_recovery
     SET replaced_at = $2
     WHERE account_id = $1 AND replaced_at IS NULL`,
    [input.accountId, input.createdAt],
  );
  await executor.query(
    `INSERT INTO account_crypto_recovery (
       id, account_id, crypto_profile, recovery_key_version,
       recovery_hpke_public_key, recovery_auth_public_key, encrypted_bundle,
       created_by_crypto_device_id, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.id,
      input.accountId,
      input.cryptoProfile,
      input.recoveryKeyVersion,
      input.recoveryHpkePublicKey,
      input.recoveryAuthPublicKey,
      input.encryptedBundle,
      input.createdByCryptoDeviceId,
      input.createdAt,
    ],
  );
}

export interface CryptoRecoveryChallengeRecord {
  readonly id: string;
  readonly accountId: string;
  readonly targetCryptoDeviceId: string;
  readonly recoveryKeyVersion: number;
  readonly challenge: Buffer;
  readonly expiresAt: Date;
}

export async function insertCryptoRecoveryChallenge(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly targetCryptoDeviceId: string;
    readonly recoveryKeyVersion: number;
    readonly challenge: Buffer;
    readonly createdAt: Date;
    readonly expiresAt: Date;
  },
): Promise<void> {
  await executor.query(
    `UPDATE crypto_recovery_challenges
     SET failed_at = $3
     WHERE account_id = $1
       AND target_crypto_device_id = $2
       AND consumed_at IS NULL
       AND failed_at IS NULL`,
    [input.accountId, input.targetCryptoDeviceId, input.createdAt],
  );
  await executor.query(
    `INSERT INTO crypto_recovery_challenges (
       id, account_id, target_crypto_device_id, recovery_key_version,
       challenge, created_at, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.id,
      input.accountId,
      input.targetCryptoDeviceId,
      input.recoveryKeyVersion,
      input.challenge,
      input.createdAt,
      input.expiresAt,
    ],
  );
}

export async function lockCryptoRecoveryChallenge(
  executor: QueryExecutor,
  challengeId: string,
  accountId: string,
): Promise<CryptoRecoveryChallengeRecord | null> {
  const result = await executor.query<{
    id: string;
    account_id: string;
    target_crypto_device_id: string;
    recovery_key_version: number;
    challenge: Buffer;
    expires_at: Date;
  }>(
    `SELECT id, account_id, target_crypto_device_id, recovery_key_version, challenge, expires_at
     FROM crypto_recovery_challenges
     WHERE id = $1
       AND account_id = $2
       AND consumed_at IS NULL
       AND failed_at IS NULL
     FOR UPDATE`,
    [challengeId, accountId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        accountId: row.account_id,
        targetCryptoDeviceId: row.target_crypto_device_id,
        recoveryKeyVersion: row.recovery_key_version,
        challenge: row.challenge,
        expiresAt: row.expires_at,
      }
    : null;
}

export async function consumeCryptoRecoveryChallenge(
  executor: QueryExecutor,
  challengeId: string,
  consumedAt: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE crypto_recovery_challenges
     SET consumed_at = $2
     WHERE id = $1 AND consumed_at IS NULL AND failed_at IS NULL`,
    [challengeId, consumedAt],
  );
  return result.rowCount === 1;
}

export interface PartnershipCryptoGroup {
  readonly partnershipId: string;
  readonly groupGeneration: number;
  readonly groupId: Buffer;
  readonly cryptoProfile: string;
  readonly ciphersuite: string;
  readonly currentEpoch: bigint;
  readonly controlSequence: bigint;
  readonly rekeyRequired: boolean;
  readonly status: CryptoGroupStatus;
  readonly createdByCryptoDeviceId: string;
  readonly createdAt: Date;
}

interface PartnershipCryptoGroupRow {
  partnership_id: string;
  group_generation: number;
  group_id: Buffer;
  crypto_profile: string;
  ciphersuite: string;
  current_epoch: string | number | bigint;
  control_sequence: string | number | bigint;
  rekey_required: boolean;
  status: CryptoGroupStatus;
  created_by_crypto_device_id: string;
  created_at: Date;
}

function mapGroup(row: PartnershipCryptoGroupRow): PartnershipCryptoGroup {
  return {
    partnershipId: row.partnership_id,
    groupGeneration: row.group_generation,
    groupId: row.group_id,
    cryptoProfile: row.crypto_profile,
    ciphersuite: row.ciphersuite,
    currentEpoch: BigInt(row.current_epoch),
    controlSequence: BigInt(row.control_sequence),
    rekeyRequired: row.rekey_required,
    status: row.status,
    createdByCryptoDeviceId: row.created_by_crypto_device_id,
    createdAt: row.created_at,
  };
}

const groupColumns = `
  partnership_id, group_generation, group_id, crypto_profile, ciphersuite,
  current_epoch, control_sequence, rekey_required, status,
  created_by_crypto_device_id, created_at
`;

export async function loadActivePartnershipCryptoGroup(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<PartnershipCryptoGroup | null> {
  const result = await executor.query<PartnershipCryptoGroupRow>(
    `SELECT ${groupColumns}
     FROM partnership_crypto_groups
     WHERE partnership_id = $1 AND status = 'active'
     LIMIT 1`,
    [partnershipId],
  );
  return result.rows[0] ? mapGroup(result.rows[0]) : null;
}

export async function lockActivePartnershipCryptoGroup(
  executor: QueryExecutor,
  partnershipId: string,
): Promise<PartnershipCryptoGroup | null> {
  const result = await executor.query<PartnershipCryptoGroupRow>(
    `SELECT ${groupColumns}
     FROM partnership_crypto_groups
     WHERE partnership_id = $1 AND status = 'active'
     FOR UPDATE`,
    [partnershipId],
  );
  return result.rows[0] ? mapGroup(result.rows[0]) : null;
}

export async function insertPartnershipCryptoGroup(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly groupId: Buffer;
    readonly cryptoProfile: string;
    readonly ciphersuite: string;
    readonly currentEpoch: bigint;
    readonly createdByCryptoDeviceId: string;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO partnership_crypto_groups (
       partnership_id, group_generation, group_id, crypto_profile, ciphersuite,
       current_epoch, created_by_crypto_device_id, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.partnershipId,
      input.groupGeneration,
      input.groupId,
      input.cryptoProfile,
      input.ciphersuite,
      input.currentEpoch.toString(),
      input.createdByCryptoDeviceId,
      input.createdAt,
    ],
  );
}

export interface PartnershipCryptoMember {
  readonly cryptoDeviceId: string;
  readonly accountId: string;
  readonly leafIndex: number;
  readonly joinedEpoch: bigint;
  readonly removedEpoch: bigint | null;
  readonly removedAt: Date | null;
}

export async function listPartnershipCryptoMembers(
  executor: QueryExecutor,
  partnershipId: string,
  groupGeneration: number,
): Promise<readonly PartnershipCryptoMember[]> {
  const result = await executor.query<{
    crypto_device_id: string;
    account_id: string;
    leaf_index: number;
    joined_epoch: string | number | bigint;
    removed_epoch: string | number | bigint | null;
    removed_at: Date | null;
  }>(
    `SELECT crypto_device_id, account_id, leaf_index, joined_epoch, removed_epoch, removed_at
     FROM partnership_crypto_members
     WHERE partnership_id = $1 AND group_generation = $2
     ORDER BY leaf_index`,
    [partnershipId, groupGeneration],
  );
  return result.rows.map((row) => ({
    cryptoDeviceId: row.crypto_device_id,
    accountId: row.account_id,
    leafIndex: row.leaf_index,
    joinedEpoch: BigInt(row.joined_epoch),
    removedEpoch: row.removed_epoch === null ? null : BigInt(row.removed_epoch),
    removedAt: row.removed_at,
  }));
}

export async function insertPartnershipCryptoMember(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly cryptoDeviceId: string;
    readonly accountId: string;
    readonly leafIndex: number;
    readonly joinedEpoch: bigint;
    readonly joinedAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO partnership_crypto_members (
       partnership_id, group_generation, crypto_device_id, account_id,
       leaf_index, joined_epoch, joined_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.partnershipId,
      input.groupGeneration,
      input.cryptoDeviceId,
      input.accountId,
      input.leafIndex,
      input.joinedEpoch.toString(),
      input.joinedAt,
    ],
  );
}

export async function removePartnershipCryptoMember(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly cryptoDeviceId: string;
    readonly expectedLeafIndex: number;
    readonly removedEpoch: bigint;
    readonly removedAt: Date;
  },
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE partnership_crypto_members
     SET removed_epoch = $5, removed_at = $6
     WHERE partnership_id = $1
       AND group_generation = $2
       AND crypto_device_id = $3
       AND leaf_index = $4
       AND removed_at IS NULL`,
    [
      input.partnershipId,
      input.groupGeneration,
      input.cryptoDeviceId,
      input.expectedLeafIndex,
      input.removedEpoch.toString(),
      input.removedAt,
    ],
  );
  return result.rowCount === 1;
}

export async function advancePartnershipCryptoGroup(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly expectedEpoch: bigint;
    readonly newEpoch: bigint;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ control_sequence: string | number | bigint }>(
    `UPDATE partnership_crypto_groups
     SET current_epoch = $4,
         control_sequence = control_sequence + 1
     WHERE partnership_id = $1
       AND group_generation = $2
       AND status = 'active'
       AND current_epoch = $3
     RETURNING control_sequence`,
    [
      input.partnershipId,
      input.groupGeneration,
      input.expectedEpoch.toString(),
      input.newEpoch.toString(),
    ],
  );
  return result.rows[0] ? BigInt(result.rows[0].control_sequence) : null;
}

export async function refreshPartnershipCryptoRekeyRequired(
  executor: QueryExecutor,
  partnershipId: string,
  groupGeneration: number,
): Promise<boolean> {
  const result = await executor.query<{ rekey_required: boolean }>(
    `UPDATE partnership_crypto_groups AS groups
     SET rekey_required = EXISTS (
       SELECT 1
       FROM partnership_crypto_members AS members
       JOIN device_crypto_identities AS identities
         ON identities.crypto_device_id = members.crypto_device_id
       WHERE members.partnership_id = groups.partnership_id
         AND members.group_generation = groups.group_generation
         AND members.removed_at IS NULL
         AND identities.trust_state = 'revoked'
     )
     WHERE groups.partnership_id = $1
       AND groups.group_generation = $2
       AND groups.status = 'active'
     RETURNING rekey_required`,
    [partnershipId, groupGeneration],
  );
  return result.rows[0]?.rekey_required ?? false;
}

export async function partnershipHasLegacyProtectedPlaintext(
  executor: QueryExecutor,
  partnershipId: string,
  cryptoProfile: string,
): Promise<boolean> {
  const result = await executor.query(
    `SELECT 1
     WHERE EXISTS (
       SELECT 1 FROM messages
       WHERE partnership_id = $1
         AND deleted_at IS NULL
         AND (
           body_text IS NOT NULL
           OR (ciphertext IS NOT NULL AND body_content_key_id IS NULL)
         )
     )
     OR EXISTS (
       SELECT 1 FROM message_reactions
       WHERE partnership_id = $1
         AND removed_at IS NULL
         AND (
           emoji_text IS NOT NULL
           OR (encrypted_reaction IS NOT NULL AND content_key_id IS NULL)
         )
     )
     OR EXISTS (
       SELECT 1 FROM partnership_chat_nicknames
       WHERE partnership_id = $1
         AND (
           nickname IS NOT NULL
           OR (encrypted_nickname IS NOT NULL AND content_key_id IS NULL)
         )
     )
     OR EXISTS (
       SELECT 1 FROM relationship_items
       WHERE partnership_id = $1
         AND lifecycle = 'active'
         AND (
           development_preview_payload IS NOT NULL
           OR development_plaintext_payload IS NOT NULL
           OR (encrypted_preview_payload IS NOT NULL AND preview_content_key_id IS NULL)
           OR (encrypted_payload IS NOT NULL AND main_content_key_id IS NULL)
         )
     )
     OR EXISTS (
       SELECT 1 FROM media_objects
       WHERE partnership_id = $1
         AND deleted_at IS NULL
         AND state IN ('uploading', 'ready_unbound', 'bound')
         AND (
           crypto_protocol_version <> $2
           OR content_key_id IS NULL
         )
     )
     LIMIT 1`,
    [partnershipId, cryptoProfile],
  );
  return result.rowCount === 1;
}

export async function activatePartnershipCryptoIfReady(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly cryptoProfile: string;
    readonly activatedAt: Date;
  },
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE partnerships AS partnerships
     SET crypto_profile = $3,
         crypto_required_from = COALESCE(crypto_required_from, $4),
         crypto_group_generation = $2,
         updated_at = $4
     WHERE partnerships.id = $1
       AND partnerships.lifecycle_state <> 'terminated'
       AND (
         SELECT count(DISTINCT crypto_members.account_id)
         FROM partnership_crypto_members AS crypto_members
         WHERE crypto_members.partnership_id = $1
           AND crypto_members.group_generation = $2
           AND crypto_members.removed_at IS NULL
       ) = (
         SELECT count(*)
         FROM partnership_members AS members
         WHERE members.partnership_id = $1
           AND members.released_at IS NULL
       )
       AND (
         SELECT count(*)
         FROM partnership_members AS members
         WHERE members.partnership_id = $1
           AND members.released_at IS NULL
       ) = 2
       AND (
         SELECT count(DISTINCT recovery.account_id)
         FROM account_crypto_recovery AS recovery
         JOIN partnership_members AS recovery_members
           ON recovery_members.account_id = recovery.account_id
          AND recovery_members.partnership_id = $1
          AND recovery_members.released_at IS NULL
         WHERE recovery.replaced_at IS NULL
       ) = 2
       AND NOT EXISTS (
         SELECT 1
         FROM messages AS message
         WHERE message.partnership_id = $1
           AND message.deleted_at IS NULL
           AND (
             message.body_text IS NOT NULL
             OR (message.ciphertext IS NOT NULL AND message.body_content_key_id IS NULL)
           )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM message_reactions AS reaction
         WHERE reaction.partnership_id = $1
           AND reaction.removed_at IS NULL
           AND (
             reaction.emoji_text IS NOT NULL
             OR (
               reaction.encrypted_reaction IS NOT NULL
               AND reaction.content_key_id IS NULL
             )
           )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM partnership_chat_nicknames AS nickname
         WHERE nickname.partnership_id = $1
           AND (
             nickname.nickname IS NOT NULL
             OR (
               nickname.encrypted_nickname IS NOT NULL
               AND nickname.content_key_id IS NULL
             )
           )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM relationship_items AS item
         WHERE item.partnership_id = $1
           AND item.lifecycle = 'active'
           AND (
             item.development_preview_payload IS NOT NULL
             OR item.development_plaintext_payload IS NOT NULL
             OR (
               item.encrypted_preview_payload IS NOT NULL
               AND item.preview_content_key_id IS NULL
             )
             OR (
               item.encrypted_payload IS NOT NULL
               AND item.main_content_key_id IS NULL
             )
           )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM media_objects AS media
         WHERE media.partnership_id = $1
           AND media.deleted_at IS NULL
           AND media.state IN ('uploading', 'ready_unbound', 'bound')
           AND (
             media.crypto_protocol_version <> $3
             OR media.content_key_id IS NULL
           )
       )`,
    [input.partnershipId, input.groupGeneration, input.cryptoProfile, input.activatedAt],
  );
  return result.rowCount === 1;
}

export async function insertPartnershipCryptoControlMessage(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly controlSequence: bigint;
    readonly kind: CryptoControlKind;
    readonly epochFrom: bigint;
    readonly epochTo: bigint;
    readonly senderCryptoDeviceId: string;
    readonly targetCryptoDeviceId: string | null;
    readonly mlsMessage: Buffer;
    readonly welcome: Buffer | null;
    readonly messageSha256: Buffer;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO partnership_crypto_control_messages (
       partnership_id, group_generation, control_sequence, kind,
       epoch_from, epoch_to, sender_crypto_device_id, target_crypto_device_id,
       mls_message, welcome, message_sha256, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      input.partnershipId,
      input.groupGeneration,
      input.controlSequence.toString(),
      input.kind,
      input.epochFrom.toString(),
      input.epochTo.toString(),
      input.senderCryptoDeviceId,
      input.targetCryptoDeviceId,
      input.mlsMessage,
      input.welcome,
      input.messageSha256,
      input.createdAt,
    ],
  );
}

export interface PartnershipCryptoControlMessage {
  readonly controlSequence: bigint;
  readonly kind: CryptoControlKind;
  readonly epochFrom: bigint;
  readonly epochTo: bigint;
  readonly senderCryptoDeviceId: string;
  readonly targetCryptoDeviceId: string | null;
  readonly mlsMessage: Buffer;
  readonly welcome: Buffer | null;
  readonly createdAt: Date;
}

export async function listPartnershipCryptoControlMessages(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly after: bigint;
    readonly limit: number;
  },
): Promise<readonly PartnershipCryptoControlMessage[]> {
  const result = await executor.query<{
    control_sequence: string | number | bigint;
    kind: CryptoControlKind;
    epoch_from: string | number | bigint;
    epoch_to: string | number | bigint;
    sender_crypto_device_id: string;
    target_crypto_device_id: string | null;
    mls_message: Buffer;
    welcome: Buffer | null;
    created_at: Date;
  }>(
    `SELECT
       control_sequence, kind, epoch_from, epoch_to, sender_crypto_device_id,
       target_crypto_device_id, mls_message, welcome, created_at
     FROM partnership_crypto_control_messages
     WHERE partnership_id = $1
       AND group_generation = $2
       AND control_sequence > $3
     ORDER BY control_sequence
     LIMIT $4`,
    [input.partnershipId, input.groupGeneration, input.after.toString(), input.limit],
  );
  return result.rows.map((row) => ({
    controlSequence: BigInt(row.control_sequence),
    kind: row.kind,
    epochFrom: BigInt(row.epoch_from),
    epochTo: BigInt(row.epoch_to),
    senderCryptoDeviceId: row.sender_crypto_device_id,
    targetCryptoDeviceId: row.target_crypto_device_id,
    mlsMessage: row.mls_message,
    welcome: row.welcome,
    createdAt: row.created_at,
  }));
}

export async function accountIsCurrentPartnershipMember(
  executor: QueryExecutor,
  accountId: string,
  partnershipId: string,
): Promise<boolean> {
  const result = await executor.query(
    `SELECT 1
     FROM partnership_members
     JOIN partnerships ON partnerships.id = partnership_members.partnership_id
     WHERE partnership_members.partnership_id = $1
       AND partnership_members.account_id = $2
       AND partnership_members.released_at IS NULL
       AND partnerships.lifecycle_state <> 'terminated'
     LIMIT 1`,
    [partnershipId, accountId],
  );
  return result.rowCount === 1;
}

export async function accountBelongsToPartnership(
  executor: QueryExecutor,
  accountId: string,
  partnershipId: string,
): Promise<boolean> {
  const result = await executor.query(
    `SELECT 1 FROM partnership_members
     WHERE partnership_id = $1 AND account_id = $2 AND released_at IS NULL
     LIMIT 1`,
    [partnershipId, accountId],
  );
  return result.rowCount === 1;
}

export async function cryptoDeviceIsActiveGroupMember(
  executor: QueryExecutor,
  input: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly cryptoDeviceId: string;
  },
): Promise<PartnershipCryptoMember | null> {
  const result = await executor.query<{
    crypto_device_id: string;
    account_id: string;
    leaf_index: number;
    joined_epoch: string | number | bigint;
    removed_epoch: string | number | bigint | null;
    removed_at: Date | null;
  }>(
    `SELECT crypto_device_id, account_id, leaf_index, joined_epoch, removed_epoch, removed_at
     FROM partnership_crypto_members
     WHERE partnership_id = $1
       AND group_generation = $2
       AND crypto_device_id = $3
       AND removed_at IS NULL
     LIMIT 1`,
    [input.partnershipId, input.groupGeneration, input.cryptoDeviceId],
  );
  const row = result.rows[0];
  return row
    ? {
        cryptoDeviceId: row.crypto_device_id,
        accountId: row.account_id,
        leafIndex: row.leaf_index,
        joinedEpoch: BigInt(row.joined_epoch),
        removedEpoch: row.removed_epoch === null ? null : BigInt(row.removed_epoch),
        removedAt: row.removed_at,
      }
    : null;
}
