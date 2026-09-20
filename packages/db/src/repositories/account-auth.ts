import type { QueryExecutor } from "../types/query-executor.ts";

export type AccountStatus = "active" | "deletion_pending" | "deleted";
export type EmailPurpose =
  | "registration"
  | "email_change"
  | "password_recovery"
  | "account_recovery";

export interface RegistrationIntentRow {
  readonly id: string;
  readonly usernameNormalized: string;
  readonly usernameDisplay: string;
  readonly displayName: string;
  readonly dateOfBirth: string;
  readonly emailNormalized: string;
  readonly emailDisplay: string;
  readonly passwordHash: string | null;
  readonly expiresAt: Date;
  readonly completedAt: Date | null;
}

interface RegistrationIntentDbRow {
  id: string;
  username_normalized: string;
  username_display: string;
  display_name: string;
  date_of_birth: string;
  email_normalized: string;
  email_display: string;
  password_hash: string | null;
  expires_at: Date;
  completed_at: Date | null;
}

function mapRegistrationIntent(row: RegistrationIntentDbRow): RegistrationIntentRow {
  return {
    id: row.id,
    usernameNormalized: row.username_normalized,
    usernameDisplay: row.username_display,
    displayName: row.display_name,
    dateOfBirth: row.date_of_birth,
    emailNormalized: row.email_normalized,
    emailDisplay: row.email_display,
    passwordHash: row.password_hash,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
  };
}

export async function insertRegistrationIntent(
  executor: QueryExecutor,
  input: {
    id: string;
    usernameNormalized: string;
    usernameDisplay: string;
    displayName: string;
    dateOfBirth: string;
    emailNormalized: string;
    emailDisplay: string;
    passwordHash: string;
    expiresAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO registration_intents (
       id, username_normalized, username_display, display_name, date_of_birth,
       email_normalized, email_display, password_hash, expires_at
     ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9)`,
    [
      input.id,
      input.usernameNormalized,
      input.usernameDisplay,
      input.displayName,
      input.dateOfBirth,
      input.emailNormalized,
      input.emailDisplay,
      input.passwordHash,
      input.expiresAt,
    ],
  );
}

export async function lockRegistrationIntent(
  executor: QueryExecutor,
  id: string,
): Promise<RegistrationIntentRow | null> {
  const result = await executor.query<RegistrationIntentDbRow>(
    `SELECT id, username_normalized, username_display, display_name,
            date_of_birth::text, email_normalized, email_display, password_hash,
            expires_at, completed_at
     FROM registration_intents
     WHERE id = $1
     FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapRegistrationIntent(row) : null;
}

export async function completeRegistrationIntent(
  executor: QueryExecutor,
  id: string,
  completedAt: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE registration_intents
     SET completed_at = $2, password_hash = NULL
     WHERE id = $1 AND completed_at IS NULL`,
    [id, completedAt],
  );
  return result.rowCount === 1;
}

export interface EmailChallenge {
  readonly id: string;
  readonly accountId: string | null;
  readonly registrationIntentId: string | null;
  readonly purpose: EmailPurpose;
  readonly emailNormalized: string;
  readonly emailDisplay: string | null;
  readonly verifier: Buffer;
  readonly challengeNonce: Buffer | null;
  readonly expiresAt: Date;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly consumedAt: Date | null;
  readonly supersededAt: Date | null;
  readonly verifierKeyVersion: number;
  readonly createdAt: Date;
}

interface EmailChallengeDbRow {
  id: string;
  account_id: string | null;
  registration_intent_id: string | null;
  purpose: EmailPurpose;
  email_normalized: string;
  email_display: string | null;
  verifier: Buffer;
  challenge_nonce: Buffer | null;
  expires_at: Date;
  attempt_count: number;
  max_attempts: number;
  consumed_at: Date | null;
  superseded_at: Date | null;
  verifier_key_version: number;
  created_at: Date;
}

function mapChallenge(row: EmailChallengeDbRow): EmailChallenge {
  return {
    id: row.id,
    accountId: row.account_id,
    registrationIntentId: row.registration_intent_id,
    purpose: row.purpose,
    emailNormalized: row.email_normalized,
    emailDisplay: row.email_display,
    verifier: row.verifier,
    challengeNonce: row.challenge_nonce,
    expiresAt: row.expires_at,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    consumedAt: row.consumed_at,
    supersededAt: row.superseded_at,
    verifierKeyVersion: row.verifier_key_version,
    createdAt: row.created_at,
  };
}

export async function supersedeActiveChallenges(
  executor: QueryExecutor,
  subject: { accountId?: string; registrationIntentId?: string },
  purpose: EmailPurpose,
  at: Date,
): Promise<void> {
  await executor.query(
    `UPDATE email_verifications
     SET superseded_at = $4
     WHERE purpose = $3
       AND consumed_at IS NULL
       AND superseded_at IS NULL
       AND (($1::uuid IS NOT NULL AND account_id = $1)
         OR ($2::uuid IS NOT NULL AND registration_intent_id = $2))`,
    [subject.accountId ?? null, subject.registrationIntentId ?? null, purpose, at],
  );
}

export async function insertEmailChallenge(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId?: string;
    registrationIntentId?: string;
    purpose: EmailPurpose;
    emailNormalized: string;
    emailDisplay: string;
    verifier: Buffer;
    challengeNonce: Buffer;
    expiresAt: Date;
    verifierKeyVersion: number;
    maxAttempts?: number;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO email_verifications (
       id, account_id, registration_intent_id, purpose, email_normalized, email_display,
       verifier, challenge_nonce, expires_at, verifier_key_version, max_attempts
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.id,
      input.accountId ?? null,
      input.registrationIntentId ?? null,
      input.purpose,
      input.emailNormalized,
      input.emailDisplay,
      input.verifier,
      input.challengeNonce,
      input.expiresAt,
      input.verifierKeyVersion,
      input.maxAttempts ?? 5,
    ],
  );
}

export async function lockActiveChallengeForRegistration(
  executor: QueryExecutor,
  registrationIntentId: string,
): Promise<EmailChallenge | null> {
  const result = await executor.query<EmailChallengeDbRow>(
    `SELECT id, account_id, registration_intent_id, purpose, email_normalized, email_display,
            verifier, challenge_nonce, expires_at, attempt_count, max_attempts,
            consumed_at, superseded_at, verifier_key_version, created_at
     FROM email_verifications
     WHERE registration_intent_id = $1
       AND purpose = 'registration'
       AND consumed_at IS NULL
       AND superseded_at IS NULL
     FOR UPDATE`,
    [registrationIntentId],
  );
  const row = result.rows[0];
  return row ? mapChallenge(row) : null;
}

export async function lockActiveChallengeForAccount(
  executor: QueryExecutor,
  accountId: string,
  purpose: Exclude<EmailPurpose, "registration">,
): Promise<EmailChallenge | null> {
  const result = await executor.query<EmailChallengeDbRow>(
    `SELECT id, account_id, registration_intent_id, purpose, email_normalized, email_display,
            verifier, challenge_nonce, expires_at, attempt_count, max_attempts,
            consumed_at, superseded_at, verifier_key_version, created_at
     FROM email_verifications
     WHERE account_id = $1
       AND purpose = $2
       AND consumed_at IS NULL
       AND superseded_at IS NULL
     FOR UPDATE`,
    [accountId, purpose],
  );
  const row = result.rows[0];
  return row ? mapChallenge(row) : null;
}

export async function recordChallengeFailure(
  executor: QueryExecutor,
  id: string,
  at: Date,
): Promise<number> {
  const result = await executor.query<{ attempt_count: number }>(
    `UPDATE email_verifications
     SET attempt_count = LEAST(attempt_count + 1, max_attempts),
         last_attempt_at = $2
     WHERE id = $1
     RETURNING attempt_count`,
    [id, at],
  );
  return result.rows[0]?.attempt_count ?? 0;
}

export async function consumeChallenge(
  executor: QueryExecutor,
  id: string,
  at: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE email_verifications
     SET consumed_at = $2, challenge_nonce = NULL, verifier = decode('', 'hex')
     WHERE id = $1 AND consumed_at IS NULL AND superseded_at IS NULL`,
    [id, at],
  );
  return result.rowCount === 1;
}

export async function isUsernameAvailable(
  executor: QueryExecutor,
  usernameNormalized: string,
): Promise<boolean> {
  const result = await executor.query(
    "SELECT 1 FROM accounts WHERE username_normalized = $1 LIMIT 1",
    [usernameNormalized],
  );
  return result.rowCount === 0;
}

export async function isVerifiedEmailAvailable(
  executor: QueryExecutor,
  emailNormalized: string,
  exceptAccountId?: string,
): Promise<boolean> {
  const result = await executor.query(
    `SELECT 1
     FROM account_emails
     WHERE email_normalized = $1
       AND is_current
       AND verified_at IS NOT NULL
       AND released_at IS NULL
       AND ($2::uuid IS NULL OR account_id <> $2)
     LIMIT 1`,
    [emailNormalized, exceptAccountId ?? null],
  );
  return result.rowCount === 0;
}

export async function insertAccount(
  executor: QueryExecutor,
  input: {
    id: string;
    usernameNormalized: string;
    usernameDisplay: string;
    dateOfBirth: string;
    createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO accounts (
       id, username_normalized, username_display, date_of_birth, created_at, updated_at
     ) VALUES ($1,$2,$3,$4::date,$5,$5)`,
    [input.id, input.usernameNormalized, input.usernameDisplay, input.dateOfBirth, input.createdAt],
  );
}

export async function insertAccountProfile(
  executor: QueryExecutor,
  input: { accountId: string; displayName: string; at: Date },
): Promise<void> {
  await executor.query(
    `INSERT INTO account_profiles (account_id, display_name, updated_at)
     VALUES ($1,$2,$3)`,
    [input.accountId, input.displayName, input.at],
  );
}

export async function insertPasswordCredential(
  executor: QueryExecutor,
  accountId: string,
  passwordHash: string,
  at: Date,
): Promise<void> {
  await executor.query(
    `INSERT INTO account_password_credentials (
       account_id, password_hash, changed_at, created_at
     ) VALUES ($1,$2,$3,$3)`,
    [accountId, passwordHash, at],
  );
}

export async function updatePasswordCredential(
  executor: QueryExecutor,
  accountId: string,
  passwordHash: string,
  at: Date,
): Promise<void> {
  await executor.query(
    `UPDATE account_password_credentials
     SET password_hash = $2, password_version = password_version + 1, changed_at = $3
     WHERE account_id = $1`,
    [accountId, passwordHash, at],
  );
}

export async function insertCurrentEmail(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId: string;
    emailNormalized: string;
    emailDisplay: string;
    at: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO account_emails (
       id, account_id, email_normalized, email_display, verified_at, is_current, created_at
     ) VALUES ($1,$2,$3,$4,$5,true,$5)`,
    [input.id, input.accountId, input.emailNormalized, input.emailDisplay, input.at],
  );
}

export interface LoginCredential {
  readonly accountId: string;
  readonly status: AccountStatus;
  readonly passwordHash: string;
  readonly emailNormalized: string;
}

export async function findLoginCredential(
  executor: QueryExecutor,
  identifierNormalized: string,
): Promise<LoginCredential | null> {
  const result = await executor.query<{
    account_id: string;
    status: AccountStatus;
    password_hash: string;
    email_normalized: string;
  }>(
    `SELECT a.id AS account_id, a.status, c.password_hash, e.email_normalized
     FROM accounts a
     JOIN account_password_credentials c ON c.account_id = a.id
     JOIN account_emails e
       ON e.account_id = a.id
      AND e.is_current
      AND e.verified_at IS NOT NULL
      AND e.released_at IS NULL
     WHERE a.username_normalized = $1 OR e.email_normalized = $1
     LIMIT 1`,
    [identifierNormalized],
  );
  const row = result.rows[0];
  return row
    ? {
        accountId: row.account_id,
        status: row.status,
        passwordHash: row.password_hash,
        emailNormalized: row.email_normalized,
      }
    : null;
}

export async function findAccountByIdentifier(
  executor: QueryExecutor,
  identifierNormalized: string,
): Promise<{ accountId: string; status: AccountStatus; emailNormalized: string; emailDisplay: string } | null> {
  const result = await executor.query<{
    account_id: string;
    status: AccountStatus;
    email_normalized: string;
    email_display: string;
  }>(
    `SELECT a.id AS account_id, a.status, e.email_normalized, e.email_display
     FROM accounts a
     JOIN account_emails e
       ON e.account_id = a.id
      AND e.is_current
      AND e.verified_at IS NOT NULL
      AND e.released_at IS NULL
     WHERE a.username_normalized = $1 OR e.email_normalized = $1
     LIMIT 1`,
    [identifierNormalized],
  );
  const row = result.rows[0];
  return row
    ? {
        accountId: row.account_id,
        status: row.status,
        emailNormalized: row.email_normalized,
        emailDisplay: row.email_display,
      }
    : null;
}

export async function createDevice(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId: string;
    displayName: string;
    handleVerifier: Buffer;
    handleKeyVersion: number;
    at: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO account_devices (
       id, account_id, display_name, handle_verifier, handle_key_version,
       created_at, last_seen_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$6,$6)`,
    [
      input.id,
      input.accountId,
      input.displayName,
      input.handleVerifier,
      input.handleKeyVersion,
      input.at,
    ],
  );
}

export async function findActiveDeviceByHandle(
  executor: QueryExecutor,
  accountId: string,
  handleVerifier: Buffer,
): Promise<{ id: string; handleKeyVersion: number } | null> {
  const result = await executor.query<{ id: string; handle_key_version: number }>(
    `SELECT id, handle_key_version
     FROM account_devices
     WHERE account_id = $1
       AND handle_verifier = $2
       AND revoked_at IS NULL
     LIMIT 1`,
    [accountId, handleVerifier],
  );
  const row = result.rows[0];
  return row ? { id: row.id, handleKeyVersion: row.handle_key_version } : null;
}

export async function rotateDeviceHandle(
  executor: QueryExecutor,
  deviceId: string,
  verifier: Buffer,
  keyVersion: number,
  at: Date,
): Promise<void> {
  await executor.query(
    `UPDATE account_devices
     SET handle_verifier = $2, handle_key_version = $3, last_seen_at = $4, updated_at = $4
     WHERE id = $1 AND revoked_at IS NULL`,
    [deviceId, verifier, keyVersion, at],
  );
}

export async function createSession(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId: string;
    deviceId: string;
    tokenVerifier: Buffer;
    tokenKeyVersion: number;
    createdAt: Date;
    expiresAt: Date;
    idleExpiresAt: Date;
    reauthenticatedAt?: Date | null;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO account_sessions (
       id, account_id, device_id, token_verifier, token_key_version,
       token_generation, created_at, expires_at, idle_expires_at,
       reauthenticated_at, last_seen_at
     ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$6)`,
    [
      input.id,
      input.accountId,
      input.deviceId,
      input.tokenVerifier,
      input.tokenKeyVersion,
      input.createdAt,
      input.expiresAt,
      input.idleExpiresAt,
      input.reauthenticatedAt ?? null,
    ],
  );
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly accountStatus: AccountStatus;
  readonly deviceId: string | null;
  readonly deviceRevokedAt: Date | null;
  readonly tokenKeyVersion: number;
  readonly tokenGeneration: bigint;
  readonly expiresAt: Date;
  readonly idleExpiresAt: Date;
  readonly reauthenticatedAt: Date | null;
  readonly lastSeenAt: Date | null;
}

export async function findSessionByVerifier(
  executor: QueryExecutor,
  verifier: Buffer,
): Promise<AuthenticatedSession | null> {
  const result = await executor.query<{
    session_id: string;
    account_id: string;
    account_status: AccountStatus;
    device_id: string | null;
    device_revoked_at: Date | null;
    token_key_version: number;
    token_generation: string | number | bigint;
    expires_at: Date;
    idle_expires_at: Date;
    reauthenticated_at: Date | null;
    last_seen_at: Date | null;
  }>(
    `SELECT s.id AS session_id, s.account_id, a.status AS account_status,
            s.device_id, d.revoked_at AS device_revoked_at,
            s.token_key_version, s.token_generation, s.expires_at,
            s.idle_expires_at, s.reauthenticated_at, s.last_seen_at
     FROM account_sessions s
     JOIN accounts a ON a.id = s.account_id
     LEFT JOIN account_devices d ON d.id = s.device_id
     WHERE s.token_verifier = $1
       AND s.revoked_at IS NULL
     LIMIT 1`,
    [verifier],
  );
  const row = result.rows[0];
  return row
    ? {
        sessionId: row.session_id,
        accountId: row.account_id,
        accountStatus: row.account_status,
        deviceId: row.device_id,
        deviceRevokedAt: row.device_revoked_at,
        tokenKeyVersion: row.token_key_version,
        tokenGeneration: BigInt(row.token_generation),
        expiresAt: row.expires_at,
        idleExpiresAt: row.idle_expires_at,
        reauthenticatedAt: row.reauthenticated_at,
        lastSeenAt: row.last_seen_at,
      }
    : null;
}

export async function touchSession(
  executor: QueryExecutor,
  sessionId: string,
  at: Date,
  idleExpiresAt: Date,
): Promise<void> {
  await executor.query(
    `UPDATE account_sessions
     SET last_seen_at = $2, idle_expires_at = LEAST(expires_at, $3)
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, at, idleExpiresAt],
  );
}

export async function revokeSession(
  executor: QueryExecutor,
  sessionId: string,
  at: Date,
): Promise<void> {
  await executor.query(
    "UPDATE account_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1",
    [sessionId, at],
  );
}

export async function revokeAllSessionsForAccount(
  executor: QueryExecutor,
  accountId: string,
  at: Date,
  exceptSessionId?: string,
): Promise<number> {
  const result = await executor.query(
    `UPDATE account_sessions
     SET revoked_at = COALESCE(revoked_at, $2)
     WHERE account_id = $1
       AND revoked_at IS NULL
       AND ($3::uuid IS NULL OR id <> $3)`,
    [accountId, at, exceptSessionId ?? null],
  );
  return result.rowCount ?? 0;
}

export async function rotateSessionToken(
  executor: QueryExecutor,
  input: {
    sessionId: string;
    expectedGeneration: bigint;
    verifier: Buffer;
    keyVersion: number;
    at: Date;
    reauthenticatedAt?: Date | null;
  },
): Promise<bigint | null> {
  const result = await executor.query<{ token_generation: string | number | bigint }>(
    `UPDATE account_sessions
     SET token_verifier = $3,
         token_key_version = $4,
         token_generation = token_generation + 1,
         rotated_at = $5,
         reauthenticated_at = COALESCE($6, reauthenticated_at)
     WHERE id = $1
       AND token_generation = $2
       AND revoked_at IS NULL
     RETURNING token_generation`,
    [
      input.sessionId,
      input.expectedGeneration.toString(),
      input.verifier,
      input.keyVersion,
      input.at,
      input.reauthenticatedAt ?? null,
    ],
  );
  const row = result.rows[0];
  return row ? BigInt(row.token_generation) : null;
}

export async function lockAuthenticatedSession(
  executor: QueryExecutor,
  input: {
    sessionId: string;
    accountId: string;
    expectedGeneration: bigint;
  },
): Promise<boolean> {
  const result = await executor.query(
    `SELECT 1
     FROM account_sessions s
     LEFT JOIN account_devices d ON d.id = s.device_id
     WHERE s.id = $1
       AND s.account_id = $2
       AND s.token_generation = $3
       AND s.revoked_at IS NULL
       AND s.expires_at > transaction_timestamp()
       AND s.idle_expires_at > transaction_timestamp()
       AND (s.device_id IS NULL OR d.revoked_at IS NULL)
     FOR UPDATE OF s`,
    [input.sessionId, input.accountId, input.expectedGeneration.toString()],
  );
  return result.rowCount === 1;
}

export async function getPasswordHash(
  executor: QueryExecutor,
  accountId: string,
): Promise<string | null> {
  const result = await executor.query<{ password_hash: string }>(
    "SELECT password_hash FROM account_password_credentials WHERE account_id = $1",
    [accountId],
  );
  return result.rows[0]?.password_hash ?? null;
}

export async function getAccountProfile(
  executor: QueryExecutor,
  accountId: string,
): Promise<{
  accountId: string;
  username: string;
  displayName: string;
  dateOfBirth: string;
  status: AccountStatus;
  email: string;
} | null> {
  const result = await executor.query<{
    account_id: string;
    username_display: string;
    display_name: string;
    date_of_birth: string;
    status: AccountStatus;
    email_display: string;
  }>(
    `SELECT a.id AS account_id, a.username_display, p.display_name,
            a.date_of_birth::text, a.status, e.email_display
     FROM accounts a
     JOIN account_profiles p ON p.account_id = a.id
     JOIN account_emails e ON e.account_id = a.id
       AND e.is_current AND e.released_at IS NULL AND e.verified_at IS NOT NULL
     WHERE a.id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  return row
    ? {
        accountId: row.account_id,
        username: row.username_display,
        displayName: row.display_name,
        dateOfBirth: row.date_of_birth,
        status: row.status,
        email: row.email_display,
      }
    : null;
}

export async function updateDisplayName(
  executor: QueryExecutor,
  accountId: string,
  displayName: string,
  at: Date,
): Promise<void> {
  await executor.query(
    "UPDATE account_profiles SET display_name = $2, updated_at = $3 WHERE account_id = $1",
    [accountId, displayName, at],
  );
}

export async function accountHasOccupiedPartnership(
  executor: QueryExecutor,
  accountId: string,
): Promise<boolean> {
  const result = await executor.query(
    `SELECT 1 FROM partnership_members
     WHERE account_id = $1 AND released_at IS NULL
     LIMIT 1`,
    [accountId],
  );
  return result.rowCount === 1;
}

export async function lockAccountForProfileMutation(
  executor: QueryExecutor,
  accountId: string,
): Promise<{
  status: AccountStatus;
  usernameNormalized: string;
  usernameDisplay: string;
  dateOfBirthCorrectedAt: Date | null;
  nextUsernameChangeEligibleAt: Date | null;
} | null> {
  const result = await executor.query<{
    status: AccountStatus;
    username_normalized: string;
    username_display: string;
    date_of_birth_corrected_at: Date | null;
    next_username_change_eligible_at: Date | null;
  }>(
    `SELECT status, username_normalized, username_display,
            date_of_birth_corrected_at, next_username_change_eligible_at
     FROM accounts WHERE id = $1 FOR UPDATE`,
    [accountId],
  );
  const row = result.rows[0];
  return row
    ? {
        status: row.status,
        usernameNormalized: row.username_normalized,
        usernameDisplay: row.username_display,
        dateOfBirthCorrectedAt: row.date_of_birth_corrected_at,
        nextUsernameChangeEligibleAt: row.next_username_change_eligible_at,
      }
    : null;
}

export async function changeUsername(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId: string;
    oldNormalized: string;
    newNormalized: string;
    newDisplay: string;
    changedAt: Date;
    nextEligibleAt: Date;
  },
): Promise<void> {
  await executor.query(
    `UPDATE accounts
     SET username_normalized = $2, username_display = $3,
         next_username_change_eligible_at = $4, updated_at = $5
     WHERE id = $1`,
    [input.accountId, input.newNormalized, input.newDisplay, input.nextEligibleAt, input.changedAt],
  );
  await executor.query(
    `INSERT INTO username_change_history (
       id, account_id, old_username_normalized, new_username_normalized,
       changed_at, next_eligible_at
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.id,
      input.accountId,
      input.oldNormalized,
      input.newNormalized,
      input.changedAt,
      input.nextEligibleAt,
    ],
  );
}

export async function correctDateOfBirth(
  executor: QueryExecutor,
  accountId: string,
  dateOfBirth: string,
  at: Date,
): Promise<void> {
  await executor.query(
    `UPDATE accounts
     SET date_of_birth = $2::date, date_of_birth_corrected_at = $3, updated_at = $3
     WHERE id = $1`,
    [accountId, dateOfBirth, at],
  );
}

export async function releaseCurrentEmail(
  executor: QueryExecutor,
  accountId: string,
  at: Date,
): Promise<{ emailDisplay: string } | null> {
  const result = await executor.query<{ email_display: string }>(
    `UPDATE account_emails
     SET is_current = false, released_at = $2
     WHERE account_id = $1 AND is_current AND released_at IS NULL
     RETURNING email_display`,
    [accountId, at],
  );
  const row = result.rows[0];
  return row ? { emailDisplay: row.email_display } : null;
}

export interface DeviceSummary {
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date | null;
  readonly revokedAt: Date | null;
  readonly activeSessionCount: number;
}

export async function listDevices(
  executor: QueryExecutor,
  accountId: string,
): Promise<readonly DeviceSummary[]> {
  const result = await executor.query<{
    id: string;
    display_name: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked_at: Date | null;
    active_session_count: string;
  }>(
    `SELECT d.id, d.display_name, d.created_at, d.last_seen_at, d.revoked_at,
            count(s.id) FILTER (WHERE s.revoked_at IS NULL)::text AS active_session_count
     FROM account_devices d
     LEFT JOIN account_sessions s ON s.device_id = d.id
     WHERE d.account_id = $1
     GROUP BY d.id
     ORDER BY d.created_at DESC, d.id`,
    [accountId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    activeSessionCount: Number(row.active_session_count),
  }));
}

export async function renameDevice(
  executor: QueryExecutor,
  accountId: string,
  deviceId: string,
  displayName: string,
  at: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE account_devices
     SET display_name = $3, updated_at = $4
     WHERE id = $2 AND account_id = $1`,
    [accountId, deviceId, displayName, at],
  );
  return result.rowCount === 1;
}

export async function revokeDevice(
  executor: QueryExecutor,
  accountId: string,
  deviceId: string,
  at: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE account_devices
     SET revoked_at = COALESCE(revoked_at, $3), updated_at = $3
     WHERE id = $2 AND account_id = $1`,
    [accountId, deviceId, at],
  );
  if (result.rowCount !== 1) return false;
  await executor.query(
    `UPDATE account_sessions
     SET revoked_at = COALESCE(revoked_at, $2)
     WHERE device_id = $1 AND revoked_at IS NULL`,
    [deviceId, at],
  );
  return true;
}

export interface RateLimitBucketInput {
  readonly scope: string;
  readonly keyHash: Buffer;
  readonly windowMs: number;
  readonly limit: number;
  readonly blockMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export async function consumeRateLimitBuckets(
  executor: QueryExecutor,
  inputs: readonly RateLimitBucketInput[],
  at: Date,
): Promise<RateLimitDecision> {
  const ordered = [...inputs].sort((a, b) => {
    const scopeOrder = a.scope.localeCompare(b.scope);
    return scopeOrder !== 0 ? scopeOrder : Buffer.compare(a.keyHash, b.keyHash);
  });

  let retryAfterMs = 0;
  for (const input of ordered) {
    await executor.query(
      `INSERT INTO security_rate_limit_buckets (
         scope, key_hash, window_started_at, attempt_count, updated_at
       ) VALUES ($1,$2,$3,0,$3)
       ON CONFLICT (scope, key_hash) DO NOTHING`,
      [input.scope, input.keyHash, at],
    );

    const locked = await executor.query<{
      window_started_at: Date;
      attempt_count: number;
      blocked_until: Date | null;
    }>(
      `SELECT window_started_at, attempt_count, blocked_until
       FROM security_rate_limit_buckets
       WHERE scope = $1 AND key_hash = $2
       FOR UPDATE`,
      [input.scope, input.keyHash],
    );
    const row = locked.rows[0];
    if (!row) throw new Error("Rate-limit bucket disappeared");

    if (row.blocked_until && row.blocked_until.getTime() > at.getTime()) {
      retryAfterMs = Math.max(retryAfterMs, row.blocked_until.getTime() - at.getTime());
      continue;
    }

    const windowExpired = at.getTime() - row.window_started_at.getTime() >= input.windowMs;
    const nextCount = windowExpired ? 1 : row.attempt_count + 1;
    const nextWindow = windowExpired ? at : row.window_started_at;

    if (nextCount > input.limit) {
      const blockedUntil = new Date(at.getTime() + input.blockMs);
      await executor.query(
        `UPDATE security_rate_limit_buckets
         SET window_started_at = $3, attempt_count = $4,
             blocked_until = $5, last_outcome = 'blocked', updated_at = $6
         WHERE scope = $1 AND key_hash = $2`,
        [input.scope, input.keyHash, nextWindow, nextCount, blockedUntil, at],
      );
      retryAfterMs = Math.max(retryAfterMs, input.blockMs);
    } else {
      await executor.query(
        `UPDATE security_rate_limit_buckets
         SET window_started_at = $3, attempt_count = $4,
             blocked_until = NULL, last_outcome = 'allowed', updated_at = $5
         WHERE scope = $1 AND key_hash = $2`,
        [input.scope, input.keyHash, nextWindow, nextCount, at],
      );
    }
  }

  return { allowed: retryAfterMs === 0, retryAfterMs };
}

export async function resetRateLimitBucket(
  executor: QueryExecutor,
  scope: string,
  keyHash: Buffer,
  at: Date,
): Promise<void> {
  await executor.query(
    `UPDATE security_rate_limit_buckets
     SET attempt_count = 0, blocked_until = NULL,
         last_outcome = 'reset', window_started_at = $3, updated_at = $3
     WHERE scope = $1 AND key_hash = $2`,
    [scope, keyHash, at],
  );
}

const SECURITY_METADATA_KEYS = new Set([
  "generation",
  "reason",
  "scope",
  "status",
  "source",
]);

export async function appendSecurityEvent(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId?: string | null;
    deviceId?: string | null;
    eventType: string;
    metadata?: Readonly<Record<string, string | number | boolean | null>>;
    at: Date;
  },
): Promise<void> {
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (!SECURITY_METADATA_KEYS.has(key)) {
      throw new Error(`Unsupported security metadata key: ${key}`);
    }
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error("Security metadata values must be scalar");
    }
  }
  await executor.query(
    `INSERT INTO security_events (
       id, account_id, device_id, event_type, metadata_json, created_at
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      input.id,
      input.accountId ?? null,
      input.deviceId ?? null,
      input.eventType,
      JSON.stringify(input.metadata ?? {}),
      input.at,
    ],
  );
}

export async function insertSecurityEmailDelivery(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId?: string | null;
    destinationEmail: string;
    template: string;
    parameters?: Readonly<Record<string, string | number | boolean | null>>;
    expiresAt: Date;
    at: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO security_email_deliveries (
       id, account_id, destination_email, template, parameters_json,
       created_at, expires_at
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [
      input.id,
      input.accountId ?? null,
      input.destinationEmail,
      input.template,
      JSON.stringify(input.parameters ?? {}),
      input.at,
      input.expiresAt,
    ],
  );
}

export async function getSecurityEmailDelivery(
  executor: QueryExecutor,
  id: string,
): Promise<{
  destinationEmail: string;
  template: string;
  parameters: Readonly<Record<string, unknown>>;
  expiresAt: Date;
  deliveredAt: Date | null;
} | null> {
  const result = await executor.query<{
    destination_email: string;
    template: string;
    parameters_json: Record<string, unknown>;
    expires_at: Date;
    delivered_at: Date | null;
  }>(
    `SELECT destination_email, template, parameters_json, expires_at, delivered_at
     FROM security_email_deliveries WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row
    ? {
        destinationEmail: row.destination_email,
        template: row.template,
        parameters: row.parameters_json,
        expiresAt: row.expires_at,
        deliveredAt: row.delivered_at,
      }
    : null;
}

export async function markSecurityEmailDelivered(
  executor: QueryExecutor,
  id: string,
  at: Date,
): Promise<void> {
  await executor.query(
    "UPDATE security_email_deliveries SET delivered_at = COALESCE(delivered_at, $2) WHERE id = $1",
    [id, at],
  );
}

export async function getChallengeForDelivery(
  executor: QueryExecutor,
  id: string,
): Promise<EmailChallenge | null> {
  const result = await executor.query<EmailChallengeDbRow>(
    `SELECT id, account_id, registration_intent_id, purpose, email_normalized, email_display,
            verifier, challenge_nonce, expires_at, attempt_count, max_attempts,
            consumed_at, superseded_at, verifier_key_version, created_at
     FROM email_verifications WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapChallenge(row) : null;
}

export async function getCalendarYearAfter(
  executor: QueryExecutor,
  at: Date,
): Promise<Date> {
  const result = await executor.query<{ value: Date }>(
    "SELECT $1::timestamptz + interval '1 year' AS value",
    [at],
  );
  const value = result.rows[0]?.value;
  if (!value) throw new Error("PostgreSQL did not return calendar-year timestamp");
  return value;
}

export async function getCurrentPartnershipForAccount(
  executor: QueryExecutor,
  accountId: string,
): Promise<{
  partnershipId: string;
  lifecycleState: "active" | "breakup_pending";
  generation: bigint;
  breakupFinalDeadline: Date | null;
  otherAccountId: string;
} | null> {
  const result = await executor.query<{
    partnership_id: string;
    lifecycle_state: "active" | "breakup_pending";
    generation: string | number | bigint;
    final_deadline: Date | null;
    other_account_id: string;
  }>(
    `SELECT p.id AS partnership_id, p.lifecycle_state, p.generation,
            bp.final_deadline,
            other.account_id AS other_account_id
     FROM partnership_members self
     JOIN partnerships p ON p.id = self.partnership_id
     JOIN partnership_members other
       ON other.partnership_id = self.partnership_id
      AND other.account_id <> self.account_id
      AND other.released_at IS NULL
     LEFT JOIN breakup_processes bp
       ON bp.partnership_id = p.id
      AND bp.restored_at IS NULL
      AND bp.dissolved_at IS NULL
     WHERE self.account_id = $1
       AND self.released_at IS NULL
       AND p.lifecycle_state IN ('active', 'breakup_pending')
     LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  return row
    ? {
        partnershipId: row.partnership_id,
        lifecycleState: row.lifecycle_state,
        generation: BigInt(row.generation),
        breakupFinalDeadline: row.final_deadline,
        otherAccountId: row.other_account_id,
      }
    : null;
}

export async function finalizePartnershipForAccountDeletion(
  executor: QueryExecutor,
  input: {
    partnershipId: string;
    deletingAccountId: string;
    remainingAccountId: string;
    at: Date;
    breakupDeadline: Date | null;
  },
): Promise<"breakup" | "partner_account_deleted"> {
  const breakupWins =
    input.breakupDeadline !== null && input.breakupDeadline.getTime() <= input.at.getTime();
  const reason = breakupWins ? "breakup" : "partner_account_deleted";

  await executor.query(
    `UPDATE partnerships
     SET lifecycle_state = 'terminated',
         terminated_at = $2,
         termination_reason = $3,
         version = version + 1,
         generation = generation + 1,
         updated_at = $2
     WHERE id = $1 AND lifecycle_state <> 'terminated'`,
    [input.partnershipId, input.at, reason],
  );

  await executor.query(
    `UPDATE partnership_members
     SET released_at = COALESCE(released_at, $2)
     WHERE partnership_id = $1 AND released_at IS NULL`,
    [input.partnershipId, input.at],
  );

  if (breakupWins) {
    await executor.query(
      `UPDATE breakup_processes
       SET dissolved_at = COALESCE(dissolved_at, $2)
       WHERE partnership_id = $1
         AND restored_at IS NULL
         AND dissolved_at IS NULL`,
      [input.partnershipId, input.at],
    );
    for (const accountId of [input.deletingAccountId, input.remainingAccountId]) {
      await executor.query(
        `INSERT INTO account_partner_eligibility (
           id, account_id, source_partnership_id, reason, created_at, eligible_at
         ) VALUES (md5($1::text || $2::text || $3::text || 'breakup_dissolution')::uuid, $1, $2, 'breakup_dissolution', $3, $3 + interval '3 months')
         ON CONFLICT (account_id) WHERE resolved_at IS NULL DO NOTHING`,
        [accountId, input.partnershipId, input.at],
      );
    }
  } else {
    await executor.query(
      `INSERT INTO account_partner_eligibility (
         id, account_id, source_partnership_id, reason, created_at, eligible_at
       ) VALUES (md5($1::text || $2::text || $3::text || 'partner_account_deleted')::uuid, $1, $2, 'partner_account_deleted', $3, $3 + interval '1 month')
       ON CONFLICT (account_id) WHERE resolved_at IS NULL DO NOTHING`,
      [input.remainingAccountId, input.partnershipId, input.at],
    );
  }

  return reason;
}

export async function getAccountDeletionGeneration(
  executor: QueryExecutor,
  accountId: string,
): Promise<bigint> {
  const result = await executor.query<{ generation: string | number | bigint }>(
    `SELECT generation
     FROM account_deletion_requests
     WHERE account_id = $1
     ORDER BY generation DESC LIMIT 1`,
    [accountId],
  );
  return BigInt(result.rows[0]?.generation ?? 0);
}

export async function requestAccountDeletion(
  executor: QueryExecutor,
  input: {
    id: string;
    accountId: string;
    requestedAt: Date;
    recoverUntil: Date;
    generation: bigint;
  },
): Promise<void> {
  await executor.query(
    "UPDATE accounts SET status = 'deletion_pending', updated_at = $2 WHERE id = $1",
    [input.accountId, input.requestedAt],
  );
  await executor.query(
    `INSERT INTO account_deletion_requests (
       id, account_id, requested_at, recover_until, generation
     ) VALUES ($1,$2,$3,$4,$5)`,
    [
      input.id,
      input.accountId,
      input.requestedAt,
      input.recoverUntil,
      input.generation.toString(),
    ],
  );
}

export async function recoverAccountDeletion(
  executor: QueryExecutor,
  accountId: string,
  at: Date,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE account_deletion_requests
     SET status = 'recovered', recovered_at = $2
     WHERE account_id = $1
       AND status = 'pending'
       AND $2 < recover_until`,
    [accountId, at],
  );
  if (result.rowCount !== 1) return false;
  await executor.query(
    "UPDATE accounts SET status = 'active', updated_at = $2 WHERE id = $1",
    [accountId, at],
  );
  return true;
}

export async function lockPendingAccountDeletion(
  executor: QueryExecutor,
  accountId: string,
  generation: bigint,
): Promise<{ id: string; requestedAt: Date; recoverUntil: Date } | null> {
  const result = await executor.query<{ id: string; requested_at: Date; recover_until: Date }>(
    `SELECT id, requested_at, recover_until
     FROM account_deletion_requests
     WHERE account_id = $1 AND status = 'pending' AND generation = $2
     FOR UPDATE`,
    [accountId, generation.toString()],
  );
  const row = result.rows[0];
  return row ? { id: row.id, requestedAt: row.requested_at, recoverUntil: row.recover_until } : null;
}

export async function finalizeAccountDeletionState(
  executor: QueryExecutor,
  accountId: string,
  deletionRequestId: string,
  at: Date,
): Promise<void> {
  await executor.query(
    "UPDATE accounts SET status = 'deleted', updated_at = $2 WHERE id = $1",
    [accountId, at],
  );
  await executor.query(
    `UPDATE account_deletion_requests
     SET status = 'finalized', finalized_at = $2
     WHERE id = $1 AND status = 'pending'`,
    [deletionRequestId, at],
  );
}

export async function scrubAccountAuthenticationData(
  executor: QueryExecutor,
  accountId: string,
): Promise<void> {
  await executor.query("DELETE FROM email_verifications WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM account_sessions WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM account_recovery_material WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM account_password_credentials WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM account_emails WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM account_devices WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM account_profiles WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM username_change_history WHERE account_id = $1", [accountId]);
  await executor.query("DELETE FROM security_email_deliveries WHERE account_id = $1", [accountId]);
}
