import {
  M3_FILE_MAX_BYTES,
  M3_IMAGE_LONGEST_EDGE_MAX,
  M3_IMAGE_SOURCE_MAX_BYTES,
  M3_VIDEO_MAX_BYTES,
  M3_VIDEO_MAX_DURATION_SECONDS,
  M3_VOICE_MAX_BYTES,
  M3_VOICE_MAX_DURATION_SECONDS,
  type MediaFormatCode,
  type MediaKind,
} from "@shawtie/contracts";
import { decryptMedia, encryptMedia } from "./crypto-port.ts";
import {
  completeMediaUpload,
  createMediaUpload,
  deleteUnboundMedia,
  getCiphertext,
  putCiphertext,
  requestMediaAccess,
} from "./media-api.ts";
import {
  deleteMediaDraft,
  loadMediaDraft,
  saveMediaDraft,
} from "./media-local-db.ts";
import type { LocalMediaDraft, MediaServerProjection } from "./media-types.ts";

const IMAGE_TARGET_BYTES = 2 * 1024 * 1024;

function formatForFile(file: Blob & { readonly type: string }, kind: MediaKind): MediaFormatCode {
  const type = file.type.toLowerCase();
  if (kind === "image") {
    if (type === "image/jpeg") return "jpeg";
    if (type === "image/png") return "png";
    if (type === "image/avif") return "avif";
    return "webp";
  }
  if (kind === "video") return type === "video/mp4" ? "mp4" : "webm_video";
  if (kind === "voice") {
    if (type.includes("ogg")) return "ogg_opus";
    if (type.includes("mp4") || type.includes("m4a")) return "m4a";
    return "webm_opus";
  }
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/")) return "text";
  if (type === "application/zip" || type === "application/x-zip-compressed") return "zip";
  return "binary";
}

function kindForFile(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

async function blobSha256(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mediaDuration(blob: Blob, elementName: "audio" | "video"): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const element = document.createElement(elementName);
    element.preload = "metadata";
    element.src = url;
    return await new Promise<number>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("MEDIA_METADATA_TIMEOUT")), 10_000);
      element.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve(Math.ceil(element.duration));
      };
      element.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("MEDIA_FORMAT_UNSUPPORTED"));
      };
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("IMAGE_PROCESSING_UNAVAILABLE");
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality),
  );
  if (!blob) throw new Error("IMAGE_PROCESSING_FAILED");
  return blob;
}

async function processImage(file: File): Promise<Blob> {
  if (file.size > M3_IMAGE_SOURCE_MAX_BYTES) throw new Error("MEDIA_POLICY_VIOLATION");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, M3_IMAGE_LONGEST_EDGE_MAX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let output = await canvasBlob(bitmap, width, height, 0.86);
    if (output.size > IMAGE_TARGET_BYTES) output = await canvasBlob(bitmap, width, height, 0.72);
    if (output.size > M3_IMAGE_SOURCE_MAX_BYTES) throw new Error("MEDIA_POLICY_VIOLATION");
    return output;
  } finally {
    bitmap.close();
  }
}

async function validateAndProcess(
  source: File | Blob,
  forcedKind?: MediaKind,
  knownDurationSeconds?: number | null,
): Promise<{ blob: Blob; kind: MediaKind; formatCode: MediaFormatCode; durationSeconds: number | null }> {
  const kind = forcedKind ?? kindForFile(source as File);
  if (kind === "image") {
    if (!(source instanceof File)) throw new Error("IMAGE_SOURCE_INVALID");
    const blob = await processImage(source);
    return { blob, kind, formatCode: "webp", durationSeconds: null };
  }
  if (kind === "video") {
    if (source.size > M3_VIDEO_MAX_BYTES) throw new Error("MEDIA_POLICY_VIOLATION");
    const durationSeconds = knownDurationSeconds ?? (await mediaDuration(source, "video"));
    if (durationSeconds > M3_VIDEO_MAX_DURATION_SECONDS) throw new Error("MEDIA_POLICY_VIOLATION");
    return { blob: source, kind, formatCode: formatForFile(source, kind), durationSeconds };
  }
  if (kind === "voice") {
    if (source.size > M3_VOICE_MAX_BYTES) throw new Error("MEDIA_POLICY_VIOLATION");
    const durationSeconds = knownDurationSeconds ?? (await mediaDuration(source, "audio"));
    if (durationSeconds > M3_VOICE_MAX_DURATION_SECONDS) throw new Error("MEDIA_POLICY_VIOLATION");
    return { blob: source, kind, formatCode: formatForFile(source, kind), durationSeconds };
  }
  if (source.size > M3_FILE_MAX_BYTES) throw new Error("MEDIA_POLICY_VIOLATION");
  return { blob: source, kind: "file", formatCode: formatForFile(source, "file"), durationSeconds: null };
}

export async function prepareMediaDraft(input: {
  readonly accountId: string;
  readonly partnershipId: string;
  readonly ownerContext: LocalMediaDraft["ownerContext"];
  readonly source: File | Blob;
  readonly role: LocalMediaDraft["role"];
  readonly kind?: MediaKind;
  readonly durationSeconds?: number | null;
}): Promise<LocalMediaDraft> {
  const prepared = await validateAndProcess(input.source, input.kind, input.durationSeconds);
  if ((input.role === "voice_message" || input.role === "voice_letter") && prepared.kind !== "voice") {
    throw new Error("MEDIA_ROLE_INVALID");
  }
  if (input.role === "attachment" && prepared.kind === "voice") {
    throw new Error("MEDIA_ROLE_INVALID");
  }
  const encrypted = await encryptMedia(prepared.blob);
  const now = Date.now();
  const draft: LocalMediaDraft = {
    draftId: crypto.randomUUID(),
    accountId: input.accountId,
    partnershipId: input.partnershipId,
    ownerContext: input.ownerContext,
    kind: prepared.kind,
    formatCode: prepared.formatCode,
    role: input.role,
    ciphertext: encrypted.ciphertext,
    ciphertextBytes: encrypted.ciphertext.size,
    ciphertextSha256: await blobSha256(encrypted.ciphertext),
    cryptoProtocolVersion: encrypted.protocolVersion,
    durationSeconds: prepared.durationSeconds,
    idempotencyKey: "m3-" + crypto.randomUUID(),
    mediaId: null,
    uploadGeneration: null,
    state: "prepared",
    createdAt: now,
    updatedAt: now,
    errorCode: null,
  };
  await saveMediaDraft(draft);
  return draft;
}

export async function uploadMediaDraft(
  accountId: string,
  draftId: string,
): Promise<{ readonly draft: LocalMediaDraft; readonly media: MediaServerProjection }> {
  const draft = await loadMediaDraft(accountId, draftId);
  if (!draft) throw new Error("MEDIA_DRAFT_NOT_FOUND");
  const uploading: LocalMediaDraft = { ...draft, state: "uploading", updatedAt: Date.now(), errorCode: null };
  await saveMediaDraft(uploading);
  try {
    const grant = await createMediaUpload(
      {
        kind: draft.kind,
        formatCode: draft.formatCode,
        ciphertextBytes: draft.ciphertextBytes,
        ciphertextSha256: draft.ciphertextSha256,
        cryptoProtocolVersion: draft.cryptoProtocolVersion,
        durationSeconds: draft.durationSeconds,
      },
      draft.idempotencyKey,
    );
    const withServer: LocalMediaDraft = {
      ...uploading,
      mediaId: grant.mediaId,
      uploadGeneration: grant.uploadGeneration,
      updatedAt: Date.now(),
    };
    await saveMediaDraft(withServer);

    let media: MediaServerProjection;
    if (grant.state === "ready_unbound") {
      media = grant;
    } else {
      await putCiphertext(grant, draft.ciphertext);
      media = await completeMediaUpload(grant.mediaId, {
        expectedUploadGeneration: grant.uploadGeneration,
      });
    }
    const ready: LocalMediaDraft = {
      ...withServer,
      mediaId: media.mediaId,
      uploadGeneration: media.uploadGeneration,
      state: "ready",
      updatedAt: Date.now(),
    };
    await saveMediaDraft(ready);
    return { draft: ready, media };
  } catch (error) {
    await saveMediaDraft({
      ...uploading,
      state: "failed",
      updatedAt: Date.now(),
      errorCode: error instanceof Error ? error.message.slice(0, 128) : "MEDIA_UPLOAD_FAILED",
    }).catch(() => undefined);
    throw error;
  }
}

export async function discardMediaDraft(
  accountId: string,
  draftId: string,
  deleteServer = true,
): Promise<void> {
  const draft = await loadMediaDraft(accountId, draftId);
  if (deleteServer && draft?.mediaId) {
    await deleteUnboundMedia(draft.mediaId).catch(() => undefined);
  }
  await deleteMediaDraft(accountId, draftId);
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function validateMagic(blob: Blob, kind: MediaKind, format: MediaFormatCode): Promise<void> {
  return blob.slice(0, 16).arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const ok =
      format === "jpeg"
        ? hasPrefix(bytes, [0xff, 0xd8, 0xff])
        : format === "png"
          ? hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])
          : format === "webp"
            ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
              String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
            : format === "avif" || format === "mp4" || format === "m4a"
              ? String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
              : format === "webm_video" || format === "webm_opus"
                ? hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])
                : format === "ogg_opus"
                  ? String.fromCharCode(...bytes.slice(0, 4)) === "OggS"
                  : format === "pdf"
                    ? String.fromCharCode(...bytes.slice(0, 4)) === "%PDF"
                    : format === "zip"
                      ? hasPrefix(bytes, [0x50, 0x4b])
                      : true;
    if (!ok) throw new Error("MEDIA_DECRYPTED_FORMAT_MISMATCH");
    if (kind === "voice" && !["webm_opus", "ogg_opus", "m4a"].includes(format)) {
      throw new Error("MEDIA_DECRYPTED_FORMAT_MISMATCH");
    }
  });
}

export function mimeForFormat(format: MediaFormatCode): string {
  const values: Record<MediaFormatCode, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
    mp4: "video/mp4",
    webm_video: "video/webm",
    pdf: "application/pdf",
    text: "text/plain",
    zip: "application/zip",
    binary: "application/octet-stream",
    webm_opus: "audio/webm",
    ogg_opus: "audio/ogg",
    m4a: "audio/mp4",
  };
  return values[format];
}

export async function loadDecryptedMedia(mediaId: string): Promise<{
  readonly media: MediaServerProjection;
  readonly blob: Blob;
  readonly url: string;
  readonly revoke: () => void;
}> {
  const grant = await requestMediaAccess(mediaId);
  const ciphertext = await getCiphertext(grant.downloadUrl);
  const plaintext = await decryptMedia(ciphertext, grant.media.cryptoProtocolVersion);
  await validateMagic(plaintext, grant.media.kind, grant.media.formatCode);
  const typed = new Blob([plaintext], { type: mimeForFormat(grant.media.formatCode) });
  const url = URL.createObjectURL(typed);
  return {
    media: grant.media,
    blob: typed,
    url,
    revoke: () => URL.revokeObjectURL(url),
  };
}
