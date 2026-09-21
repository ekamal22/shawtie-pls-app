import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const metadataVersion = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const partnershipIdParamsSchema = z.object({
  partnershipId: uuid,
});

export const relationshipStartDateUpdateSchema = z.object({
  relationshipStartDate: isoDate,
  expectedMetadataVersion: metadataVersion,
});

export const relationshipStartDateUpdateResponseSchema = z.object({
  partnershipId: uuid,
  relationshipStartDate: isoDate,
  metadataVersion,
  changed: z.boolean(),
});

export type PartnershipIdParams = z.infer<typeof partnershipIdParamsSchema>;
export type RelationshipStartDateUpdateInput = z.infer<typeof relationshipStartDateUpdateSchema>;
export type RelationshipStartDateUpdateResponse = z.infer<
  typeof relationshipStartDateUpdateResponseSchema
>;
