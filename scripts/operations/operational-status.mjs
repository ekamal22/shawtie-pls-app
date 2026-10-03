import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: "shawtie-operational-status",
});
await client.connect();

async function one(query) {
  const result = await client.query(query);
  return result.rows[0] ?? {};
}

try {
  const [outbox, scheduled, deletion, email, reports] = await Promise.all([
    one(`SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'processing')::int AS processing,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      EXTRACT(EPOCH FROM (clock_timestamp() - min(available_at)
        FILTER (WHERE status = 'pending')))::int AS oldest_pending_seconds
      FROM outbox_events`),
    one(`SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'processing')::int AS processing,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      EXTRACT(EPOCH FROM (clock_timestamp() - min(execute_at)
        FILTER (WHERE status = 'pending' AND execute_at <= clock_timestamp())))::int
        AS oldest_due_seconds
      FROM scheduled_actions`),
    one(`SELECT
      count(*) FILTER (WHERE status <> 'completed')::int AS incomplete_manifests,
      count(*) FILTER (WHERE status = 'failed')::int AS failed_manifests,
      EXTRACT(EPOCH FROM (clock_timestamp() - min(created_at)
        FILTER (WHERE status <> 'completed')))::int AS oldest_incomplete_seconds,
      (SELECT count(*)::int FROM deletion_targets WHERE status = 'failed') AS failed_targets
      FROM deletion_manifests`),
    one(`SELECT
      count(*) FILTER (
        WHERE delivered_at IS NULL AND expires_at > clock_timestamp()
      )::int AS pending,
      count(*) FILTER (
        WHERE delivered_at IS NULL AND expires_at <= clock_timestamp()
      )::int AS expired_undelivered
      FROM security_email_deliveries`),
    one(`SELECT
      count(*) FILTER (WHERE status = 'open')::int AS open,
      EXTRACT(EPOCH FROM (clock_timestamp() - min(created_at)
        FILTER (WHERE status = 'open')))::int AS oldest_open_seconds
      FROM abuse_reports`),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    outbox,
    scheduledActions: scheduled,
    deletion,
    securityEmail: email,
    supportReports: reports,
  };
  console.log(JSON.stringify(report, null, 2));

  const limits = {
    oldestOutbox: Number(process.env.R2_ALERT_OUTBOX_SECONDS ?? 300),
    oldestScheduled: Number(process.env.R2_ALERT_SCHEDULED_SECONDS ?? 300),
    oldestDeletion: Number(process.env.R2_ALERT_DELETION_SECONDS ?? 3600),
  };
  const failures = [];
  if ((outbox.failed ?? 0) > 0) failures.push("failed_outbox");
  if ((scheduled.failed ?? 0) > 0) failures.push("failed_scheduled_action");
  if ((deletion.failed_manifests ?? 0) > 0) failures.push("failed_deletion_manifest");
  if ((deletion.failed_targets ?? 0) > 0) failures.push("failed_deletion_target");
  if ((email.expired_undelivered ?? 0) > 0) failures.push("expired_security_email");
  if ((outbox.oldest_pending_seconds ?? 0) > limits.oldestOutbox) failures.push("outbox_lag");
  if ((scheduled.oldest_due_seconds ?? 0) > limits.oldestScheduled) failures.push("scheduled_lag");
  if ((deletion.oldest_incomplete_seconds ?? 0) > limits.oldestDeletion) failures.push("deletion_lag");

  if (failures.length > 0) {
    console.error("R2_OPERATIONAL_STATUS_FAIL classes=" + failures.join(","));
    process.exitCode = 2;
  } else {
    console.log("R2_OPERATIONAL_STATUS_PASS");
  }
} finally {
  await client.end();
}
