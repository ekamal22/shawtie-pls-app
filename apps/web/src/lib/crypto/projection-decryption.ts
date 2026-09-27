import type {
  EncryptedProtectedContentProjection,
  MessageProjection,
  RelationshipItemProjection,
} from "@shawtie/contracts";
import { utf8Decode } from "@shawtie/crypto";
import type { S1CryptoRuntime } from "./crypto-runtime.ts";

export type ProtectedContentViewState =
  | "available"
  | "history_unavailable"
  | "integrity_failed"
  | "temporarily_unavailable";

export interface DecryptedMessageProjection extends Omit<
  MessageProjection,
  "body" | "replyContext" | "reactions"
> {
  readonly body: string | null;
  readonly protectedContentState: ProtectedContentViewState;
  readonly replyContext: {
    readonly messageId: string;
    readonly senderAccountId: string;
    readonly body: string | null;
    readonly protectedBody: EncryptedProtectedContentProjection | null;
    readonly deleted: boolean;
    readonly protectedContentState: ProtectedContentViewState;
  } | null;
  readonly reactions: readonly {
    readonly reactionId: string;
    readonly accountId: string;
    readonly emoji: string;
    readonly protectedReaction: EncryptedProtectedContentProjection | null;
  }[];
  readonly protectedReactionFailure: boolean;
}

export interface DecryptedRelationshipItemProjection extends Omit<
  RelationshipItemProjection,
  "preview" | "content"
> {
  readonly preview: Record<string, unknown> | null;
  readonly content: Record<string, unknown> | null;
  readonly cryptoPreviewState: ProtectedContentViewState;
  readonly cryptoContentState: ProtectedContentViewState;
}

export function protectedContentStateForError(
  error: unknown,
): Exclude<ProtectedContentViewState, "available"> | null {
  if (!(error instanceof Error) || !error.message.startsWith("CRYPTO_")) return null;
  if (error.message === "CRYPTO_HISTORY_UNAVAILABLE") return "history_unavailable";
  if (
    error.message === "CRYPTO_CIPHERTEXT_INVALID" ||
    error.message === "CRYPTO_SIGNATURE_INVALID"
  ) {
    return "integrity_failed";
  }
  return "temporarily_unavailable";
}

async function decryptTextForView(
  runtime: S1CryptoRuntime | null,
  context: {
    readonly partnershipId: string;
    readonly contentType: "message" | "message_reaction" | "partnership_nickname";
    readonly contentId: string;
    readonly payloadRole: "message_body" | "reaction_value" | "nickname_value";
  },
  protectedContent: EncryptedProtectedContentProjection,
): Promise<{ readonly value: string | null; readonly state: ProtectedContentViewState }> {
  if (!runtime) return { value: null, state: "temporarily_unavailable" };
  try {
    return {
      value: utf8Decode(await runtime.decryptProtectedBytes(context, protectedContent)),
      state: "available",
    };
  } catch (error) {
    const state = protectedContentStateForError(error);
    if (!state) throw error;
    return { value: null, state };
  }
}

export async function decryptMessageProjectionForView(
  runtime: S1CryptoRuntime | null,
  partnershipId: string,
  message: MessageProjection,
): Promise<DecryptedMessageProjection> {
  const bodyResult =
    message.protectedBody && !message.deletedAt
      ? await decryptTextForView(
          runtime,
          {
            partnershipId,
            contentType: "message",
            contentId: message.messageId,
            payloadRole: "message_body",
          },
          message.protectedBody,
        )
      : { value: message.body, state: "available" as const };

  let replyContext: DecryptedMessageProjection["replyContext"] = null;
  if (message.replyContext) {
    const replyResult =
      message.replyContext.protectedBody && !message.replyContext.deleted
        ? await decryptTextForView(
            runtime,
            {
              partnershipId,
              contentType: "message",
              contentId: message.replyContext.messageId,
              payloadRole: "message_body",
            },
            message.replyContext.protectedBody,
          )
        : { value: message.replyContext.body, state: "available" as const };
    replyContext = {
      ...message.replyContext,
      body: replyResult.value,
      protectedContentState: replyResult.state,
    };
  }

  const reactions: DecryptedMessageProjection["reactions"][number][] = [];
  let protectedReactionFailure = false;
  for (const reaction of message.reactions) {
    if (!reaction.protectedReaction) {
      if (reaction.emoji !== null) reactions.push({ ...reaction, emoji: reaction.emoji });
      continue;
    }
    const decrypted = await decryptTextForView(
      runtime,
      {
        partnershipId,
        contentType: "message_reaction",
        contentId: reaction.reactionId,
        payloadRole: "reaction_value",
      },
      reaction.protectedReaction,
    );
    if (decrypted.state !== "available" || decrypted.value === null) {
      protectedReactionFailure = true;
      continue;
    }
    reactions.push({ ...reaction, emoji: decrypted.value });
  }

  return {
    ...message,
    body: bodyResult.value,
    protectedContentState: bodyResult.state,
    replyContext,
    reactions,
    protectedReactionFailure,
  };
}

export async function decryptMessagesForView(
  runtime: S1CryptoRuntime | null,
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
  runtime: S1CryptoRuntime | null,
  partnershipId: string,
  subjectAccountId: string,
  protectedNickname: EncryptedProtectedContentProjection | null | undefined,
  fallback: string | null,
): Promise<string | null> {
  if (!protectedNickname) return fallback;
  const decrypted = await decryptTextForView(
    runtime,
    {
      partnershipId,
      contentType: "partnership_nickname",
      contentId: subjectAccountId,
      payloadRole: "nickname_value",
    },
    protectedNickname,
  );
  return decrypted.state === "available" ? decrypted.value : fallback;
}

async function decryptRelationshipPayload(
  runtime: S1CryptoRuntime | null,
  partnershipId: string,
  itemId: string,
  role: "relationship_preview" | "relationship_main",
  protectedContent: EncryptedProtectedContentProjection,
): Promise<{
  readonly value: Record<string, unknown> | null;
  readonly state: ProtectedContentViewState;
}> {
  if (!runtime) return { value: null, state: "temporarily_unavailable" };
  try {
    return {
      value: await runtime.decryptProtectedJson<Record<string, unknown>>(
        {
          partnershipId,
          contentType: "relationship_item",
          contentId: itemId,
          payloadRole: role,
        },
        protectedContent,
      ),
      state: "available",
    };
  } catch (error) {
    const state = protectedContentStateForError(error);
    if (!state) throw error;
    return { value: null, state };
  }
}

export async function decryptRelationshipItemForView(
  runtime: S1CryptoRuntime | null,
  partnershipId: string,
  item: RelationshipItemProjection,
): Promise<DecryptedRelationshipItemProjection> {
  const previewResult = item.protectedPreview
    ? await decryptRelationshipPayload(
        runtime,
        partnershipId,
        item.itemId,
        "relationship_preview",
        item.protectedPreview,
      )
    : { value: item.preview, state: "available" as const };
  const contentResult = item.protectedContent
    ? await decryptRelationshipPayload(
        runtime,
        partnershipId,
        item.itemId,
        "relationship_main",
        item.protectedContent,
      )
    : { value: item.content, state: "available" as const };

  return {
    ...item,
    preview: previewResult.value,
    content: contentResult.value,
    cryptoPreviewState: previewResult.state,
    cryptoContentState: contentResult.state,
  };
}

export async function decryptRelationshipItemsForView(
  runtime: S1CryptoRuntime | null,
  partnershipId: string,
  items: readonly RelationshipItemProjection[],
): Promise<readonly DecryptedRelationshipItemProjection[]> {
  const output: DecryptedRelationshipItemProjection[] = [];
  for (const item of items) {
    output.push(await decryptRelationshipItemForView(runtime, partnershipId, item));
  }
  return output;
}
