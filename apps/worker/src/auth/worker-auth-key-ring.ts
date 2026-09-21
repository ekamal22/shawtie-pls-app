import { createHmac, hkdfSync } from "node:crypto";

export interface WorkerAuthKeyConfig {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

function deriveSubkey(root: Buffer, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), Buffer.from(label), 32));
}

export class WorkerAuthKeyRing {
  readonly config: WorkerAuthKeyConfig;

  constructor(config: WorkerAuthKeyConfig) {
    this.config = config;
  }

  deriveEmailCode(challengeId: string, purpose: string, nonce: Buffer, version: number): string {
    const root = this.config.keys.get(version);
    if (!root) throw new Error("Unknown authentication key version");
    const key = deriveSubkey(root, "email-code-derivation");
    const maximum = 0x1_0000_0000;
    const modulus = 100_000_000;
    const ceiling = Math.floor(maximum / modulus) * modulus;
    for (let counter = 0; counter < 128; counter += 1) {
      const digest = createHmac("sha256", key)
        .update("email-code\0")
        .update(challengeId)
        .update("\0")
        .update(purpose)
        .update("\0")
        .update(nonce)
        .update(Buffer.from([counter]))
        .digest();
      const value = digest.readUInt32BE(0);
      if (value < ceiling) return String(value % modulus).padStart(8, "0");
    }
    throw new Error("Could not derive unbiased email code");
  }
}

export function workerAuthKeyConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkerAuthKeyConfig {
  const raw = env.AUTH_HMAC_KEYS;
  const activeRaw = env.AUTH_HMAC_ACTIVE_VERSION;
  if (!raw) throw new Error("AUTH_HMAC_KEYS is required for auth email handlers");
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(",")) {
    const [versionRaw, value] = part.split(":");
    const version = Number.parseInt(versionRaw ?? "", 10);
    if (!Number.isInteger(version) || version <= 0 || !value) {
      throw new Error("AUTH_HMAC_KEYS must use version:base64 entries");
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.length < 32)
      throw new Error("AUTH_HMAC_KEYS entries must contain at least 32 bytes");
    keys.set(version, decoded);
  }
  const activeVersion = Number.parseInt(activeRaw ?? "", 10);
  if (!Number.isInteger(activeVersion) || !keys.has(activeVersion)) {
    throw new Error("AUTH_HMAC_ACTIVE_VERSION must identify a configured key");
  }
  return { activeVersion, keys };
}
