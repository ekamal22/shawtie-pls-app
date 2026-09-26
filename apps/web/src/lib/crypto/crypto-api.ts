import type {
  CryptoBootstrapInput,
  CryptoCommitInput,
  CryptoDeviceApprovalInput,
  CryptoDeviceEnrollInput,
  CryptoKeyPackageUploadInput,
  CryptoRecoveryChallengeInput,
  CryptoRecoveryProofInput,
  CryptoRecoverySetupInput,
} from "@shawtie/contracts";
import { apiRequest } from "../api-client.ts";

export interface CryptoDeviceProjection {
  readonly cryptoDeviceId: string;
  readonly deviceId: string;
  readonly accountId: string;
  readonly cryptoProfile: string;
  readonly mlsSigningPublicKey: string;
  readonly contentSigningPublicKey: string;
  readonly trustState: "pending" | "trusted" | "revoked";
  readonly approvedAt: string | null;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface CryptoPartnershipState {
  readonly cryptoProfile: string;
  readonly cryptoRequired: boolean;
  readonly cryptoRequiredFrom: string | null;
  readonly currentCryptoDeviceId: string;
  readonly group: {
    readonly partnershipId: string;
    readonly groupGeneration: number;
    readonly groupId: string;
    readonly ciphersuite: string;
    readonly currentEpoch: number;
    readonly controlSequence: number;
    readonly rekeyRequired: boolean;
  } | null;
  readonly devices: readonly CryptoDeviceProjection[];
  readonly members: readonly {
    readonly cryptoDeviceId: string;
    readonly accountId: string;
    readonly leafIndex: number;
    readonly joinedEpoch: number;
    readonly removedEpoch: number | null;
    readonly removedAt: string | null;
  }[];
  readonly keyPackages: readonly {
    readonly keyPackageId: string;
    readonly cryptoDeviceId: string;
    readonly accountId: string;
    readonly keyPackage: string;
  }[];
  readonly recoveryRecipients: readonly {
    readonly accountId: string;
    readonly recoveryKeyVersion: number;
    readonly recoveryHpkePublicKey: string;
  }[];
  readonly legacyPlaintextBlocker: boolean;
}

export interface CryptoControlPage {
  readonly groupGeneration: number;
  readonly currentEpoch: number;
  readonly latestControlSequence: number;
  readonly hasMore: boolean;
  readonly items: readonly {
    readonly controlSequence: number;
    readonly kind: "add" | "remove" | "update" | "reset";
    readonly epochFrom: number;
    readonly epochTo: number;
    readonly senderCryptoDeviceId: string;
    readonly targetCryptoDeviceId: string | null;
    readonly controlMessage: string;
    readonly welcome: string | null;
    readonly createdAt: string;
  }[];
}

export interface CryptoRecoveryBundleProjection {
  readonly cryptoProfile: string;
  readonly recoveryKeyVersion: number;
  readonly recoveryHpkePublicKey: string;
  readonly recoveryAuthPublicKey: string;
  readonly encryptedBundle: string;
  readonly createdAt: string;
}

export function enrollCryptoDevice(input: CryptoDeviceEnrollInput) {
  return apiRequest<{ device: CryptoDeviceProjection; initialTrust?: boolean }>(
    "/api/v1/crypto/devices/enroll",
    { method: "POST", body: input },
  );
}

export function loadCurrentCryptoDevice() {
  return apiRequest<{ device: CryptoDeviceProjection }>(
    "/api/v1/crypto/devices/current",
  );
}

export function listCryptoDevices() {
  return apiRequest<{ devices: readonly CryptoDeviceProjection[] }>(
    "/api/v1/crypto/devices",
  );
}

export function uploadCryptoKeyPackages(
  cryptoDeviceId: string,
  input: CryptoKeyPackageUploadInput,
) {
  return apiRequest<{ accepted: number }>(
    "/api/v1/crypto/devices/" + cryptoDeviceId + "/key-packages",
    { method: "POST", body: input },
  );
}

export function approveCryptoDevice(
  cryptoDeviceId: string,
  input: CryptoDeviceApprovalInput,
) {
  return apiRequest<{ device: CryptoDeviceProjection }>(
    "/api/v1/crypto/devices/" + cryptoDeviceId + "/approve",
    { method: "POST", body: input },
  );
}

export function loadCryptoPartnershipState(
  partnershipId: string,
): Promise<CryptoPartnershipState> {
  return apiRequest(
    "/api/v1/crypto/partnerships/" + partnershipId + "/state",
  );
}

export function bootstrapCryptoPartnership(
  partnershipId: string,
  input: CryptoBootstrapInput,
) {
  return apiRequest<{
    groupGeneration: number;
    currentEpoch: number;
    controlSequence: number;
    cryptoRequired: boolean;
  }>("/api/v1/crypto/partnerships/" + partnershipId + "/bootstrap", {
    method: "POST",
    body: input,
  });
}

export function commitCryptoPartnership(
  partnershipId: string,
  input: CryptoCommitInput,
) {
  return apiRequest<{
    groupGeneration: number;
    currentEpoch: number;
    controlSequence: number;
    rekeyRequired: boolean;
    cryptoRequired: boolean;
  }>("/api/v1/crypto/partnerships/" + partnershipId + "/commits", {
    method: "POST",
    body: input,
  });
}

export function loadCryptoControls(
  partnershipId: string,
  after: number,
  limit = 100,
): Promise<CryptoControlPage> {
  return apiRequest(
    "/api/v1/crypto/partnerships/" +
      partnershipId +
      "/control?after=" +
      after +
      "&limit=" +
      limit,
  );
}

export function setupCryptoRecovery(input: CryptoRecoverySetupInput) {
  return apiRequest<{
    cryptoProfile: string;
    recoveryKeyVersion: number;
    createdAt: string;
    cryptoRequired: boolean;
  }>("/api/v1/crypto/recovery/setup", {
    method: "POST",
    body: input,
  });
}

export function loadCryptoRecoveryBundle(): Promise<CryptoRecoveryBundleProjection> {
  return apiRequest("/api/v1/crypto/recovery/bundle");
}

export function createCryptoRecoveryChallenge(
  input: CryptoRecoveryChallengeInput,
) {
  return apiRequest<{
    challengeId: string;
    challenge: string;
    recoveryKeyVersion: number;
    expiresAt: string;
  }>("/api/v1/crypto/recovery/challenge", {
    method: "POST",
    body: input,
  });
}

export function proveCryptoRecovery(input: CryptoRecoveryProofInput) {
  return apiRequest<{ device: CryptoDeviceProjection }>(
    "/api/v1/crypto/recovery/prove",
    { method: "POST", body: input },
  );
}
