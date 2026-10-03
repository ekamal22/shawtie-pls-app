import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const journalPath = process.argv[2] || process.env.R2_ERASURE_JOURNAL_FILE;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!journalPath) throw new Error("Erasure journal path is required");
if (process.env.R2_RESTORE_ISOLATED !== "1") {
  throw new Error("R2_RESTORE_ISOLATED=1 is required for restore verification");
}

const raw = await readFile(path.resolve(journalPath), "utf8");
const expectedRaw = await readFile(path.resolve(journalPath) + ".sha256", "utf8");
const expected = expectedRaw.trim().split(/\s+/)[0];
if (createHash("sha256").update(raw).digest("hex") !== expected) {
  throw new Error("Erasure journal checksum mismatch");
}
const journal = JSON.parse(raw);

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: "shawtie-restore-erasure-verify",
});
await client.connect();
try {
  for (const entry of journal.entries ?? []) {
    if (entry.subjectType === "account") {
      const result = await client.query(
        `SELECT account.status,
                (SELECT count(*)::int FROM account_sessions WHERE account_id = $1) AS sessions,
                (SELECT count(*)::int FROM account_emails WHERE account_id = $1) AS emails,
                (SELECT count(*)::int FROM account_devices WHERE account_id = $1) AS devices,
                (SELECT count(*)::int FROM account_profiles WHERE account_id = $1) AS profiles,
                (SELECT count(*)::int FROM account_notification_preferences
                 WHERE account_id = $1) AS notification_preferences,
                (SELECT count(*)::int FROM account_policy_acceptances
                 WHERE account_id = $1) AS policy_acceptances,
                (SELECT count(*)::int FROM abuse_reports
                 WHERE reporter_account_id = $1) AS reporter_reports,
                (SELECT count(*)::int FROM abuse_reports
                 WHERE target_account_id = $1) AS target_reports
         FROM accounts account WHERE account.id = $1`,
        [entry.subjectId],
      );
      const row = result.rows[0];
      if (
        row &&
        (row.status !== "deleted" ||
          row.sessions !== 0 ||
          row.emails !== 0 ||
          row.devices !== 0 ||
          row.profiles !== 0 ||
          row.notification_preferences !== 0 ||
          row.policy_acceptances !== 0 ||
          row.reporter_reports !== 0 ||
          row.target_reports !== 0)
      ) {
        throw new Error("Deleted account became accessible after restore: " + entry.subjectId);
      }
    } else if (entry.subjectType === "partnership") {
      const result = await client.query(
        `SELECT partnership.lifecycle_state,
                (SELECT count(*)::int FROM partnership_members
                 WHERE partnership_id = $1 AND released_at IS NULL) AS active_members,
                (SELECT status FROM deletion_manifests
                 WHERE subject_type = 'partnership' AND subject_id = $1
                 ORDER BY created_at DESC LIMIT 1) AS deletion_status
         FROM partnerships partnership WHERE partnership.id = $1`,
        [entry.subjectId],
      );
      const row = result.rows[0];
      if (
        row &&
        (row.lifecycle_state !== "terminated" ||
          row.active_members !== 0 ||
          row.deletion_status !== "completed")
      ) {
        throw new Error(
          "Deleted partnership is not fully deletion-safe after restore: " + entry.subjectId,
        );
      }
    }
  }
  console.log("R2_RESTORE_ERASURE_VERIFY_PASS entries=" + (journal.entries?.length ?? 0));
} finally {
  await client.end();
}
