import { ApiClientError, apiRequest } from "../../lib/api-client.ts";
import { getActiveM2Runtime } from "../../lib/realtime/runtime-context.tsx";
import type {
  RelationshipItem,
  RelationshipItemListResponse,
  RelationshipItemKind,
  RelationshipSpaceResponse,
} from "./model.ts";

function mutationKey(): string {
  return crypto.randomUUID();
}

function mutationHeaders(key = mutationKey()): HeadersInit {
  return { "idempotency-key": key };
}

function runtimeOrThrow() {
  const runtime = getActiveM2Runtime();
  if (!runtime) throw new ApiClientError("OFFLINE_RUNTIME_UNAVAILABLE", 0);
  return runtime;
}

function networkFallback(error: unknown): boolean {
  return !(error instanceof ApiClientError);
}

type RelationshipMutationSuccess<T> = [T] extends [void]
  ? { queued: false }
  : { queued: false } & T;

export type RelationshipMutationResult<T = void> =
  RelationshipMutationSuccess<T> | { queued: true; operationId: string };

export function loadRelationshipHome(): Promise<RelationshipSpaceResponse> {
  return apiRequest("/api/v1/relationship-space");
}

export function listRelationshipItems(
  input: {
    kind?: RelationshipItemKind;
    storyOnly?: boolean;
    year?: number;
    cursor?: string;
    sort?: "created_desc" | "occurred_asc";
  } = {},
): Promise<RelationshipItemListResponse> {
  const query = new URLSearchParams();
  if (input.kind) query.set("kind", input.kind);
  if (input.storyOnly) query.set("storyOnly", "true");
  if (input.year) query.set("year", String(input.year));
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.sort) query.set("sort", input.sort);
  query.set("limit", "50");
  return apiRequest("/api/v1/relationship-space/items?" + query.toString());
}

export async function createRelationshipItem(body: unknown): Promise<
  RelationshipMutationResult<{
    itemId: string;
    version: number;
    createdAt: string;
  }>
> {
  const key = mutationKey();
  const queue = async () => {
    try {
      const operation = await runtimeOrThrow().queueRelationshipCreate(body, key);
      return { queued: true as const, operationId: operation.operationId };
    } catch {
      throw new ApiClientError("OFFLINE_OPERATION_REQUIRES_CONNECTION", 0);
    }
  };

  if (!navigator.onLine) return queue();

  try {
    const result = await apiRequest<{
      itemId: string;
      version: number;
      createdAt: string;
    }>("/api/v1/relationship-space/items", {
      method: "POST",
      headers: mutationHeaders(key),
      body,
    });
    return { queued: false, ...result };
  } catch (error) {
    if (networkFallback(error)) return queue();
    throw error;
  }
}

export async function patchRelationshipItem(
  itemId: string,
  body: unknown,
): Promise<
  RelationshipMutationResult<{
    itemId: string;
    version: number;
    updatedAt: string;
  }>
> {
  const key = mutationKey();
  const queue = async () => {
    try {
      const operation = await runtimeOrThrow().queueRelationshipPatch(itemId, body, key);
      return { queued: true as const, operationId: operation.operationId };
    } catch {
      throw new ApiClientError("OFFLINE_OPERATION_REQUIRES_CONNECTION", 0);
    }
  };

  if (!navigator.onLine) return queue();

  try {
    const result = await apiRequest<{
      itemId: string;
      version: number;
      updatedAt: string;
    }>("/api/v1/relationship-space/items/" + itemId, {
      method: "PATCH",
      headers: mutationHeaders(key),
      body,
    });
    return { queued: false, ...result };
  } catch (error) {
    if (networkFallback(error)) return queue();
    throw error;
  }
}

export async function deleteRelationshipItem(
  itemId: string,
  expectedVersion: number,
): Promise<RelationshipMutationResult> {
  const key = mutationKey();
  const queue = async () => {
    const operation = await runtimeOrThrow().queueRelationshipDelete(itemId, expectedVersion, key);
    return { queued: true as const, operationId: operation.operationId };
  };

  if (!navigator.onLine) return queue();

  try {
    await apiRequest("/api/v1/relationship-space/items/" + itemId, {
      method: "DELETE",
      headers: mutationHeaders(key),
      body: { expectedVersion },
    });
    return { queued: false };
  } catch (error) {
    if (networkFallback(error)) return queue();
    throw error;
  }
}

export function releaseRelationshipItem(
  itemId: string,
  expectedVersion: number,
): Promise<{ itemId: string; version: number; releasedAt: string }> {
  return apiRequest("/api/v1/relationship-space/items/" + itemId + "/release", {
    method: "POST",
    headers: mutationHeaders(),
    body: { expectedVersion },
  });
}

export function loadThisDay(on: string): Promise<{ on: string; items: RelationshipItem[] }> {
  return apiRequest("/api/v1/relationship-space/experiences/this-day?on=" + encodeURIComponent(on));
}

export function loadOurYear(year: number): Promise<{
  year: number;
  savedCuration: RelationshipItem | null;
  candidates: RelationshipItem[];
}> {
  return apiRequest("/api/v1/relationship-space/experiences/our-year/" + year);
}

export function loadAnniversary(on?: string): Promise<{
  relationshipStartDate: string | null;
  anniversaryDate: string | null;
  savedCuration: RelationshipItem | null;
  eligibleItems: RelationshipItem[];
}> {
  const query = on ? "?on=" + encodeURIComponent(on) : "";
  return apiRequest("/api/v1/relationship-space/experiences/anniversary" + query);
}
