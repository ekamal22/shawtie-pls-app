import type { MediaFormatCode, MediaKind } from "@shawtie/contracts";

export interface MediaServerProjection {
  readonly mediaId: string;
  readonly kind: MediaKind;
  readonly formatCode: MediaFormatCode;
  readonly state: "uploading" | "ready_unbound" | "bound" | "deletion_pending" | "failed";
  readonly ciphertextBytes: number;
  readonly cryptoProtocolVersion: string;
  readonly durationSeconds: number | null;
  readonly uploadGeneration: number;
  readonly uploadExpiresAt: string | null;
  readonly readyAt: string | null;
  readonly binding: {
    readonly type: "message" | "relationship_item";
    readonly id: string;
    readonly role: "attachment" | "voice_message" | "voice_letter";
    readonly position: number;
  } | null;
  readonly createdAt: string;
}

export interface MediaUploadGrant extends MediaServerProjection {
  readonly uploadUrl: string | null;
  readonly requiredHeaders: Readonly<Record<string, string>> | null;
  readonly grantExpiresAt?: string;
}

export interface MediaAccessGrant {
  readonly media: MediaServerProjection;
  readonly downloadUrl: string;
  readonly expiresAt: string;
}

export interface LocalMediaDraft {
  readonly draftId: string;
  readonly accountId: string;
  readonly partnershipId: string;
  readonly ownerContext: "chat" | "relationship";
  readonly kind: MediaKind;
  readonly formatCode: MediaFormatCode;
  readonly role: "attachment" | "voice_message" | "voice_letter";
  readonly ciphertext: Blob;
  readonly ciphertextBytes: number;
  readonly ciphertextSha256: string;
  readonly cryptoProtocolVersion: string;
  readonly durationSeconds: number | null;
  readonly idempotencyKey: string;
  readonly mediaId: string | null;
  readonly uploadGeneration: number | null;
  readonly state: "prepared" | "uploading" | "ready" | "failed";
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly errorCode: string | null;
}
