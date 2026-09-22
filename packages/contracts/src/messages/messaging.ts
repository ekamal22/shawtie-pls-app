import { z } from "zod";

export const M1_MESSAGE_MAX_UTF8_BYTES = 8_192;
export const M1_MESSAGE_MAX_CHARACTERS = 4_000;
export const M1_NICKNAME_MAX_UTF8_BYTES = 256;
export const M1_NICKNAME_MAX_CHARACTERS = 80;
export const M1_HISTORY_DEFAULT_LIMIT = 50;
export const M1_HISTORY_MAX_LIMIT = 100;
export const M1_CHANGE_DEFAULT_LIMIT = 100;
export const M1_CHANGE_MAX_LIMIT = 200;
export const M1_TYPING_TTL_MS = 5_000;
export const M1_TYPING_MIN_REFRESH_MS = 2_000;
export const M1_PRESENCE_HEARTBEAT_MIN_MS = 30_000;
export const M1_PRESENCE_ONLINE_TTL_MS = 60_000;
export const M1_VISIBLE_CHANGE_POLL_MS = 2_000;
export const M1_TYPING_RATE_WINDOW_MS = 60_000;
export const M1_TYPING_RATE_LIMIT = 60;
export const M1_PRESENCE_RATE_WINDOW_MS = 60_000;
export const M1_PRESENCE_RATE_LIMIT = 30;

const uuid = z.string().uuid();
const timestamp = z.string().min(20).max(40);
const safePositive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const safeNonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeNonnegativeQuery = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
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

export const messageBodySchema = boundedUtf8(M1_MESSAGE_MAX_UTF8_BYTES)
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(M1_MESSAGE_MAX_CHARACTERS));

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
    afterSequence: safeNonnegativeQuery.optional(),
    limit: cursorLimit.max(M1_HISTORY_MAX_LIMIT).default(M1_HISTORY_DEFAULT_LIMIT),
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
  afterChangeSequence: safeNonnegativeQuery,
  limit: cursorLimit.max(M1_CHANGE_MAX_LIMIT).default(M1_CHANGE_DEFAULT_LIMIT),
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
  nickname: boundedUtf8(M1_NICKNAME_MAX_UTF8_BYTES)
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(M1_NICKNAME_MAX_CHARACTERS))
    .nullable(),
  expectedVersion: safePositive,
});

export const messageProjectionSchema = z.object({
  messageId: uuid,
  conversationId: uuid,
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
