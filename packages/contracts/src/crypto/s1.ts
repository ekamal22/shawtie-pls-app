import { z } from "zod";

export const S1_CRYPTO_PROFILE = "shawtie.mls.v1" as const;
export const S1_MLS_CIPHERSUITE =
  "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519" as const;
export const S1_MAX_KEY_PACKAGE_BYTES = 64 * 1024;
export const S1_MAX_CONTROL_MESSAGE_BYTES = 1024 * 1024;
export const S1_MAX_RECOVERY_BUNDLE_BYTES = 1024 * 1024;
export const S1_KEY_PACKAGE_BATCH_MAX = 20;
export const S1_CONTROL_PAGE_MAX = 100;

const base64Url = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/u);

function boundedBase64(maxBytes: number) {
  return base64Url.max(Math.ceil((maxBytes * 4) / 3) + 8);
}

export const s1CryptoProfileSchema = z.literal(S1_CRYPTO_PROFILE);
export const s1CiphersuiteSchema = z.literal(S1_MLS_CIPHERSUITE);
export const cryptoDeviceIdParamsSchema = z.object({
  cryptoDeviceId: z.string().uuid(),
});

export const cryptoKeyPackageSchema = z.object({
  keyPackageId: z.string().uuid(),
  keyPackage: boundedBase64(S1_MAX_KEY_PACKAGE_BYTES),
});

export const cryptoDeviceEnrollSchema = z.object({
  cryptoDeviceId: z.string().uuid(),
  cryptoProfile: s1CryptoProfileSchema,
  mlsSigningPublicKey: boundedBase64(256),
  contentSigningPublicKey: boundedBase64(256),
  identityProofSignature: boundedBase64(512),
  keyPackages: z.array(cryptoKeyPackageSchema).min(1).max(S1_KEY_PACKAGE_BATCH_MAX),
});

export const cryptoKeyPackageUploadSchema = z.object({
  keyPackages: z.array(cryptoKeyPackageSchema).min(1).max(S1_KEY_PACKAGE_BATCH_MAX),
});

export const cryptoDeviceApprovalSchema = z.object({
  approvalSignature: boundedBase64(512),
});

export const cryptoPartnershipIdParamsSchema = z.object({
  partnershipId: z.string().uuid(),
});

export const cryptoControlQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(S1_CONTROL_PAGE_MAX).default(50),
});

export const cryptoBootstrapSchema = z.object({
  cryptoProfile: s1CryptoProfileSchema,
  ciphersuite: s1CiphersuiteSchema,
  groupGeneration: z.number().int().positive(),
  groupId: boundedBase64(256),
  epoch: z.number().int().min(0),
  founderLeafIndex: z.number().int().min(0),
});

export const cryptoCommitKindSchema = z.enum(["add", "remove", "update", "reset"]);

export const cryptoCommitSchema = z
  .object({
    expectedGroupGeneration: z.number().int().positive(),
    expectedEpoch: z.number().int().min(0),
    newEpoch: z.number().int().min(0),
    kind: cryptoCommitKindSchema,
    controlMessage: boundedBase64(S1_MAX_CONTROL_MESSAGE_BYTES),
    welcome: boundedBase64(S1_MAX_CONTROL_MESSAGE_BYTES).nullable().default(null),
    targetCryptoDeviceId: z.string().uuid().nullable().default(null),
    targetLeafIndex: z.number().int().min(0).nullable().default(null),
    keyPackageId: z.string().uuid().nullable().default(null),
    resetGroupGeneration: z.number().int().positive().nullable().default(null),
    resetGroupId: boundedBase64(256).nullable().default(null),
    resetFounderLeafIndex: z.number().int().min(0).nullable().default(null),
    recoveryKeyVersion: z.number().int().positive().nullable().default(null),
    recoverySignature: boundedBase64(512).nullable().default(null),
  })
  .superRefine((value, context) => {
    const resetFieldsPresent =
      value.resetGroupGeneration !== null ||
      value.resetGroupId !== null ||
      value.resetFounderLeafIndex !== null ||
      value.recoveryKeyVersion !== null ||
      value.recoverySignature !== null;

    if (value.kind === "reset") {
      if (
        value.newEpoch !== 0 ||
        value.resetGroupGeneration !== value.expectedGroupGeneration + 1 ||
        !value.resetGroupId ||
        value.resetFounderLeafIndex === null ||
        value.recoveryKeyVersion === null ||
        !value.recoverySignature ||
        value.welcome !== null ||
        value.targetCryptoDeviceId !== null ||
        value.targetLeafIndex !== null ||
        value.keyPackageId !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "reset commit requires recovery proof and a fresh next-generation group",
        });
      }
      return;
    }

    if (resetFieldsPresent) {
      context.addIssue({
        code: "custom",
        message: "reset fields are only valid for reset commits",
      });
    }
    if (value.newEpoch !== value.expectedEpoch + 1) {
      context.addIssue({
        code: "custom",
        path: ["newEpoch"],
        message: "newEpoch must advance exactly one MLS epoch",
      });
    }
    if (value.kind === "add") {
      if (
        !value.welcome ||
        !value.targetCryptoDeviceId ||
        !value.keyPackageId ||
        value.targetLeafIndex === null
      ) {
        context.addIssue({
          code: "custom",
          message: "add commit requires welcome, target device, target leaf, and KeyPackage",
        });
      }
    } else if (value.welcome !== null || value.keyPackageId !== null) {
      context.addIssue({
        code: "custom",
        message: "only add commits may carry Welcome or KeyPackage identifiers",
      });
    }
    if (
      value.kind === "remove" &&
      (!value.targetCryptoDeviceId || value.targetLeafIndex === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "remove commit requires target device and target leaf",
      });
    }
  });


export function cryptoResetProofText(input: {
  readonly accountId: string;
  readonly partnershipId: string;
  readonly cryptoDeviceId: string;
  readonly expectedGroupGeneration: number;
  readonly expectedEpoch: number;
  readonly resetGroupGeneration: number;
  readonly resetGroupId: string;
  readonly resetFounderLeafIndex: number;
  readonly recoveryKeyVersion: number;
}): string {
  return [
    "shawtie-group-reset-v1",
    input.accountId,
    input.partnershipId,
    input.cryptoDeviceId,
    String(input.expectedGroupGeneration),
    String(input.expectedEpoch),
    String(input.resetGroupGeneration),
    input.resetGroupId,
    String(input.resetFounderLeafIndex),
    String(input.recoveryKeyVersion),
  ].join("\0");
}

export const cryptoRecoverySetupSchema = z.object({
  cryptoProfile: s1CryptoProfileSchema,
  recoveryKeyVersion: z.number().int().positive(),
  recoveryHpkePublicKey: boundedBase64(512),
  recoveryAuthPublicKey: boundedBase64(512),
  encryptedBundle: boundedBase64(S1_MAX_RECOVERY_BUNDLE_BYTES),
});

export const cryptoRecoveryChallengeSchema = z.object({
  targetCryptoDeviceId: z.string().uuid(),
});

export const cryptoRecoveryProofSchema = z.object({
  challengeId: z.string().uuid(),
  recoverySignature: boundedBase64(512),
});

export type CryptoDeviceEnrollInput = z.infer<typeof cryptoDeviceEnrollSchema>;
export type CryptoKeyPackageUploadInput = z.infer<typeof cryptoKeyPackageUploadSchema>;
export type CryptoDeviceApprovalInput = z.infer<typeof cryptoDeviceApprovalSchema>;
export type CryptoControlQuery = z.infer<typeof cryptoControlQuerySchema>;
export type CryptoBootstrapInput = z.infer<typeof cryptoBootstrapSchema>;
export type CryptoCommitInput = z.infer<typeof cryptoCommitSchema>;
export type CryptoCommitKind = z.infer<typeof cryptoCommitKindSchema>;
export type CryptoRecoverySetupInput = z.infer<typeof cryptoRecoverySetupSchema>;
export type CryptoRecoveryChallengeInput = z.infer<typeof cryptoRecoveryChallengeSchema>;
export type CryptoRecoveryProofInput = z.infer<typeof cryptoRecoveryProofSchema>;
