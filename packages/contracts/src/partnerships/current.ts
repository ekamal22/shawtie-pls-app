import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(20).max(40);
const metadataVersion = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const generation = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const currentPartnershipResponseSchema = z.object({
  partnership: z
    .object({
      partnershipId: uuid,
      lifecycleState: z.enum(["active", "breakup_pending"]),
      interactionMode: z.enum(["normal", "breakup_restricted", "account_deletion_view_only"]),
      activatedAt: timestamp,
      relationshipStartDate: isoDate,
      metadataVersion,
      generation,
      breakup: z
        .object({
          breakupId: uuid,
          initiatedBy: z.enum(["self", "partner"]),
          initiatedAt: timestamp,
          initiatorCancelUntil: timestamp,
          baseDeadline: timestamp,
          finalDeadline: timestamp,
          selfRestoreIntentAt: timestamp.nullable(),
          partnerRestoreIntentAt: timestamp.nullable(),
        })
        .nullable(),
      accountDeletion: z
        .object({
          deletingMember: z.enum(["self", "partner"]),
          recoverUntil: timestamp,
        })
        .nullable(),
      capabilities: z.object({
        changeRelationshipStartDate: z.boolean(),
        initiateBreakup: z.boolean(),
        cancelBreakup: z.boolean(),
        submitRestoreIntent: z.boolean(),
        viewSharedData: z.boolean(),
      }),
      otherMember: z.object({
        accountId: uuid,
        username: z.string().trim().min(1).max(128),
        displayName: z.string().trim().min(1).max(80),
      }),
    })
    .nullable(),
});

export type CurrentPartnershipResponse = z.infer<typeof currentPartnershipResponseSchema>;
