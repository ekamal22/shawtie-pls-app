import { z } from "zod";

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const positiveVersion = z.number().int().safe().positive();

export const callKindSchema = z.enum(["voice", "video"]);
export const callStateSchema = z.enum(["ringing", "accepted", "connected", "ended"]);
export const callOutcomeSchema = z
  .enum(["rejected", "cancelled", "missed", "completed", "failed", "unavailable"])
  .nullable();

export const callProjectionSchema = z
  .object({
    id: uuid,
    partnershipId: uuid,
    kind: callKindSchema,
    direction: z.enum(["incoming", "outgoing"]),
    state: callStateSchema,
    version: positiveVersion,
    initiatedAt: timestamp,
    ringExpiresAt: timestamp.nullable(),
    acceptedAt: timestamp.nullable(),
    connectedAt: timestamp.nullable(),
    endedAt: timestamp.nullable(),
    outcome: callOutcomeSchema,
    isThisDeviceSelectedEndpoint: z.boolean(),
  })
  .strict();

export const callCreateSchema = z
  .object({
    expectedPartnershipId: uuid,
    kind: callKindSchema,
  })
  .strict();

export const callIdParamsSchema = z.object({ callId: uuid }).strict();

export const callVersionMutationSchema = z
  .object({ expectedVersion: positiveVersion })
  .strict();

export const callFailureCategorySchema = z.enum([
  "media_permission",
  "relay_unavailable",
  "negotiation_failed",
  "network_failed",
]);

export const callFailureMutationSchema = z
  .object({
    expectedVersion: positiveVersion,
    category: callFailureCategorySchema,
  })
  .strict();

export const callEndpointConnectedSchema = z.object({}).strict();

export const callHistoryQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const callHistoryItemSchema = z
  .object({
    id: uuid,
    kind: callKindSchema,
    direction: z.enum(["incoming", "outgoing"]),
    initiatedAt: timestamp,
    connectedAt: timestamp.nullable(),
    endedAt: timestamp.nullable(),
    outcome: callOutcomeSchema,
    durationSeconds: z.number().int().safe().nonnegative().nullable(),
  })
  .strict();

export const callHistoryResponseSchema = z
  .object({
    items: z.array(callHistoryItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const turnCredentialResponseSchema = z
  .object({
    urls: z.array(z.string().url()).min(1).max(8),
    username: z.string().min(1).max(512),
    credential: z.string().min(1).max(1024),
    expiresAt: timestamp,
    iceTransportPolicy: z.literal("relay"),
  })
  .strict();

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(4096),
    expirationTime: z.number().safe().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(512),
        auth: z.string().min(1).max(512),
      })
      .strict(),
  })
  .strict();

export type CallCreateInput = z.infer<typeof callCreateSchema>;
export type CallProjection = z.infer<typeof callProjectionSchema>;
export type CallVersionMutationInput = z.infer<typeof callVersionMutationSchema>;
export type CallFailureMutationInput = z.infer<typeof callFailureMutationSchema>;
export type CallFailureCategory = z.infer<typeof callFailureCategorySchema>;
export type CallHistoryQuery = z.infer<typeof callHistoryQuerySchema>;
export type CallHistoryItem = z.infer<typeof callHistoryItemSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
