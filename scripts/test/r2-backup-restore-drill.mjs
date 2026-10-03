import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
  closeDatabasePool,
  createDatabasePool,
  insertAbuseReport,
  insertAccount,
  insertAccountPolicyAcceptance,
  insertAccountProfile,
  insertCurrentEmail,
  insertErasureTombstone,
  insertPartnership,
  insertPartnershipMembers,
  insertPasswordCredential,
  upsertNotificationPreferences,
} from "@shawtie/db";
import {
  createDefaultDeletionHandlers,
  defaultRetryPolicy,
  runDeletionBatch,
} from "../../apps/worker/dist/index.js";

if (process.env.DB_TEST_CONFIRM !== "1") {
  throw new Error("DB_TEST_CONFIRM=1 is required");
}
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed");
  }
}

function databaseName(value) {
  return value.replace(/[^a-z0-9_]/gi, "_").slice(0, 50);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "shawtie-r2-restore-"));
const backupFile = path.join(tempDir, "before-erasure.dump");
const journalFile = path.join(tempDir, "erasure.json");
const restoreDbName = databaseName("shawtie_r2_restore_" + process.pid + "_" + Date.now());

const source = new URL(sourceUrl);
const admin = new URL(sourceUrl);
admin.pathname = "/postgres";
const restore = new URL(sourceUrl);
restore.pathname = "/" + restoreDbName;
const restoreUrl = restore.toString();

const adminClient = new pg.Client({ connectionString: admin.toString() });
await adminClient.connect();

let sourceDatabase = null;
let restoreDatabase = null;

try {
  await adminClient.query(`CREATE DATABASE "${restoreDbName}"`);

  sourceDatabase = createDatabasePool({
    connectionString: sourceUrl,
    applicationName: "shawtie-r2-restore-drill-source",
  });

  const at = new Date();
  const erasedAccountId = randomUUID();
  const remainingAccountId = randomUUID();
  const partnershipId = randomUUID();

  await insertAccount(sourceDatabase.pool, {
    id: erasedAccountId,
    usernameNormalized: "r2-restore-erased",
    usernameDisplay: "r2-restore-erased",
    dateOfBirth: "2000-01-01",
    createdAt: at,
  });
  await insertAccountProfile(sourceDatabase.pool, {
    accountId: erasedAccountId,
    displayName: "R2 Restore Erased",
    at,
  });
  await insertPasswordCredential(
    sourceDatabase.pool,
    erasedAccountId,
    "$argon2id$r2-restore-erased",
    at,
  );
  await insertCurrentEmail(sourceDatabase.pool, {
    id: randomUUID(),
    accountId: erasedAccountId,
    emailNormalized: "r2-restore-erased@example.test",
    emailDisplay: "r2-restore-erased@example.test",
    at,
  });
  await insertAccountPolicyAcceptance(sourceDatabase.pool, {
    accountId: erasedAccountId,
    policyVersion: "r2-restore-drill",
    acceptedAt: at,
  });
  await upsertNotificationPreferences(sourceDatabase.pool, {
    accountId: erasedAccountId,
    messagePreviewEnabled: true,
    updatedAt: at,
  });

  await insertAccount(sourceDatabase.pool, {
    id: remainingAccountId,
    usernameNormalized: "r2-restore-remaining",
    usernameDisplay: "r2-restore-remaining",
    dateOfBirth: "2000-01-01",
    createdAt: at,
  });
  await insertAccountProfile(sourceDatabase.pool, {
    accountId: remainingAccountId,
    displayName: "R2 Restore Remaining",
    at,
  });

  await insertPartnership(sourceDatabase.pool, {
    id: partnershipId,
    relationshipStartDate: "2025-01-01",
    activatedAt: at,
  });
  await insertPartnershipMembers(
    sourceDatabase.pool,
    partnershipId,
    [erasedAccountId, remainingAccountId],
    at,
  );

  await insertAbuseReport(sourceDatabase.pool, {
    id: randomUUID(),
    reporterAccountId: erasedAccountId,
    targetAccountId: remainingAccountId,
    subjectReference: "@r2-restore-remaining",
    category: "other",
    details: "Synthetic restore drill reporter-owned support data.",
    createdAt: at,
  });
  await insertAbuseReport(sourceDatabase.pool, {
    id: randomUUID(),
    reporterAccountId: remainingAccountId,
    targetAccountId: erasedAccountId,
    subjectReference: "@r2-restore-erased",
    category: "abusive_username",
    details: "Synthetic restore drill target-reference data.",
    createdAt: at,
  });

  run(process.execPath, ["scripts/operations/postgres-backup.mjs", backupFile], {
    ...process.env,
    DATABASE_URL: sourceUrl,
  });

  const erasedAt = new Date(at.getTime() + 60_000);
  await insertErasureTombstone(sourceDatabase.pool, {
    subjectType: "account",
    subjectId: erasedAccountId,
    erasedAt,
    reason: "account_permanently_deleted",
  });
  await insertErasureTombstone(sourceDatabase.pool, {
    subjectType: "partnership",
    subjectId: partnershipId,
    erasedAt: new Date(erasedAt.getTime() + 1),
    reason: "breakup",
  });

  run(process.execPath, ["scripts/operations/export-erasure-journal.mjs", journalFile], {
    ...process.env,
    DATABASE_URL: sourceUrl,
  });

  run(process.execPath, ["scripts/operations/postgres-restore.mjs", backupFile, journalFile], {
    ...process.env,
    DATABASE_URL: restoreUrl,
    R2_RESTORE_CONFIRM: "RESTORE",
    R2_RESTORE_ISOLATED: "1",
    R2_RESTORE_TARGET_DATABASE: restoreDbName,
  });

  restoreDatabase = createDatabasePool({
    connectionString: restoreUrl,
    applicationName: "shawtie-r2-restore-drill-target",
  });

  const handlers = createDefaultDeletionHandlers(restoreDatabase);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const count = await runDeletionBatch(
      restoreDatabase,
      "r2-restore-drill",
      handlers,
      new AbortController().signal,
      {
        batchSize: 20,
        concurrency: 2,
        leaseMs: 60_000,
        retryPolicy: defaultRetryPolicy,
      },
    );
    if (count === 0) break;
    if (iteration === 19) {
      throw new Error("Deletion worker did not drain restore manifests");
    }
  }

  run(process.execPath, ["scripts/operations/verify-erasure-restore.mjs", journalFile], {
    ...process.env,
    DATABASE_URL: restoreUrl,
    R2_RESTORE_ISOLATED: "1",
  });

  const account = await restoreDatabase.pool.query(
    `SELECT status,
            (SELECT count(*)::int FROM account_profiles WHERE account_id = $1) AS profiles,
            (SELECT count(*)::int FROM account_emails WHERE account_id = $1) AS emails,
            (SELECT count(*)::int FROM account_policy_acceptances WHERE account_id = $1) AS policies,
            (SELECT count(*)::int FROM account_notification_preferences
             WHERE account_id = $1) AS preferences,
            (SELECT count(*)::int FROM abuse_reports WHERE reporter_account_id = $1) AS reports,
            (SELECT count(*)::int FROM abuse_reports WHERE target_account_id = $1) AS targeted
     FROM accounts
     WHERE id = $1`,
    [erasedAccountId],
  );
  assert.equal(account.rows[0]?.status, "deleted");
  assert.equal(account.rows[0]?.profiles, 0);
  assert.equal(account.rows[0]?.emails, 0);
  assert.equal(account.rows[0]?.policies, 0);
  assert.equal(account.rows[0]?.preferences, 0);
  assert.equal(account.rows[0]?.reports, 0);
  assert.equal(account.rows[0]?.targeted, 0);

  const partnership = await restoreDatabase.pool.query(
    `SELECT lifecycle_state,
            (SELECT count(*)::int FROM partnership_members
             WHERE partnership_id = $1 AND released_at IS NULL) AS active_members,
            (SELECT status FROM deletion_manifests
             WHERE subject_type = 'partnership' AND subject_id = $1
             ORDER BY created_at DESC LIMIT 1) AS deletion_status
     FROM partnerships
     WHERE id = $1`,
    [partnershipId],
  );
  assert.equal(partnership.rows[0]?.lifecycle_state, "terminated");
  assert.equal(partnership.rows[0]?.active_members, 0);
  assert.equal(partnership.rows[0]?.deletion_status, "completed");

  console.log(
    "R2_BACKUP_RESTORE_DELETION_DRILL_PASS account=true partnership=true support_cleanup=true",
  );
} finally {
  if (sourceDatabase) await closeDatabasePool(sourceDatabase);
  if (restoreDatabase) await closeDatabasePool(restoreDatabase);
  await adminClient.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [restoreDbName],
  );
  await adminClient.query(`DROP DATABASE IF EXISTS "${restoreDbName}"`);
  await adminClient.end();
  await rm(tempDir, { recursive: true, force: true });
}
