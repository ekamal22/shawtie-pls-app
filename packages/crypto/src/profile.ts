export const S1_CRYPTO_PROFILE = "shawtie.mls.v1" as const;
export const S1_MLS_CIPHERSUITE =
  "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519" as const;
export const S1_OPENMLS_VERSION = "0.9.0" as const;
export const S1_OPENMLS_RUST_CRYPTO_VERSION = "0.6.0" as const;
export const S1_CONTENT_AEAD = "AES-256-GCM" as const;
export const S1_RECOVERY_PROFILE = "shawtie.recovery.v1" as const;
export const S1_RECOVERY_HPKE_PROFILE = "DHKEM(X25519,HKDF-SHA256)/HKDF-SHA256/AES-128-GCM" as const;
export const S1_CONTENT_KEY_BYTES = 32;
export const S1_GCM_NONCE_BYTES = 12;
export const S1_RECOVERY_MASTER_SECRET_BYTES = 32;
export const S1_RECOVERY_SALT_BYTES = 32;

export type S1CryptoProfile = typeof S1_CRYPTO_PROFILE;
