import { z } from "zod";
import {
  M3_ATTACHMENTS_PER_MESSAGE_MAX,
  mediaAttachmentProjectionSchema,
  messageMediaAttachmentInputSchema,
} from "../media/media.ts";
import {
  encryptedProtectedContentProjectionSchema,
  encryptedProtectedContentSchema,
} from "../crypto/protected-content.ts";

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

export const messageSendSchema = z
  .object({
    messageId: uuid.optional(),
    body: messageBodySchema.nullable().optional().default(null),
    protectedBody: encryptedProtectedContentSchema.nullable().optional().default(null),
    replyToMessageId: uuid.nullable().optional().default(null),
    attachments: z
      .array(messageMediaAttachmentInputSchema)
      .max(M3_ATTACHMENTS_PER_MESSAGE_MAX)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.protectedBody !== null && value.messageId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["messageId"],
        message: "protected message requires client-generated messageId",
      });
    }
    if (value.body !== null && value.protectedBody !== null) {
      context.addIssue({ code: "custom", message: "message cannot contain plaintext and protected body" });
    }
    if (value.body === null && value.protectedBody === null && value.attachments.length === 0) {
      context.addIssue({ code: "custom", message: "message cannot be empty" });
    }
    const positions = new Set<number>();
    for (const attachment of value.attachments) {
      if (positions.has(attachment.position)) {
        context.addIssue({ code: "custom", message: "attachment positions must be unique" });
        break;
      }
      positions.add(attachment.position);
    }
    const voice = value.attachments.filter((attachment) => attachment.role === "voice_message");
    if (
      voice.length > 0 &&
      (
        voice.length !== 1 ||
        value.attachments.length !== 1 ||
        value.body !== null ||
        value.protectedBody !== null
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "voice message must be one voice attachment with no text body",
      });
    }
  });

export const messageEditSchema = z
  .object({
    body: messageBodySchema.nullable().optional().default(null),
    protectedBody: encryptedProtectedContentSchema.nullable().optional().default(null),
    expectedContentVersion: safePositive,
  })
  .superRefine((value, context) => {
    if ((value.body === null) === (value.protectedBody === null)) {
      context.addIssue({
        code: "custom",
        message: "message edit requires exactly one plaintext or protected body",
      });
    }
  });

export const reactionEmojiSchema = boundedUtf8(32)
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(16));

export const messageReactionSchema = z
  .object({
    reactionId: uuid.optional(),
    emoji: reactionEmojiSchema.nullable().optional().default(null),
    protectedReaction: encryptedProtectedContentSchema.nullable().optional().default(null),
  })
  .superRefine((value, context) => {
    if ((value.emoji === null) === (value.protectedReaction === null)) {
      context.addIssue({
        code: "custom",
        message: "reaction requires exactly one plaintext or protected value",
      });
    }
    if (value.protectedReaction !== null && value.reactionId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reactionId"],
        message: "protected reaction requires client-generated reactionId",
      });
    }
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

export const nicknameMutationSchema = z
  .object({
    nickname: boundedUtf8(M1_NICKNAME_MAX_UTF8_BYTES)
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(M1_NICKNAME_MAX_CHARACTERS))
      .nullable()
      .optional()
      .default(null),
    protectedNickname: encryptedProtectedContentSchema.nullable().optional().default(null),
    expectedVersion: safePositive,
  })
  .superRefine((value, context) => {
    if (value.nickname !== null && value.protectedNickname !== null) {
      context.addIssue({
        code: "custom",
        message: "nickname cannot contain plaintext and protected value",
      });
    }
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
      protectedBody: encryptedProtectedContentProjectionSchema.nullable().optional().default(null),
      deleted: z.boolean(),
    })
    .nullable(),
  body: z.string().nullable(),
  protectedBody: encryptedProtectedContentProjectionSchema.nullable().optional().default(null),
  createdAt: timestamp,
  editedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
  reactions: z.array(
    z.object({
      reactionId: uuid,
      accountId: uuid,
      emoji: reactionEmojiSchema.nullable(),
      protectedReaction: encryptedProtectedContentProjectionSchema.nullable().optional().default(null),
    }),
  ),
  attachments: z.array(mediaAttachmentProjectionSchema).max(M3_ATTACHMENTS_PER_MESSAGE_MAX),
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
