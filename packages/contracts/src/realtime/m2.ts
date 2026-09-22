import { z } from "zod";

export const M2_REALTIME_PROTOCOL_VERSION = 1 as const;
export const M2_REALTIME_SUBPROTOCOL = "shawtie.realtime.v1" as const;
export const M2_REALTIME_NOTIFY_CHANNEL = "shawtie_realtime_v1" as const;
export const M2_REALTIME_MAX_FRAME_BYTES = 4 * 1024;
export const M2_INTERNAL_NOTIFY_MAX_BYTES = 2 * 1024;
export const M2_LOCAL_SCHEMA_VERSION = 1 as const;
export const M2_PRE_S1_CONTENT_CONTEXT = "pre-s1" as const;

const uuidSchema = z.string().uuid();
const positiveSequenceSchema = z.number().int().safe().positive();
const nonNegativeSequenceSchema = z.number().int().safe().nonnegative();
const timestampSchema = z.string().datetime({ offset: true });

const readyPayloadSchema = z
  .object({
    connectionId: uuidSchema,
    serverTime: timestampSchema,
    accountId: uuidSchema,
    partnershipId: uuidSchema.nullable(),
    conversationId: uuidSchema.nullable(),
    partnershipGeneration: nonNegativeSequenceSchema.nullable(),
    latestServerSequence: nonNegativeSequenceSchema,
    latestChangeSequence: nonNegativeSequenceSchema,
  })
  .strict();

const pingPayloadSchema = z.object({ nonce: z.string().min(1).max(96) }).strict();

const resyncPayloadSchema = z
  .object({
    scope: z.enum(["account", "partnership", "conversation", "relationship"]),
    reason: z.enum(["gap", "backpressure", "scope_changed", "listener_reset", "anti_entropy", "unknown_state"]),
  })
  .strict();

const updateRequiredPayloadSchema = z
  .object({
    minimumRealtimeProtocolVersion: positiveSequenceSchema,
    minimumClientProtocolVersion: positiveSequenceSchema,
  })
  .strict();

const messageCreatedPayloadSchema = z
  .object({
    eventId: uuidSchema,
    conversationId: uuidSchema,
    messageId: uuidSchema,
    mutation: z.literal("created"),
    changeSequence: positiveSequenceSchema,
    serverSequence: positiveSequenceSchema,
    contentVersion: positiveSequenceSchema,
  })
  .strict();

const messageMutationPayloadSchema = z
  .object({
    eventId: uuidSchema,
    conversationId: uuidSchema,
    messageId: uuidSchema,
    mutation: z.enum(["updated", "deleted", "reaction_changed"]),
    changeSequence: positiveSequenceSchema,
    contentVersion: positiveSequenceSchema.nullable(),
  })
  .strict();

const receiptPayloadSchema = z
  .object({
    eventId: uuidSchema,
    conversationId: uuidSchema,
    deliveredThrough: nonNegativeSequenceSchema,
    readThrough: nonNegativeSequenceSchema,
  })
  .strict();

const nicknamePayloadSchema = z
  .object({
    eventId: uuidSchema,
    partnershipId: uuidSchema,
    subjectAccountId: uuidSchema,
    version: positiveSequenceSchema,
  })
  .strict();

const partnershipPayloadSchema = z
  .object({
    eventId: uuidSchema,
    partnershipId: uuidSchema,
    generation: nonNegativeSequenceSchema,
    metadataVersion: positiveSequenceSchema,
  })
  .strict();

const relationshipPayloadSchema = z
  .object({
    eventId: uuidSchema,
    partnershipId: uuidSchema,
    itemId: uuidSchema.nullable(),
    itemVersion: positiveSequenceSchema.nullable(),
  })
  .strict();

const accountSecurityPayloadSchema = z.object({ eventId: uuidSchema }).strict();

const internalPresencePayloadSchema = z
  .object({
    eventId: uuidSchema,
    actorAccountId: uuidSchema,
    online: z.boolean(),
  })
  .strict();

const internalTypingPayloadSchema = z
  .object({
    eventId: uuidSchema,
    actorAccountId: uuidSchema,
    conversationId: uuidSchema,
    typing: z.boolean(),
    expiresAt: timestampSchema.nullable(),
  })
  .strict();

const presencePayloadSchema = z.object({ online: z.boolean() }).strict();

const typingPayloadSchema = z
  .object({
    typing: z.boolean(),
    expiresAt: timestampSchema.nullable(),
  })
  .strict();

const namespaceRevokedPayloadSchema = z
  .object({
    partnershipId: uuidSchema,
    reason: z.literal("authorization_changed"),
  })
  .strict();

function serverFrame<TType extends string, TSchema extends z.ZodTypeAny>(type: TType, payload: TSchema) {
  return z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      type: z.literal(type),
      payload,
    })
    .strict();
}

export const m2RealtimeServerFrameSchema = z.discriminatedUnion("type", [
  serverFrame("control.ready", readyPayloadSchema),
  serverFrame("control.ping", pingPayloadSchema),
  serverFrame("control.resync_required", resyncPayloadSchema),
  serverFrame("control.update_required", updateRequiredPayloadSchema),
  serverFrame("message.changed", z.union([messageCreatedPayloadSchema, messageMutationPayloadSchema])),
  serverFrame("conversation.receipt_changed", receiptPayloadSchema),
  serverFrame("conversation.nickname_changed", nicknamePayloadSchema),
  serverFrame("partnership.changed", partnershipPayloadSchema),
  serverFrame("relationship.changed", relationshipPayloadSchema),
  serverFrame("account.security_changed", accountSecurityPayloadSchema),
  serverFrame("presence.changed", presencePayloadSchema),
  serverFrame("typing.changed", typingPayloadSchema),
  serverFrame("namespace.revoked", namespaceRevokedPayloadSchema),
]);

export const m2RealtimeClientFrameSchema = z.discriminatedUnion("type", [
  serverFrame("control.pong", pingPayloadSchema),
  serverFrame("presence.heartbeat", z.object({}).strict()),
  serverFrame("typing.set", z.object({ typing: z.boolean() }).strict()),
]);

export const m2InternalRealtimeNotificationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("message.changed"),
      scope: z.object({ conversationId: uuidSchema }).strict(),
      data: z.union([messageCreatedPayloadSchema, messageMutationPayloadSchema]),
    })
    .strict(),
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("conversation.receipt_changed"),
      scope: z.object({ conversationId: uuidSchema }).strict(),
      data: receiptPayloadSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("conversation.nickname_changed"),
      scope: z.object({ partnershipId: uuidSchema }).strict(),
      data: nicknamePayloadSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("partnership.changed"),
      scope: z.object({ partnershipId: uuidSchema }).strict(),
      data: partnershipPayloadSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("relationship.changed"),
      scope: z.object({ partnershipId: uuidSchema }).strict(),
      data: relationshipPayloadSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("account.security_changed"),
      scope: z.object({ accountId: uuidSchema }).strict(),
      data: accountSecurityPayloadSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("presence.changed"),
      scope: z.object({ partnershipId: uuidSchema }).strict(),
      data: internalPresencePayloadSchema,
    })
    .strict(),
  z
    .object({
      v: z.literal(M2_REALTIME_PROTOCOL_VERSION),
      kind: z.literal("typing.changed"),
      scope: z.object({ conversationId: uuidSchema }).strict(),
      data: internalTypingPayloadSchema,
    })
    .strict(),
]);

export type M2RealtimeServerFrame = z.infer<typeof m2RealtimeServerFrameSchema>;
export type M2RealtimeClientFrame = z.infer<typeof m2RealtimeClientFrameSchema>;
export type M2InternalRealtimeNotification = z.infer<typeof m2InternalRealtimeNotificationSchema>;

export function m2FrameByteLength(frame: unknown): number {
  return new TextEncoder().encode(JSON.stringify(frame)).byteLength;
}

export function assertM2RealtimeFrameSize(frame: unknown, maxBytes = M2_REALTIME_MAX_FRAME_BYTES): void {
  if (m2FrameByteLength(frame) > maxBytes) {
    throw new Error("M2_REALTIME_FRAME_TOO_LARGE");
  }
}
