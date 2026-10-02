import pg from "pg";

if (process.env.R2_SUPPORT_ADMIN_CONFIRM !== "1") {
  throw new Error("R2_SUPPORT_ADMIN_CONFIRM=1 is required");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const [command, reportId] = process.argv.slice(2);
if (!["list", "resolve"].includes(command ?? "")) {
  throw new Error("Usage: node scripts/operations/support-reports.mjs <list|resolve> [report-id]");
}
if (command === "resolve" && !reportId) {
  throw new Error("resolve requires a report UUID");
}

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: "shawtie-support-operations",
});
await client.connect();

try {
  if (command === "list") {
    const result = await client.query(
      `SELECT id, reporter_account_id, target_account_id, subject_reference,
              category, details, status, created_at
       FROM abuse_reports
       WHERE status = 'open'
       ORDER BY created_at ASC
       LIMIT 100`,
    );
    console.log(
      JSON.stringify(
        {
          count: result.rowCount ?? result.rows.length,
          reports: result.rows.map((row) => ({
            id: row.id,
            reporterAccountId: row.reporter_account_id,
            targetAccountId: row.target_account_id,
            subjectReference: row.subject_reference,
            category: row.category,
            details: row.details,
            status: row.status,
            createdAt: row.created_at.toISOString(),
          })),
        },
        null,
        2,
      ),
    );
    console.log("R2_SUPPORT_QUEUE_LIST_PASS");
  } else {
    const result = await client.query(
      `UPDATE abuse_reports
       SET status = 'resolved', resolved_at = clock_timestamp()
       WHERE id = $1 AND status = 'open'
       RETURNING id, resolved_at`,
      [reportId],
    );
    if (result.rowCount !== 1) throw new Error("Open support report not found");
    console.log(
      "R2_SUPPORT_REPORT_RESOLVED id=" +
        result.rows[0].id +
        " resolvedAt=" +
        result.rows[0].resolved_at.toISOString(),
    );
  }
} finally {
  await client.end();
}
