const TEST_PROTOCOL = "m3-test-aes-gcm-v1";
const MAGIC = new TextEncoder().encode("M3T1");
const TEST_KEY = new Uint8Array([
  0x4d, 0x33, 0x2d, 0x73, 0x79, 0x6e, 0x74, 0x68,
  0x65, 0x74, 0x69, 0x63, 0x2d, 0x6d, 0x65, 0x64,
  0x69, 0x61, 0x2d, 0x6b, 0x65, 0x79, 0x2d, 0x76,
  0x31, 0x2d, 0x6f, 0x6e, 0x6c, 0x79, 0x21, 0x21,
]);

interface ViteEnv {
  readonly MODE?: string;
  readonly VITE_M3_TEST_CRYPTO?: string;
}

function env(): ViteEnv {
  return ((import.meta as ImportMeta & { readonly env?: ViteEnv }).env ?? {}) as ViteEnv;
}

export function mediaCryptoAvailable(): boolean {
  const value = env();
  return value.MODE !== "production" && value.VITE_M3_TEST_CRYPTO === "1";
}

export function mediaCryptoProtocolVersion(): string {
  if (!mediaCryptoAvailable()) {
    throw new Error("M3 production media crypto is unavailable until S1");
  }
  return TEST_PROTOCOL;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", TEST_KEY, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export async function encryptMedia(plaintext: Blob): Promise<{
  readonly ciphertext: Blob;
  readonly protocolVersion: string;
}> {
  const protocolVersion = mediaCryptoProtocolVersion();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: MAGIC },
      await key(),
      await plaintext.arrayBuffer(),
    ),
  );
  return {
    ciphertext: new Blob([concat(MAGIC, iv, encrypted)], { type: "application/octet-stream" }),
    protocolVersion,
  };
}

export async function decryptMedia(
  ciphertext: Blob,
  protocolVersion: string,
): Promise<Blob> {
  if (protocolVersion !== TEST_PROTOCOL || !mediaCryptoAvailable()) {
    throw new Error("Protected media requires the S1 production crypto adapter");
  }
  const bytes = new Uint8Array(await ciphertext.arrayBuffer());
  if (bytes.byteLength <= MAGIC.byteLength + 12) throw new Error("Invalid media ciphertext");
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index]) throw new Error("Invalid media ciphertext");
  }
  const iv = bytes.slice(MAGIC.byteLength, MAGIC.byteLength + 12);
  const body = bytes.slice(MAGIC.byteLength + 12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: MAGIC },
    await key(),
    body,
  );
  return new Blob([plaintext]);
}
