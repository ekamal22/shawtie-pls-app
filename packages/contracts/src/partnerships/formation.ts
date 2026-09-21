import { z } from "zod";
import { partnerRequestIdParamsSchema } from "../partner-requests/requests.ts";

const uuid = z.string().uuid();

export const p2ErrorCodeSchema = z.enum([
  "REQUEST_NOT_FOUND",
  "REQUEST_NOT_AVAILABLE",
  "PARTNERSHIP_UNAVAILABLE",
  "RELATIONSHIP_DATE_FUTURE",
  "PARTNERSHIP_METADATA_LOCKED",
  "VERSION_CONFLICT",
]);

export const partnerRequestAcceptParamsSchema = partnerRequestIdParamsSchema;
export const partnerRequestAcceptBodySchema = z.undefined();

export const partnerRequestAcceptResponseSchema = z.object({
  outcome: z.enum(["formed", "already_accepted"]),
  partnershipId: uuid,
});

export type P2ErrorCode = z.infer<typeof p2ErrorCodeSchema>;
export type PartnerRequestAcceptParams = z.infer<typeof partnerRequestAcceptParamsSchema>;
export type PartnerRequestAcceptResponse = z.infer<typeof partnerRequestAcceptResponseSchema>;
