import {
  M1_CHANGE_DEFAULT_LIMIT,
  M1_HISTORY_DEFAULT_LIMIT,
  M1_MESSAGE_MAX_CHARACTERS,
  M1_NICKNAME_MAX_CHARACTERS,
  M1_PRESENCE_HEARTBEAT_MIN_MS,
  M1_TYPING_MIN_REFRESH_MS,
  M1_VISIBLE_CHANGE_POLL_MS,
} from "@shawtie/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";
import {
  useM2Runtime,
  useM2SyncStatus,
} from "../../lib/realtime/runtime-context.tsx";

interface ConversationSummary {
  conversationId: string;
  partnershipId: string;
  lifecycleState: "active" | "breakup_pending";
  interactionMode: "normal" | "breakup_restricted" | "account_deletion_view_only";
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
    nicknameVersion: number;
  };
  partner: {
    accountId: string;
    username: string;
    displayName: string;
    nickname: string | null;
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

interface ReplyContext {
  messageId: string;
  senderAccountId: string;
  body: string | null;
  deleted: boolean;
}

interface Message {
  messageId: string;
  conversationId: string;
  senderAccountId: string;
  senderDeviceId: string | null;
  serverSequence: number;
  contentVersion: number;
  lastChangeSequence: number;
  replyToMessageId: string | null;
  replyContext: ReplyContext | null;
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: Array<{
    accountId: string;
    emoji: string;
  }>;
}

interface MessagePage {
  items: Message[];
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

const defaultReactions = ["❤️", "😂", "😭", "😮", "😡", "👍"];
const M1_MESSAGE_EDIT_WINDOW_MS = 30 * 60_000;

function idempotencyKey(): string {
  return "m1-" + crypto.randomUUID();
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    const known: Record<string, string> = {
      ACCOUNT_LOCKED: "Chat is view-only while account deletion recovery is active.",
      CONVERSATION_NOT_FOUND: "This conversation is no longer available.",
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
  readonly body: string;
  readonly replyToMessageId: string | null;
}

export function MessagingPanel() {
  const runtime = useM2Runtime();
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
  const [sendStatus, setSendStatus] = useState<
    "sending" | "queued" | "failed" | null
  >(null);
  const changeCursorRef = useRef(0);
  const lastTypingSentRef = useRef(0);
  const pendingSendRef = useRef<PendingSend | null>(null);
  const selfNicknameDirtyRef = useRef(false);
  const partnerNicknameDirtyRef = useRef(false);

  const refreshConversation = useCallback(async () => {
    const result = await apiRequest<{ conversation: ConversationSummary | null }>(
      "/api/v1/conversations/current",
    );
    setConversation(result.conversation);
    if (result.conversation) {
      if (!selfNicknameDirtyRef.current) {
        setSelfNickname(result.conversation.self.nickname ?? "");
      }
      if (!partnerNicknameDirtyRef.current) {
        setPartnerNickname(result.conversation.partner.nickname ?? "");
      }
    }
    return result.conversation;
  }, []);

  const refreshMessage = useCallback(
    async (conversationId: string, messageId: string): Promise<Message> => {
      const message = await apiRequest<Message>(
        "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      );
      setMessages((current) => mergeMessages(current, [message]));
      return message;
    },
    [],
  );

  const acknowledge = useCallback(async (summary: ConversationSummary, throughSequence: number) => {
    if (throughSequence <= 0) return;
    await apiRequest("/api/v1/conversations/" + summary.conversationId + "/receipt", {
      method: "POST",
      body: { type: "delivered", throughSequence },
    });
    if (document.visibilityState === "visible") {
      await apiRequest("/api/v1/conversations/" + summary.conversationId + "/receipt", {
        method: "POST",
        body: { type: "read", throughSequence },
      });
    }
  }, []);

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
    setMessages(page.items);
    setHasOlder(page.hasMore);
    changeCursorRef.current = summary.latestChangeSequence;
    await acknowledge(summary, newest);
  }, [acknowledge, refreshConversation, runtime]);

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

      const canonical: Message[] = [];
      for (const change of result.items) {
        canonical.push(
          await apiRequest<Message>(
            "/api/v1/conversations/" +
              summary.conversationId +
              "/messages/" +
              change.messageId,
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
              previous?.pendingDeliveredThrough ??
              summary.receipts.selfDeliveredThrough,
            pendingReadThrough:
              previous?.pendingReadThrough ??
              summary.receipts.selfReadThrough,
            lastSyncedAt: new Date().toISOString(),
          },
        });
        setMessages((current) => mergeMessages(current, canonical));
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
              previous?.pendingDeliveredThrough ??
              refreshed.receipts.selfDeliveredThrough,
            pendingReadThrough:
              previous?.pendingReadThrough ??
              refreshed.receipts.selfReadThrough,
            lastSyncedAt: new Date().toISOString(),
          },
        });
        setMessages((current) => mergeMessages(current, page.items));
        if (!page.hasMore) break;
      }
      refreshed = await refreshConversation();
    }

    if (refreshed) {
      await acknowledge(refreshed, highestLoadedSequence);
    }
    return { latestChangeSequence: changeCursorRef.current };
  }, [acknowledge, conversation, messages, refreshConversation, runtime]);

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

  useEffect(() => {
    void loadInitial().catch((caught) => setError(errorText(caught)));
  }, [loadInitial]);

  useEffect(
    () =>
      runtime.registerSynchronizer("messaging", async () => {
        return syncChanges();
      }),
    [runtime, syncChanges],
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
      const queue = await (await runtime.database()).listChatQueue(
        conversation.partnershipId,
      );
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
      setMessages((current) => mergeMessages(current, page.items));
      setHasOlder(page.hasMore);
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !composer.trim()) return;

    const body = composer;
    const replyToMessageId = replyingTo?.messageId ?? null;
    const existing = pendingSendRef.current;
    const pending =
      existing &&
      existing.body === body &&
      existing.replyToMessageId === replyToMessageId
        ? existing
        : { key: idempotencyKey(), body, replyToMessageId };
    pendingSendRef.current = pending;
    setSendStatus("sending");
    setNotice("");

    await run(async () => {
      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "message.send",
          requestBody: { body, replyToMessageId },
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
          body: { body, replyToMessageId },
        });

        await refreshMessage(conversation.conversationId, created.messageId);
        changeCursorRef.current = Math.max(
          changeCursorRef.current,
          created.changeSequence,
        );
        pendingSendRef.current = null;
        setSendStatus(null);
        setComposer("");
        setReplyingTo(null);
        if (!runtime.sendTyping(false)) {
          await apiRequest(
            "/api/v1/conversations/" +
              conversation.conversationId +
              "/typing",
            {
              method: "POST",
              body: { typing: false },
            },
          ).catch(() => undefined);
        }
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "message.send",
            requestBody: { body, replyToMessageId },
            idempotencyKey: pending.key,
          });
          pendingSendRef.current = null;
          setSendStatus("queued");
          setComposer("");
          setReplyingTo(null);
          setNotice("Message queued after the network request failed.");
          return;
        }
        setSendStatus("failed");
        throw caught;
      }
    });
  }

  function composerChanged(value: string) {
    setComposer(value);
    if (pendingSendRef.current && pendingSendRef.current.body !== value) {
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

  async function editMessage(message: Message) {
    if (!conversation || !message.body) return;
    const body = window.prompt("Edit message", message.body);
    if (body === null || !body.trim() || body === message.body) return;
    const key = idempotencyKey();

    await run(async () => {
      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "message.edit",
          messageId: message.messageId,
          requestBody: {
            body,
            expectedContentVersion: message.contentVersion,
          },
          expectedContentVersion: message.contentVersion,
          idempotencyKey: key,
        });
        setNotice("Edit queued. Server version and edit-window rules will be rechecked.");
        return;
      }
      try {
        await apiRequest(
          "/api/v1/conversations/" +
            conversation.conversationId +
            "/messages/" +
            message.messageId,
          {
            method: "PATCH",
            headers: { "idempotency-key": key },
            body: {
              body,
              expectedContentVersion: message.contentVersion,
            },
          },
        );
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "message.edit",
            messageId: message.messageId,
            requestBody: {
              body,
              expectedContentVersion: message.contentVersion,
            },
            expectedContentVersion: message.contentVersion,
            idempotencyKey: key,
          });
          setNotice("Edit queued after the network request failed.");
          return;
        }
        if (
          caught.code === "VERSION_CONFLICT" ||
          caught.code === "MESSAGE_DELETED"
        ) {
          await refreshMessage(
            conversation.conversationId,
            message.messageId,
          );
        }
        throw caught;
      }
      await refreshMessage(conversation.conversationId, message.messageId);
    });
  }

  async function deleteMessage(message: Message) {
    if (!conversation || !window.confirm("Delete this message for both of you?")) return;
    const key = idempotencyKey();

    await run(async () => {
      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "message.delete",
          messageId: message.messageId,
          requestBody: null,
          idempotencyKey: key,
        });
        setNotice("Delete queued. Lifecycle rules will be rechecked before replay.");
        return;
      }
      try {
        await apiRequest(
          "/api/v1/conversations/" +
            conversation.conversationId +
            "/messages/" +
            message.messageId,
          {
            method: "DELETE",
            headers: { "idempotency-key": key },
          },
        );
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "message.delete",
            messageId: message.messageId,
            requestBody: null,
            idempotencyKey: key,
          });
          setNotice("Delete queued after the network request failed.");
          return;
        }
        if (caught.code === "MESSAGE_DELETED") {
          await refreshMessage(
            conversation.conversationId,
            message.messageId,
          );
        }
        throw caught;
      }
      await refreshMessage(conversation.conversationId, message.messageId);
    });
  }

  async function react(message: Message, emoji: string) {
    if (!conversation) return;
    const key = idempotencyKey();
    await run(async () => {
      if (!navigator.onLine) {
        await runtime.queueChat({
          operationType: "reaction.set",
          messageId: message.messageId,
          requestBody: { emoji },
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
            body: { emoji },
          },
        );
      } catch (caught) {
        if (!(caught instanceof ApiClientError)) {
          await runtime.queueChat({
            operationType: "reaction.set",
            messageId: message.messageId,
            requestBody: { emoji },
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

  async function saveNickname(
    subject: "self" | "partner",
    nickname: string,
    expectedVersion: number,
  ) {
    if (!conversation) return;
    const target = subject === "self" ? conversation.self : conversation.partner;
    await run(async () => {
      try {
        await apiRequest(
          "/api/v1/partnerships/" + conversation.partnershipId + "/nicknames/" + target.accountId,
          {
            method: "PATCH",
            headers: { "idempotency-key": idempotencyKey() },
            body: {
              nickname: nickname.trim() || null,
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
      <section className="panel">
        <h2>Messages</h2>
        <p className="muted">Loading conversation...</p>
      </section>
    );
  }

  if (!conversation) {
    return (
      <section className="panel">
        <h2>Messages</h2>
        <p className="muted">Your private conversation appears after a partnership is formed.</p>
      </section>
    );
  }

  const partnerName = conversation.partner.nickname || conversation.partner.displayName;
  const selfName = conversation.self.nickname || conversation.self.displayName;

  return (
    <section className="panel messaging-panel">
      <div className="messaging-header">
        <div>
          <h2>{partnerName}</h2>
          <p className="muted">
            {conversation.partner.presence.online
              ? "Online"
              : conversation.partner.presence.lastSeenAt
                ? "Last seen " + new Date(conversation.partner.presence.lastSeenAt).toLocaleString()
                : "Offline"}
            {conversation.partner.typing ? " · typing..." : ""}
          </p>
        </div>
        {conversation.interactionMode !== "normal" ? (
          <span className="pill">
            {conversation.interactionMode === "breakup_restricted"
              ? "Breakup reconsideration"
              : "View only"}
          </span>
        ) : null}
      </div>

      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner success">{notice}</p> : null}

      <details className="nickname-settings">
        <summary>Chat nicknames</summary>
        <div className="two-column">
          <label className="field">
            <span>Your nickname</span>
            <input
              value={selfNickname}
              onChange={(event) => {
                selfNicknameDirtyRef.current = true;
                setSelfNickname(event.target.value);
              }}
              maxLength={M1_NICKNAME_MAX_CHARACTERS}
              disabled={!conversation.capabilities.changeNickname || busy}
            />
            <button
              className="secondary compact"
              type="button"
              disabled={!conversation.capabilities.changeNickname || busy}
              onClick={() =>
                void saveNickname("self", selfNickname, conversation.self.nicknameVersion)
              }
            >
              Save
            </button>
          </label>
          <label className="field">
            <span>{conversation.partner.displayName}'s nickname</span>
            <input
              value={partnerNickname}
              onChange={(event) => {
                partnerNicknameDirtyRef.current = true;
                setPartnerNickname(event.target.value);
              }}
              maxLength={M1_NICKNAME_MAX_CHARACTERS}
              disabled={!conversation.capabilities.changeNickname || busy}
            />
            <button
              className="secondary compact"
              type="button"
              disabled={!conversation.capabilities.changeNickname || busy}
              onClick={() =>
                void saveNickname("partner", partnerNickname, conversation.partner.nicknameVersion)
              }
            >
              Save
            </button>
          </label>
        </div>
      </details>

      {hasOlder ? (
        <button className="link" type="button" onClick={() => void loadOlder()} disabled={busy}>
          Load older messages
        </button>
      ) : null}

      <div className="message-list" aria-live="polite">
        {messages.length === 0 ? <p className="muted">No messages yet.</p> : null}
        {messages.map((message) => {
          const own = message.senderAccountId === conversation.self.accountId;
          const mutable = messageMutable(message, conversation);
          const myReaction = message.reactions.find(
            (reaction) => reaction.accountId === conversation.self.accountId,
          );
          const delivery = own
            ? conversation.receipts.partnerReadThrough >= message.serverSequence
              ? "Read"
              : conversation.receipts.partnerDeliveredThrough >= message.serverSequence
                ? "Delivered"
                : "Sent"
            : null;

          return (
            <article
              className={"message-bubble " + (own ? "message-own" : "message-partner")}
              key={message.messageId}
            >
              <div className="message-meta">
                <strong>{own ? selfName : partnerName}</strong>
                <span>{new Date(message.createdAt).toLocaleString()}</span>
              </div>

              {message.replyContext ? (
                <div className="reply-context">
                  {message.replyContext.deleted
                    ? "Replying to a deleted message"
                    : (message.replyContext.body ?? "Replying to a protected message")}
                </div>
              ) : null}

              <p className={message.deletedAt ? "message-deleted" : ""}>
                {message.deletedAt ? "This message has been deleted" : message.body}
              </p>

              {message.editedAt && !message.deletedAt ? (
                <span className="message-edited">edited</span>
              ) : null}

              {!message.deletedAt && message.reactions.length > 0 ? (
                <div className="reaction-list">
                  {message.reactions.map((reaction) => (
                    <span key={reaction.accountId}>{reaction.emoji}</span>
                  ))}
                </div>
              ) : null}

              <div className="message-actions">
                {!message.deletedAt && conversation.capabilities.sendMessage ? (
                  <button
                    className="link compact"
                    type="button"
                    onClick={() => setReplyingTo(message)}
                  >
                    Reply
                  </button>
                ) : null}
                {own && messageEditable(message, conversation) && message.body ? (
                  <button
                    className="link compact"
                    type="button"
                    onClick={() => void editMessage(message)}
                    disabled={busy}
                  >
                    Edit
                  </button>
                ) : null}
                {own && mutable ? (
                  <button
                    className="link compact"
                    type="button"
                    onClick={() => void deleteMessage(message)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                ) : null}
              </div>

              {mutable ? (
                <div className="reaction-picker">
                  {defaultReactions.map((emoji) => (
                    <button
                      type="button"
                      className={myReaction?.emoji === emoji ? "active" : ""}
                      key={emoji}
                      onClick={() => void react(message, emoji)}
                      disabled={busy}
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const emoji = window.prompt("Emoji reaction");
                      if (emoji?.trim()) void react(message, emoji.trim());
                    }}
                    disabled={busy}
                  >
                    +
                  </button>
                  {myReaction ? (
                    <button
                      type="button"
                      className="link compact"
                      onClick={() => void removeReaction(message)}
                      disabled={busy}
                    >
                      remove
                    </button>
                  ) : null}
                </div>
              ) : null}

              {delivery ? <div className="message-delivery">{delivery}</div> : null}
            </article>
          );
        })}
      </div>

      {replyingTo ? (
        <div className="replying-banner">
          <span>
            Replying to{" "}
            {replyingTo.senderAccountId === conversation.self.accountId ? selfName : partnerName}
          </span>
          <button className="link compact" type="button" onClick={() => setReplyingTo(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {sendStatus ? (
        <div className="message-delivery" role="status">
          {sendStatus === "sending"
            ? "Sending..."
            : "Send failed. Retry will reuse the same request."}
        </div>
      ) : null}

      <form className="message-composer" onSubmit={send}>
        <textarea
          value={composer}
          onChange={(event) => composerChanged(event.target.value)}
          onBlur={() => {
            if (!conversation.capabilities.typing) return;
            if (runtime.sendTyping(false)) return;
            void apiRequest("/api/v1/conversations/" + conversation.conversationId + "/typing", {
              method: "POST",
              body: { typing: false },
            }).catch(() => undefined);
          }}
          placeholder={
            conversation.capabilities.sendMessage
              ? "Write a message..."
              : "Messaging is currently view-only."
          }
          disabled={!conversation.capabilities.sendMessage || busy}
          rows={3}
          maxLength={M1_MESSAGE_MAX_CHARACTERS}
        />
        <button
          className="primary"
          disabled={!conversation.capabilities.sendMessage || busy || !composer.trim()}
        >
          Send
        </button>
      </form>
    </section>
  );
}
