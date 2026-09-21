import { z } from "zod";

const uuid = z.string().uuid();
const timestamp = z.string().min(20).max(40);
const cursor = z.string().min(1).max(2048);

export const breakupIdParamsSchema = z.object({
  partnershipId: uuid,
  breakupId: uuid,
});

export const partnershipLifecycleMutationBodySchema = z.undefined();

export const breakupInitiateResponseSchema = z.object({
  partnershipId: uuid,
  breakupId: uuid,
  lifecycleState: z.literal("breakup_pending"),
  initiatedAt: timestamp,
  initiatorCancelUntil: timestamp,
  baseDeadline: timestamp,
  finalDeadline: timestamp,
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export const breakupCancelResponseSchema = z.object({
  partnershipId: uuid,
  breakupId: uuid,
  lifecycleState: z.literal("active"),
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export const restoreIntentResponseSchema = z.object({
  partnershipId: uuid,
  breakupId: uuid,
  lifecycleState: z.enum(["active", "breakup_pending"]),
  finalDeadline: timestamp,
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  restored: z.boolean(),
});

export const formerPartnershipListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: cursor.optional(),
});

export const formerPartnershipCursorSchema = z.object({
  v: z.literal(1),
  snapshotAt: timestamp,
  releasedAt: timestamp,
  partnershipId: uuid,
});

export const formerPartnershipSchema = z.object({
  partnershipId: uuid,
  terminatedAt: timestamp,
  terminationReason: z.enum(["breakup", "partner_account_deleted"]),
  formerPartner: z
    .object({
      accountId: uuid,
      username: z.string().trim().min(1).max(128),
      displayName: z.string().trim().min(1).max(80),
    })
    .nullable(),
  blockedByMe: z.boolean(),
});

export const formerPartnershipListResponseSchema = z.object({
  items: z.array(formerPartnershipSchema),
  nextCursor: cursor.nullable(),
});

export const blockFormerPartnerResponseSchema = z.object({
  partnershipId: uuid,
  blocked: z.boolean(),
});

export type BreakupIdParams = z.infer<typeof breakupIdParamsSchema>;
export type BreakupInitiateResponse = z.infer<typeof breakupInitiateResponseSchema>;
export type BreakupCancelResponse = z.infer<typeof breakupCancelResponseSchema>;
export type RestoreIntentResponse = z.infer<typeof restoreIntentResponseSchema>;
export type FormerPartnershipListQuery = z.infer<typeof formerPartnershipListQuerySchema>;
export type FormerPartnershipCursor = z.infer<typeof formerPartnershipCursorSchema>;
export type FormerPartnership = z.infer<typeof formerPartnershipSchema>;
export type FormerPartnershipListResponse = z.infer<typeof formerPartnershipListResponseSchema>;
export type BlockFormerPartnerResponse = z.infer<typeof blockFormerPartnerResponseSchema>;
