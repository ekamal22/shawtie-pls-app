import { z } from "zod";

const uuid = z.string().uuid();
const timestamp = z.string().min(20).max(40);
const safePositive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const safeNonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const cursorLimit = z.coerce.number().int().min(1);
const textEncoder = new TextEncoder();

function boundedUtf8(maxBytes: number) {
  return z.string().refine((value) => textEncoder.encode(value).length <= maxBytes, {
    message: "UTF-8 payload too large",
  });
}

export const conversationIdParamsSchema = z.object({
  conversationId: uuid,
});

export const messageIdParamsSchema = z.object({
  conversationId: uuid,
  messageId: uuid,
});

export const messageBodySchema = boundedUtf8(8_192)
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(4_000));

export const messageSendSchema = z.object({
  body: messageBodySchema,
  replyToMessageId: uuid.nullable().optional().default(null),
});

export const messageEditSchema = z.object({
  body: messageBodySchema,
  expectedContentVersion: safePositive,
});

export const reactionEmojiSchema = boundedUtf8(32)
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(16));

export const messageReactionSchema = z.object({
  emoji: reactionEmojiSchema,
});

export const messageHistoryQuerySchema = z
  .object({
    beforeSequence: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    afterSequence: safeNonnegative.optional(),
    limit: cursorLimit.max(100).default(50),
  })
  .superRefine((value, context) => {
    if (value.beforeSequence !== undefined && value.afterSequence !== undefined) {
      context.addIssue({
        code: "custom",
        message: "beforeSequence and afterSequence are mutually exclusive",
      });
    }
  });

export const messageChangeQuerySchema = z.object({
  afterChangeSequence: safeNonnegative,
  limit: cursorLimit.max(200).default(100),
});

export const messageReceiptSchema = z.object({
  type: z.enum(["delivered", "read"]),
  throughSequence: safeNonnegative,
});

export const typingStateSchema = z.object({
  typing: z.boolean(),
});

export const presenceHeartbeatSchema = z.object({}).strict();

export const nicknameSubjectParamsSchema = z.object({
  partnershipId: uuid,
  accountId: uuid,
});

export const nicknameMutationSchema = z.object({
  nickname: boundedUtf8(256)
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(80))
    .nullable(),
  expectedVersion: safePositive,
});

export const messageProjectionSchema = z.object({
  messageId: uuid,
  senderAccountId: uuid,
  senderDeviceId: uuid.nullable(),
  serverSequence: safePositive,
  contentVersion: safePositive,
  lastChangeSequence: safePositive,
  replyToMessageId: uuid.nullable(),
  replyContext: z
    .object({
      messageId: uuid,
      senderAccountId: uuid,
      body: z.string().nullable(),
      deleted: z.boolean(),
    })
    .nullable(),
  body: z.string().nullable(),
  createdAt: timestamp,
  editedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
  reactions: z.array(
    z.object({
      accountId: uuid,
      emoji: reactionEmojiSchema,
    }),
  ),
});

export const conversationChangeSchema = z.object({
  changeSequence: safePositive,
  type: z.enum([
    "message.created",
    "message.updated",
    "message.deleted",
    "message.reaction_changed",
  ]),
  messageId: uuid,
  contentVersion: safePositive.nullable(),
  changedAt: timestamp,
});

export type MessageSendInput = z.infer<typeof messageSendSchema>;
export type MessageEditInput = z.infer<typeof messageEditSchema>;
export type MessageReactionInput = z.infer<typeof messageReactionSchema>;
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;
export type MessageChangeQuery = z.infer<typeof messageChangeQuerySchema>;
export type MessageReceiptInput = z.infer<typeof messageReceiptSchema>;
export type TypingStateInput = z.infer<typeof typingStateSchema>;
export type NicknameMutationInput = z.infer<typeof nicknameMutationSchema>;
export type MessageProjection = z.infer<typeof messageProjectionSchema>;
export type ConversationChange = z.infer<typeof conversationChangeSchema>;
