import type { MediaUploadCreateInput, MediaUploadGenerationInput } from "@shawtie/contracts";
import { apiRequest } from "../api-client.ts";
import type { MediaAccessGrant, MediaServerProjection, MediaUploadGrant } from "./media-types.ts";

function mediaKey(): string {
  return "m3-" + crypto.randomUUID();
}

export function loadMediaPolicy(): Promise<{
  imageSourceMaxBytes: number;
  imageProcessedLongestEdge: number;
  imageTargetBytes: number;
  videoMaxBytes: number;
  videoMaxDurationSeconds: number;
  fileMaxBytes: number;
  voiceMaxBytes: number;
  voiceMaxDurationSeconds: number;
  attachmentsPerMessage: number;
  wholeObjectTransfer: boolean;
}> {
  return apiRequest("/api/v1/media/policy");
}

export function createMediaUpload(
  input: MediaUploadCreateInput,
  idempotencyKey: string,
): Promise<MediaUploadGrant> {
  return apiRequest("/api/v1/media/uploads", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey || mediaKey() },
    body: input,
  });
}

export function refreshMediaUpload(
  mediaId: string,
  input: MediaUploadGenerationInput,
): Promise<MediaUploadGrant> {
  return apiRequest("/api/v1/media/" + mediaId + "/refresh-upload", {
    method: "POST",
    body: input,
  });
}

export function completeMediaUpload(
  mediaId: string,
  input: MediaUploadGenerationInput,
): Promise<MediaServerProjection> {
  return apiRequest("/api/v1/media/" + mediaId + "/complete", {
    method: "POST",
    body: input,
  });
}

export function loadMediaMetadata(mediaId: string): Promise<MediaServerProjection> {
  return apiRequest("/api/v1/media/" + mediaId);
}

export function requestMediaAccess(mediaId: string): Promise<MediaAccessGrant> {
  return apiRequest("/api/v1/media/" + mediaId + "/access");
}

export function deleteUnboundMedia(mediaId: string): Promise<void> {
  return apiRequest("/api/v1/media/" + mediaId, { method: "DELETE" });
}

export async function putCiphertext(
  grant: Pick<MediaUploadGrant, "uploadUrl" | "requiredHeaders">,
  ciphertext: Blob,
): Promise<void> {
  if (!grant.uploadUrl || !grant.requiredHeaders) return;
  const response = await fetch(grant.uploadUrl, {
    method: "PUT",
    headers: new Headers(grant.requiredHeaders),
    body: ciphertext,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("MEDIA_STORAGE_UPLOAD_FAILED_" + response.status);
}

export async function getCiphertext(url: string): Promise<Blob> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("MEDIA_STORAGE_DOWNLOAD_FAILED_" + response.status);
  return response.blob();
}
