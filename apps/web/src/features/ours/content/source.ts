import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api-client.ts";

/*
 * Memory Return (PRESENTATION_ONLY). A Remember This item may hold a loose message reference.
 * R1 rule: the reference is provenance only and the item survives without its source. We show
 * "Take me there" only when the existing message read endpoint resolves the message and it is
 * not deleted. Otherwise the source is rendered unavailable. No new API is involved.
 */

export type SourceState = "unknown" | "checking" | "available" | "unavailable" | "offline";

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; available: boolean }>();
let conversationIdCache: { at: number; id: string | null } | null = null;

async function currentConversationId(): Promise<string | null> {
  if (conversationIdCache && Date.now() - conversationIdCache.at < CACHE_MS) {
    return conversationIdCache.id;
  }
  const result = await apiRequest<{ conversation: { conversationId: string } | null }>(
    "/api/v1/conversations/current",
  );
  conversationIdCache = { at: Date.now(), id: result.conversation?.conversationId ?? null };
  return conversationIdCache.id;
}

export async function resolveMessageSource(messageId: string): Promise<boolean> {
  const hit = cache.get(messageId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.available;
  let available = false;
  try {
    const conversationId = await currentConversationId();
    if (conversationId) {
      const message = await apiRequest<{ deletedAt: string | null }>(
        "/api/v1/conversations/" + conversationId + "/messages/" + messageId,
      );
      available = message.deletedAt === null || message.deletedAt === undefined;
    }
  } catch {
    available = false;
  }
  cache.set(messageId, { at: Date.now(), available });
  return available;
}

export function useMessageSource(messageId: string | null): SourceState {
  const [state, setState] = useState<SourceState>(messageId ? "checking" : "unknown");
  useEffect(() => {
    if (!messageId) {
      setState("unknown");
      return;
    }
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    let active = true;
    setState("checking");
    void resolveMessageSource(messageId).then((available) => {
      if (active) setState(available ? "available" : "unavailable");
    });
    return () => {
      active = false;
    };
  }, [messageId]);
  return state;
}

/**
 * Navigates to Talk and announces which message the person came for. The route parser only
 * reads the first hash segment, so the extra segment is harmless to existing routing, and the
 * event lets the conversation surface scroll to and highlight the message when it supports it.
 */
export function openSourceMessage(messageId: string): void {
  window.location.hash = "#/talk/message/" + messageId;
  window.dispatchEvent(new CustomEvent("shawtie:open-message", { detail: { messageId } }));
}
