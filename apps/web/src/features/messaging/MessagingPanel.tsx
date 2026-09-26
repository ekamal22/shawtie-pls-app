import {
  M1_CHANGE_DEFAULT_LIMIT,
  M1_HISTORY_DEFAULT_LIMIT,
  M1_MESSAGE_MAX_CHARACTERS,
  M1_NICKNAME_MAX_CHARACTERS,
  M1_PRESENCE_HEARTBEAT_MIN_MS,
  M1_TYPING_MIN_REFRESH_MS,
  M1_VISIBLE_CHANGE_POLL_MS,
  M2_PRE_S1_CONTENT_CONTEXT,
  S1_CONTENT_CONTEXT,
  type EncryptedProtectedContentProjection,
  type MessageProjection,
  type MessageSendInput,
} from "@shawtie/contracts";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "../../design/icons.tsx";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorNotice,
  IconButton,
  Notice,
  OfflineNotice,
  PresenceLine,
  Sheet,
  Skeleton,
  SkeletonGroup,
} from "../../design/primitives.tsx";
import { ApiClientError, ApiNetworkError, apiRequest } from "../../lib/api-client.ts";
import { useM2Runtime, useM2SyncStatus } from "../../lib/realtime/runtime-context.tsx";
import { useS1CryptoRuntime } from "../../lib/crypto/runtime-context.tsx";
import {
  decryptMessageProjectionForView,
  decryptMessagesForView,
  decryptNicknameForView,
  type DecryptedMessageProjection,
} from "../../lib/crypto/projection-decryption.ts";
import { VoiceRecorder } from "../media/VoiceRecorder.tsx";
import {
  discardMediaDraft,
  prepareMediaDraft,
  uploadMediaDraft,
} from "../../lib/media/media-runtime.ts";
import {
  listMediaDrafts,
  purgeMediaPartnershipData,
} from "../../lib/media/media-local-db.ts";
import type { LocalMediaDraft } from "../../lib/media/media-types.ts";
import type { ChatQueueOperation } from "../../lib/offline/local-db.ts";
import { createRelationshipItem } from "../relationship-space/api.ts";
import {
  afterNavigationSettles,
  nameSharedElement,
  runSignatureTransition,
} from "../../design/motion/view-transition.ts";
import { keptSourcesSnapshot, subscribeKeptSources } from "./kept-registry.ts";
import { TalkActions } from "./TalkActions.tsx";
import { TalkBubble } from "./TalkBubble.tsx";
import { buildRememberThisPayload, buildRows, deliveryLabel } from "./talk-model.ts";
import "./talk.css";

interface ConversationSummary {
  conversationId: string;
  partnershipId: string;
  lifecycleState: "active" | "breakup_pending";
  interactionMode: "normal" | "breakup_restricted" | "account_deletion_view_only";
  cryptoRequired: boolean;
  cryptoRequiredFrom: string | null;
  latestServerSequence: number;
  latestChangeSequence: number;
  breakup: {
    initiatedAt: string | null;
    messageFreezeSequence: number | null;
  } | null;
  self: {
    accountId: string;
    username: string;
    displayName: string;
    nickname: string | null;
    protectedNickname: EncryptedProtectedContentProjection | null;
    nicknameVersion: number;
  };
  partner: {
    accountId: string;
    username: string;
    displayName: string;
    nickname: string | null;
    protectedNickname: EncryptedProtectedContentProjection | null;
    nicknameVersion: number;
    presence: {
      online: boolean;
      lastSeenAt: string | null;
    };
    typing: boolean;
  };
  receipts: {
    selfDeliveredThrough: number;
    selfReadThrough: number;
    partnerDeliveredThrough: number;
    partnerReadThrough: number;
  };
  capabilities: {
    sendMessage: boolean;
    changeNickname: boolean;
    typing: boolean;
    viewMessages: boolean;
  };
}

type Message = DecryptedMessageProjection;
interface MessagePage {
  items: MessageProjection[];
  hasMore: boolean;
  oldestSequence: number | null;
  newestSequence: number | null;
  latestServerSequence: number;
}

interface ConversationChange {
  changeSequence: number;
  type: "message.created" | "message.updated" | "message.deleted" | "message.reaction_changed";
  messageId: string;
  contentVersion: number | null;
  changedAt: string;
}

const M1_MESSAGE_EDIT_WINDOW_MS = 30 * 60_000;
const textEncoder = new TextEncoder();

function idempotencyKey(): string {
  return "m1-" + crypto.randomUUID();
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    const known: Record<string, string> = {
      ACCOUNT_LOCKED: "Chat is view-only while account deletion recovery is active.",
      CONVERSATION_NOT_FOUND: "This conversation is no longer available.",
      MEDIA_ALREADY_BOUND: "That attachment was already used. Remove it and try again.",
      MEDIA_BINDING_DISABLED: "New attachments are temporarily unavailable.",
      MEDIA_NOT_FOUND: "That attachment is no longer available.",
      MEDIA_NOT_READY: "That attachment has not finished uploading.",
      MEDIA_UNAVAILABLE: "Media storage is temporarily unavailable.",
      OFFLINE_OPERATION_REQUIRES_CONNECTION:
        "Keeping a message needs a connection. Try again when you are back online.",
      INVALID_REFERENCE: "That message cannot be kept right now.",
      NO_CURRENT_PARTNERSHIP: "There is no current relationship space.",
      MEDIA_UPLOAD_DISABLED: "New media uploads are temporarily unavailable.",
      MEDIA_CRYPTO_PROTOCOL_UNAVAILABLE: "Sending attachments is not available in this build yet.",
      IDEMPOTENCY_KEY_REUSED: "That retry key was already used for a different change.",
      MESSAGE_DELETED: "That message was already deleted.",
      MESSAGE_EDIT_WINDOW_EXPIRED: "The 30-minute edit window has expired.",
      MESSAGE_NOT_OWNED: "Only the sender can change that message.",
      PRE_BREAKUP_MESSAGE_LOCKED: "Messages from before the breakup request are read-only.",
      RATE_LIMITED: "Too many chat-state updates. Try again shortly.",
      VERSION_CONFLICT: "This item changed on another device. Refresh and try again.",
    };
    return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
  }
  if (error instanceof Error && error.message.startsWith("CRYPTO_")) {
    const known: Record<string, string> = {
      CRYPTO_UNAVAILABLE: "Protected messaging is unavailable on this device.",
      CRYPTO_DEVICE_UNTRUSTED: "This device needs cryptographic approval before it can send.",
      CRYPTO_GROUP_NOT_READY: "Protected messaging is still preparing for this relationship.",
      CRYPTO_REKEY_REQUIRED: "Protected messaging is updating device access. Try again shortly.",
      CRYPTO_RECOVERY_REQUIRED: "Protected recovery must be configured for both partners first.",
      CRYPTO_HISTORY_UNAVAILABLE: "This protected history is unavailable on this device.",
      CRYPTO_CIPHERTEXT_INVALID: "Protected content failed integrity verification.",
      CRYPTO_SIGNATURE_INVALID: "Protected content failed sender verification.",
      CRYPTO_NOT_INITIALIZED: "Protected messaging is not active yet.",
    };
    return known[error.message] ?? error.message.replaceAll("_", " ").toLowerCase();
  }
  return "Messaging request failed.";
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.messageId, message]));
  for (const message of incoming) byId.set(message.messageId, message);
  return [...byId.values()].sort((left, right) => left.serverSequence - right.serverSequence);
}

function messageMutable(message: Message, conversation: ConversationSummary): boolean {
  if (message.deletedAt) return false;
  if (conversation.interactionMode === "account_deletion_view_only") return false;
  if (conversation.lifecycleState === "active") return true;
  const breakup = conversation.breakup;
  if (!breakup) return false;
  if (breakup.messageFreezeSequence !== null) {
    return message.serverSequence > breakup.messageFreezeSequence;
  }
  if (breakup.initiatedAt) {
    return new Date(message.createdAt).getTime() >= new Date(breakup.initiatedAt).getTime();
  }
  return false;
}

function messageEditable(message: Message, conversation: ConversationSummary): boolean {
  return (
    messageMutable(message, conversation) &&
    Date.now() < new Date(message.createdAt).getTime() + M1_MESSAGE_EDIT_WINDOW_MS
  );
}

interface PendingSend {
  readonly key: string;
  readonly messageId: string;
  readonly body: string | null;
  readonly replyToMessageId: string | null;
  readonly draftIds: readonly string[];
  readonly requestBody: MessageSendInput | null;
}

export function MessagingPanel({ active = true }: { readonly active?: boolean } = {}) {
  const runtime = useM2Runtime();
  const { runtime: cryptoRuntime, status: cryptoStatus } = useS1CryptoRuntime();
  // Talk stays mounted while Home or Ours is showing so delivery, sync, and typing keep working.
  // A message is only READ when Talk is the visible route, so the receipt code reads this ref.
  const activeRef = useRef(active);
  const syncStatus = useM2SyncStatus();
  const [conversation, setConversation] = useState<ConversationSummary | null | undefined>(
    undefined,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [composer, setComposer] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [selfNickname, setSelfNickname] = useState("");
  const [partnerNickname, setPartnerNickname] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendStatus, setSendStatus] = useState<"sending" | "queued" | "failed" | null>(null);
  const [mediaDrafts, setMediaDrafts] = useState<LocalMediaDraft[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ message: Message; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Message | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nicknamesOpen, setNicknamesOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [sessionKeptIds, setKeptIds] = useState<ReadonlySet<string>>(() => new Set());
  // Kept marks also come from Remember This lists Ours already loaded (no extra requests).
  const [knownKeptIds, setKnownKeptIds] = useState<ReadonlySet<string>>(keptSourcesSnapshot);
  useEffect(() => {
    setKnownKeptIds(keptSourcesSnapshot());
    return subscribeKeptSources(() => setKnownKeptIds(keptSourcesSnapshot()));
  }, []);
  const keptIds = useMemo(
    () => new Set([...sessionKeptIds, ...knownKeptIds]),
    [sessionKeptIds, knownKeptIds],
  );
  const [outbox, setOutbox] = useState<ChatQueueOperation[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickToEndRef = useRef(true);
  const lastEndKeyRef = useRef("");
  const changeCursorRef = useRef(0);
  const lastTypingSentRef = useRef(0);
  const pendingSendRef = useRef<PendingSend | null>(null);
  const selfNicknameDirtyRef = useRef(false);
  const partnerNicknameDirtyRef = useRef(false);

  const refreshConversation = useCallback(async () => {
    const result = await apiRequest<{ conversation: ConversationSummary | null }>(
      "/api/v1/conversations/current",
    );
    if (!result.conversation) {
      setConversation(null);
      return null;
    }

    const raw = result.conversation;
    const contentContextKey = raw.cryptoRequired
      ? S1_CONTENT_CONTEXT
      : M2_PRE_S1_CONTENT_CONTEXT;
    const database = await runtime.database();
    const contextChanged = await database.ensureNamespaceContentContext(
      raw.partnershipId,
      raw.conversationId,
      contentContextKey,
    );
    if (contextChanged) {
      await purgeMediaPartnershipData(runtime.accountId, raw.partnershipId);
    }

    const [selfNicknameValue, partnerNicknameValue] = await Promise.all([
      decryptNicknameForView(
        cryptoRuntime,
        raw.partnershipId,
        raw.self.accountId,
        raw.self.protectedNickname,
        raw.self.nickname,
      ),
      decryptNicknameForView(
        cryptoRuntime,
        raw.partnershipId,
        raw.partner.accountId,
        raw.partner.protectedNickname,
        raw.partner.nickname,
      ),
    ]);
    const summary: ConversationSummary = {
      ...raw,
      self: { ...raw.self, nickname: selfNicknameValue },
      partner: { ...raw.partner, nickname: partnerNicknameValue },
    };
    setConversation(summary);
    if (!selfNicknameDirtyRef.current) {
      setSelfNickname(summary.self.nickname ?? "");
    }
    if (!partnerNicknameDirtyRef.current) {
      setPartnerNickname(summary.partner.nickname ?? "");
    }
    return summary;
  }, [cryptoRuntime, runtime]);

  const refreshMediaDrafts = useCallback(
    async (partnershipId: string | null) => {
      if (!partnershipId) {
        setMediaDrafts([]);
        return;
      }
      setMediaDrafts(await listMediaDrafts(runtime.accountId, partnershipId, "chat"));
    },
    [runtime.accountId],
  );

  async function prepareFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!conversation) return;
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    if (mediaDrafts.length + files.length > 10) {
      setError("A message can contain at most 10 attachments.");
      return;
    }
    setMediaBusy(true);
    setError("");
    try {
      for (const file of files) {
        await prepareMediaDraft({
          accountId: runtime.accountId,
          partnershipId: conversation.partnershipId,
          ownerContext: "chat",
          source: file,
          role: "attachment",
          cryptoRequired: conversation.cryptoRequired,
          cryptoRuntime,
        });
      }
      await refreshMediaDrafts(conversation.partnershipId);
      setNotice(
        navigator.onLine
          ? "Attachment ready. Send when you are ready."
          : "Attachment saved on this device. Connect to upload and send it.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ").toLowerCase()
          : "Media preparation failed.",
      );
    } finally {
      setMediaBusy(false);
    }
  }

  async function retryDraft(draftId: string) {
    if (!conversation || !navigator.onLine) return;
    setMediaBusy(true);
    setError("");
    try {
      await uploadMediaDraft(runtime.accountId, draftId);
      await refreshMediaDrafts(conversation.partnershipId);
      setNotice("Attachment uploaded. Send when you are ready.");
    } catch (caught) {
      await refreshMediaDrafts(conversation.partnershipId).catch(() => undefined);
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ").toLowerCase()
          : "Media retry failed.",
      );
    } finally {
      setMediaBusy(false);
    }
  }

  async function removeDraft(draftId: string) {
    if (!conversation) return;
    setMediaBusy(true);
    try {
      await discardMediaDraft(runtime.accountId, draftId);
      await refreshMediaDrafts(conversation.partnershipId);
    } finally {
      setMediaBusy(false);
    }
  }

  async function uploadDrafts(): Promise<
    Array<{ mediaId: string; role: "attachment"; position: number }>
  > {
    const uploaded: Array<{ mediaId: string; role: "attachment"; position: number }> = [];
    for (const [position, draft] of mediaDrafts.entries()) {
      const result = await uploadMediaDraft(runtime.accountId, draft.draftId);
      uploaded.push({ mediaId: result.media.mediaId, role: "attachment", position });
    }
    return uploaded;
  }

  async function sendVoice(blob: Blob, durationSeconds: number) {
    if (!conversation) return;
    setMediaBusy(true);
    setError("");
    try {
      const draft = await prepareMediaDraft({
        accountId: runtime.accountId,
        partnershipId: conversation.partnershipId,
        ownerContext: "chat",
        source: blob,
        role: "voice_message",
        kind: "voice",
        durationSeconds,
        cryptoRequired: conversation.cryptoRequired,
        cryptoRuntime,
      });
      if (!navigator.onLine) {
        await refreshMediaDrafts(conversation.partnershipId);
        setNotice("Voice message saved on this device. Connect to upload and send it.");
        return;
      }
      const uploaded = await uploadMediaDraft(runtime.accountId, draft.draftId);
      const key = idempotencyKey();
      const requestBody = {
        body: null,
        replyToMessageId: replyingTo?.messageId ?? null,
        attachments: [
          { mediaId: uploaded.media.mediaId, role: "voice_message" as const, position: 0 },
        ],
      };
      try {
        const created = await apiRequest<{ messageId: string; changeSequence: number }>(
          "/api/v1/conversations/" + conversation.conversationId + "/messages",
          {
            method: "POST",
            headers: { "idempotency-key": key },
            body: requestBody,
          },
        );
        await refreshMessage(conversation.conversationId, created.messageId);
        changeCursorRef.current = Math.max(changeCursorRef.current, created.changeSequence);
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "message.send",
            contentContextKey: conversation.cryptoRequired
              ? S1_CONTENT_CONTEXT
              : M2_PRE_S1_CONTENT_CONTEXT,
            requestBody,
            idempotencyKey: key,
          });
          setNotice("Voice message queued after the final send request lost connection.");
        } else {
          throw caught;
        }
      }
      await discardMediaDraft(runtime.accountId, draft.draftId, false);
      await refreshMediaDrafts(conversation.partnershipId);
      setReplyingTo(null);
    } finally {
      setMediaBusy(false);
    }
  }

  const refreshMessage = useCallback(
    async (conversationId: string, messageId: string): Promise<Message> => {
      const summary = conversation;
      if (!summary || summary.conversationId !== conversationId) {
        throw new Error("CONVERSATION_NOT_FOUND");
      }
      const canonical = await apiRequest<MessageProjection>(
        "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      );
      const message = await decryptMessageProjectionForView(
        cryptoRuntime,
        summary.partnershipId,
        canonical,
      );
      setMessages((current) => mergeMessages(current, [message]));
      return message;
    },
    [conversation, cryptoRuntime],
  );

  const acknowledge = useCallback(
    async (summary: ConversationSummary, throughSequence: number) => {
      if (throughSequence <= 0) return;

      const database = await runtime.database();
      const pending = await database.advancePendingReceipts({
        partnershipId: summary.partnershipId,
        conversationId: summary.conversationId,
        deliveredThrough: throughSequence,
        readThrough:
          document.visibilityState === "visible" && activeRef.current ? throughSequence : 0,
      });

      const deliveredThrough = Math.max(throughSequence, pending?.pendingDeliveredThrough ?? 0);
      const readThrough = pending?.pendingReadThrough ?? 0;

      if (!navigator.onLine) return;

      // Only POST a receipt when it actually advances past what the server
      // already has on record. Posting unconditionally on every reconcile
      // pass caused a self-sustaining loop: acknowledging a receipt emits a
      // conversation.receipt_changed realtime frame back to every connection
      // on the conversation, including the acknowledging client's own
      // socket, which marked the sync coordinator dirty and requested
      // another reconcile pass that acknowledged again, forever, starving
      // the offline-replay phase of a clean pass to run in.
      try {
        if (deliveredThrough > summary.receipts.selfDeliveredThrough) {
          await apiRequest("/api/v1/conversations/" + summary.conversationId + "/receipt", {
            method: "POST",
            body: { type: "delivered", throughSequence: deliveredThrough },
          });
        }
        if (readThrough > 0 && readThrough > summary.receipts.selfReadThrough) {
          await apiRequest("/api/v1/conversations/" + summary.conversationId + "/receipt", {
            method: "POST",
            body: { type: "read", throughSequence: readThrough },
          });
        }
      } catch (error) {
        if (error instanceof ApiNetworkError) return;
        throw error;
      }
    },
    [runtime],
  );

  const loadInitial = useCallback(async () => {
    const summary = await refreshConversation();
    if (!summary) {
      setMessages([]);
      setHasOlder(false);
      changeCursorRef.current = 0;
      return;
    }

    const page = await apiRequest<MessagePage>(
      "/api/v1/conversations/" +
        summary.conversationId +
        "/messages?limit=" +
        M1_HISTORY_DEFAULT_LIMIT,
    );
    const newest = page.newestSequence ?? 0;
    const oldest = page.oldestSequence ?? newest;
    const database = await runtime.database();
    await database.commitMessagesAndSync({
      partnershipId: summary.partnershipId,
      conversationId: summary.conversationId,
      messages: page.items,
      contentContextKey: summary.cryptoRequired
        ? S1_CONTENT_CONTEXT
        : M2_PRE_S1_CONTENT_CONTEXT,
      sync: {
        partnershipId: summary.partnershipId,
        conversationId: summary.conversationId,
        latestChangeSequence: summary.latestChangeSequence,
        latestServerSequence: summary.latestServerSequence,
        retainedHistoryStartSequence: oldest,
        retainedHistoryEndSequence: newest,
        pendingDeliveredThrough: summary.receipts.selfDeliveredThrough,
        pendingReadThrough: summary.receipts.selfReadThrough,
        lastSyncedAt: new Date().toISOString(),
      },
    });
    const visible = await decryptMessagesForView(
      cryptoRuntime,
      summary.partnershipId,
      page.items,
    );
    setMessages([...visible]);
    setHasOlder(page.hasMore);
    changeCursorRef.current = summary.latestChangeSequence;
    await acknowledge(summary, newest);
  }, [acknowledge, cryptoRuntime, refreshConversation, runtime]);

  const syncChanges = useCallback(async () => {
    const summary = conversation;
    if (!summary) {
      return { latestChangeSequence: changeCursorRef.current };
    }

    const database = await runtime.database();
    let cursor = changeCursorRef.current;
    let highestLoadedSequence = messages.at(-1)?.serverSequence ?? 0;

    for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
      const result = await apiRequest<{
        items: ConversationChange[];
        latestChangeSequence: number;
        hasMore: boolean;
      }>(
        "/api/v1/conversations/" +
          summary.conversationId +
          "/changes?afterChangeSequence=" +
          cursor +
          "&limit=" +
          M1_CHANGE_DEFAULT_LIMIT,
      );

      const canonical: MessageProjection[] = [];
      for (const change of result.items) {
        canonical.push(
          await apiRequest<MessageProjection>(
            "/api/v1/conversations/" + summary.conversationId + "/messages/" + change.messageId,
          ),
        );
        cursor = change.changeSequence;
      }

      if (canonical.length > 0) {
        highestLoadedSequence = Math.max(
          highestLoadedSequence,
          ...canonical.map((message) => message.serverSequence),
        );
        const previous = await database.getConversationSync(
          summary.partnershipId,
          summary.conversationId,
        );
        await database.commitMessagesAndSync({
          partnershipId: summary.partnershipId,
          conversationId: summary.conversationId,
          messages: canonical,
          contentContextKey: summary.cryptoRequired
            ? S1_CONTENT_CONTEXT
            : M2_PRE_S1_CONTENT_CONTEXT,
          sync: {
            partnershipId: summary.partnershipId,
            conversationId: summary.conversationId,
            latestChangeSequence: cursor,
            latestServerSequence: Math.max(
              previous?.latestServerSequence ?? 0,
              highestLoadedSequence,
            ),
            retainedHistoryStartSequence:
              previous?.retainedHistoryStartSequence ??
              canonical.at(0)?.serverSequence ??
              highestLoadedSequence,
            retainedHistoryEndSequence: Math.max(
              previous?.retainedHistoryEndSequence ?? 0,
              highestLoadedSequence,
            ),
            pendingDeliveredThrough:
              previous?.pendingDeliveredThrough ?? summary.receipts.selfDeliveredThrough,
            pendingReadThrough: previous?.pendingReadThrough ?? summary.receipts.selfReadThrough,
            lastSyncedAt: new Date().toISOString(),
          },
        });
        const visibleCanonical = await decryptMessagesForView(
          cryptoRuntime,
          summary.partnershipId,
          canonical,
        );
        setMessages((current) => mergeMessages(current, [...visibleCanonical]));
        changeCursorRef.current = cursor;
      }

      if (!result.hasMore) break;
    }

    let refreshed = await refreshConversation();
    if (refreshed && refreshed.latestServerSequence > highestLoadedSequence) {
      for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
        const page = await apiRequest<MessagePage>(
          "/api/v1/conversations/" +
            refreshed.conversationId +
            "/messages?afterSequence=" +
            highestLoadedSequence +
            "&limit=" +
            M1_HISTORY_DEFAULT_LIMIT,
        );
        if (page.items.length === 0) break;

        highestLoadedSequence = page.newestSequence ?? highestLoadedSequence;
        const previous = await database.getConversationSync(
          refreshed.partnershipId,
          refreshed.conversationId,
        );
        await database.commitMessagesAndSync({
          partnershipId: refreshed.partnershipId,
          conversationId: refreshed.conversationId,
          messages: page.items,
          contentContextKey: refreshed.cryptoRequired
            ? S1_CONTENT_CONTEXT
            : M2_PRE_S1_CONTENT_CONTEXT,
          sync: {
            partnershipId: refreshed.partnershipId,
            conversationId: refreshed.conversationId,
            latestChangeSequence: changeCursorRef.current,
            latestServerSequence: Math.max(
              refreshed.latestServerSequence,
              previous?.latestServerSequence ?? 0,
            ),
            retainedHistoryStartSequence:
              previous?.retainedHistoryStartSequence ??
              page.oldestSequence ??
              highestLoadedSequence,
            retainedHistoryEndSequence: Math.max(
              previous?.retainedHistoryEndSequence ?? 0,
              highestLoadedSequence,
            ),
            pendingDeliveredThrough:
              previous?.pendingDeliveredThrough ?? refreshed.receipts.selfDeliveredThrough,
            pendingReadThrough: previous?.pendingReadThrough ?? refreshed.receipts.selfReadThrough,
            lastSyncedAt: new Date().toISOString(),
          },
        });
        const visiblePage = await decryptMessagesForView(
          cryptoRuntime,
          refreshed.partnershipId,
          page.items,
        );
        setMessages((current) => mergeMessages(current, [...visiblePage]));
        if (!page.hasMore) break;
      }
      refreshed = await refreshConversation();
    }

    if (refreshed) {
      await acknowledge(refreshed, highestLoadedSequence);
    }
    return { latestChangeSequence: changeCursorRef.current };
  }, [acknowledge, conversation, cryptoRuntime, messages, refreshConversation, runtime]);

  const handleSyncFailure = useCallback(
    async (caught: unknown) => {
      if (caught instanceof ApiClientError && caught.code === "CONVERSATION_NOT_FOUND") {
        try {
          await loadInitial();
          setError("");
          return;
        } catch (refreshError) {
          setError(errorText(refreshError));
          return;
        }
      }
      setError(errorText(caught));
    },
    [loadInitial],
  );

  // Entering Talk acknowledges what is now actually visible. Leaving it stops read
  // acknowledgment until Talk is opened again; delivered receipts are unaffected.
  useEffect(() => {
    const becameActive = active && !activeRef.current;
    activeRef.current = active;
    if (becameActive && conversation) {
      void syncChanges().catch((caught) => void handleSyncFailure(caught));
    }
    // Only a change of `active` re-evaluates; sync dependencies are read at call time.
  }, [active]);

  // Memory Return: a kept item asks Talk to show its source message. The app shell brings Talk
  // forward; once Talk is active and the message is rendered, it is scrolled into view and
  // highlighted with the same treatment as a reply jump.
  const pendingJumpRef = useRef<string | null>(null);
  // Two Sides: after arriving from a kept memory, offer the way back to the kept side.
  const [cameFromKept, setCameFromKept] = useState(false);
  useEffect(() => {
    if (!active) setCameFromKept(false);
  }, [active]);
  const [jumpTick, setJumpTick] = useState(0);
  useEffect(() => {
    const onOpenMessage = (event: Event) => {
      const messageId = (event as CustomEvent<{ messageId?: string }>).detail?.messageId;
      if (!messageId) return;
      pendingJumpRef.current = messageId;
      setCameFromKept(true);
      setJumpTick((value) => value + 1);
    };
    window.addEventListener("shawtie:open-message", onOpenMessage);
    return () => window.removeEventListener("shawtie:open-message", onOpenMessage);
  }, []);
  useEffect(() => {
    const messageId = pendingJumpRef.current;
    if (!messageId || !active || !conversation) return;
    const element = document.getElementById("talk-msg-" + messageId);
    pendingJumpRef.current = null;
    if (!element) {
      setNotice("That message is further back or no longer available.");
      return;
    }
    // Under a running Memory Return transition the arrival lands without smooth scrolling.
    element.scrollIntoView({ block: "center", behavior: "auto" });
    nameSharedElement(element);
    setHighlightedId(messageId);
    window.setTimeout(
      () => setHighlightedId((current) => (current === messageId ? null : current)),
      1800,
    );
  }, [jumpTick, active, conversation, messages]);

  useEffect(() => {
    void loadInitial().catch((caught) => setError(errorText(caught)));
  }, [loadInitial]);

  useEffect(() => {
    void refreshMediaDrafts(conversation?.partnershipId ?? null).catch(() => undefined);
  }, [conversation?.partnershipId, refreshMediaDrafts]);

  useEffect(
    () =>
      runtime.registerSynchronizer("messaging", async () => {
        try {
          return await syncChanges();
        } catch (caught) {
          // A dissolved partnership leaves this component still holding the
          // old conversationId, so the coordinator's reconcile pass starts
          // getting CONVERSATION_NOT_FOUND from the server. Only the
          // separate polling-interval error handler used to route that case
          // through loadInitial() to clear the stale conversation/messages
          // state; the coordinator-registered reconciler just let it
          // propagate into an endless retry, leaving the dissolved
          // partnership's messages visibly stuck on screen after reconnect.
          if (caught instanceof ApiClientError && caught.code === "CONVERSATION_NOT_FOUND") {
            await handleSyncFailure(caught);
            return;
          }
          throw caught;
        }
      }),
    [runtime, syncChanges, handleSyncFailure],
  );

  useEffect(() => {
    if (
      !conversation ||
      !navigator.onLine ||
      syncStatus === "live" ||
      syncStatus === "syncing" ||
      syncStatus === "update-required"
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void syncChanges().catch((caught) => void handleSyncFailure(caught));
    }, M1_VISIBLE_CHANGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [conversation, handleSyncFailure, syncChanges, syncStatus]);

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      if (runtime.sendPresenceHeartbeat()) return;
      void apiRequest("/api/v1/presence/heartbeat", {
        method: "POST",
        body: {},
      }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, M1_PRESENCE_HEARTBEAT_MIN_MS);
    return () => window.clearInterval(timer);
  }, [runtime]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void syncChanges().catch((caught) => void handleSyncFailure(caught));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [handleSyncFailure, syncChanges]);

  useEffect(() => {
    const refreshTransient = () => {
      void refreshConversation().catch(() => undefined);
    };
    const queueChanged = async () => {
      if (!conversation) return;
      const queue = await (await runtime.database()).listChatQueue(conversation.partnershipId);
      if (queue.length === 0 && sendStatus === "queued") {
        setSendStatus(null);
        setNotice("Queued message synced.");
      }
    };
    window.addEventListener("shawtie:presence-changed", refreshTransient);
    window.addEventListener("shawtie:typing-changed", refreshTransient);
    window.addEventListener("shawtie:chat-queue-changed", queueChanged);
    return () => {
      window.removeEventListener("shawtie:presence-changed", refreshTransient);
      window.removeEventListener("shawtie:typing-changed", refreshTransient);
      window.removeEventListener("shawtie:chat-queue-changed", queueChanged);
    };
  }, [conversation, refreshConversation, runtime, sendStatus]);

  const closeVoice = useCallback(() => setVoiceOpen(false), []);

  useEffect(() => {
    if (!composer && composerRef.current) composerRef.current.style.height = "";
  }, [composer]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Queued sends are shown in the thread as waiting messages. Read-only view of the M2 outbox.
  useEffect(() => {
    const partnershipId = conversation?.partnershipId;
    if (!partnershipId) {
      setOutbox([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const queue = await (await runtime.database()).listChatQueue(partnershipId);
      if (!cancelled)
        setOutbox(queue.filter((operation) => operation.operationType === "message.send"));
    };
    void load().catch(() => undefined);
    const refresh = () => void load().catch(() => undefined);
    window.addEventListener("shawtie:chat-queue-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("shawtie:chat-queue-changed", refresh);
    };
  }, [conversation?.partnershipId, runtime]);

  // Keep the newest message in view, but never yank a reader who scrolled back.
  useEffect(() => {
    const onScroll = () => {
      stickToEndRef.current =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const endKey =
    (messages.at(-1)?.messageId ?? "") + ":" + outbox.length + ":" + (conversation ? "c" : "");
  useEffect(() => {
    if (endKey === lastEndKeyRef.current) return;
    lastEndKeyRef.current = endKey;
    const root = document.querySelector(".talk");
    if (!root || (root as HTMLElement).offsetParent === null) return;
    const lastOwn = messages.at(-1)?.senderAccountId === conversation?.self.accountId;
    if (stickToEndRef.current || lastOwn) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [endKey, messages, conversation?.self.accountId]);

  // Talk stays mounted while hidden, so returning to it scrolls to the newest message.
  useEffect(() => {
    const onHash = () => {
      if (!window.location.hash.includes("talk")) return;
      window.requestAnimationFrame(() => {
        const root = document.querySelector(".talk");
        if (root && (root as HTMLElement).offsetParent !== null) {
          window.scrollTo({ top: document.documentElement.scrollHeight });
        }
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function loadOlder() {
    if (!conversation || !messages[0]) return;
    await run(async () => {
      const page = await apiRequest<MessagePage>(
        "/api/v1/conversations/" +
          conversation.conversationId +
          "/messages?limit=" +
          M1_HISTORY_DEFAULT_LIMIT +
          "&beforeSequence=" +
          messages[0]!.serverSequence,
      );
      const visible = await decryptMessagesForView(
        cryptoRuntime,
        conversation.partnershipId,
        page.items,
      );
      setMessages((current) => mergeMessages(current, [...visible]));
      setHasOlder(page.hasMore);
    });
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!conversation || (!composer.trim() && mediaDrafts.length === 0)) return;

    const body = composer.trim() ? composer : null;
    const replyToMessageId = replyingTo?.messageId ?? null;
    const draftIds = mediaDrafts.map((draft) => draft.draftId);
    const existing = pendingSendRef.current;
    const pending: PendingSend =
      existing &&
      existing.body === body &&
      existing.replyToMessageId === replyToMessageId &&
      existing.draftIds.join(",") === draftIds.join(",")
        ? existing
        : {
            key: idempotencyKey(),
            messageId: crypto.randomUUID(),
            body,
            replyToMessageId,
            draftIds,
            requestBody: null,
          };
    pendingSendRef.current = pending;
    setSendStatus("sending");
    setNotice("");

    await run(async () => {
      if (!pending.requestBody && !navigator.onLine && mediaDrafts.length > 0) {
        setSendStatus(null);
        setNotice("Attachments are saved on this device. Connect before sending this message.");
        return;
      }

      let requestBody = pending.requestBody;
      if (!requestBody) {
        let attachments: Array<{ mediaId: string; role: "attachment"; position: number }> = [];
        if (mediaDrafts.length > 0) {
          setMediaBusy(true);
          try {
            attachments = await uploadDrafts();
          } catch (caught) {
            await refreshMediaDrafts(conversation.partnershipId).catch(() => undefined);
            setSendStatus("failed");
            if (!(caught instanceof ApiClientError)) {
              setNotice(
                "Upload did not finish. Your attachment is saved on this device. Retry when connected.",
              );
              return;
            }
            throw caught;
          } finally {
            setMediaBusy(false);
          }
        }

        const protectedBody =
          conversation.cryptoRequired && body
            ? await (() => {
                if (!cryptoRuntime) throw new Error("CRYPTO_UNAVAILABLE");
                return cryptoRuntime.protectBytes(
                  {
                    partnershipId: conversation.partnershipId,
                    contentType: "message",
                    contentId: pending.messageId,
                    contentVersion: 1,
                    payloadRole: "message_body",
                    schemaVersion: 1,
                  },
                  textEncoder.encode(body),
                );
              })()
            : null;

        requestBody = {
          messageId: pending.messageId,
          body: conversation.cryptoRequired ? null : body,
          protectedBody,
          replyToMessageId,
          attachments,
        };
        pendingSendRef.current = { ...pending, requestBody };
      }

      const contentContextKey = conversation.cryptoRequired
        ? S1_CONTENT_CONTEXT
        : M2_PRE_S1_CONTENT_CONTEXT;

      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "message.send",
          contentContextKey,
          requestBody,
          idempotencyKey: pending.key,
        });
        pendingSendRef.current = null;
        setSendStatus("queued");
        setComposer("");
        setReplyingTo(null);
        setNotice("Message queued. It will send after connection and authority are restored.");
        return;
      }

      try {
        const created = await apiRequest<{
          messageId: string;
          serverSequence: number;
          contentVersion: number;
          changeSequence: number;
          createdAt: string;
        }>("/api/v1/conversations/" + conversation.conversationId + "/messages", {
          method: "POST",
          headers: { "idempotency-key": pending.key },
          body: requestBody,
        });

        await refreshMessage(conversation.conversationId, created.messageId);
        changeCursorRef.current = Math.max(changeCursorRef.current, created.changeSequence);
        for (const draftId of draftIds) {
          await discardMediaDraft(runtime.accountId, draftId, false);
        }
        await refreshMediaDrafts(conversation.partnershipId);
        pendingSendRef.current = null;
        setSendStatus(null);
        setComposer("");
        setReplyingTo(null);
        if (!runtime.sendTyping(false)) {
          await apiRequest("/api/v1/conversations/" + conversation.conversationId + "/typing", {
            method: "POST",
            body: { typing: false },
          }).catch(() => undefined);
        }
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "message.send",
            contentContextKey,
            requestBody,
            idempotencyKey: pending.key,
          });
          for (const draftId of draftIds) {
            await discardMediaDraft(runtime.accountId, draftId, false);
          }
          await refreshMediaDrafts(conversation.partnershipId);
          pendingSendRef.current = null;
          setSendStatus("queued");
          setComposer("");
          setReplyingTo(null);
          setNotice("Message queued after the final send request lost connection.");
          return;
        }
        if (caught.status < 500 && caught.status !== 429) {
          pendingSendRef.current = null;
        }
        setSendStatus("failed");
        throw caught;
      }
    });
  }
  function composerChanged(value: string) {
    setComposer(value);
    if (pendingSendRef.current && pendingSendRef.current.body !== (value.trim() ? value : null)) {
      pendingSendRef.current = null;
      setSendStatus(null);
    }
    if (!conversation?.capabilities.typing || !value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < M1_TYPING_MIN_REFRESH_MS) return;
    lastTypingSentRef.current = now;
    if (runtime.sendTyping(true)) return;
    void apiRequest("/api/v1/conversations/" + conversation.conversationId + "/typing", {
      method: "POST",
      body: { typing: true },
    }).catch(() => undefined);
  }

  async function editMessage(message: Message, body: string) {
    if (!conversation || !message.body) return;
    if (!body.trim() || body === message.body) return;
    const key = idempotencyKey();

    await run(async () => {
      const protectedBody =
        conversation.cryptoRequired
          ? await (() => {
              if (!cryptoRuntime) throw new Error("CRYPTO_UNAVAILABLE");
              return cryptoRuntime.protectBytes(
                {
                  partnershipId: conversation.partnershipId,
                  contentType: "message",
                  contentId: message.messageId,
                  contentVersion: message.contentVersion + 1,
                  payloadRole: "message_body",
                  schemaVersion: 1,
                },
                textEncoder.encode(body),
              );
            })()
          : null;
      const requestBody = {
        body: conversation.cryptoRequired ? null : body,
        protectedBody,
        expectedContentVersion: message.contentVersion,
      };
      const contentContextKey = conversation.cryptoRequired
        ? S1_CONTENT_CONTEXT
        : M2_PRE_S1_CONTENT_CONTEXT;

      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "message.edit",
          contentContextKey,
          messageId: message.messageId,
          requestBody,
          expectedContentVersion: message.contentVersion,
          idempotencyKey: key,
        });
        setNotice("Edit queued. Server version and edit-window rules will be rechecked.");
        return;
      }
      try {
        await apiRequest(
          "/api/v1/conversations/" + conversation.conversationId + "/messages/" + message.messageId,
          {
            method: "PATCH",
            headers: { "idempotency-key": key },
            body: requestBody,
          },
        );
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "message.edit",
            contentContextKey,
            messageId: message.messageId,
            requestBody,
            expectedContentVersion: message.contentVersion,
            idempotencyKey: key,
          });
          setNotice("Edit queued after the network request failed.");
          return;
        }
        if (caught.code === "VERSION_CONFLICT" || caught.code === "MESSAGE_DELETED") {
          await refreshMessage(conversation.conversationId, message.messageId);
        }
        throw caught;
      }
      await refreshMessage(conversation.conversationId, message.messageId);
    });
  }

  async function deleteMessage(message: Message) {
    if (!conversation) return;
    const key = idempotencyKey();

    await run(async () => {
      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "message.delete",
          contentContextKey: conversation.cryptoRequired
            ? S1_CONTENT_CONTEXT
            : M2_PRE_S1_CONTENT_CONTEXT,
          messageId: message.messageId,
          requestBody: null,
          idempotencyKey: key,
        });
        setNotice("Delete queued. Lifecycle rules will be rechecked before replay.");
        return;
      }
      try {
        await apiRequest(
          "/api/v1/conversations/" + conversation.conversationId + "/messages/" + message.messageId,
          {
            method: "DELETE",
            headers: { "idempotency-key": key },
          },
        );
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "message.delete",
            contentContextKey: conversation.cryptoRequired
              ? S1_CONTENT_CONTEXT
              : M2_PRE_S1_CONTENT_CONTEXT,
            messageId: message.messageId,
            requestBody: null,
            idempotencyKey: key,
          });
          setNotice("Delete queued after the network request failed.");
          return;
        }
        if (caught.code === "MESSAGE_DELETED") {
          await refreshMessage(conversation.conversationId, message.messageId);
        }
        throw caught;
      }
      await refreshMessage(conversation.conversationId, message.messageId);
    });
  }

  async function react(message: Message, emoji: string) {
    if (!conversation) return;
    const key = idempotencyKey();
    const reactionId = crypto.randomUUID();
    await run(async () => {
      const protectedReaction =
        conversation.cryptoRequired
          ? await (() => {
              if (!cryptoRuntime) throw new Error("CRYPTO_UNAVAILABLE");
              return cryptoRuntime.protectBytes(
                {
                  partnershipId: conversation.partnershipId,
                  contentType: "message_reaction",
                  contentId: reactionId,
                  contentVersion: 1,
                  payloadRole: "reaction_value",
                  schemaVersion: 1,
                },
                textEncoder.encode(emoji),
              );
            })()
          : null;
      const requestBody = conversation.cryptoRequired
        ? { reactionId, emoji: null, protectedReaction }
        : { emoji };
      const contentContextKey = conversation.cryptoRequired
        ? S1_CONTENT_CONTEXT
        : M2_PRE_S1_CONTENT_CONTEXT;

      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "reaction.set",
          contentContextKey,
          messageId: message.messageId,
          requestBody,
          idempotencyKey: key,
        });
        setNotice("Reaction queued.");
        return;
      }
      try {
        await apiRequest(
          "/api/v1/conversations/" +
            conversation.conversationId +
            "/messages/" +
            message.messageId +
            "/reaction",
          {
            method: "PUT",
            headers: { "idempotency-key": key },
            body: requestBody,
          },
        );
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "reaction.set",
            contentContextKey,
            messageId: message.messageId,
            requestBody,
            idempotencyKey: key,
          });
          setNotice("Reaction queued after the network request failed.");
          return;
        }
        throw caught;
      }
      await refreshMessage(conversation.conversationId, message.messageId);
    });
  }
  async function removeReaction(message: Message) {
    if (!conversation) return;
    const key = idempotencyKey();
    await run(async () => {
      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "reaction.remove",
          contentContextKey: conversation.cryptoRequired
            ? S1_CONTENT_CONTEXT
            : M2_PRE_S1_CONTENT_CONTEXT,
          messageId: message.messageId,
          requestBody: null,
          idempotencyKey: key,
        });
        setNotice("Reaction removal queued.");
        return;
      }
      try {
        await apiRequest(
          "/api/v1/conversations/" +
            conversation.conversationId +
            "/messages/" +
            message.messageId +
            "/reaction",
          {
            method: "DELETE",
            headers: { "idempotency-key": key },
          },
        );
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "reaction.remove",
            contentContextKey: conversation.cryptoRequired
              ? S1_CONTENT_CONTEXT
              : M2_PRE_S1_CONTENT_CONTEXT,
            messageId: message.messageId,
            requestBody: null,
            idempotencyKey: key,
          });
          setNotice("Reaction removal queued after the network request failed.");
          return;
        }
        throw caught;
      }
      await refreshMessage(conversation.conversationId, message.messageId);
    });
  }

  async function keepMessage(message: Message) {
    if (!conversation || !message.body || message.deletedAt) return;
    if (conversation.cryptoRequired) {
      setError("Protected Remember This is still being prepared.");
      return;
    }
    const authorName =
      message.senderAccountId === conversation.self.accountId
        ? conversation.self.nickname || conversation.self.displayName
        : conversation.partner.nickname || conversation.partner.displayName;
    await run(async () => {
      const result = await createRelationshipItem(
        buildRememberThisPayload({
          messageId: message.messageId,
          body: message.body ?? "",
          authorName,
          createdAt: message.createdAt,
        }),
      );
      setKeptIds((current) => new Set(current).add(message.messageId));
      setNotice(
        result.queued ? "Kept. It will be added when you are back online." : "Kept for us.",
      );
    });
  }

  async function saveNickname(
    subject: "self" | "partner",
    nickname: string,
    expectedVersion: number,
  ) {
    if (!conversation) return;
    const target = subject === "self" ? conversation.self : conversation.partner;
    await run(async () => {
      const value = nickname.trim() || null;
      const protectedNickname =
        conversation.cryptoRequired && value
          ? await (() => {
              if (!cryptoRuntime) throw new Error("CRYPTO_UNAVAILABLE");
              return cryptoRuntime.protectBytes(
                {
                  partnershipId: conversation.partnershipId,
                  contentType: "partnership_nickname",
                  contentId: target.accountId,
                  contentVersion: expectedVersion + 1,
                  payloadRole: "nickname_value",
                  schemaVersion: 1,
                },
                textEncoder.encode(value),
              );
            })()
          : null;
      try {
        await apiRequest(
          "/api/v1/partnerships/" + conversation.partnershipId + "/nicknames/" + target.accountId,
          {
            method: "PATCH",
            headers: { "idempotency-key": idempotencyKey() },
            body: {
              nickname: conversation.cryptoRequired ? null : value,
              protectedNickname,
              expectedVersion,
            },
          },
        );
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.code === "VERSION_CONFLICT") {
          await refreshConversation();
        }
        throw caught;
      }
      if (subject === "self") {
        selfNicknameDirtyRef.current = false;
      } else {
        partnerNicknameDirtyRef.current = false;
      }
      await refreshConversation();
    });
  }

  if (conversation === undefined) {
    return (
      <section className="talk" aria-label="Conversation">
        <SkeletonGroup label="Loading conversation">
          <div className="talk-skeleton">
            <Skeleton shape="block" width="60%" />
            <Skeleton shape="block" width="45%" />
            <Skeleton shape="block" width="70%" />
          </div>
        </SkeletonGroup>
      </section>
    );
  }

  if (!conversation) {
    return (
      <section className="talk" aria-label="Conversation">
        <EmptyState title="Your conversation is waiting">
          It appears after a partnership is formed.
        </EmptyState>
      </section>
    );
  }

  const partnerName = conversation.partner.nickname || conversation.partner.displayName;
  const selfName = conversation.self.nickname || conversation.self.displayName;
  const cryptoWritable =
    !conversation.cryptoRequired ||
    Boolean(
      cryptoRuntime &&
      cryptoStatus.available &&
      cryptoStatus.trustState === "trusted",
    );
  const canSend = conversation.capabilities.sendMessage && cryptoWritable;
  const hasContent = composer.trim().length > 0 || mediaDrafts.length > 0;
  const rows = buildRows(messages, conversation.self.accountId);
  const actionMessage = actionsFor
    ? (messages.find((message) => message.messageId === actionsFor) ?? null)
    : null;
  const actionOwn = actionMessage?.senderAccountId === conversation.self.accountId;
  const actionMutable = actionMessage ? messageMutable(actionMessage, conversation) : false;
  const actionMyReaction =
    actionMessage?.reactions.find((reaction) => reaction.accountId === conversation.self.accountId)
      ?.emoji ?? null;
  const replyAuthorName = (accountId: string) =>
    accountId === conversation.self.accountId ? "You" : partnerName;

  function jumpTo(messageId: string) {
    const element = document.getElementById("talk-msg-" + messageId);
    if (!element) {
      setNotice(
        hasOlder
          ? "That message is further back. Load older messages to see it."
          : "That message is not available.",
      );
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    setHighlightedId(messageId);
    window.setTimeout(
      () => setHighlightedId((current) => (current === messageId ? null : current)),
      1800,
    );
  }

  function startVoice() {
    setAddOpen(false);
    setVoiceOpen(true);
  }

  return (
    <section className="talk" aria-label="Conversation">
      <header className="talk-header">
        <Avatar name={partnerName} size={40} />
        <div className="talk-header__who">
          <h2 className="talk-header__name">{partnerName}</h2>
          <PresenceLine
            presence={conversation.partner.presence}
            typing={conversation.partner.typing}
          />
        </div>
        {conversation.interactionMode !== "normal" ? (
          <Badge tone="candle">
            {conversation.interactionMode === "breakup_restricted"
              ? "Breakup reconsideration"
              : "View only"}
          </Badge>
        ) : null}
        <IconButton label="Chat nicknames" icon="more" onClick={() => setNicknamesOpen(true)} />
      </header>

      {!online ? (
        <OfflineNotice>
          You are offline. Messages you write will send when you are back. Attachments wait on this
          device until you are connected.
        </OfflineNotice>
      ) : null}
      {error ? (
        <ErrorNotice
          action={
            <Button variant="quiet" compact onClick={() => setError("")}>
              Dismiss
            </Button>
          }
        >
          {error}
        </ErrorNotice>
      ) : null}
      {notice ? (
        <Notice
          tone={notice === "Kept for us." ? "success" : "info"}
          action={
            <Button variant="quiet" compact onClick={() => setNotice("")}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Notice>
      ) : null}

      {cameFromKept && active ? (
        <div className="talk-return">
          <Button
            variant="quiet"
            compact
            onClick={() =>
              runSignatureTransition("memory-return", () => {
                const settled = afterNavigationSettles();
                window.location.hash = "#/ours";
                return settled;
              })
            }
          >
            Back to what we kept
          </Button>
        </div>
      ) : null}

      {hasOlder ? (
        <Button variant="quiet" onClick={() => void loadOlder()} disabled={busy}>
          Load older messages
        </Button>
      ) : null}

      <div className="talk-list" role="log" aria-live="polite" aria-label="Messages">
        {messages.length === 0 && outbox.length === 0 ? (
          <EmptyState title="Nothing here yet">
            {canSend ? "Say hello whenever you like." : "Messages will appear here."}
          </EmptyState>
        ) : null}
        {rows.map((row) => {
          if (row.type === "separator") {
            return (
              <p className="talk-separator" key={row.key}>
                <span>{row.label}</span>
              </p>
            );
          }
          const { message, own, position } = row;
          const endOfGroup = position === "last" || position === "single";
          return (
            <TalkBubble
              key={row.key}
              message={message}
              own={own}
              position={position}
              authorName={own ? selfName : partnerName}
              selfAccountId={conversation.self.accountId}
              replyAuthorName={replyAuthorName}
              delivery={
                own && endOfGroup && !message.deletedAt
                  ? deliveryLabel(conversation.receipts, message.serverSequence)
                  : null
              }
              showTime={endOfGroup}
              kept={keptIds.has(message.messageId)}
              highlighted={highlightedId === message.messageId}
              canOpenActions={conversation.interactionMode !== "account_deletion_view_only"}
              onOpenActions={setActionsFor}
              onJumpTo={jumpTo}
            />
          );
        })}
        {outbox.map((operation) => {
          const queuedRequest = operation.requestBody as {
            body?: unknown;
            protectedBody?: unknown;
            attachments?: unknown[];
          } | null;
          const queuedBody = queuedRequest?.body;
          const body =
            typeof queuedBody === "string"
              ? queuedBody
              : queuedRequest?.protectedBody
                ? "Encrypted message"
                : Array.isArray(queuedRequest?.attachments) &&
                    queuedRequest.attachments.length > 0
                  ? "Attachment"
                  : "Waiting message";
          const blocked = operation.status === "blocked";
          return (
            <article
              className="talk-message"
              data-own="true"
              data-position="single"
              data-pending="true"
              key={"outbox-" + operation.operationId}
            >
              <div className="talk-bubble">
                <p className="talk-text">{body}</p>
              </div>
              <p className="talk-meta">
                <span data-delivery={blocked ? "failed" : "waiting"}>
                  {blocked ? "Not sent" : "Waiting to send"}
                </span>
                {blocked ? (
                  <Button
                    variant="quiet"
                    compact
                    onClick={() => void runtime.retryQueuedOperation("chat", operation.operationId)}
                  >
                    Retry
                  </Button>
                ) : null}
              </p>
            </article>
          );
        })}
      </div>

      <div className="talk-composer-wrap">
        {replyingTo ? (
          <div className="talk-replying">
            <span className="talk-replying__text">
              <strong>Replying to {replyAuthorName(replyingTo.senderAccountId)}</strong>
              <span>{replyingTo.body ?? "Attachment"}</span>
            </span>
            <IconButton label="Cancel reply" icon="close" onClick={() => setReplyingTo(null)} />
          </div>
        ) : null}

        {sendStatus ? (
          <div className="talk-sendstatus" role="status">
            {sendStatus === "sending" ? (
              "Sending..."
            ) : sendStatus === "queued" ? (
              "Waiting to send. It will go out when you are back online."
            ) : (
              <>
                <span>Could not send. Trying again reuses the same request.</span>
                <Button variant="secondary" compact onClick={() => void send()} disabled={busy}>
                  Retry
                </Button>
              </>
            )}
          </div>
        ) : null}

        {mediaDrafts.length > 0 ? (
          <div className="talk-drafts">
            {mediaDrafts.map((draft) => (
              <div className="talk-draft" key={draft.draftId}>
                <span>
                  {draft.kind === "voice" ? "Voice message" : draft.kind.replace("_", " ")} ·{" "}
                  {Math.ceil(draft.ciphertextBytes / 1024)} KB ·{" "}
                  {draft.state === "prepared"
                    ? "Saved on this device"
                    : draft.state === "uploading"
                      ? "Uploading"
                      : draft.state === "ready"
                        ? "Ready to send"
                        : "Upload failed"}
                </span>
                <span className="talk-draft__actions">
                  {draft.state === "failed" ? (
                    <Button
                      variant="secondary"
                      compact
                      disabled={mediaBusy || busy || !online}
                      onClick={() => void retryDraft(draft.draftId)}
                    >
                      Retry upload
                    </Button>
                  ) : null}
                  <Button
                    variant="quiet"
                    compact
                    disabled={mediaBusy || busy}
                    onClick={() => void removeDraft(draft.draftId)}
                  >
                    Remove
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {voiceOpen ? (
          <div className="talk-voicebar">
            <VoiceRecorder
              autoStart
              disabled={!canSend || busy || mediaBusy}
              onReady={sendVoice}
              onIdle={closeVoice}
              onError={setError}
            />
          </div>
        ) : null}

        <form className="talk-composer" onSubmit={send}>
          <IconButton
            label="Add photo, file, or voice message"
            icon="plus"
            variant="secondary"
            disabled={!canSend || busy || mediaBusy || voiceOpen}
            onClick={() => setAddOpen(true)}
          />
          <textarea
            ref={composerRef}
            className="talk-composer__input"
            aria-label="Message"
            value={composer}
            onChange={(event) => composerChanged(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && hasContent) {
                void send();
              }
            }}
            onBlur={() => {
              if (!conversation.capabilities.typing) return;
              if (runtime.sendTyping(false)) return;
              void apiRequest("/api/v1/conversations/" + conversation.conversationId + "/typing", {
                method: "POST",
                body: { typing: false },
              }).catch(() => undefined);
            }}
            placeholder={canSend ? "Message..." : "Messaging is currently view-only."}
            disabled={!canSend || busy}
            rows={1}
            maxLength={M1_MESSAGE_MAX_CHARACTERS}
          />
          {hasContent ? (
            <button
              type="submit"
              className="ds-icon-button talk-send"
              aria-label="Send"
              disabled={!canSend || busy || mediaBusy}
            >
              <Icon name="send" size={22} />
            </button>
          ) : (
            <IconButton
              label="Record a voice message"
              icon="mic"
              disabled={!canSend || busy || mediaBusy || voiceOpen}
              onClick={startVoice}
            />
          )}
        </form>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        disabled={!canSend || busy || mediaBusy}
        accept="image/*,video/mp4,video/webm,application/pdf,text/plain,application/zip,.zip"
        onChange={(event) => void prepareFiles(event)}
      />

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add to message">
        <div className="talk-actionlist">
          <button
            type="button"
            className="talk-action"
            disabled={!canSend || busy || mediaBusy}
            onClick={() => {
              setAddOpen(false);
              fileInputRef.current?.click();
            }}
          >
            <Icon name="image" size={22} />
            <span>
              <span className="talk-action__label">Photo, video, or file</span>
              <span className="talk-action__hint">Saved on this device until it is sent.</span>
            </span>
          </button>
          <button
            type="button"
            className="talk-action"
            disabled={!canSend || busy || mediaBusy}
            onClick={startVoice}
          >
            <Icon name="mic" size={22} />
            <span>
              <span className="talk-action__label">Voice message</span>
              <span className="talk-action__hint">You can listen before it sends.</span>
            </span>
          </button>
        </div>
      </Sheet>

      <TalkActions
        open={actionMessage !== null}
        onClose={() => setActionsFor(null)}
        canReact={actionMutable}
        myReaction={actionMyReaction}
        canReply={Boolean(actionMessage && !actionMessage.deletedAt && canSend)}
        canEdit={Boolean(
          actionMessage &&
          actionOwn &&
          messageEditable(actionMessage, conversation) &&
          actionMessage.body,
        )}
        canDelete={Boolean(actionMessage && actionOwn && actionMutable)}
        canKeep={Boolean(
          actionMessage &&
          actionMessage.body &&
          !actionMessage.deletedAt &&
          conversation.interactionMode === "normal",
        )}
        kept={actionMessage ? keptIds.has(actionMessage.messageId) : false}
        busy={busy}
        onReact={(emoji) => {
          const target = actionMessage;
          setActionsFor(null);
          if (target) void react(target, emoji);
        }}
        onRemoveReaction={() => {
          const target = actionMessage;
          setActionsFor(null);
          if (target) void removeReaction(target);
        }}
        onReply={() => {
          const target = actionMessage;
          setActionsFor(null);
          if (target) {
            setReplyingTo(target);
            composerRef.current?.focus();
          }
        }}
        onEdit={() => {
          const target = actionMessage;
          setActionsFor(null);
          if (target?.body) setEditing({ message: target, text: target.body });
        }}
        onDelete={() => {
          const target = actionMessage;
          setActionsFor(null);
          if (target) setConfirmDelete(target);
        }}
        onKeep={() => {
          const target = actionMessage;
          setActionsFor(null);
          if (target) void keepMessage(target);
        }}
      />

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit message"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!editing || !editing.text.trim() || editing.text === editing.message.body}
              onClick={() => {
                if (!editing) return;
                const { message, text } = editing;
                setEditing(null);
                void editMessage(message, text);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <textarea
          className="talk-edit-input"
          data-autofocus
          aria-label="Edited message"
          value={editing?.text ?? ""}
          onChange={(event) =>
            setEditing((current) => (current ? { ...current, text: event.target.value } : current))
          }
          maxLength={M1_MESSAGE_MAX_CHARACTERS}
          rows={4}
        />
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void deleteMessage(target);
        }}
        title="Delete this message for both of you?"
        confirmLabel="Delete message"
        destructive
      >
        It will show as deleted for both of you, and its content will no longer be visible.
      </ConfirmDialog>

      <Sheet open={nicknamesOpen} onClose={() => setNicknamesOpen(false)} title="Chat nicknames">
        <div className="talk-nicknames">
          <label className="field">
            <span>Your nickname</span>
            <input
              value={selfNickname}
              onChange={(event) => {
                selfNicknameDirtyRef.current = true;
                setSelfNickname(event.target.value);
              }}
              maxLength={M1_NICKNAME_MAX_CHARACTERS}
              disabled={!conversation.capabilities.changeNickname || !cryptoWritable || busy}
            />
            <Button
              compact
              disabled={!conversation.capabilities.changeNickname || !cryptoWritable || busy}
              onClick={() =>
                void saveNickname("self", selfNickname, conversation.self.nicknameVersion)
              }
            >
              Save
            </Button>
          </label>
          <label className="field">
            <span>{conversation.partner.displayName}&apos;s nickname</span>
            <input
              value={partnerNickname}
              onChange={(event) => {
                partnerNicknameDirtyRef.current = true;
                setPartnerNickname(event.target.value);
              }}
              maxLength={M1_NICKNAME_MAX_CHARACTERS}
              disabled={!conversation.capabilities.changeNickname || !cryptoWritable || busy}
            />
            <Button
              compact
              disabled={!conversation.capabilities.changeNickname || !cryptoWritable || busy}
              onClick={() =>
                void saveNickname("partner", partnerNickname, conversation.partner.nicknameVersion)
              }
            >
              Save
            </Button>
          </label>
        </div>
      </Sheet>
    </section>
  );
}
