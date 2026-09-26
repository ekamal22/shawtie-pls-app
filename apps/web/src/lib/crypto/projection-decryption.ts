import type {
  EncryptedProtectedContentProjection,
  MessageProjection,
  RelationshipItemProjection,
} from "@shawtie/contracts";
import { utf8Decode } from "@shawtie/crypto";
import type { S1CryptoRuntime } from "./crypto-runtime.ts";

export interface DecryptedMessageProjection
  extends Omit<MessageProjection, "body" | "replyContext" | "reactions"> {
  readonly body: string | null;
  readonly replyContext:
    | {
        readonly messageId: string;
        readonly senderAccountId: string;
        readonly body: string | null;
        readonly protectedBody: EncryptedProtectedContentProjection | null;
        readonly deleted: boolean;
      }
    | null;
  readonly reactions: readonly {
    readonly reactionId: string;
    readonly accountId: string;
    readonly emoji: string;
    readonly protectedReaction: EncryptedProtectedContentProjection | null;
  }[];
}

export interface DecryptedRelationshipItemProjection
  extends Omit<RelationshipItemProjection, "preview" | "content"> {
  readonly preview: Record<string, unknown> | null;
  readonly content: Record<string, unknown> | null;
}

export async function decryptMessageProjectionForView(
  runtime: S1CryptoRuntime,
  partnershipId: string,
  message: MessageProjection,
): Promise<DecryptedMessageProjection> {
  const body =
    message.protectedBody && !message.deletedAt
      ? utf8Decode(
          await runtime.decryptProtectedBytes(
            {
              partnershipId,
              contentType: "message",
              contentId: message.messageId,
              payloadRole: "message_body",
            },
            message.protectedBody,
          ),
        )
      : message.body;

  const replyContext = message.replyContext
    ? {
        ...message.replyContext,
        body:
          message.replyContext.protectedBody && !message.replyContext.deleted
            ? utf8Decode(
                await runtime.decryptProtectedBytes(
                  {
                    partnershipId,
                    contentType: "message",
                    contentId: message.replyContext.messageId,
                    payloadRole: "message_body",
                  },
                  message.replyContext.protectedBody,
                ),
              )
            : message.replyContext.body,
      }
    : null;

  const reactions = await Promise.all(
    message.reactions.map(async (reaction) => {
      const emoji = reaction.protectedReaction
        ? utf8Decode(
            await runtime.decryptProtectedBytes(
              {
                partnershipId,
                contentType: "message_reaction",
                contentId: reaction.reactionId,
                payloadRole: "reaction_value",
              },
              reaction.protectedReaction,
            ),
          )
        : reaction.emoji;
      if (emoji === null) throw new Error("CRYPTO_CIPHERTEXT_INVALID");
      return { ...reaction, emoji };
    }),
  );

  return {
    ...message,
    body,
    replyContext,
    reactions,
  };
}

export async function decryptMessagesForView(
  runtime: S1CryptoRuntime,
  partnershipId: string,
  messages: readonly MessageProjection[],
): Promise<readonly DecryptedMessageProjection[]> {
  const output: DecryptedMessageProjection[] = [];
  for (const message of messages) {
    output.push(await decryptMessageProjectionForView(runtime, partnershipId, message));
  }
  return output;
}

export async function decryptNicknameForView(
  runtime: S1CryptoRuntime,
  partnershipId: string,
  subjectAccountId: string,
  protectedNickname: EncryptedProtectedContentProjection | null | undefined,
  fallback: string | null,
): Promise<string | null> {
  if (!protectedNickname) return fallback;
  return utf8Decode(
    await runtime.decryptProtectedBytes(
      {
        partnershipId,
        contentType: "partnership_nickname",
        contentId: subjectAccountId,
        payloadRole: "nickname_value",
      },
      protectedNickname,
    ),
  );
}

export async function decryptRelationshipItemForView(
  runtime: S1CryptoRuntime,
  partnershipId: string,
  item: RelationshipItemProjection,
): Promise<DecryptedRelationshipItemProjection> {
  const preview = item.protectedPreview
    ? await runtime.decryptProtectedJson<Record<string, unknown>>(
        {
          partnershipId,
          contentType: "relationship_item",
          contentId: item.itemId,
          payloadRole: "relationship_preview",
        },
        item.protectedPreview,
      )
    : item.preview;
  const content = item.protectedContent
    ? await runtime.decryptProtectedJson<Record<string, unknown>>(
        {
          partnershipId,
          contentType: "relationship_item",
          contentId: item.itemId,
          payloadRole: "relationship_main",
        },
        item.protectedContent,
      )
    : item.content;

  return {
    ...item,
    preview,
    content,
  };
}

export async function decryptRelationshipItemsForView(
  runtime: S1CryptoRuntime,
  partnershipId: string,
  items: readonly RelationshipItemProjection[],
): Promise<readonly DecryptedRelationshipItemProjection[]> {
  const output: DecryptedRelationshipItemProjection[] = [];
  for (const item of items) {
    output.push(await decryptRelationshipItemForView(runtime, partnershipId, item));
  }
  return output;
}
