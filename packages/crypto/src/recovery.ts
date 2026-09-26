import { base64UrlDecode, base64UrlEncode, utf8 } from "./bytes.ts";
import {
  S1_RECOVERY_MASTER_SECRET_BYTES,
  S1_RECOVERY_PROFILE,
  S1_RECOVERY_SALT_BYTES,
} from "./profile.ts";

const RECOVERY_INFO = utf8("shawtie/recovery-bundle/v1");

export interface EncryptedRecoveryBundle {
  readonly profile: typeof S1_RECOVERY_PROFILE;
  readonly salt: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

function exactSecret(secret: Uint8Array): Uint8Array<ArrayBuffer> {
  if (secret.byteLength !== S1_RECOVERY_MASTER_SECRET_BYTES) {
    throw new Error("CRYPTO_RECOVERY_FAILED");
  }
  return new Uint8Array(secret);
}

export function generateRecoveryMasterSecret(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(S1_RECOVERY_MASTER_SECRET_BYTES));
}

export function encodeRecoveryMasterSecret(secret: Uint8Array): string {
  return "shawtie-rms-v1." + base64UrlEncode(exactSecret(secret));
}

export function decodeRecoveryMasterSecret(value: string): Uint8Array<ArrayBuffer> {
  const prefix = "shawtie-rms-v1.";
  if (!value.startsWith(prefix)) throw new Error("CRYPTO_RECOVERY_FAILED");
  return exactSecret(base64UrlDecode(value.slice(prefix.length)));
}

async function deriveBundleKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", exactSecret(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: RECOVERY_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptRecoveryBundle(
  plaintext: BufferSource,
  secret: Uint8Array,
): Promise<EncryptedRecoveryBundle> {
  const salt = crypto.getRandomValues(new Uint8Array(S1_RECOVERY_SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: RECOVERY_INFO, tagLength: 128 },
    await deriveBundleKey(secret, salt),
    plaintext,
  );
  return {
    profile: S1_RECOVERY_PROFILE,
    salt: base64UrlEncode(salt),
    nonce: base64UrlEncode(nonce),
    ciphertext: base64UrlEncode(ciphertext),
  };
}

export async function decryptRecoveryBundle(
  bundle: EncryptedRecoveryBundle,
  secret: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (bundle.profile !== S1_RECOVERY_PROFILE) throw new Error("CRYPTO_RECOVERY_FAILED");
  try {
    const salt = base64UrlDecode(bundle.salt);
    const nonce = base64UrlDecode(bundle.nonce);
    if (salt.byteLength !== S1_RECOVERY_SALT_BYTES || nonce.byteLength !== 12) {
      throw new Error("invalid recovery parameters");
    }
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: RECOVERY_INFO, tagLength: 128 },
        await deriveBundleKey(secret, salt),
        base64UrlDecode(bundle.ciphertext),
      ),
    );
  } catch {
    throw new Error("CRYPTO_RECOVERY_FAILED");
  }
}
