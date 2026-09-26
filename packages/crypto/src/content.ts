import { base64UrlDecode, base64UrlEncode, utf8, utf8Decode } from "./bytes.ts";
import { envelopeAad, type EncryptedPayload, type EnvelopeContext } from "./envelopes.ts";
import {
  S1_CONTENT_KEY_BYTES,
  S1_CRYPTO_PROFILE,
  S1_GCM_NONCE_BYTES,
} from "./profile.ts";

export interface ProtectedEncryptionResult {
  readonly key: Uint8Array<ArrayBuffer>;
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
  readonly digest: Uint8Array<ArrayBuffer>;
  readonly payload: EncryptedPayload;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function importAesKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (key.byteLength !== S1_CONTENT_KEY_BYTES) throw new Error("Invalid S1 content key length");
  return crypto.subtle.importKey("raw", asArrayBuffer(key), { name: "AES-GCM" }, false, [usage]);
}

export async function sha256(bytes: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export function generateContentKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(S1_CONTENT_KEY_BYTES));
}

export async function encryptBytes(
  plaintext: BufferSource,
  context: EnvelopeContext,
  suppliedKey?: Uint8Array,
): Promise<ProtectedEncryptionResult> {
  const key = suppliedKey
    ? new Uint8Array(suppliedKey)
    : generateContentKey();
  const nonce = crypto.getRandomValues(new Uint8Array(S1_GCM_NONCE_BYTES));
  const aad = envelopeAad(context);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
      await importAesKey(key, "encrypt"),
      plaintext,
    ),
  );
  const digest = await sha256(encrypted);
  return {
    key: new Uint8Array(key),
    nonce,
    ciphertext: encrypted,
    digest,
    payload: {
      cryptoProfile: S1_CRYPTO_PROFILE,
      nonce: base64UrlEncode(nonce),
      ciphertext: base64UrlEncode(encrypted),
      ciphertextSha256: base64UrlEncode(digest),
    },
  };
}

export async function decryptBytes(
  payload: EncryptedPayload,
  key: Uint8Array,
  context: EnvelopeContext,
): Promise<Uint8Array<ArrayBuffer>> {
  if (payload.cryptoProfile !== S1_CRYPTO_PROFILE) throw new Error("CRYPTO_UNSUPPORTED_PROTOCOL");
  const nonce = base64UrlDecode(payload.nonce);
  const ciphertext = base64UrlDecode(payload.ciphertext);
  if (nonce.byteLength !== S1_GCM_NONCE_BYTES) throw new Error("CRYPTO_CIPHERTEXT_INVALID");
  const actualDigest = base64UrlEncode(await sha256(ciphertext));
  if (actualDigest !== payload.ciphertextSha256) throw new Error("CRYPTO_CIPHERTEXT_INVALID");
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: envelopeAad(context), tagLength: 128 },
        await importAesKey(key, "decrypt"),
        ciphertext,
      ),
    );
  } catch {
    throw new Error("CRYPTO_CIPHERTEXT_INVALID");
  }
}

export async function encryptJson(
  value: unknown,
  context: EnvelopeContext,
  suppliedKey?: Uint8Array,
): Promise<ProtectedEncryptionResult> {
  return encryptBytes(utf8(JSON.stringify(value)), context, suppliedKey);
}

export async function decryptJson<T>(
  payload: EncryptedPayload,
  key: Uint8Array,
  context: EnvelopeContext,
): Promise<T> {
  return JSON.parse(utf8Decode(await decryptBytes(payload, key, context))) as T;
}
