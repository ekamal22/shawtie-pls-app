import type { QueryExecutor } from "../types/query-executor.ts";

export type AbuseReportCategory =
  | "abusive_username"
  | "impersonation"
  | "partner_request_harassment"
  | "account_compromise"
  | "illegal_content"
  | "other";

export async function insertAccountPolicyAcceptance(
  executor: QueryExecutor,
  input: {
    readonly accountId: string;
    readonly policyVersion: string;
    readonly acceptedAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO account_policy_acceptances (account_id, policy_version, accepted_at)
     VALUES ($1,$2,$3)
     ON CONFLICT (account_id, policy_version) DO NOTHING`,
    [input.accountId, input.policyVersion, input.acceptedAt],
  );
}

export async function insertAbuseReport(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly reporterAccountId: string;
    readonly targetAccountId?: string | null;
    readonly subjectReference?: string | null;
    readonly category: AbuseReportCategory;
    readonly details?: string | null;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO abuse_reports (
       id, reporter_account_id, target_account_id, subject_reference,
       category, details, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.id,
      input.reporterAccountId,
      input.targetAccountId ?? null,
      input.subjectReference ?? null,
      input.category,
      input.details ?? null,
      input.createdAt,
    ],
  );
}

export interface ErasureTombstone {
  readonly subjectType: "account" | "partnership";
  readonly subjectId: string;
  readonly erasedAt: Date;
  readonly reason: string;
}

export async function insertErasureTombstone(
  executor: QueryExecutor,
  input: ErasureTombstone,
): Promise<void> {
  await executor.query(
    `INSERT INTO erasure_tombstones (
       subject_type, subject_id, erased_at, reason
     ) VALUES ($1,$2,$3,$4)
     ON CONFLICT (subject_type, subject_id) DO UPDATE
     SET erased_at = GREATEST(erasure_tombstones.erased_at, EXCLUDED.erased_at),
         reason = EXCLUDED.reason`,
    [input.subjectType, input.subjectId, input.erasedAt, input.reason],
  );
}

export async function listErasureTombstones(
  executor: QueryExecutor,
): Promise<readonly ErasureTombstone[]> {
  const result = await executor.query<{
    subject_type: "account" | "partnership";
    subject_id: string;
    erased_at: Date;
    reason: string;
  }>(
    `SELECT subject_type, subject_id, erased_at, reason
     FROM erasure_tombstones
     ORDER BY erased_at, subject_type, subject_id`,
  );
  return result.rows.map((row) => ({
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    erasedAt: row.erased_at,
    reason: row.reason,
  }));
}
