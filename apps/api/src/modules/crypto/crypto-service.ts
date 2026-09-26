import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  S1_CRYPTO_PROFILE,
  S1_MLS_CIPHERSUITE,
  cryptoResetProofText,
  type CryptoBootstrapInput,
  type CryptoCommitInput,
  type CryptoControlQuery,
  type CryptoDeviceApprovalInput,
  type CryptoDeviceEnrollInput,
  type CryptoKeyPackageUploadInput,
  type CryptoRecoveryChallengeInput,
  type CryptoRecoveryProofInput,
  type CryptoRecoverySetupInput,
} from "@shawtie/contracts";
import {
  POSTGRES_SQLSTATE,
  accountIsCurrentPartnershipMember,
  activatePartnershipCryptoIfReady,
  activateResetPartnershipCryptoGeneration,
  advancePartnershipCryptoGroup,
  consumeCryptoKeyPackage,
  consumeCryptoRecoveryChallenge,
  countTrustedCryptoDevices,
  cryptoDeviceIsActiveGroupMember,
  getCurrentPartnershipForAccount,
  getTransactionTimestamp,
  insertCryptoDeviceApproval,
  insertCryptoKeyPackage,
  insertCryptoRecoveryChallenge,
  insertDeviceCryptoIdentity,
  insertPartnershipCryptoControlMessage,
  insertPartnershipCryptoGroup,
  insertPartnershipCryptoMember,
  listAccountCryptoDevices,
  listAvailablePartnershipKeyPackages,
  listPartnershipCryptoControlMessages,
  listPartnershipCryptoDevices,
  listPartnershipCryptoMembers,
  listPartnershipRecoveryRecipients,
  listPartnershipTrustedCryptoDevices,
  loadActivePartnershipCryptoGroup,
  loadCurrentCryptoRecovery,
  loadPartnershipCryptoPolicy,
  loadDeviceCryptoIdentity,
  loadDeviceCryptoIdentityByDevice,
  lockAccounts,
  lockActivePartnershipCryptoGroup,
  lockAvailableCryptoKeyPackage,
  lockCryptoRecoveryChallenge,
  lockDeviceCryptoIdentity,
  markCryptoDeviceTrusted,
  partnershipHasLegacyProtectedPlaintext,
  postgresSqlState,
  refreshPartnershipCryptoRekeyRequired,
  removePartnershipCryptoMember,
  supersedeActivePartnershipCryptoGroup,
  replaceCryptoRecovery,
  withTransaction,
  type DatabasePool,
  type DeviceCryptoIdentity,
  type QueryExecutor,
} from "@shawtie/db";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import { verifyRawEd25519 } from "./ed25519.ts";

const TEN_MINUTES_MS = 10 * 60_000;

function decode(value: string): Buffer {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0) throw new Error("empty");
    return decoded;
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED");
  }
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function digest(value: Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("S1 sequence exceeds JavaScript safe integer");
  return number;
}

function requireRawEd25519(value: string): Buffer {
  const decoded = decode(value);
  if (decoded.length !== 32) throw new ApiError(400, "VALIDATION_FAILED");
  return decoded;
}

function requireSignature(value: string): Buffer {
  const decoded = decode(value);
  if (decoded.length !== 64) throw new ApiError(400, "VALIDATION_FAILED");
  return decoded;
}

function enrollmentProofPayload(
  accountId: string,
  deviceId: string,
  input: Pick<
    CryptoDeviceEnrollInput,
    "cryptoDeviceId" | "cryptoProfile" | "mlsSigningPublicKey" | "contentSigningPublicKey"
  >,
): Buffer {
  return Buffer.from(
    [
      "shawtie-device-enrollment-v1",
      accountId,
      deviceId,
      input.cryptoDeviceId,
      input.cryptoProfile,
      input.mlsSigningPublicKey,
      input.contentSigningPublicKey,
    ].join("\\0"),
    "utf8",
  );
}

function approvalPayload(accountId: string, target: DeviceCryptoIdentity): Buffer {
  return Buffer.from(
    [
      "shawtie-device-approval-v1",
      accountId,
      target.cryptoDeviceId,
      target.cryptoProfile,
      target.mlsSigningPublicKey.toString("base64url"),
      target.contentSigningPublicKey.toString("base64url"),
    ].join("\0"),
    "utf8",
  );
}

function recoveryProofPayload(
  accountId: string,
  targetCryptoDeviceId: string,
  challengeId: string,
  challenge: Buffer,
  recoveryKeyVersion: number,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      [
        "shawtie-recovery-proof-v1",
        accountId,
        targetCryptoDeviceId,
        challengeId,
        String(recoveryKeyVersion),
      ].join("\0") + "\0",
      "utf8",
    ),
    challenge,
  ]);
}

function identityProjection(identity: DeviceCryptoIdentity) {
  return {
    cryptoDeviceId: identity.cryptoDeviceId,
    deviceId: identity.deviceId,
    accountId: identity.accountId,
    cryptoProfile: identity.cryptoProfile,
    mlsSigningPublicKey: encode(identity.mlsSigningPublicKey),
    contentSigningPublicKey: encode(identity.contentSigningPublicKey),
    trustState: identity.trustState,
    approvedAt: identity.approvedAt?.toISOString() ?? null,
    createdAt: identity.createdAt.toISOString(),
    revokedAt: identity.revokedAt?.toISOString() ?? null,
  };
}

export class CryptoService {
  readonly database: DatabasePool;

  constructor(database: DatabasePool) {
    this.database = database;
  }

  async #currentIdentity(
    executor: QueryExecutor,
    auth: AuthContext,
    requiredTrust: "any" | "trusted" = "any",
  ): Promise<DeviceCryptoIdentity> {
    if (!auth.session.deviceId) throw new ApiError(409, "CRYPTO_DEVICE_UNAVAILABLE");
    const identity = await loadDeviceCryptoIdentityByDevice(
      executor,
      auth.session.accountId,
      auth.session.deviceId,
    );
    if (!identity) throw new ApiError(409, "CRYPTO_NOT_INITIALIZED");
    if (identity.revokedAt || identity.trustState === "revoked") {
      throw new ApiError(409, "CRYPTO_DEVICE_REVOKED");
    }
    if (requiredTrust === "trusted" && identity.trustState !== "trusted") {
      throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
    }
    return identity;
  }

  async currentDevice(auth: AuthContext): Promise<unknown> {
    const identity = await this.#currentIdentity(
      this.database.pool,
      auth,
      "any",
    );
    return { device: identityProjection(identity) };
  }

  async devices(auth: AuthContext): Promise<unknown> {
    const identities = await listAccountCryptoDevices(
      this.database.pool,
      auth.session.accountId,
    );
    return { devices: identities.map(identityProjection) };
  }

  async enroll(auth: AuthContext, input: CryptoDeviceEnrollInput): Promise<unknown> {
    if (!auth.session.deviceId) throw new ApiError(409, "CRYPTO_DEVICE_UNAVAILABLE");
    const mlsSigningPublicKey = requireRawEd25519(input.mlsSigningPublicKey);
    const contentSigningPublicKey = requireRawEd25519(input.contentSigningPublicKey);
    const identityProofSignature = requireSignature(input.identityProofSignature);
    if (
      !verifyRawEd25519(
        contentSigningPublicKey,
        enrollmentProofPayload(
          auth.session.accountId,
          auth.session.deviceId,
          input,
        ),
        identityProofSignature,
      )
    ) {
      throw new ApiError(403, "CRYPTO_SIGNATURE_INVALID");
    }

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);

      const existing = await loadDeviceCryptoIdentityByDevice(
        transaction,
        auth.session.accountId,
        auth.session.deviceId!,
      );
      if (existing) {
        if (
          existing.cryptoDeviceId !== input.cryptoDeviceId ||
          existing.cryptoProfile !== input.cryptoProfile ||
          !existing.mlsSigningPublicKey.equals(mlsSigningPublicKey) ||
          !existing.contentSigningPublicKey.equals(contentSigningPublicKey)
        ) {
          throw new ApiError(409, "CRYPTO_DEVICE_IDENTITY_CONFLICT");
        }
        for (const item of input.keyPackages) {
          const bytes = decode(item.keyPackage);
          await insertCryptoKeyPackage(transaction, {
            id: item.keyPackageId,
            cryptoDeviceId: existing.cryptoDeviceId,
            keyPackage: bytes,
            keyPackageSha256: digest(bytes),
            createdAt: now,
          });
        }
        return { device: identityProjection(existing) };
      }

      const trustedCount = await countTrustedCryptoDevices(transaction, auth.session.accountId);
      const initial = trustedCount === 0;
      await insertDeviceCryptoIdentity(transaction, {
        cryptoDeviceId: input.cryptoDeviceId,
        deviceId: auth.session.deviceId!,
        accountId: auth.session.accountId,
        cryptoProfile: input.cryptoProfile,
        mlsSigningPublicKey,
        contentSigningPublicKey,
        trustState: initial ? "trusted" : "pending",
        approvedAt: initial ? now : null,
        createdAt: now,
      });

      for (const item of input.keyPackages) {
        const bytes = decode(item.keyPackage);
        await insertCryptoKeyPackage(transaction, {
          id: item.keyPackageId,
          cryptoDeviceId: input.cryptoDeviceId,
          keyPackage: bytes,
          keyPackageSha256: digest(bytes),
          createdAt: now,
        });
      }

      const created = await loadDeviceCryptoIdentity(transaction, input.cryptoDeviceId);
      if (!created) throw new Error("S1 device identity insert was not visible");
      return { device: identityProjection(created), initialTrust: initial };
    });
  }

  async uploadKeyPackages(
    auth: AuthContext,
    cryptoDeviceId: string,
    input: CryptoKeyPackageUploadInput,
  ): Promise<{ accepted: number }> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await this.#currentIdentity(transaction, auth, "trusted");
      if (current.cryptoDeviceId !== cryptoDeviceId) {
        throw new ApiError(404, "CRYPTO_DEVICE_NOT_FOUND");
      }
      let accepted = 0;
      for (const item of input.keyPackages) {
        const bytes = decode(item.keyPackage);
        await insertCryptoKeyPackage(transaction, {
          id: item.keyPackageId,
          cryptoDeviceId,
          keyPackage: bytes,
          keyPackageSha256: digest(bytes),
          createdAt: now,
        });
        accepted += 1;
      }
      return { accepted };
    });
  }

  async approveDevice(
    auth: AuthContext,
    targetCryptoDeviceId: string,
    input: CryptoDeviceApprovalInput,
  ): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);

      const approver = await this.#currentIdentity(transaction, auth, "trusted");
      const target = await lockDeviceCryptoIdentity(transaction, targetCryptoDeviceId);
      if (!target || target.accountId !== auth.session.accountId) {
        throw new ApiError(404, "CRYPTO_DEVICE_NOT_FOUND");
      }
      if (target.trustState === "revoked" || target.revokedAt) {
        throw new ApiError(409, "CRYPTO_DEVICE_REVOKED");
      }
      if (target.trustState === "trusted") return { device: identityProjection(target) };
      if (target.cryptoDeviceId === approver.cryptoDeviceId) {
        throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
      }

      const signature = requireSignature(input.approvalSignature);
      if (
        !verifyRawEd25519(
          approver.contentSigningPublicKey,
          approvalPayload(auth.session.accountId, target),
          signature,
        )
      ) {
        throw new ApiError(403, "CRYPTO_SIGNATURE_INVALID");
      }

      const changed = await markCryptoDeviceTrusted(transaction, {
        cryptoDeviceId: target.cryptoDeviceId,
        approvedByCryptoDeviceId: approver.cryptoDeviceId,
        approvedAt: now,
      });
      if (!changed) throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
      await insertCryptoDeviceApproval(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        targetCryptoDeviceId: target.cryptoDeviceId,
        approverCryptoDeviceId: approver.cryptoDeviceId,
        approvalKind: "trusted_device",
        approvalSignature: signature,
        createdAt: now,
      });

      const trusted = await loadDeviceCryptoIdentity(transaction, target.cryptoDeviceId);
      if (!trusted) throw new Error("Trusted crypto device disappeared");
      return { device: identityProjection(trusted) };
    });
  }

  async partnershipState(auth: AuthContext, partnershipId: string): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      if (
        !(await accountIsCurrentPartnershipMember(
          transaction,
          auth.session.accountId,
          partnershipId,
        ))
      ) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }
      const current = await this.#currentIdentity(transaction, auth, "trusted");
      const policy = await loadPartnershipCryptoPolicy(transaction, partnershipId);
      const group = await loadActivePartnershipCryptoGroup(transaction, partnershipId);
      const devices = await listPartnershipCryptoDevices(transaction, partnershipId);
      const members = group
        ? await listPartnershipCryptoMembers(
            transaction,
            partnershipId,
            group.groupGeneration,
          )
        : [];
      const packages = await listAvailablePartnershipKeyPackages(transaction, partnershipId);
      const recoveryRecipients = await listPartnershipRecoveryRecipients(transaction, partnershipId);
      const legacyPlaintextBlocker = await partnershipHasLegacyProtectedPlaintext(
        transaction,
        partnershipId,
        S1_CRYPTO_PROFILE,
      );
      const memberIds = new Set(
        members.filter((item) => item.removedAt === null).map((item) => item.cryptoDeviceId),
      );

      return {
        cryptoProfile: S1_CRYPTO_PROFILE,
        cryptoRequired: Boolean(policy?.cryptoRequiredFrom),
        cryptoRequiredFrom: policy?.cryptoRequiredFrom?.toISOString() ?? null,
        currentCryptoDeviceId: current.cryptoDeviceId,
        group: group
          ? {
              partnershipId,
              groupGeneration: group.groupGeneration,
              groupId: encode(group.groupId),
              ciphersuite: group.ciphersuite,
              currentEpoch: safeNumber(group.currentEpoch),
              controlSequence: safeNumber(group.controlSequence),
              rekeyRequired: group.rekeyRequired,
            }
          : null,
        devices: devices.map(identityProjection),
        members: members.map((member) => ({
          cryptoDeviceId: member.cryptoDeviceId,
          accountId: member.accountId,
          leafIndex: member.leafIndex,
          joinedEpoch: safeNumber(member.joinedEpoch),
          removedEpoch: member.removedEpoch === null ? null : safeNumber(member.removedEpoch),
          removedAt: member.removedAt?.toISOString() ?? null,
        })),
        keyPackages: packages
          .filter((item) => !memberIds.has(item.cryptoDeviceId))
          .map((item) => ({
            keyPackageId: item.keyPackageId,
            cryptoDeviceId: item.cryptoDeviceId,
            accountId: item.accountId,
            keyPackage: encode(item.keyPackage),
          })),
        recoveryRecipients: recoveryRecipients.map((item) => ({
          accountId: item.accountId,
          recoveryKeyVersion: item.recoveryKeyVersion,
          recoveryHpkePublicKey: encode(item.recoveryHpkePublicKey),
        })),
        legacyPlaintextBlocker,
      };
    });
  }

  async bootstrap(
    auth: AuthContext,
    partnershipId: string,
    input: CryptoBootstrapInput,
  ): Promise<unknown> {
    try {
      return await withTransaction(this.database, async (transaction) => {
        const now = await getTransactionTimestamp(transaction);
        if (
          !(await accountIsCurrentPartnershipMember(
            transaction,
            auth.session.accountId,
            partnershipId,
          ))
        ) {
          throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
        }
        const current = await this.#currentIdentity(transaction, auth, "trusted");
        const existing = await lockActivePartnershipCryptoGroup(transaction, partnershipId);
        if (existing) {
          if (
            existing.groupGeneration === input.groupGeneration &&
            existing.groupId.equals(decode(input.groupId))
          ) {
            return {
              groupGeneration: existing.groupGeneration,
              currentEpoch: safeNumber(existing.currentEpoch),
              controlSequence: safeNumber(existing.controlSequence),
            };
          }
          throw new ApiError(409, "CRYPTO_GROUP_BOOTSTRAP_CONFLICT");
        }
        if (
          input.cryptoProfile !== S1_CRYPTO_PROFILE ||
          input.ciphersuite !== S1_MLS_CIPHERSUITE ||
          input.groupGeneration !== 1 ||
          input.epoch !== 0
        ) {
          throw new ApiError(409, "CRYPTO_GROUP_BOOTSTRAP_CONFLICT");
        }

        await insertPartnershipCryptoGroup(transaction, {
          partnershipId,
          groupGeneration: 1,
          groupId: decode(input.groupId),
          cryptoProfile: input.cryptoProfile,
          ciphersuite: input.ciphersuite,
          currentEpoch: 0n,
          createdByCryptoDeviceId: current.cryptoDeviceId,
          createdAt: now,
        });
        await insertPartnershipCryptoMember(transaction, {
          partnershipId,
          groupGeneration: 1,
          cryptoDeviceId: current.cryptoDeviceId,
          accountId: auth.session.accountId,
          leafIndex: input.founderLeafIndex,
          joinedEpoch: 0n,
          joinedAt: now,
        });

        return {
          groupGeneration: 1,
          currentEpoch: 0,
          controlSequence: 0,
          cryptoRequired: false,
        };
      });
    } catch (error) {
      if (postgresSqlState(error) === POSTGRES_SQLSTATE.uniqueViolation) {
        throw new ApiError(409, "CRYPTO_GROUP_BOOTSTRAP_CONFLICT");
      }
      throw error;
    }
  }

  async commit(
    auth: AuthContext,
    partnershipId: string,
    input: CryptoCommitInput,
  ): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      if (
        !(await accountIsCurrentPartnershipMember(
          transaction,
          auth.session.accountId,
          partnershipId,
        ))
      ) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }
      const actor = await this.#currentIdentity(transaction, auth, "trusted");
      const group = await lockActivePartnershipCryptoGroup(transaction, partnershipId);
      if (!group) throw new ApiError(409, "CRYPTO_GROUP_NOT_READY");
      if (
        group.groupGeneration !== input.expectedGroupGeneration ||
        group.currentEpoch !== BigInt(input.expectedEpoch)
      ) {
        throw new ApiError(409, "CRYPTO_EPOCH_CONFLICT");
      }

      if (input.kind === "reset") {
        if (
          input.resetGroupGeneration === null ||
          input.resetGroupId === null ||
          input.resetFounderLeafIndex === null ||
          input.recoveryKeyVersion === null ||
          input.recoverySignature === null
        ) {
          throw new ApiError(400, "VALIDATION_FAILED");
        }
        const policy = await loadPartnershipCryptoPolicy(transaction, partnershipId);
        if (!policy?.cryptoRequiredFrom) {
          throw new ApiError(409, "CRYPTO_GROUP_RESET_REQUIRED");
        }
        const recovery = await loadCurrentCryptoRecovery(
          transaction,
          auth.session.accountId,
        );
        if (
          !recovery ||
          recovery.recoveryKeyVersion !== input.recoveryKeyVersion
        ) {
          throw new ApiError(409, "CRYPTO_RECOVERY_VERSION_CONFLICT");
        }

        const resetGroupId = decode(input.resetGroupId);
        if (resetGroupId.equals(group.groupId)) {
          throw new ApiError(409, "CRYPTO_GROUP_BOOTSTRAP_CONFLICT");
        }
        const proof = Buffer.from(
          cryptoResetProofText({
            accountId: auth.session.accountId,
            partnershipId,
            cryptoDeviceId: actor.cryptoDeviceId,
            expectedGroupGeneration: input.expectedGroupGeneration,
            expectedEpoch: input.expectedEpoch,
            resetGroupGeneration: input.resetGroupGeneration,
            resetGroupId: input.resetGroupId,
            resetFounderLeafIndex: input.resetFounderLeafIndex,
            recoveryKeyVersion: input.recoveryKeyVersion,
          }),
          "utf8",
        );
        if (
          !verifyRawEd25519(
            recovery.recoveryAuthPublicKey,
            proof,
            requireSignature(input.recoverySignature),
          )
        ) {
          throw new ApiError(403, "CRYPTO_RECOVERY_FAILED");
        }

        const superseded = await supersedeActivePartnershipCryptoGroup(
          transaction,
          {
            partnershipId,
            expectedGroupGeneration: group.groupGeneration,
            expectedEpoch: group.currentEpoch,
            supersededAt: now,
          },
        );
        if (!superseded) throw new ApiError(409, "CRYPTO_EPOCH_CONFLICT");

        await insertPartnershipCryptoGroup(transaction, {
          partnershipId,
          groupGeneration: input.resetGroupGeneration,
          groupId: resetGroupId,
          cryptoProfile: group.cryptoProfile,
          ciphersuite: group.ciphersuite,
          currentEpoch: 0n,
          createdByCryptoDeviceId: actor.cryptoDeviceId,
          createdAt: now,
        });
        await insertPartnershipCryptoMember(transaction, {
          partnershipId,
          groupGeneration: input.resetGroupGeneration,
          cryptoDeviceId: actor.cryptoDeviceId,
          accountId: auth.session.accountId,
          leafIndex: input.resetFounderLeafIndex,
          joinedEpoch: 0n,
          joinedAt: now,
        });

        const controlMessage = decode(input.controlMessage);
        await insertPartnershipCryptoControlMessage(transaction, {
          partnershipId,
          groupGeneration: input.resetGroupGeneration,
          controlSequence: 1n,
          kind: "reset",
          epochFrom: 0n,
          epochTo: 0n,
          senderCryptoDeviceId: actor.cryptoDeviceId,
          targetCryptoDeviceId: null,
          mlsMessage: controlMessage,
          welcome: null,
          messageSha256: digest(controlMessage),
          createdAt: now,
        });
        const activated = await activateResetPartnershipCryptoGeneration(
          transaction,
          {
            partnershipId,
            groupGeneration: input.resetGroupGeneration,
            controlSequence: 1n,
            updatedAt: now,
          },
        );
        if (!activated) throw new ApiError(409, "CRYPTO_GROUP_RESET_REQUIRED");

        return {
          groupGeneration: input.resetGroupGeneration,
          currentEpoch: 0,
          controlSequence: 1,
          rekeyRequired: false,
          cryptoRequired: true,
        };
      }

      const actorMember = await cryptoDeviceIsActiveGroupMember(transaction, {
        partnershipId,
        groupGeneration: group.groupGeneration,
        cryptoDeviceId: actor.cryptoDeviceId,
      });
      if (!actorMember) throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
      if (group.rekeyRequired && input.kind !== "remove") {
        throw new ApiError(409, "CRYPTO_REKEY_REQUIRED");
      }

      let target: DeviceCryptoIdentity | null = null;
      let keyPackageId: string | null = null;

      if (input.kind === "add") {
        if (!input.targetCryptoDeviceId || !input.keyPackageId || input.targetLeafIndex === null) {
          throw new ApiError(400, "VALIDATION_FAILED");
        }
        target = await lockDeviceCryptoIdentity(transaction, input.targetCryptoDeviceId);
        if (!target || target.trustState !== "trusted" || target.revokedAt) {
          throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
        }
        if (
          !(await accountIsCurrentPartnershipMember(
            transaction,
            target.accountId,
            partnershipId,
          ))
        ) {
          throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
        }
        const alreadyMember = await cryptoDeviceIsActiveGroupMember(transaction, {
          partnershipId,
          groupGeneration: group.groupGeneration,
          cryptoDeviceId: target.cryptoDeviceId,
        });
        if (alreadyMember) throw new ApiError(409, "CRYPTO_DEVICE_ALREADY_MEMBER");

        const keyPackage = await lockAvailableCryptoKeyPackage(transaction, input.keyPackageId);
        if (!keyPackage || keyPackage.cryptoDeviceId !== target.cryptoDeviceId) {
          throw new ApiError(409, "CRYPTO_KEY_PACKAGE_REQUIRED");
        }
        keyPackageId = keyPackage.keyPackageId;
      } else if (input.kind === "remove") {
        if (!input.targetCryptoDeviceId || input.targetLeafIndex === null) {
          throw new ApiError(400, "VALIDATION_FAILED");
        }
        target = await lockDeviceCryptoIdentity(transaction, input.targetCryptoDeviceId);
        if (!target || target.trustState !== "revoked") {
          throw new ApiError(409, "CRYPTO_REMOVE_REQUIRES_REVOKED_DEVICE");
        }
        const member = await cryptoDeviceIsActiveGroupMember(transaction, {
          partnershipId,
          groupGeneration: group.groupGeneration,
          cryptoDeviceId: target.cryptoDeviceId,
        });
        if (!member || member.leafIndex !== input.targetLeafIndex) {
          throw new ApiError(409, "CRYPTO_EPOCH_CONFLICT");
        }
      }

      const nextSequence = await advancePartnershipCryptoGroup(transaction, {
        partnershipId,
        groupGeneration: group.groupGeneration,
        expectedEpoch: group.currentEpoch,
        newEpoch: BigInt(input.newEpoch),
      });
      if (nextSequence === null) throw new ApiError(409, "CRYPTO_EPOCH_CONFLICT");

      if (input.kind === "add" && target && input.targetLeafIndex !== null && keyPackageId) {
        const consumed = await consumeCryptoKeyPackage(
          transaction,
          keyPackageId,
          partnershipId,
          now,
        );
        if (!consumed) throw new ApiError(409, "CRYPTO_KEY_PACKAGE_REQUIRED");
        await insertPartnershipCryptoMember(transaction, {
          partnershipId,
          groupGeneration: group.groupGeneration,
          cryptoDeviceId: target.cryptoDeviceId,
          accountId: target.accountId,
          leafIndex: input.targetLeafIndex,
          joinedEpoch: BigInt(input.newEpoch),
          joinedAt: now,
        });
      }

      if (input.kind === "remove" && target && input.targetLeafIndex !== null) {
        const removed = await removePartnershipCryptoMember(transaction, {
          partnershipId,
          groupGeneration: group.groupGeneration,
          cryptoDeviceId: target.cryptoDeviceId,
          expectedLeafIndex: input.targetLeafIndex,
          removedEpoch: BigInt(input.newEpoch),
          removedAt: now,
        });
        if (!removed) throw new ApiError(409, "CRYPTO_EPOCH_CONFLICT");
      }

      const controlMessage = decode(input.controlMessage);
      await insertPartnershipCryptoControlMessage(transaction, {
        partnershipId,
        groupGeneration: group.groupGeneration,
        controlSequence: nextSequence,
        kind: input.kind,
        epochFrom: group.currentEpoch,
        epochTo: BigInt(input.newEpoch),
        senderCryptoDeviceId: actor.cryptoDeviceId,
        targetCryptoDeviceId: input.targetCryptoDeviceId,
        mlsMessage: controlMessage,
        welcome: input.welcome ? decode(input.welcome) : null,
        messageSha256: digest(controlMessage),
        createdAt: now,
      });

      const rekeyRequired =
        input.kind === "remove"
          ? await refreshPartnershipCryptoRekeyRequired(
              transaction,
              partnershipId,
              group.groupGeneration,
            )
          : group.rekeyRequired;
      const cryptoRequired = await activatePartnershipCryptoIfReady(transaction, {
        partnershipId,
        groupGeneration: group.groupGeneration,
        cryptoProfile: S1_CRYPTO_PROFILE,
        activatedAt: now,
      });

      return {
        groupGeneration: group.groupGeneration,
        currentEpoch: input.newEpoch,
        controlSequence: safeNumber(nextSequence),
        rekeyRequired,
        cryptoRequired,
      };
    });
  }

  async controls(
    auth: AuthContext,
    partnershipId: string,
    query: CryptoControlQuery,
  ): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      if (
        !(await accountIsCurrentPartnershipMember(
          transaction,
          auth.session.accountId,
          partnershipId,
        ))
      ) {
        throw new ApiError(404, "PARTNERSHIP_UNAVAILABLE");
      }
      const current = await this.#currentIdentity(transaction, auth, "trusted");
      const group = await loadActivePartnershipCryptoGroup(transaction, partnershipId);
      if (!group) throw new ApiError(409, "CRYPTO_GROUP_NOT_READY");

      const rows = await listPartnershipCryptoControlMessages(transaction, {
        partnershipId,
        groupGeneration: group.groupGeneration,
        after: BigInt(query.after),
        limit: query.limit + 1,
      });
      const visible = rows.slice(0, query.limit);
      return {
        groupGeneration: group.groupGeneration,
        currentEpoch: safeNumber(group.currentEpoch),
        latestControlSequence: safeNumber(group.controlSequence),
        hasMore: rows.length > query.limit,
        items: visible.map((row) => ({
          controlSequence: safeNumber(row.controlSequence),
          kind: row.kind,
          epochFrom: safeNumber(row.epochFrom),
          epochTo: safeNumber(row.epochTo),
          senderCryptoDeviceId: row.senderCryptoDeviceId,
          targetCryptoDeviceId: row.targetCryptoDeviceId,
          controlMessage: encode(row.mlsMessage),
          welcome:
            row.targetCryptoDeviceId === current.cryptoDeviceId && row.welcome
              ? encode(row.welcome)
              : null,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  async setupRecovery(auth: AuthContext, input: CryptoRecoverySetupInput): Promise<unknown> {
    const hpkePublic = decode(input.recoveryHpkePublicKey);
    const authPublic = requireRawEd25519(input.recoveryAuthPublicKey);
    if (hpkePublic.length !== 32) throw new ApiError(400, "VALIDATION_FAILED");
    const encryptedBundle = decode(input.encryptedBundle);

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      const current = await this.#currentIdentity(transaction, auth, "trusted");
      const existing = await loadCurrentCryptoRecovery(transaction, auth.session.accountId);
      if (
        existing &&
        input.recoveryKeyVersion !== existing.recoveryKeyVersion + 1
      ) {
        throw new ApiError(409, "CRYPTO_RECOVERY_VERSION_CONFLICT");
      }
      if (!existing && input.recoveryKeyVersion !== 1) {
        throw new ApiError(409, "CRYPTO_RECOVERY_VERSION_CONFLICT");
      }

      await replaceCryptoRecovery(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        cryptoProfile: input.cryptoProfile,
        recoveryKeyVersion: input.recoveryKeyVersion,
        recoveryHpkePublicKey: hpkePublic,
        recoveryAuthPublicKey: authPublic,
        encryptedBundle,
        createdByCryptoDeviceId: current.cryptoDeviceId,
        createdAt: now,
      });

      let cryptoRequired = false;
      const partnership = await getCurrentPartnershipForAccount(
        transaction,
        auth.session.accountId,
      );
      if (partnership) {
        const group = await loadActivePartnershipCryptoGroup(
          transaction,
          partnership.partnershipId,
        );
        if (group) {
          cryptoRequired = await activatePartnershipCryptoIfReady(transaction, {
            partnershipId: partnership.partnershipId,
            groupGeneration: group.groupGeneration,
            cryptoProfile: S1_CRYPTO_PROFILE,
            activatedAt: now,
          });
        }
      }

      return {
        cryptoProfile: input.cryptoProfile,
        recoveryKeyVersion: input.recoveryKeyVersion,
        createdAt: now.toISOString(),
        cryptoRequired,
      };
    });
  }

  async recoveryBundle(auth: AuthContext): Promise<unknown> {
    const recovery = await loadCurrentCryptoRecovery(
      this.database.pool,
      auth.session.accountId,
    );
    if (!recovery) throw new ApiError(404, "CRYPTO_RECOVERY_UNAVAILABLE");
    return {
      cryptoProfile: recovery.cryptoProfile,
      recoveryKeyVersion: recovery.recoveryKeyVersion,
      recoveryHpkePublicKey: encode(recovery.recoveryHpkePublicKey),
      recoveryAuthPublicKey: encode(recovery.recoveryAuthPublicKey),
      encryptedBundle: encode(recovery.encryptedBundle),
      createdAt: recovery.createdAt.toISOString(),
    };
  }

  async createRecoveryChallenge(
    auth: AuthContext,
    input: CryptoRecoveryChallengeInput,
  ): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const current = await this.#currentIdentity(transaction, auth, "any");
      if (
        current.cryptoDeviceId !== input.targetCryptoDeviceId ||
        current.trustState !== "pending"
      ) {
        throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
      }
      const recovery = await loadCurrentCryptoRecovery(transaction, auth.session.accountId);
      if (!recovery) throw new ApiError(404, "CRYPTO_RECOVERY_UNAVAILABLE");

      const id = randomUUID();
      const challenge = randomBytes(32);
      const expiresAt = new Date(now.getTime() + TEN_MINUTES_MS);
      await insertCryptoRecoveryChallenge(transaction, {
        id,
        accountId: auth.session.accountId,
        targetCryptoDeviceId: current.cryptoDeviceId,
        recoveryKeyVersion: recovery.recoveryKeyVersion,
        challenge,
        createdAt: now,
        expiresAt,
      });
      return {
        challengeId: id,
        challenge: encode(challenge),
        recoveryKeyVersion: recovery.recoveryKeyVersion,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async proveRecovery(auth: AuthContext, input: CryptoRecoveryProofInput): Promise<unknown> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      const current = await this.#currentIdentity(transaction, auth, "any");
      if (current.trustState === "trusted") return { device: identityProjection(current) };
      if (current.trustState !== "pending") {
        throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
      }

      const challenge = await lockCryptoRecoveryChallenge(
        transaction,
        input.challengeId,
        auth.session.accountId,
      );
      if (
        !challenge ||
        challenge.targetCryptoDeviceId !== current.cryptoDeviceId ||
        now.getTime() >= challenge.expiresAt.getTime()
      ) {
        throw new ApiError(409, "CRYPTO_RECOVERY_FAILED");
      }
      const recovery = await loadCurrentCryptoRecovery(transaction, auth.session.accountId);
      if (
        !recovery ||
        recovery.recoveryKeyVersion !== challenge.recoveryKeyVersion
      ) {
        throw new ApiError(409, "CRYPTO_RECOVERY_FAILED");
      }

      const signature = requireSignature(input.recoverySignature);
      const payload = recoveryProofPayload(
        auth.session.accountId,
        current.cryptoDeviceId,
        challenge.id,
        challenge.challenge,
        challenge.recoveryKeyVersion,
      );
      if (!verifyRawEd25519(recovery.recoveryAuthPublicKey, payload, signature)) {
        throw new ApiError(403, "CRYPTO_RECOVERY_FAILED");
      }

      const changed = await markCryptoDeviceTrusted(transaction, {
        cryptoDeviceId: current.cryptoDeviceId,
        approvedByCryptoDeviceId: null,
        approvedAt: now,
      });
      if (!changed) throw new ApiError(409, "CRYPTO_RECOVERY_FAILED");
      const consumed = await consumeCryptoRecoveryChallenge(transaction, challenge.id, now);
      if (!consumed) throw new ApiError(409, "CRYPTO_RECOVERY_FAILED");
      await insertCryptoDeviceApproval(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        targetCryptoDeviceId: current.cryptoDeviceId,
        approverCryptoDeviceId: null,
        approvalKind: "recovery",
        approvalSignature: null,
        createdAt: now,
      });

      const trusted = await loadDeviceCryptoIdentity(transaction, current.cryptoDeviceId);
      if (!trusted) throw new Error("Recovered crypto identity disappeared");
      return { device: identityProjection(trusted) };
    });
  }
}
