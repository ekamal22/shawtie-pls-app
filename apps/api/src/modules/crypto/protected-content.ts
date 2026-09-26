import { createHash } from "node:crypto";
import {
  S1_CRYPTO_PROFILE,
  type ProtectedContentEnvelopeInput,
} from "@shawtie/contracts";
import {
  cryptoDeviceIsActiveGroupMember,
  insertProtectedContentKey,
  listPartnershipRecoveryRecipients,
  loadActivePartnershipCryptoGroup,
  loadDeviceCryptoIdentityByDevice,
  loadPartnershipCryptoPolicy,
  type ProtectedContentKeyRecord,
  type ProtectedContentType,
  type ProtectedPayloadRole,
  type QueryExecutor,
} from "@shawtie/db";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";
import { verifyRawEd25519 } from "./ed25519.ts";

interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}
type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | CanonicalObject;

function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite canonical number");
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item))
      .join(",") +
    "}"
  );
}

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

function equal(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function contentSignaturePayload(
  input: {
    readonly partnershipId: string;
    readonly contentType: ProtectedContentType;
    readonly contentId: string;
    readonly contentVersion: bigint;
    readonly payloadRole: ProtectedPayloadRole;
    readonly schemaVersion: number;
  },
  envelope: ProtectedContentEnvelopeInput,
  nonce: Buffer,
  ciphertextDigest: Buffer,
): Buffer {
  const canonical = canonicalJson({
    contentId: input.contentId,
    contentType: input.contentType,
    contentVersion: Number(input.contentVersion),
    cryptoProfile: envelope.cryptoProfile,
    groupGeneration: envelope.groupGeneration,
    mlsEpoch: envelope.mlsEpoch,
    partnershipId: input.partnershipId,
    payloadRole: input.payloadRole,
    schemaVersion: input.schemaVersion,
    senderCryptoDeviceId: envelope.senderCryptoDeviceId,
  });
  return Buffer.concat([
    Buffer.from("shawtie-content-signature-v1\0", "utf8"),
    Buffer.from(canonical, "utf8"),
    Buffer.from("\0", "utf8"),
    Buffer.from(envelope.contentKeyId, "utf8"),
    Buffer.from("\0", "utf8"),
    Buffer.from(encode(nonce), "utf8"),
    Buffer.from("\0", "utf8"),
    ciphertextDigest,
  ]);
}

export interface ProtectedWriteContext {
  readonly partnershipId: string;
  readonly contentType: ProtectedContentType;
  readonly contentId: string;
  readonly contentVersion: bigint;
  readonly payloadRole: ProtectedPayloadRole;
  readonly schemaVersion: number;
  readonly ciphertextSha256: Buffer;
  readonly at: Date;
}

export async function requireCryptoProtectedWrite(
  executor: QueryExecutor,
  auth: AuthContext,
  context: ProtectedWriteContext,
  envelope: ProtectedContentEnvelopeInput,
): Promise<void> {
  const policy = await loadPartnershipCryptoPolicy(executor, context.partnershipId);
  if (!policy || !policy.cryptoRequiredFrom || policy.cryptoProfile !== S1_CRYPTO_PROFILE) {
    throw new ApiError(409, "CRYPTO_NOT_INITIALIZED");
  }
  const group = await loadActivePartnershipCryptoGroup(executor, context.partnershipId);
  if (
    !group ||
    group.cryptoProfile !== S1_CRYPTO_PROFILE ||
    group.groupGeneration !== policy.groupGeneration
  ) {
    throw new ApiError(409, "CRYPTO_GROUP_NOT_READY");
  }
  if (group.rekeyRequired) throw new ApiError(409, "CRYPTO_REKEY_REQUIRED");
  if (
    envelope.cryptoProfile !== group.cryptoProfile ||
    envelope.groupGeneration !== group.groupGeneration ||
    BigInt(envelope.mlsEpoch) !== group.currentEpoch
  ) {
    throw new ApiError(409, "CRYPTO_EPOCH_CONFLICT");
  }
  if (!auth.session.deviceId) throw new ApiError(409, "CRYPTO_DEVICE_UNAVAILABLE");
  const identity = await loadDeviceCryptoIdentityByDevice(
    executor,
    auth.session.accountId,
    auth.session.deviceId,
  );
  if (
    !identity ||
    identity.cryptoDeviceId !== envelope.senderCryptoDeviceId ||
    identity.trustState !== "trusted" ||
    identity.revokedAt
  ) {
    throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
  }
  const membership = await cryptoDeviceIsActiveGroupMember(executor, {
    partnershipId: context.partnershipId,
    groupGeneration: group.groupGeneration,
    cryptoDeviceId: identity.cryptoDeviceId,
  });
  if (!membership || membership.accountId !== auth.session.accountId) {
    throw new ApiError(409, "CRYPTO_DEVICE_UNTRUSTED");
  }

  const nonce = decode(envelope.nonce);
  if (nonce.length !== 12) throw new ApiError(400, "CRYPTO_CIPHERTEXT_INVALID");
  const claimedDigest = decode(envelope.ciphertextSha256);
  if (claimedDigest.length !== 32 || !equal(claimedDigest, context.ciphertextSha256)) {
    throw new ApiError(400, "CRYPTO_CIPHERTEXT_INVALID");
  }
  const signature = decode(envelope.contentSignature);
  if (
    signature.length !== 64 ||
    !verifyRawEd25519(
      identity.contentSigningPublicKey,
      contentSignaturePayload(context, envelope, nonce, context.ciphertextSha256),
      signature,
    )
  ) {
    throw new ApiError(403, "CRYPTO_SIGNATURE_INVALID");
  }

  const recipients = await listPartnershipRecoveryRecipients(executor, context.partnershipId);
  if (recipients.length !== 2 || envelope.recoveryCapsules.length !== 2) {
    throw new ApiError(409, "CRYPTO_RECOVERY_REQUIRED");
  }
  const expected = new Map(
    recipients.map((recipient) => [
      recipient.accountId,
      recipient.recoveryKeyVersion,
    ] as const),
  );
  for (const capsule of envelope.recoveryCapsules) {
    const version = expected.get(capsule.accountId);
    if (version === undefined || version !== capsule.recoveryKeyVersion) {
      throw new ApiError(409, "CRYPTO_RECOVERY_VERSION_CONFLICT");
    }
    expected.delete(capsule.accountId);
  }
  if (expected.size !== 0) throw new ApiError(409, "CRYPTO_RECOVERY_REQUIRED");

  await insertProtectedContentKey(executor, {
    id: envelope.contentKeyId,
    partnershipId: context.partnershipId,
    contentType: context.contentType,
    contentId: context.contentId,
    contentVersion: context.contentVersion,
    payloadRole: context.payloadRole,
    cryptoProfile: envelope.cryptoProfile,
    groupGeneration: envelope.groupGeneration,
    mlsEpoch: BigInt(envelope.mlsEpoch),
    senderCryptoDeviceId: envelope.senderCryptoDeviceId,
    nonce,
    keyDistributionMessage: decode(envelope.keyDistributionMessage),
    ciphertextSha256: context.ciphertextSha256,
    contentSignature: signature,
    createdAt: context.at,
    recoveryCapsules: envelope.recoveryCapsules.map((capsule) => ({
      accountId: capsule.accountId,
      recoveryKeyVersion: capsule.recoveryKeyVersion,
      hpkeEncapsulation: decode(capsule.encapsulation),
      hpkeCiphertext: decode(capsule.ciphertext),
    })),
  });
}

export function protectedContentProjection(
  record: ProtectedContentKeyRecord,
  accountId: string,
): unknown {
  const recovery = record.recoveryCapsules.find((capsule) => capsule.accountId === accountId);
  return {
    cryptoProfile: record.cryptoProfile,
    groupGeneration: record.groupGeneration,
    mlsEpoch: Number(record.mlsEpoch),
    senderCryptoDeviceId: record.senderCryptoDeviceId,
    contentKeyId: record.id,
    nonce: encode(record.nonce),
    ciphertextSha256: encode(record.ciphertextSha256),
    keyDistributionMessage: encode(record.keyDistributionMessage),
    contentSignature: encode(record.contentSignature),
    recoveryCapsule: recovery
      ? {
          accountId: recovery.accountId,
          recoveryKeyVersion: recovery.recoveryKeyVersion,
          encapsulation: encode(recovery.hpkeEncapsulation),
          ciphertext: encode(recovery.hpkeCiphertext),
        }
      : null,
  };
}

export function ciphertextDigest(ciphertext: Uint8Array): Buffer {
  return createHash("sha256").update(ciphertext).digest();
}


export function protectedContentInputProjection(
  record: ProtectedContentKeyRecord,
  ciphertext: Buffer,
): unknown {
  return {
    ciphertext: ciphertext.toString("base64url"),
    envelope: {
      cryptoProfile: record.cryptoProfile,
      groupGeneration: record.groupGeneration,
      mlsEpoch: Number(record.mlsEpoch),
      senderCryptoDeviceId: record.senderCryptoDeviceId,
      contentKeyId: record.id,
      nonce: encode(record.nonce),
      ciphertextSha256: encode(record.ciphertextSha256),
      keyDistributionMessage: encode(record.keyDistributionMessage),
      contentSignature: encode(record.contentSignature),
      recoveryCapsules: record.recoveryCapsules.map((capsule) => ({
        accountId: capsule.accountId,
        recoveryKeyVersion: capsule.recoveryKeyVersion,
        encapsulation: encode(capsule.hpkeEncapsulation),
        ciphertext: encode(capsule.hpkeCiphertext),
      })),
    },
  };
}
