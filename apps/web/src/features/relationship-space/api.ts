import { apiRequest } from "../../lib/api-client.ts";
import type {
  RelationshipItem,
  RelationshipItemListResponse,
  RelationshipItemKind,
  RelationshipSpaceResponse,
} from "./model.ts";

function mutationHeaders(): HeadersInit {
  return { "idempotency-key": crypto.randomUUID() };
}

export function loadRelationshipHome(): Promise<RelationshipSpaceResponse> {
  return apiRequest("/api/v1/relationship-space");
}

export function listRelationshipItems(input: {
  kind?: RelationshipItemKind;
  storyOnly?: boolean;
  year?: number;
  cursor?: string;
  sort?: "created_desc" | "occurred_asc";
} = {}): Promise<RelationshipItemListResponse> {
  const query = new URLSearchParams();
  if (input.kind) query.set("kind", input.kind);
  if (input.storyOnly) query.set("storyOnly", "true");
  if (input.year) query.set("year", String(input.year));
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.sort) query.set("sort", input.sort);
  query.set("limit", "50");
  return apiRequest("/api/v1/relationship-space/items?" + query.toString());
}

export function createRelationshipItem(body: unknown): Promise<{
  itemId: string;
  version: number;
  createdAt: string;
}> {
  return apiRequest("/api/v1/relationship-space/items", {
    method: "POST",
    headers: mutationHeaders(),
    body,
  });
}

export function patchRelationshipItem(
  itemId: string,
  body: unknown,
): Promise<{ itemId: string; version: number; updatedAt: string }> {
  return apiRequest("/api/v1/relationship-space/items/" + itemId, {
    method: "PATCH",
    headers: mutationHeaders(),
    body,
  });
}

export function deleteRelationshipItem(itemId: string, expectedVersion: number): Promise<void> {
  return apiRequest("/api/v1/relationship-space/items/" + itemId, {
    method: "DELETE",
    headers: mutationHeaders(),
    body: { expectedVersion },
  });
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
  return apiRequest(
    "/api/v1/relationship-space/experiences/this-day?on=" + encodeURIComponent(on),
  );
}

export function loadOurYear(
  year: number,
): Promise<{ year: number; savedCuration: RelationshipItem | null; candidates: RelationshipItem[] }> {
  return apiRequest("/api/v1/relationship-space/experiences/our-year/" + year);
}

export function loadAnniversary(
  on?: string,
): Promise<{
  relationshipStartDate: string | null;
  anniversaryDate: string | null;
  savedCuration: RelationshipItem | null;
  eligibleItems: RelationshipItem[];
}> {
  const query = on ? "?on=" + encodeURIComponent(on) : "";
  return apiRequest("/api/v1/relationship-space/experiences/anniversary" + query);
}
