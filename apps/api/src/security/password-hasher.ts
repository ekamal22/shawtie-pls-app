import {
  hash,
  parseOptions,
  verify,
  type Options,
} from "@node-rs/argon2";
import { normalizePassword } from "@shawtie/domain";

const POLICY = {
  // @node-rs/argon2 declares Algorithm and Version as ambient const enums.
  // Numeric member values preserve the explicit policy while remaining compatible
  // with this repository's verbatimModuleSyntax and isolatedModules settings.
  algorithm: 2,
  version: 1,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

export class PasswordHasher {
  readonly #dummyHash: Promise<string>;

  constructor() {
    this.#dummyHash = this.hash("shawtie-dummy-password-not-a-user-secret");
  }

  hash(password: string): Promise<string> {
    return hash(normalizePassword(password), POLICY);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, normalizePassword(password));
  }

  async verifyDummy(password: string): Promise<void> {
    await verify(await this.#dummyHash, normalizePassword(password));
  }

  needsRehash(passwordHash: string): boolean {
    const parsed = parseOptions(passwordHash);
    return (
      parsed.algorithm !== POLICY.algorithm ||
      parsed.version !== POLICY.version ||
      parsed.memoryCost !== POLICY.memoryCost ||
      parsed.timeCost !== POLICY.timeCost ||
      parsed.parallelism !== POLICY.parallelism ||
      parsed.outputLen !== POLICY.outputLen ||
      parsed.saltLen < 16
    );
  }
}
