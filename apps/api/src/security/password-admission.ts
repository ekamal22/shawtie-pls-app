import {
  normalizePassword,
  validatePasswordPolicy,
  type AccountRuleDenialCode,
} from "@shawtie/domain";
import { COMMON_PASSWORDS } from "./common-passwords.generated.ts";
import type { PasswordHasher } from "./password-hasher.ts";

export type PasswordAdmissionDecision =
  | { readonly allowed: true; readonly normalizedPassword: string }
  | { readonly allowed: false; readonly reason: AccountRuleDenialCode };

export type PasswordHashDecision =
  | { readonly allowed: true; readonly passwordHash: string }
  | { readonly allowed: false; readonly reason: AccountRuleDenialCode };

export class PasswordAdmissionService {
  readonly #passwords: PasswordHasher;

  constructor(passwords: PasswordHasher) {
    this.#passwords = passwords;
  }

  validateForNewCredential(password: string): PasswordAdmissionDecision {
    const structural = validatePasswordPolicy(password);
    if (!structural.allowed) {
      return {
        allowed: false,
        reason: structural.reason ?? "PASSWORD_TOO_SHORT",
      };
    }

    const normalizedPassword = normalizePassword(password);
    if (COMMON_PASSWORDS.has(normalizedPassword.toLowerCase())) {
      return { allowed: false, reason: "PASSWORD_COMMON" };
    }

    return { allowed: true, normalizedPassword };
  }

  async hashNewCredential(password: string): Promise<PasswordHashDecision> {
    const decision = this.validateForNewCredential(password);
    if (!decision.allowed) return decision;
    return {
      allowed: true,
      passwordHash: await this.#passwords.hash(decision.normalizedPassword),
    };
  }
}
