import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeDatabasePool,
  createDatabasePool,
  databaseConfigFromEnv,
  insertAbuseReport,
  insertAccount,
  insertAccountProfile,
  insertCurrentEmail,
  insertPasswordCredential,
  scrubAccountAuthenticationData,
} from "@shawtie/db";

if (process.env.DB_TEST_CONFIRM !== "1") {
  throw new Error("DB_TEST_CONFIRM=1 is required");
}

const database = createDatabasePool({
  ...databaseConfigFromEnv(),
  applicationName: "shawtie-r2-support-drill",
});

function runOperator(args) {
  const result = spawnSync(process.execPath, ["scripts/operations/support-reports.mjs", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      R2_SUPPORT_ADMIN_CONFIRM: "1",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function seedAccount(accountId, username, email, at) {
  await insertAccount(database.pool, {
    id: accountId,
    usernameNormalized: username,
    usernameDisplay: username,
    dateOfBirth: "2000-01-01",
    createdAt: at,
  });
  await insertAccountProfile(database.pool, {
    accountId,
    displayName: username,
    at,
  });
  await insertPasswordCredential(database.pool, accountId, "$argon2id$r2-support", at);
  await insertCurrentEmail(database.pool, {
    id: randomUUID(),
    accountId,
    emailNormalized: email,
    emailDisplay: email,
    at,
  });
}

try {
  const at = new Date();
  const reporterId = randomUUID();
  const targetId = randomUUID();
  const secondReporterId = randomUUID();

  await seedAccount(reporterId, "r2-support-reporter", "r2-support-reporter@example.test", at);
  await seedAccount(targetId, "r2-support-target", "r2-support-target@example.test", at);
  await seedAccount(
    secondReporterId,
    "r2-support-second",
    "r2-support-second@example.test",
    at,
  );

  const firstReportId = randomUUID();
  await insertAbuseReport(database.pool, {
    id: firstReportId,
    reporterAccountId: reporterId,
    targetAccountId: targetId,
    subjectReference: "@r2-support-target",
    category: "partner_request_harassment",
    details: "Synthetic R2 support drill report.",
    createdAt: at,
  });

  const listed = runOperator(["list"]);
  assert.match(listed, new RegExp(firstReportId));
  assert.match(listed, /partner_request_harassment/);

  const resolved = runOperator(["resolve", firstReportId]);
  assert.match(resolved, /R2_SUPPORT_REPORT_RESOLVED/);

  const firstState = await database.pool.query(
    "SELECT status, resolved_at FROM abuse_reports WHERE id = $1",
    [firstReportId],
  );
  assert.equal(firstState.rows[0]?.status, "resolved");
  assert.ok(firstState.rows[0]?.resolved_at);

  const reporterOwnedReport = randomUUID();
  await insertAbuseReport(database.pool, {
    id: reporterOwnedReport,
    reporterAccountId: reporterId,
    targetAccountId: targetId,
    subjectReference: "@r2-support-target",
    category: "impersonation",
    details: "Synthetic reporter-owned cleanup proof.",
    createdAt: at,
  });

  const otherReport = randomUUID();
  await insertAbuseReport(database.pool, {
    id: otherReport,
    reporterAccountId: secondReporterId,
    targetAccountId: reporterId,
    subjectReference: "@r2-support-reporter",
    category: "abusive_username",
    details: "Synthetic target-reference cleanup proof.",
    createdAt: at,
  });

  await scrubAccountAuthenticationData(database.pool, reporterId);

  const removed = await database.pool.query("SELECT 1 FROM abuse_reports WHERE id = $1", [
    reporterOwnedReport,
  ]);
  assert.equal(removed.rowCount, 0);

  const targetCleared = await database.pool.query(
    "SELECT target_account_id FROM abuse_reports WHERE id = $1",
    [otherReport],
  );
  assert.equal(targetCleared.rows[0]?.target_account_id, null);

  const profileRemoved = await database.pool.query(
    "SELECT 1 FROM account_profiles WHERE account_id = $1",
    [reporterId],
  );
  assert.equal(profileRemoved.rowCount, 0);

  console.log(
    "R2_SUPPORT_WORKFLOW_DRILL_PASS create=list=resolve=deletion_cleanup target_reference_clear=true",
  );
} finally {
  await closeDatabasePool(database);
}
