import { useCallback, useEffect, useRef, useState } from "react";
import { publishKeptSources } from "../../messaging/kept-registry.ts";
import { listRelationshipItems } from "../../relationship-space/api.ts";
import type { RelationshipItem, RelationshipItemKind } from "../../relationship-space/model.ts";
import { messageFor } from "./errors.ts";

export interface ItemsQuery {
  kind?: RelationshipItemKind;
  storyOnly?: boolean;
  year?: number;
  sort?: "created_desc" | "occurred_asc";
}

export type LoadStatus = "loading" | "ready" | "error";

export interface ItemsState {
  items: RelationshipItem[];
  status: LoadStatus;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/**
 * Loads one filtered list through the existing list endpoint and refreshes it on the same
 * signals the rest of Relationship Space uses (focus, visibility, relationship change and
 * partnership change events). When `provided` items are given the view is purely presentational
 * and nothing is fetched.
 */
export function useRelationshipItems(
  query: ItemsQuery,
  provided?: readonly RelationshipItem[],
): ItemsState {
  const [items, setItems] = useState<RelationshipItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>(provided ? "ready" : "loading");
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryKey = JSON.stringify(query);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    if (provided) return;
    const mine = ++generation.current;
    try {
      const page = await listRelationshipItems(query);
      if (mine !== generation.current) return;
      setItems(page.items);
      publishKeptSources(page.items, query.kind === "remember_this" && !query.storyOnly);
      setCursor(page.nextCursor);
      setStatus("ready");
      setError("");
    } catch (caught) {
      if (mine !== generation.current) return;
      setError(messageFor(caught));
      setStatus((current) => (current === "ready" ? "ready" : "error"));
    }
  }, [queryKey, provided]);

  const loadMore = useCallback(async () => {
    if (provided || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listRelationshipItems({ ...query, cursor });
      publishKeptSources(page.items, false);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.itemId));
        return [...current, ...page.items.filter((item) => !seen.has(item.itemId))];
      });
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setLoadingMore(false);
    }
  }, [queryKey, provided, cursor, loadingMore]);

  useEffect(() => {
    if (provided) return;
    setStatus("loading");
    void reload();
  }, [reload, provided]);

  useEffect(() => {
    if (provided) return;
    const refresh = () => void reload();
    const reset = () => {
      setItems([]);
      setStatus("loading");
      void reload();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("shawtie:relationship-changed", refresh);
    window.addEventListener("shawtie:relationship-queue-changed", refresh);
    window.addEventListener("shawtie:partnership-changed", reset);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("shawtie:relationship-changed", refresh);
      window.removeEventListener("shawtie:relationship-queue-changed", refresh);
      window.removeEventListener("shawtie:partnership-changed", reset);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reload, provided]);

  if (provided) {
    return {
      items: [...provided],
      status: "ready",
      error: "",
      hasMore: false,
      loadingMore: false,
      reload: async () => undefined,
      loadMore: async () => undefined,
    };
  }
  return { items, status, error, hasMore: cursor !== null, loadingMore, reload, loadMore };
}

export interface LoaderState<T> {
  data: T | null;
  status: LoadStatus;
  error: string;
  reload: () => Promise<void>;
}

/**
 * Loads one experience payload (this-day, our-year, anniversary) through the existing
 * experience endpoints and refreshes on the same relationship signals as list views.
 */
export function useExperience<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  skip = false,
): LoaderState<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LoadStatus>(skip ? "ready" : "loading");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    if (skip) return;
    const mine = ++generation.current;
    try {
      const value = await loadRef.current();
      if (mine !== generation.current) return;
      setData(value);
      setStatus("ready");
      setError("");
    } catch (caught) {
      if (mine !== generation.current) return;
      setError(messageFor(caught));
      setStatus((current) => (current === "ready" ? "ready" : "error"));
    }
  }, [skip, ...deps]);

  useEffect(() => {
    if (skip) return;
    setStatus("loading");
    void reload();
  }, [reload, skip]);

  useEffect(() => {
    if (skip) return;
    const refresh = () => void reload();
    window.addEventListener("shawtie:relationship-changed", refresh);
    window.addEventListener("shawtie:relationship-queue-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("shawtie:relationship-changed", refresh);
      window.removeEventListener("shawtie:relationship-queue-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [reload, skip]);

  return { data, status, error, reload };
}
