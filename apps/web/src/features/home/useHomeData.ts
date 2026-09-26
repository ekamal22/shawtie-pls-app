import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api-client.ts";
import { loadRelationshipHome, loadThisDay } from "../relationship-space/api.ts";
import {
  type HomeMoment,
  type LatestMessageInput,
  type LatestPreview,
  latestPreview,
  localDateKey,
  pickMoment,
} from "./home-model.ts";

/**
 * Read-only Home data. Uses only existing endpoints: the current conversation summary and its
 * newest message (GET, so nothing is marked delivered or read from Home), the R1 home
 * aggregate, and the this-day experience. No writes, no receipts, no new API.
 *
 * `undefined` means still loading, `null` means nothing to show.
 */
export interface HomeData {
  readonly latest: LatestPreview | null | undefined;
  readonly moment: HomeMoment | null | undefined;
}

const REFRESH_EVENTS = [
  "shawtie:partnership-changed",
  "shawtie:chat-queue-changed",
  // Realtime reports: a new, edited, or removed message and a changed relationship item.
  "shawtie:message-changed",
  "shawtie:relationship-changed",
  "online",
  "focus",
] as const;

const cache = new Map<string, HomeData>();

async function fetchLatest(accountId: string): Promise<LatestPreview | null> {
  const summary = await apiRequest<{ conversation: { conversationId: string } | null }>(
    "/api/v1/conversations/current",
  );
  if (!summary.conversation) return null;
  const page = await apiRequest<{ items: LatestMessageInput[] }>(
    "/api/v1/conversations/" + summary.conversation.conversationId + "/messages?limit=1",
  );
  return latestPreview(page.items.at(-1) ?? null, accountId);
}

async function fetchMoment(): Promise<HomeMoment | null> {
  const { space } = await loadRelationshipHome();
  const first = pickMoment(space, []);
  if (first && (first.type === "reunion" || first.type === "anniversary")) return first;
  let thisDay: Awaited<ReturnType<typeof loadThisDay>>["items"] = [];
  try {
    thisDay = (await loadThisDay(localDateKey())).items;
  } catch {
    thisDay = [];
  }
  return pickMoment(space, thisDay);
}

export function useHomeData(accountId: string, partnershipId: string | null): HomeData {
  const key = accountId + ":" + (partnershipId ?? "none");
  const [data, setData] = useState<HomeData>(
    () => cache.get(key) ?? { latest: undefined, moment: undefined },
  );

  useEffect(() => {
    if (!partnershipId) return;
    let alive = true;
    const cached = cache.get(key);
    setData(cached ?? { latest: undefined, moment: undefined });

    const update = (patch: Partial<HomeData>) => {
      const next = { ...(cache.get(key) ?? { latest: undefined, moment: undefined }), ...patch };
      cache.set(key, next);
      if (alive) setData(next);
    };
    const settle = (patch: "latest" | "moment") => {
      // On failure (offline or transient) keep what was last known; otherwise fall back to
      // "nothing to show" so a skeleton never lingers.
      const current = cache.get(key);
      if (current?.[patch] === undefined) update({ [patch]: null });
    };
    const refresh = () => {
      void fetchLatest(accountId).then(
        (latest) => update({ latest }),
        () => settle("latest"),
      );
      void fetchMoment().then(
        (moment) => update({ moment }),
        () => settle("moment"),
      );
    };
    refresh();
    for (const name of REFRESH_EVENTS) window.addEventListener(name, refresh);
    return () => {
      alive = false;
      for (const name of REFRESH_EVENTS) window.removeEventListener(name, refresh);
    };
  }, [accountId, partnershipId, key]);

  return data;
}
