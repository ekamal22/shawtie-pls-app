import { z } from "zod";

export const abuseReportCategorySchema = z.enum([
  "abusive_username",
  "impersonation",
  "partner_request_harassment",
  "account_compromise",
  "illegal_content",
  "other",
]);

export const abuseReportCreateSchema = z.object({
  category: abuseReportCategorySchema,
  targetAccountId: z.string().uuid().nullable().optional(),
  details: z.string().trim().min(1).max(2000).nullable().optional(),
});

export type AbuseReportCategory = z.infer<typeof abuseReportCategorySchema>;
export type AbuseReportCreateInput = z.infer<typeof abuseReportCreateSchema>;
