import {
  M2_PRE_S1_CONTENT_CONTEXT,
  S1_CONTENT_CONTEXT,
  parseAtBoundary,
  relationshipItemCreateSchema,
  relationshipItemPatchSchema,
  type RelationshipItemProjection,
} from "@shawtie/contracts";
import { ApiClientError, apiRequest } from "../../lib/api-client.ts";
import { getActiveS1CryptoRuntime } from "../../lib/crypto/runtime-context.tsx";
import { purgeMediaPartnershipData } from "../../lib/media/media-local-db.ts";
import {
  decryptRelationshipItemForView,
  decryptRelationshipItemsForView,
} from "../../lib/crypto/projection-decryption.ts";
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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface CurrentConversationCryptoAuthority {
  readonly conversation: {
    readonly partnershipId: string;
    readonly cryptoRequired: boolean;
  } | null;
}

async function relationshipCryptoPolicy(): Promise<{
  readonly partnershipId: string;
  readonly cryptoRequired: boolean;
  readonly contentContextKey: string;
}> {
  const m2 = runtimeOrThrow();
  const partnershipId = m2.realtime.scope.partnershipId;
  if (!partnershipId) throw new ApiClientError("NO_CURRENT_PARTNERSHIP", 409);

  const cryptoRuntime = getActiveS1CryptoRuntime();
  let cryptoRequired: boolean;
  if (cryptoRuntime) {
    cryptoRequired = await cryptoRuntime.cryptoRequiredForPartnership(partnershipId);
  } else {
    if (!navigator.onLine) throw new ApiClientError("CRYPTO_UNAVAILABLE", 0);
    const authority = await apiRequest<CurrentConversationCryptoAuthority>(
      "/api/v1/conversations/current",
    );
    if (
      !authority.conversation ||
      authority.conversation.partnershipId !== partnershipId
    ) {
      throw new ApiClientError("NO_CURRENT_PARTNERSHIP", 409);
    }
    cryptoRequired = authority.conversation.cryptoRequired;
  }

  const contentContextKey = cryptoRequired
    ? S1_CONTENT_CONTEXT
    : M2_PRE_S1_CONTENT_CONTEXT;
  const conversationId = m2.realtime.scope.conversationId;
  if (conversationId) {
    const database = await m2.database();
    const changed = await database.ensureNamespaceContentContext(
      partnershipId,
      conversationId,
      contentContextKey,
    );
    if (changed) {
      await purgeMediaPartnershipData(m2.accountId, partnershipId);
    }
  }

  return {
    partnershipId,
    cryptoRequired,
    contentContextKey,
  };
}

export async function relationshipCryptoRequired(): Promise<boolean> {
  return (await relationshipCryptoPolicy()).cryptoRequired;
}

async function protectCreateBody(
  body: unknown,
  policy: Awaited<ReturnType<typeof relationshipCryptoPolicy>>,
): Promise<unknown> {
  if (!policy.cryptoRequired) return body;
  const cryptoRuntime = getActiveS1CryptoRuntime();
  if (!cryptoRuntime) throw new ApiClientError("CRYPTO_UNAVAILABLE", 0);

  const source = record(body);
  if (!source) throw new ApiClientError("VALIDATION_FAILED", 400);
  if (source.protectedContent && source.content === null) return body;

  const content = record(source.content);
  const previewValue = source.preview;
  const preview =
    previewValue === null || previewValue === undefined ? null : record(previewValue);
  const kind = typeof source.kind === "string" ? source.kind : null;
  const schemaVersion =
    typeof source.contentSchemaVersion === "number" &&
    Number.isSafeInteger(source.contentSchemaVersion) &&
    source.contentSchemaVersion > 0
      ? source.contentSchemaVersion
      : null;
  if (!content || !kind || schemaVersion === null) {
    throw new ApiClientError("VALIDATION_FAILED", 400);
  }

  const itemId =
    typeof source.itemId === "string" ? source.itemId : crypto.randomUUID();
  const [protectedContent, protectedPreview] = await Promise.all([
    cryptoRuntime.protectJson(
      {
        partnershipId: policy.partnershipId,
        contentType: "relationship_item",
        contentId: itemId,
        contentVersion: 1,
        payloadRole: "relationship_main",
        schemaVersion,
      },
      content,
    ),
    preview
      ? cryptoRuntime.protectJson(
          {
            partnershipId: policy.partnershipId,
            contentType: "relationship_item",
            contentId: itemId,
            contentVersion: 1,
            payloadRole: "relationship_preview",
            schemaVersion,
          },
          preview,
        )
      : Promise.resolve(null),
  ]);

  return parseAtBoundary(relationshipItemCreateSchema, {
    ...source,
    itemId,
    preview: null,
    content: null,
    protectedPreview,
    protectedContent,
  });
}

async function protectPatchBody(
  itemId: string,
  body: unknown,
  policy: Awaited<ReturnType<typeof relationshipCryptoPolicy>>,
): Promise<unknown> {
  if (!policy.cryptoRequired) return body;
  const source = record(body);
  if (!source) throw new ApiClientError("VALIDATION_FAILED", 400);
  const cryptoRuntime = getActiveS1CryptoRuntime();
  if (!cryptoRuntime) throw new ApiClientError("CRYPTO_UNAVAILABLE", 0);

  const expectedVersion =
    typeof source.expectedVersion === "number" &&
    Number.isSafeInteger(source.expectedVersion) &&
    source.expectedVersion > 0
      ? source.expectedVersion
      : null;
  if (expectedVersion === null) throw new ApiClientError("VALIDATION_FAILED", 400);

  const next: Record<string, unknown> = { ...source };
  if (Object.prototype.hasOwnProperty.call(source, "content")) {
    const content = record(source.content);
    if (!content) throw new ApiClientError("VALIDATION_FAILED", 400);
    delete next.content;
    next.protectedContent = await cryptoRuntime.protectJson(
      {
        partnershipId: policy.partnershipId,
        contentType: "relationship_item",
        contentId: itemId,
        contentVersion: expectedVersion + 1,
        payloadRole: "relationship_main",
        schemaVersion: 1,
      },
      content,
    );
  }

  if (Object.prototype.hasOwnProperty.call(source, "preview")) {
    const preview = source.preview === null ? null : record(source.preview);
    if (source.preview !== null && !preview) {
      throw new ApiClientError("VALIDATION_FAILED", 400);
    }
    delete next.preview;
    next.protectedPreview = preview
      ? await cryptoRuntime.protectJson(
          {
            partnershipId: policy.partnershipId,
            contentType: "relationship_item",
            contentId: itemId,
            contentVersion: expectedVersion + 1,
            payloadRole: "relationship_preview",
            schemaVersion: 1,
          },
          preview,
        )
      : null;
  }

  return parseAtBoundary(relationshipItemPatchSchema, next);
}

async function decryptItems(
  items: readonly RelationshipItemProjection[],
): Promise<RelationshipItem[]> {
  if (items.length === 0) return [];
  const m2 = getActiveM2Runtime();
  const partnershipId =
    m2?.realtime.scope.partnershipId ??
    items.find((item) => item.protectedContent)?.protectedContent?.envelope.partnershipId ??
    items.find((item) => item.protectedPreview)?.protectedPreview?.envelope.partnershipId ??
    null;
  if (!partnershipId) return [...items];
  const cryptoRuntime = getActiveS1CryptoRuntime();
  return [
    ...(await decryptRelationshipItemsForView(
      cryptoRuntime,
      partnershipId,
      items,
    )),
  ];
}

async function decryptItem(
  item: RelationshipItemProjection | null,
): Promise<RelationshipItem | null> {
  if (!item) return null;
  const [visible] = await decryptItems([item]);
  return visible ?? null;
}

type RelationshipMutationSuccess<T> = [T] extends [void]
  ? { queued: false }
  : { queued: false } & T;

export type RelationshipMutationResult<T = void> =
  RelationshipMutationSuccess<T> | { queued: true; operationId: string };

export async function loadRelationshipHome(): Promise<RelationshipSpaceResponse> {
  const result = await apiRequest<RelationshipSpaceResponse>("/api/v1/relationship-space");
  if (!result.space) return result;
  const [recentItems, upcomingReleases, reunion, recentSignals] = await Promise.all([
    decryptItems(result.space.recentItems),
    decryptItems(result.space.upcomingReleases),
    decryptItem(result.space.reunion),
    decryptItems(result.space.recentSignals),
  ]);
  return {
    space: {
      ...result.space,
      recentItems,
      upcomingReleases,
      reunion,
      recentSignals,
    },
  };
}

export async function listRelationshipItems(
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
  const page = await apiRequest<RelationshipItemListResponse>(
    "/api/v1/relationship-space/items?" + query.toString(),
  );
  return {
    ...page,
    items: await decryptItems(page.items),
  };
}

export async function createRelationshipItem(body: unknown): Promise<
  RelationshipMutationResult<{
    itemId: string;
    version: number;
    createdAt: string;
  }>
> {
  const key = mutationKey();
  const policy = await relationshipCryptoPolicy();
  const requestBody = await protectCreateBody(body, policy);
  const queue = async () => {
    try {
      const operation = await runtimeOrThrow().queueRelationshipCreate(
        requestBody,
        key,
        policy.contentContextKey,
      );
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
      body: requestBody,
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
  const policy = await relationshipCryptoPolicy();
  const requestBody = await protectPatchBody(itemId, body, policy);
  const queue = async () => {
    try {
      const operation = await runtimeOrThrow().queueRelationshipPatch(
        itemId,
        requestBody,
        key,
        policy.contentContextKey,
      );
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
      body: requestBody,
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
  const policy = await relationshipCryptoPolicy();
  const queue = async () => {
    const operation = await runtimeOrThrow().queueRelationshipDelete(
      itemId,
      expectedVersion,
      key,
      policy.contentContextKey,
    );
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

export async function loadThisDay(
  on: string,
): Promise<{ on: string; items: RelationshipItem[] }> {
  const result = await apiRequest<{ on: string; items: RelationshipItemProjection[] }>(
    "/api/v1/relationship-space/experiences/this-day?on=" + encodeURIComponent(on),
  );
  return { ...result, items: await decryptItems(result.items) };
}

export async function loadOurYear(year: number): Promise<{
  year: number;
  savedCuration: RelationshipItem | null;
  candidates: RelationshipItem[];
}> {
  const result = await apiRequest<{
    year: number;
    savedCuration: RelationshipItemProjection | null;
    candidates: RelationshipItemProjection[];
  }>("/api/v1/relationship-space/experiences/our-year/" + year);
  const [savedCuration, candidates] = await Promise.all([
    decryptItem(result.savedCuration),
    decryptItems(result.candidates),
  ]);
  return { ...result, savedCuration, candidates };
}

export async function loadAnniversary(on?: string): Promise<{
  relationshipStartDate: string | null;
  anniversaryDate: string | null;
  savedCuration: RelationshipItem | null;
  eligibleItems: RelationshipItem[];
}> {
  const query = on ? "?on=" + encodeURIComponent(on) : "";
  const result = await apiRequest<{
    relationshipStartDate: string | null;
    anniversaryDate: string | null;
    savedCuration: RelationshipItemProjection | null;
    eligibleItems: RelationshipItemProjection[];
  }>("/api/v1/relationship-space/experiences/anniversary" + query);
  const [savedCuration, eligibleItems] = await Promise.all([
    decryptItem(result.savedCuration),
    decryptItems(result.eligibleItems),
  ]);
  return { ...result, savedCuration, eligibleItems };
}
