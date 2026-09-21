import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const username = z.string().trim().min(1).max(128);
const cursor = z.string().min(1).max(2048);

export const discoveryUsernameSchema = z.object({
  username,
});

export const partnerRequestCreateSchema = z.object({
  recipientAccountId: uuid,
  expectedUsername: username,
  relationshipStartDate: isoDate,
});

export const partnerRequestListQuerySchema = z.object({
  direction: z.enum(["incoming", "outgoing"]),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: cursor.optional(),
});

export const partnerRequestIdParamsSchema = z.object({
  requestId: uuid,
});

export const partnerRequestCursorSchema = z.object({
  v: z.literal(1),
  snapshotAt: z.string().min(20).max(40),
  createdAt: z.string().min(20).max(40),
  requestId: uuid,
  direction: z.enum(["incoming", "outgoing"]),
});

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\x21-\x7E]+$/);

export type DiscoveryUsernameInput = z.infer<typeof discoveryUsernameSchema>;
export type PartnerRequestCreateInput = z.infer<typeof partnerRequestCreateSchema>;
export type PartnerRequestListQuery = z.infer<typeof partnerRequestListQuerySchema>;
export type PartnerRequestCursor = z.infer<typeof partnerRequestCursorSchema>;
