import { base64UrlEncode, concatBytes, utf8 } from "./bytes.ts";
import { canonicalBytes, type CanonicalValue } from "./canonical.ts";
import { S1_CRYPTO_PROFILE, type S1CryptoProfile } from "./profile.ts";

export type ProtectedContentType =
  | "message"
  | "message_reaction"
  | "partnership_nickname"
  | "relationship_item"
  | "media_descriptor";

export type ProtectedPayloadRole =
  | "message_body"
  | "reaction_value"
  | "nickname_value"
  | "relationship_preview"
  | "relationship_main"
  | "media_descriptor";

export interface EnvelopeContext {
  readonly cryptoProfile: S1CryptoProfile;
  readonly partnershipId: string;
  readonly groupGeneration: number;
  readonly mlsEpoch: number;
  readonly contentType: ProtectedContentType;
  readonly contentId: string;
  readonly contentVersion: number;
  readonly payloadRole: ProtectedPayloadRole;
  readonly senderCryptoDeviceId: string;
  readonly schemaVersion: number;
}

export interface EncryptedPayload {
  readonly cryptoProfile: S1CryptoProfile;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly ciphertextSha256: string;
}

export interface SignedProtectedEnvelope extends EnvelopeContext {
  readonly contentKeyId: string;
  readonly encryptedPayload: EncryptedPayload;
  readonly keyDistributionMessage: string;
  readonly contentSignature: string;
}

export function envelopeContext(input: Omit<EnvelopeContext, "cryptoProfile">): EnvelopeContext {
  return { cryptoProfile: S1_CRYPTO_PROFILE, ...input };
}

export function envelopeAad(context: EnvelopeContext): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    contentId: context.contentId,
    contentType: context.contentType,
    contentVersion: context.contentVersion,
    cryptoProfile: context.cryptoProfile,
    groupGeneration: context.groupGeneration,
    mlsEpoch: context.mlsEpoch,
    partnershipId: context.partnershipId,
    payloadRole: context.payloadRole,
    schemaVersion: context.schemaVersion,
    senderCryptoDeviceId: context.senderCryptoDeviceId,
  };
  return canonicalBytes(value);
}

export function contentSignatureInput(
  context: EnvelopeContext,
  contentKeyId: string,
  nonce: Uint8Array,
  ciphertextDigest: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return concatBytes(
    utf8("shawtie-content-signature-v1\0"),
    envelopeAad(context),
    utf8("\0"),
    utf8(contentKeyId),
    utf8("\0"),
    utf8(base64UrlEncode(nonce)),
    utf8("\0"),
    ciphertextDigest,
  );
}
