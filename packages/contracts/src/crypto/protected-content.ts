import { z } from "zod";
import {
  S1_CRYPTO_PROFILE,
  S1_MAX_CONTROL_MESSAGE_BYTES,
} from "./s1.ts";

const base64Url = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/u);

function boundedBase64(maxBytes: number) {
  return base64Url.max(Math.ceil((maxBytes * 4) / 3) + 8);
}

export const S1_MAX_PROTECTED_TEXT_CIPHERTEXT_BYTES = 4 * 1024 * 1024;
export const S1_MAX_KEY_DISTRIBUTION_BYTES = S1_MAX_CONTROL_MESSAGE_BYTES;
export const S1_MAX_RECOVERY_CAPSULE_BYTES = 4096;

export const recoveryCapsuleSchema = z.object({
  accountId: z.string().uuid(),
  recoveryKeyVersion: z.number().int().positive(),
  encapsulation: boundedBase64(S1_MAX_RECOVERY_CAPSULE_BYTES),
  ciphertext: boundedBase64(S1_MAX_RECOVERY_CAPSULE_BYTES),
});

export const protectedContentEnvelopeSchema = z
  .object({
    cryptoProfile: z.literal(S1_CRYPTO_PROFILE),
    groupGeneration: z.number().int().positive(),
    mlsEpoch: z.number().int().min(0),
    senderCryptoDeviceId: z.string().uuid(),
    contentKeyId: z.string().uuid(),
    nonce: boundedBase64(64),
    ciphertextSha256: boundedBase64(64),
    keyDistributionMessage: boundedBase64(S1_MAX_KEY_DISTRIBUTION_BYTES),
    contentSignature: boundedBase64(512),
    recoveryCapsules: z.array(recoveryCapsuleSchema).min(1).max(2),
  })
  .superRefine((value, context) => {
    const accountIds = value.recoveryCapsules.map((item) => item.accountId);
    if (new Set(accountIds).size !== accountIds.length) {
      context.addIssue({
        code: "custom",
        path: ["recoveryCapsules"],
        message: "recovery capsule accounts must be unique",
      });
    }
  });

export const encryptedProtectedContentSchema = z.object({
  ciphertext: boundedBase64(S1_MAX_PROTECTED_TEXT_CIPHERTEXT_BYTES),
  envelope: protectedContentEnvelopeSchema,
});

export const recoveryCapsuleProjectionSchema = recoveryCapsuleSchema;

export const protectedContentEnvelopeProjectionSchema = z.object({
  cryptoProfile: z.literal(S1_CRYPTO_PROFILE),
  groupGeneration: z.number().int().positive(),
  mlsEpoch: z.number().int().min(0),
  senderCryptoDeviceId: z.string().uuid(),
  contentKeyId: z.string().uuid(),
  nonce: boundedBase64(64),
  ciphertextSha256: boundedBase64(64),
  keyDistributionMessage: boundedBase64(S1_MAX_KEY_DISTRIBUTION_BYTES),
  contentSignature: boundedBase64(512),
  recoveryCapsule: recoveryCapsuleProjectionSchema.nullable(),
});

export const encryptedProtectedContentProjectionSchema = z.object({
  ciphertext: boundedBase64(S1_MAX_PROTECTED_TEXT_CIPHERTEXT_BYTES),
  envelope: protectedContentEnvelopeProjectionSchema,
});

export type RecoveryCapsuleInput = z.infer<typeof recoveryCapsuleSchema>;
export type ProtectedContentEnvelopeInput = z.infer<typeof protectedContentEnvelopeSchema>;
export type EncryptedProtectedContentInput = z.infer<typeof encryptedProtectedContentSchema>;
export type ProtectedContentEnvelopeProjection = z.infer<
  typeof protectedContentEnvelopeProjectionSchema
>;
export type EncryptedProtectedContentProjection = z.infer<
  typeof encryptedProtectedContentProjectionSchema
>;
