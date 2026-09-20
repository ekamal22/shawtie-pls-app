import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthKeyConfig } from "../config.ts";

type Label =
  | "session-verifier"
  | "device-handle-verifier"
  | "email-code-derivation"
  | "email-code-verifier"
  | "rate-limit-key";

function deriveSubkey(root: Buffer, label: Label): Buffer {
  return Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), Buffer.from(label), 32));
}

export class AuthKeyRing {
  readonly #activeVersion: number;
  readonly #roots: ReadonlyMap<number, Buffer>;

  constructor(config: AuthKeyConfig) {
    this.#activeVersion = config.activeVersion;
    this.#roots = config.keys;
  }

  get activeVersion(): number {
    return this.#activeVersion;
  }

  get versions(): readonly number[] {
    return [...this.#roots.keys()].sort((a, b) => a - b);
  }

  verifier(label: Label, payload: string | Buffer, version: number): Buffer {
    const root = this.#roots.get(version);
    if (!root) throw new Error("Unknown authentication key version");
    return createHmac("sha256", deriveSubkey(root, label)).update(payload).digest();
  }

  activeVerifier(label: Label, payload: string | Buffer): { version: number; value: Buffer } {
    return {
      version: this.#activeVersion,
      value: this.verifier(label, payload, this.#activeVersion),
    };
  }

  deriveEmailCode(challengeId: string, purpose: string, nonce: Buffer, version: number): string {
    const root = this.#roots.get(version);
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

  emailCodeVerifier(challengeId: string, code: string, version: number): Buffer {
    return this.verifier("email-code-verifier", `email-verifier\0${challengeId}\0${code}`, version);
  }

  safeEqual(first: Buffer, second: Buffer): boolean {
    return first.length === second.length && timingSafeEqual(first, second);
  }
}

export function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomNonce(bytes = 32): Buffer {
  return randomBytes(bytes);
}
