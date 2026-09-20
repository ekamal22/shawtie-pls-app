import { randomUUID } from "node:crypto";
import {
  accountHasOccupiedPartnership,
  appendLifecycleEvent,
  appendSecurityEvent,
  changeUsername,
  completeRegistrationIntent,
  consumeChallenge,
  consumeRateLimitBuckets,
  correctDateOfBirth,
  createDevice,
  createSession,
  findAccountByIdentifier,
  findActiveDeviceByHandle,
  findLoginCredential,
  getAccountDeletionGeneration,
  getAccountProfile,
  getCalendarYearAfter,
  getCurrentPartnershipForAccount,
  getPasswordHash,
  insertAccount,
  insertAccountProfile,
  insertCurrentEmail,
  insertEmailChallenge,
  insertOutboxEvent,
  insertPasswordCredential,
  insertRegistrationIntent,
  insertScheduledAction,
  insertSecurityEmailDelivery,
  isUsernameAvailable,
  isVerifiedEmailAvailable,
  listDevices,
  lockAccountForProfileMutation,
  lockAuthenticatedSession,
  lockAccounts,
  lockActiveChallengeForAccount,
  lockActiveChallengeForRegistration,
  lockRegistrationIntent,
  recordChallengeFailure,
  recoverAccountDeletion,
  releaseCurrentEmail,
  renameDevice,
  requestAccountDeletion,
  resetRateLimitBucket,
  revokeAllSessionsForAccount,
  revokeDevice,
  revokeSession,
  rotateDeviceHandle,
  rotateSessionToken,
  supersedeActiveChallenges,
  updateDisplayName,
  updatePasswordCredential,
  withTransaction,
  getTransactionTimestamp,
  type DatabasePool,
  type DeviceSummary,
  type EmailChallenge,
  type EmailPurpose,
  type QueryExecutor,
} from "@shawtie/db";
import {
  evaluateDateOfBirthCorrection,
  evaluateUsernameChange,
  isAdultOnDate,
  normalizeUsername,
  validatePasswordPolicy,
  validateUsername,
} from "@shawtie/domain";
import type {
  AccountRecoveryCompleteInput,
  DateOfBirthCorrectionInput,
  EmailChangeStartInput,
  LoginInput,
  PasswordRecoveryCompleteInput,
  ProfileUpdateInput,
  RegistrationStartInput,
  RegistrationVerifyInput,
  UsernameChangeInput,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import { AuthKeyRing, randomNonce, randomOpaqueToken } from "../../security/auth-key-ring.ts";
import { normalizeEmail, normalizeLoginIdentifier } from "../../security/normalization.ts";
import { PasswordHasher } from "../../security/password-hasher.ts";
import type { AuthContext } from "../../plugins/authentication.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface SessionIssue {
  readonly sessionToken: string;
  readonly deviceToken: string;
  readonly sessionId: string;
  readonly deviceId: string;
}

interface ChallengeCreateInput {
  readonly transaction: QueryExecutor;
  readonly accountId?: string;
  readonly registrationIntentId?: string;
  readonly purpose: EmailPurpose;
  readonly emailNormalized: string;
  readonly emailDisplay: string;
  readonly now: Date;
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function addMilliseconds(now: Date, milliseconds: number): Date {
  return new Date(now.getTime() + milliseconds);
}

export class AccountService {
  constructor(
    readonly database: DatabasePool,
    readonly keys: AuthKeyRing,
    readonly passwords: PasswordHasher,
  ) {}

  async #assertSession(transaction: QueryExecutor, auth: AuthContext): Promise<void> {
    const valid = await lockAuthenticatedSession(transaction, {
      sessionId: auth.session.sessionId,
      accountId: auth.session.accountId,
      expectedGeneration: auth.session.tokenGeneration,
    });
    if (!valid) throw new ApiError(401, "AUTH_REQUIRED");
  }

  async consumeSecurityRateLimit(
    scopes: readonly {
      scope: string;
      subject: string;
      limit: number;
      windowMs: number;
      blockMs: number;
    }[],
  ): Promise<void> {
    const result = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      return consumeRateLimitBuckets(
        transaction,
        scopes.map((item) => ({
          scope: item.scope,
          keyHash: this.keys.activeVerifier("rate-limit-key", item.subject).value,
          limit: item.limit,
          windowMs: item.windowMs,
          blockMs: item.blockMs,
        })),
        now,
      );
    });
    if (!result.allowed) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "RATE_LIMITED",
        Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
      );
    }
  }

  async #createChallenge(input: ChallengeCreateInput): Promise<{ id: string; expiresAt: Date }> {
    const id = randomUUID();
    const nonce = randomNonce();
    const code = this.keys.deriveEmailCode(id, input.purpose, nonce, this.keys.activeVersion);
    const verifier = this.keys.emailCodeVerifier(id, code, this.keys.activeVersion);
    const expiresAt = addMilliseconds(input.now, 10 * MINUTE);

    await supersedeActiveChallenges(
      input.transaction,
      {
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.registrationIntentId
          ? { registrationIntentId: input.registrationIntentId }
          : {}),
      },
      input.purpose,
      input.now,
    );
    await insertEmailChallenge(input.transaction, {
      id,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.registrationIntentId
        ? { registrationIntentId: input.registrationIntentId }
        : {}),
      purpose: input.purpose,
      emailNormalized: input.emailNormalized,
      emailDisplay: input.emailDisplay,
      verifier,
      challengeNonce: nonce,
      expiresAt,
      verifierKeyVersion: this.keys.activeVersion,
    });
    await insertOutboxEvent(input.transaction, {
      id: randomUUID(),
      eventType: "auth.email_challenge",
      aggregateType: "email_verification",
      aggregateId: id,
      deduplicationKey: `auth-email-challenge:${id}`,
      payload: { challengeId: id },
      payloadVersion: 1,
    });
    return { id, expiresAt };
  }

  #verifyChallenge(challenge: EmailChallenge, code: string, now: Date): "ok" | "invalid" | "expired" {
    if (
      challenge.consumedAt ||
      challenge.supersededAt ||
      challenge.attemptCount >= challenge.maxAttempts
    ) {
      return "invalid";
    }
    if (now.getTime() >= challenge.expiresAt.getTime()) return "expired";
    let actual: Buffer;
    try {
      actual = this.keys.emailCodeVerifier(challenge.id, code, challenge.verifierKeyVersion);
    } catch {
      return "invalid";
    }
    return this.keys.safeEqual(actual, challenge.verifier) ? "ok" : "invalid";
  }

  async #issueSession(
    transaction: QueryExecutor,
    accountId: string,
    deviceName: string,
    rawDeviceHandle: string | undefined,
    now: Date,
  ): Promise<SessionIssue> {
    let deviceId: string | null = null;

    if (rawDeviceHandle) {
      for (const version of this.keys.versions) {
        const verifier = this.keys.verifier("device-handle-verifier", rawDeviceHandle, version);
        const found = await findActiveDeviceByHandle(transaction, accountId, verifier);
        if (found) {
          deviceId = found.id;
          break;
        }
      }
    }

    const deviceToken = randomOpaqueToken();
    const deviceVerifier = this.keys.activeVerifier("device-handle-verifier", deviceToken);
    if (deviceId) {
      await rotateDeviceHandle(
        transaction,
        deviceId,
        deviceVerifier.value,
        deviceVerifier.version,
        now,
      );
    } else {
      deviceId = randomUUID();
      await createDevice(transaction, {
        id: deviceId,
        accountId,
        displayName: deviceName,
        handleVerifier: deviceVerifier.value,
        handleKeyVersion: deviceVerifier.version,
        at: now,
      });
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId,
        deviceId,
        eventType: "device_created",
        at: now,
      });
    }

    const sessionToken = randomOpaqueToken();
    const sessionVerifier = this.keys.activeVerifier("session-verifier", sessionToken);
    const sessionId = randomUUID();
    await createSession(transaction, {
      id: sessionId,
      accountId,
      deviceId,
      tokenVerifier: sessionVerifier.value,
      tokenKeyVersion: sessionVerifier.version,
      createdAt: now,
      expiresAt: addMilliseconds(now, 30 * DAY),
      idleExpiresAt: addMilliseconds(now, 7 * DAY),
      reauthenticatedAt: now,
    });
    return { sessionToken, deviceToken, sessionId, deviceId };
  }

  async startRegistration(
    input: RegistrationStartInput,
    networkKey: string,
  ): Promise<{ registrationIntentId: string; expiresAt: string; resendAfterSeconds: number }> {
    const username = normalizeUsername(input.username);
    const usernameDecision = validateUsername(input.username);
    if (!usernameDecision.allowed) throw new ApiError(400, usernameDecision.reason ?? "USERNAME_INVALID");
    const passwordDecision = validatePasswordPolicy(input.password);
    if (!passwordDecision.allowed) throw new ApiError(400, passwordDecision.reason ?? "VALIDATION_FAILED");
    let email;
    try {
      email = normalizeEmail(input.email);
    } catch {
      throw new ApiError(400, "VALIDATION_FAILED");
    }

    await this.consumeSecurityRateLimit([
      { scope: "registration_network", subject: networkKey, limit: 5, windowMs: HOUR, blockMs: HOUR },
      { scope: "registration_email", subject: email.normalized, limit: 3, windowMs: HOUR, blockMs: HOUR },
      { scope: "registration_username", subject: username.normalized, limit: 3, windowMs: HOUR, blockMs: HOUR },
    ]);

    const passwordHash = await this.passwords.hash(input.password);
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      if (!isAdultOnDate(input.dateOfBirth, utcDate(now))) {
        throw new ApiError(400, "AGE_INELIGIBLE");
      }
      if (!(await isUsernameAvailable(transaction, username.normalized))) {
        throw new ApiError(409, "USERNAME_UNAVAILABLE");
      }
      if (!(await isVerifiedEmailAvailable(transaction, email.normalized))) {
        throw new ApiError(409, "EMAIL_UNAVAILABLE");
      }

      const intentId = randomUUID();
      const intentExpiresAt = addMilliseconds(now, DAY);
      await insertRegistrationIntent(transaction, {
        id: intentId,
        usernameNormalized: username.normalized,
        usernameDisplay: username.display,
        displayName: input.displayName.trim().normalize("NFC"),
        dateOfBirth: input.dateOfBirth,
        emailNormalized: email.normalized,
        emailDisplay: email.display,
        passwordHash,
        expiresAt: intentExpiresAt,
      });
      await this.#createChallenge({
        transaction,
        registrationIntentId: intentId,
        purpose: "registration",
        emailNormalized: email.normalized,
        emailDisplay: email.display,
        now,
      });
      return {
        registrationIntentId: intentId,
        expiresAt: intentExpiresAt.toISOString(),
        resendAfterSeconds: 60,
      };
    });
  }

  async resendRegistration(
    registrationIntentId: string,
    networkKey: string,
  ): Promise<{ expiresAt: string; resendAfterSeconds: number }> {
    await this.consumeSecurityRateLimit([
      { scope: "verification_send_network", subject: networkKey, limit: 20, windowMs: HOUR, blockMs: HOUR },
      { scope: "verification_send_registration", subject: registrationIntentId, limit: 5, windowMs: HOUR, blockMs: HOUR },
    ]);

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const intent = await lockRegistrationIntent(transaction, registrationIntentId);
      if (
        !intent ||
        intent.completedAt ||
        now.getTime() >= intent.expiresAt.getTime() ||
        !intent.passwordHash
      ) {
        throw new ApiError(409, "EMAIL_CHALLENGE_INVALID");
      }
      const active = await lockActiveChallengeForRegistration(transaction, registrationIntentId);
      if (active && now.getTime() - active.createdAt.getTime() < MINUTE) {
        throw new ApiError(429, "RATE_LIMITED", "RATE_LIMITED", 60);
      }
      const challenge = await this.#createChallenge({
        transaction,
        registrationIntentId,
        purpose: "registration",
        emailNormalized: intent.emailNormalized,
        emailDisplay: intent.emailDisplay,
        now,
      });
      return { expiresAt: challenge.expiresAt.toISOString(), resendAfterSeconds: 60 };
    });
  }

  async verifyRegistration(
    input: RegistrationVerifyInput,
    rawDeviceHandle?: string,
  ): Promise<{ accountId: string; session: SessionIssue }> {
    const decision = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const intent = await lockRegistrationIntent(transaction, input.registrationIntentId);
      const challenge = await lockActiveChallengeForRegistration(
        transaction,
        input.registrationIntentId,
      );
      if (!intent || !challenge || intent.completedAt || !intent.passwordHash) {
        return { ok: false as const, code: "EMAIL_CHALLENGE_INVALID" };
      }
      if (now.getTime() >= intent.expiresAt.getTime()) {
        return { ok: false as const, code: "EMAIL_CHALLENGE_EXPIRED" };
      }
      const verification = this.#verifyChallenge(challenge, input.code, now);
      if (verification !== "ok") {
        if (verification === "invalid") await recordChallengeFailure(transaction, challenge.id, now);
        return {
          ok: false as const,
          code: verification === "expired" ? "EMAIL_CHALLENGE_EXPIRED" : "EMAIL_CHALLENGE_INVALID",
        };
      }
      if (!isAdultOnDate(intent.dateOfBirth, utcDate(now))) {
        return { ok: false as const, code: "AGE_INELIGIBLE" };
      }
      if (!(await isUsernameAvailable(transaction, intent.usernameNormalized))) {
        return { ok: false as const, code: "USERNAME_UNAVAILABLE" };
      }
      if (!(await isVerifiedEmailAvailable(transaction, intent.emailNormalized))) {
        return { ok: false as const, code: "EMAIL_UNAVAILABLE" };
      }

      const accountId = randomUUID();
      await insertAccount(transaction, {
        id: accountId,
        usernameNormalized: intent.usernameNormalized,
        usernameDisplay: intent.usernameDisplay,
        dateOfBirth: intent.dateOfBirth,
        createdAt: now,
      });
      await insertAccountProfile(transaction, {
        accountId,
        displayName: intent.displayName,
        at: now,
      });
      await insertPasswordCredential(transaction, accountId, intent.passwordHash, now);
      await insertCurrentEmail(transaction, {
        id: randomUUID(),
        accountId,
        emailNormalized: intent.emailNormalized,
        emailDisplay: intent.emailDisplay,
        at: now,
      });
      const session = await this.#issueSession(
        transaction,
        accountId,
        input.deviceName ?? "Browser",
        rawDeviceHandle,
        now,
      );
      await consumeChallenge(transaction, challenge.id, now);
      await completeRegistrationIntent(transaction, intent.id, now);
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId,
        deviceId: session.deviceId,
        eventType: "registration_completed",
        at: now,
      });
      return { ok: true as const, accountId, session };
    });

    if (!decision.ok) throw new ApiError(409, decision.code);
    return { accountId: decision.accountId, session: decision.session };
  }

  async login(
    input: LoginInput,
    networkKey: string,
    rawDeviceHandle?: string,
  ): Promise<{ accountId: string; session: SessionIssue }> {
    let identifier: string;
    try {
      identifier = normalizeLoginIdentifier(input.identifier);
    } catch {
      identifier = input.identifier.trim().toLowerCase();
    }
    const identifierHash = this.keys.activeVerifier("rate-limit-key", identifier).value;
    await this.consumeSecurityRateLimit([
      { scope: "login_network", subject: networkKey, limit: 50, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE },
      { scope: "login_identifier", subject: identifier, limit: 10, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE },
    ]);

    const credential = await findLoginCredential(this.database.pool, identifier);
    if (!credential) {
      await this.passwords.verifyDummy(input.password);
      throw new ApiError(401, "AUTH_INVALID");
    }
    const passwordOk = await this.passwords.verify(credential.passwordHash, input.password);
    if (!passwordOk || credential.status !== "active") {
      throw new ApiError(401, "AUTH_INVALID");
    }

    const nextHash = this.passwords.needsRehash(credential.passwordHash)
      ? await this.passwords.hash(input.password)
      : null;

    const result = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const locked = await lockAccounts(transaction, [credential.accountId]);
      if (locked.length !== 1) throw new ApiError(401, "AUTH_INVALID");
      const current = await findLoginCredential(transaction, identifier);
      if (!current || current.accountId !== credential.accountId || current.status !== "active") {
        throw new ApiError(401, "AUTH_INVALID");
      }
      if (nextHash) await updatePasswordCredential(transaction, credential.accountId, nextHash, now);
      const session = await this.#issueSession(
        transaction,
        credential.accountId,
        input.deviceName ?? "Browser",
        rawDeviceHandle,
        now,
      );
      await resetRateLimitBucket(transaction, "login_identifier", identifierHash, now);
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: credential.accountId,
        deviceId: session.deviceId,
        eventType: "login_succeeded",
        at: now,
      });
      return { accountId: credential.accountId, session };
    });
    return result;
  }

  async logout(auth: AuthContext): Promise<void> {
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await revokeSession(transaction, auth.session.sessionId, now);
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        deviceId: auth.session.deviceId,
        eventType: "logout",
        at: now,
      });
    });
  }

  async reauthenticate(
    auth: AuthContext,
    password: string,
  ): Promise<{ sessionToken: string }> {
    const hash = await getPasswordHash(this.database.pool, auth.session.accountId);
    if (!hash || !(await this.passwords.verify(hash, password))) {
      throw new ApiError(401, "AUTH_INVALID");
    }
    const token = randomOpaqueToken();
    const verifier = this.keys.activeVerifier("session-verifier", token);
    const rotated = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const generation = await rotateSessionToken(transaction, {
        sessionId: auth.session.sessionId,
        expectedGeneration: auth.session.tokenGeneration,
        verifier: verifier.value,
        keyVersion: verifier.version,
        at: now,
        reauthenticatedAt: now,
      });
      if (!generation) return false;
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        deviceId: auth.session.deviceId,
        eventType: "reauthentication_succeeded",
        at: now,
      });
      return true;
    });
    if (!rotated) throw new ApiError(409, "CONFLICT");
    return { sessionToken: token };
  }

  async getMe(accountId: string) {
    const profile = await getAccountProfile(this.database.pool, accountId);
    if (!profile) throw new ApiError(404, "AUTH_REQUIRED");
    return profile;
  }

  async updateProfile(auth: AuthContext, input: ProfileUpdateInput): Promise<void> {
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      await this.#assertSession(transaction, auth);
      await updateDisplayName(transaction, auth.session.accountId, input.displayName.trim().normalize("NFC"), now);
    });
  }

  async startPasswordRecovery(identifierInput: string, networkKey: string): Promise<void> {
    let identifier: string;
    try {
      identifier = normalizeLoginIdentifier(identifierInput);
    } catch {
      identifier = identifierInput.trim().toLowerCase();
    }
    await this.consumeSecurityRateLimit([
      { scope: "password_recovery_identifier", subject: identifier, limit: 5, windowMs: HOUR, blockMs: HOUR },
      { scope: "password_recovery_network", subject: networkKey, limit: 20, windowMs: HOUR, blockMs: HOUR },
    ]);

    const account = await findAccountByIdentifier(this.database.pool, identifier);
    if (!account || account.status !== "active") return;
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [account.accountId]);
      await this.#createChallenge({
        transaction,
        accountId: account.accountId,
        purpose: "password_recovery",
        emailNormalized: account.emailNormalized,
        emailDisplay: account.emailDisplay,
        now,
      });
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: account.accountId,
        eventType: "password_recovery_started",
        at: now,
      });
    });
  }

  async completePasswordRecovery(
    input: PasswordRecoveryCompleteInput,
    networkKey: string,
  ): Promise<void> {
    let identifier: string;
    try {
      identifier = normalizeLoginIdentifier(input.identifier);
    } catch {
      throw new ApiError(409, "EMAIL_CHALLENGE_INVALID");
    }
    await this.consumeSecurityRateLimit([
      { scope: "verification_submit_network", subject: networkKey, limit: 20, windowMs: HOUR, blockMs: HOUR },
    ]);
    const account = await findAccountByIdentifier(this.database.pool, identifier);
    const newHash = await this.passwords.hash(input.newPassword);
    if (!account || account.status !== "active") throw new ApiError(409, "EMAIL_CHALLENGE_INVALID");

    const decision = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [account.accountId]);
      const challenge = await lockActiveChallengeForAccount(
        transaction,
        account.accountId,
        "password_recovery",
      );
      if (!challenge) return { ok: false as const, code: "EMAIL_CHALLENGE_INVALID" };
      const verification = this.#verifyChallenge(challenge, input.code, now);
      if (verification !== "ok") {
        if (verification === "invalid") await recordChallengeFailure(transaction, challenge.id, now);
        return {
          ok: false as const,
          code: verification === "expired" ? "EMAIL_CHALLENGE_EXPIRED" : "EMAIL_CHALLENGE_INVALID",
        };
      }
      await updatePasswordCredential(transaction, account.accountId, newHash, now);
      await revokeAllSessionsForAccount(transaction, account.accountId, now);
      await consumeChallenge(transaction, challenge.id, now);
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: account.accountId,
        eventType: "password_reset_completed",
        at: now,
      });
      await this.#queueSecurityEmail(
        transaction,
        account.accountId,
        account.emailDisplay,
        "password_reset_completed",
        now,
      );
      return { ok: true as const };
    });
    if (!decision.ok) throw new ApiError(409, decision.code);
  }

  async startEmailChange(
    auth: AuthContext,
    input: EmailChangeStartInput,
    networkKey: string,
  ): Promise<void> {
    let email;
    try {
      email = normalizeEmail(input.email);
    } catch {
      throw new ApiError(400, "VALIDATION_FAILED");
    }
    await this.consumeSecurityRateLimit([
      { scope: "verification_send_network", subject: networkKey, limit: 20, windowMs: HOUR, blockMs: HOUR },
      { scope: "email_change_account", subject: auth.session.accountId, limit: 5, windowMs: HOUR, blockMs: HOUR },
    ]);
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      await this.#assertSession(transaction, auth);
      if (!(await isVerifiedEmailAvailable(transaction, email.normalized, auth.session.accountId))) {
        throw new ApiError(409, "EMAIL_UNAVAILABLE");
      }
      await this.#createChallenge({
        transaction,
        accountId: auth.session.accountId,
        purpose: "email_change",
        emailNormalized: email.normalized,
        emailDisplay: email.display,
        now,
      });
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        deviceId: auth.session.deviceId,
        eventType: "email_change_started",
        at: now,
      });
    });
  }

  async resendEmailChange(auth: AuthContext, networkKey: string): Promise<void> {
    await this.consumeSecurityRateLimit([
      { scope: "verification_send_network", subject: networkKey, limit: 20, windowMs: HOUR, blockMs: HOUR },
      { scope: "email_change_account", subject: auth.session.accountId, limit: 5, windowMs: HOUR, blockMs: HOUR },
    ]);
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      await this.#assertSession(transaction, auth);
      const challenge = await lockActiveChallengeForAccount(
        transaction,
        auth.session.accountId,
        "email_change",
      );
      if (!challenge || !challenge.emailDisplay) throw new ApiError(409, "EMAIL_CHALLENGE_INVALID");
      if (now.getTime() - challenge.createdAt.getTime() < MINUTE) {
        throw new ApiError(429, "RATE_LIMITED", "RATE_LIMITED", 60);
      }
      await this.#createChallenge({
        transaction,
        accountId: auth.session.accountId,
        purpose: "email_change",
        emailNormalized: challenge.emailNormalized,
        emailDisplay: challenge.emailDisplay,
        now,
      });
    });
  }

  async completeEmailChange(
    auth: AuthContext,
    code: string,
  ): Promise<{ sessionToken: string }> {
    const rawToken = randomOpaqueToken();
    const newVerifier = this.keys.activeVerifier("session-verifier", rawToken);
    const decision = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      await this.#assertSession(transaction, auth);
      const challenge = await lockActiveChallengeForAccount(
        transaction,
        auth.session.accountId,
        "email_change",
      );
      if (!challenge || !challenge.emailDisplay) {
        return { ok: false as const, code: "EMAIL_CHALLENGE_INVALID" };
      }
      const verification = this.#verifyChallenge(challenge, code, now);
      if (verification !== "ok") {
        if (verification === "invalid") await recordChallengeFailure(transaction, challenge.id, now);
        return {
          ok: false as const,
          code: verification === "expired" ? "EMAIL_CHALLENGE_EXPIRED" : "EMAIL_CHALLENGE_INVALID",
        };
      }
      if (!(await isVerifiedEmailAvailable(transaction, challenge.emailNormalized, auth.session.accountId))) {
        return { ok: false as const, code: "EMAIL_UNAVAILABLE" };
      }
      const old = await releaseCurrentEmail(transaction, auth.session.accountId, now);
      await insertCurrentEmail(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        emailNormalized: challenge.emailNormalized,
        emailDisplay: challenge.emailDisplay,
        at: now,
      });
      await consumeChallenge(transaction, challenge.id, now);
      await revokeAllSessionsForAccount(
        transaction,
        auth.session.accountId,
        now,
        auth.session.sessionId,
      );
      const generation = await rotateSessionToken(transaction, {
        sessionId: auth.session.sessionId,
        expectedGeneration: auth.session.tokenGeneration,
        verifier: newVerifier.value,
        keyVersion: newVerifier.version,
        at: now,
        reauthenticatedAt: now,
      });
      if (!generation) return { ok: false as const, code: "CONFLICT" };
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        deviceId: auth.session.deviceId,
        eventType: "email_changed",
        at: now,
      });
      if (old) {
        await this.#queueSecurityEmail(
          transaction,
          auth.session.accountId,
          old.emailDisplay,
          "email_changed_old_address",
          now,
        );
      }
      return { ok: true as const };
    });
    if (!decision.ok) throw new ApiError(409, decision.code);
    return { sessionToken: rawToken };
  }

  async changeUsername(auth: AuthContext, input: UsernameChangeInput): Promise<void> {
    const username = normalizeUsername(input.username);
    const valid = validateUsername(input.username);
    if (!valid.allowed) throw new ApiError(400, valid.reason ?? "USERNAME_INVALID");

    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const account = await lockAccountForProfileMutation(transaction, auth.session.accountId);
      await this.#assertSession(transaction, auth);
      if (!account || account.status !== "active") throw new ApiError(401, "AUTH_REQUIRED");
      const occupied = await accountHasOccupiedPartnership(transaction, auth.session.accountId);
      const decision = evaluateUsernameChange(now, account.nextUsernameChangeEligibleAt, occupied);
      if (!decision.allowed) throw new ApiError(409, decision.reason ?? "USERNAME_CHANGE_NOT_ALLOWED");
      if (!(await isUsernameAvailable(transaction, username.normalized))) {
        throw new ApiError(409, "USERNAME_UNAVAILABLE");
      }
      const next = await getCalendarYearAfter(transaction, now);
      await changeUsername(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        oldNormalized: account.usernameNormalized,
        newNormalized: username.normalized,
        newDisplay: username.display,
        changedAt: now,
        nextEligibleAt: next,
      });
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        eventType: "username_changed",
        at: now,
      });
    });
  }

  async correctDateOfBirth(
    auth: AuthContext,
    input: DateOfBirthCorrectionInput,
  ): Promise<void> {
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const account = await lockAccountForProfileMutation(transaction, auth.session.accountId);
      await this.#assertSession(transaction, auth);
      if (!account || account.status !== "active") throw new ApiError(401, "AUTH_REQUIRED");
      const decision = evaluateDateOfBirthCorrection(
        utcDate(now),
        input.dateOfBirth,
        account.dateOfBirthCorrectedAt !== null,
      );
      if (!decision.allowed) throw new ApiError(409, decision.reason ?? "CONFLICT");
      await correctDateOfBirth(transaction, auth.session.accountId, input.dateOfBirth, now);
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        eventType: "date_of_birth_corrected",
        at: now,
      });
    });
  }

  async requestDeletion(auth: AuthContext): Promise<void> {
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const locked = await lockAccountForProfileMutation(transaction, auth.session.accountId);
      await this.#assertSession(transaction, auth);
      if (!locked || locked.status !== "active") throw new ApiError(409, "ACCOUNT_LOCKED");
      const currentGeneration = await getAccountDeletionGeneration(transaction, auth.session.accountId);
      const generation = currentGeneration + 1n;
      const recoverUntil = addMilliseconds(now, 7 * DAY);
      await requestAccountDeletion(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        requestedAt: now,
        recoverUntil,
        generation,
      });
      await revokeAllSessionsForAccount(transaction, auth.session.accountId, now);
      const partnership = await getCurrentPartnershipForAccount(transaction, auth.session.accountId);
      if (partnership) {
        await appendLifecycleEvent(transaction, {
          id: randomUUID(),
          partnershipId: partnership.partnershipId,
          actorAccountId: auth.session.accountId,
          eventType: "account_deletion_started",
          aggregateVersion: partnership.generation,
          metadata: { generation: Number(generation), status: "deletion_pending" },
        });
      }
      if (
        partnership?.lifecycleState === "breakup_pending" &&
        partnership.breakupFinalDeadline &&
        partnership.breakupFinalDeadline.getTime() < recoverUntil.getTime()
      ) {
        await insertScheduledAction(transaction, {
          id: randomUUID(),
          actionType: "account_deletion_breakup_precedence_finalize",
          aggregateType: "account",
          aggregateId: auth.session.accountId,
          executeAt: partnership.breakupFinalDeadline,
          expectedGeneration: generation,
          deduplicationKey:
            `account-deletion-breakup-precedence:${auth.session.accountId}:${partnership.partnershipId}:${generation}`,
          payload: { partnershipId: partnership.partnershipId },
          payloadVersion: 1,
        });
      }

      await insertScheduledAction(transaction, {
        id: randomUUID(),
        actionType: "account_deletion_finalize",
        aggregateType: "account",
        aggregateId: auth.session.accountId,
        executeAt: recoverUntil,
        expectedGeneration: generation,
        deduplicationKey: `account-deletion-finalize:${auth.session.accountId}:${generation}`,
        payload: {},
        payloadVersion: 1,
      });
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        deviceId: auth.session.deviceId,
        eventType: "account_deletion_requested",
        metadata: { generation: Number(generation) },
        at: now,
      });
      const profile = await getAccountProfile(transaction, auth.session.accountId);
      if (profile) {
        await this.#queueSecurityEmail(
          transaction,
          auth.session.accountId,
          profile.email,
          "account_deletion_requested",
          now,
        );
      }
    });
  }

  async startAccountRecovery(identifierInput: string, networkKey: string): Promise<void> {
    let identifier: string;
    try {
      identifier = normalizeLoginIdentifier(identifierInput);
    } catch {
      identifier = identifierInput.trim().toLowerCase();
    }
    await this.consumeSecurityRateLimit([
      { scope: "account_recovery_identifier", subject: identifier, limit: 5, windowMs: HOUR, blockMs: HOUR },
      { scope: "account_recovery_network", subject: networkKey, limit: 20, windowMs: HOUR, blockMs: HOUR },
    ]);
    const account = await findAccountByIdentifier(this.database.pool, identifier);
    if (!account || account.status !== "deletion_pending") return;
    await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [account.accountId]);
      await this.#createChallenge({
        transaction,
        accountId: account.accountId,
        purpose: "account_recovery",
        emailNormalized: account.emailNormalized,
        emailDisplay: account.emailDisplay,
        now,
      });
    });
  }

  async completeAccountRecovery(
    input: AccountRecoveryCompleteInput,
    networkKey: string,
  ): Promise<void> {
    let identifier: string;
    try {
      identifier = normalizeLoginIdentifier(input.identifier);
    } catch {
      throw new ApiError(409, "EMAIL_CHALLENGE_INVALID");
    }
    await this.consumeSecurityRateLimit([
      { scope: "verification_submit_network", subject: networkKey, limit: 20, windowMs: HOUR, blockMs: HOUR },
    ]);
    const account = await findAccountByIdentifier(this.database.pool, identifier);
    if (!account || account.status !== "deletion_pending") {
      throw new ApiError(409, "EMAIL_CHALLENGE_INVALID");
    }
    const decision = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [account.accountId]);
      const challenge = await lockActiveChallengeForAccount(
        transaction,
        account.accountId,
        "account_recovery",
      );
      if (!challenge) return { ok: false as const, code: "EMAIL_CHALLENGE_INVALID" };
      const verification = this.#verifyChallenge(challenge, input.code, now);
      if (verification !== "ok") {
        if (verification === "invalid") await recordChallengeFailure(transaction, challenge.id, now);
        return {
          ok: false as const,
          code: verification === "expired" ? "EMAIL_CHALLENGE_EXPIRED" : "EMAIL_CHALLENGE_INVALID",
        };
      }
      const recovered = await recoverAccountDeletion(transaction, account.accountId, now);
      if (!recovered) return { ok: false as const, code: "ACCOUNT_LOCKED" };
      await consumeChallenge(transaction, challenge.id, now);
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: account.accountId,
        eventType: "account_recovered",
        at: now,
      });
      return { ok: true as const };
    });
    if (!decision.ok) throw new ApiError(409, decision.code);
  }

  listDevices(accountId: string): Promise<readonly DeviceSummary[]> {
    return listDevices(this.database.pool, accountId);
  }

  async renameDevice(auth: AuthContext, deviceId: string, displayName: string): Promise<void> {
    const renamed = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      await this.#assertSession(transaction, auth);
      return renameDevice(transaction, auth.session.accountId, deviceId, displayName.trim(), now);
    });
    if (!renamed) throw new ApiError(404, "DEVICE_NOT_FOUND");
  }

  async revokeDevice(
    auth: AuthContext,
    deviceId: string,
  ): Promise<{ currentDeviceRevoked: boolean }> {
    const result = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      await lockAccounts(transaction, [auth.session.accountId]);
      await this.#assertSession(transaction, auth);
      const revoked = await revokeDevice(transaction, auth.session.accountId, deviceId, now);
      if (!revoked) return null;
      await appendSecurityEvent(transaction, {
        id: randomUUID(),
        accountId: auth.session.accountId,
        deviceId,
        eventType: "device_revoked",
        at: now,
      });
      return { currentDeviceRevoked: auth.session.deviceId === deviceId };
    });
    if (!result) throw new ApiError(404, "DEVICE_NOT_FOUND");
    return result;
  }

  async #queueSecurityEmail(
    transaction: QueryExecutor,
    accountId: string,
    destination: string,
    template: string,
    now: Date,
  ): Promise<void> {
    const deliveryId = randomUUID();
    await insertSecurityEmailDelivery(transaction, {
      id: deliveryId,
      accountId,
      destinationEmail: destination,
      template,
      expiresAt: addMilliseconds(now, 7 * DAY),
      at: now,
    });
    await insertOutboxEvent(transaction, {
      id: randomUUID(),
      eventType: "auth.security_email",
      aggregateType: "security_email_delivery",
      aggregateId: deliveryId,
      deduplicationKey: `security-email:${deliveryId}`,
      payload: { securityEmailDeliveryId: deliveryId },
      payloadVersion: 1,
    });
  }
}
