import { randomUUID } from "node:crypto";
import {
  getTransactionTimestamp,
  insertAbuseReport,
  lockAccounts,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import type { AbuseReportCreateInput } from "@shawtie/contracts";
import type { AuthContext } from "../../plugins/authentication.ts";
import { ApiError } from "../../lib/api-error.ts";
import type { AccountService } from "../accounts/account-service.ts";

const DAY = 24 * 60 * 60_000;

export class SupportService {
  constructor(
    readonly database: DatabasePool,
    readonly accountService: AccountService,
  ) {}

  async createReport(
    auth: AuthContext,
    input: AbuseReportCreateInput,
    networkKey: string,
  ): Promise<{ reportId: string; status: "open"; createdAt: string }> {
    await this.accountService.consumeSecurityRateLimit([
      {
        scope: "support_report_account",
        subject: auth.session.accountId,
        limit: 10,
        windowMs: DAY,
        blockMs: DAY,
      },
      {
        scope: "support_report_network",
        subject: networkKey,
        limit: 50,
        windowMs: DAY,
        blockMs: DAY,
      },
    ]);

    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      const accountIds = [
        auth.session.accountId,
        ...(input.targetAccountId ? [input.targetAccountId] : []),
      ];
      const locked = await lockAccounts(transaction, accountIds);
      if (!locked.includes(auth.session.accountId)) {
        throw new ApiError(401, "AUTH_REQUIRED");
      }
      if (input.targetAccountId && !locked.includes(input.targetAccountId)) {
        throw new ApiError(400, "REPORT_TARGET_UNAVAILABLE");
      }

      const reportId = randomUUID();
      await insertAbuseReport(transaction, {
        id: reportId,
        reporterAccountId: auth.session.accountId,
        targetAccountId: input.targetAccountId ?? null,
        subjectReference: input.subjectReference?.trim() || null,
        category: input.category,
        details: input.details?.trim() || null,
        createdAt: now,
      });
      return { reportId, status: "open" as const, createdAt: now.toISOString() };
    });
  }
}
