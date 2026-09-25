import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api-client.ts";

/**
 * The slice of the existing `/api/v1/conversations/current` contract the shell needs for
 * partner identity, presence, and lifecycle context. No new API, no new state: presence,
 * last seen, and typing are the authoritative always-on M1 fields.
 */
export interface ConversationContext {
  readonly partnershipId: string;
  readonly lifecycleState: "active" | "breakup_pending";
  readonly interactionMode: "normal" | "breakup_restricted" | "account_deletion_view_only";
  readonly partner: {
    readonly displayName: string;
    readonly nickname: string | null;
    readonly presence: { readonly online: boolean; readonly lastSeenAt: string | null };
    readonly typing: boolean;
  };
}

type State = ConversationContext | null | undefined;

const REFRESH_EVENTS = [
  "shawtie:presence-changed",
  "shawtie:typing-changed",
  "shawtie:partnership-changed",
  "online",
  "focus",
] as const;

/** `undefined` while loading, `null` when the account has no current partnership. */
export function useConversationContext(): State {
  const [state, setState] = useState<State>(undefined);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<{ conversation: ConversationContext | null }>(
        "/api/v1/conversations/current",
      );
      setState(result.conversation);
    } catch {
      // Keep the last known context while offline or on transient errors.
      setState((previous) => (previous === undefined ? null : previous));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    for (const name of REFRESH_EVENTS) window.addEventListener(name, handler);
    // Re-render periodically so relative last-seen wording ("recently") stays honest.
    const tick = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => {
      for (const name of REFRESH_EVENTS) window.removeEventListener(name, handler);
      window.clearInterval(tick);
    };
  }, [refresh]);

  return state;
}

export function partnerDisplayName(context: ConversationContext): string {
  return context.partner.nickname || context.partner.displayName;
}
