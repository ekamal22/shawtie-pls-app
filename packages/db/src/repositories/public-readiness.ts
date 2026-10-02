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
    readonly category: AbuseReportCategory;
    readonly details?: string | null;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO abuse_reports (
       id, reporter_account_id, target_account_id, category, details, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.id,
      input.reporterAccountId,
      input.targetAccountId ?? null,
      input.category,
      input.details ?? null,
      input.createdAt,
    ],
  );
}
