import { z } from "zod";

export const M3_ATTACHMENTS_PER_MESSAGE_MAX = 10;
export const M3_IMAGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const M3_IMAGE_LONGEST_EDGE_MAX = 4096;
export const M3_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const M3_VIDEO_MAX_DURATION_SECONDS = 120;
export const M3_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const M3_VOICE_MAX_BYTES = 15 * 1024 * 1024;
export const M3_VOICE_MAX_DURATION_SECONDS = 600;

export const M3_IMAGE_CIPHERTEXT_MAX_BYTES = 12 * 1024 * 1024;
export const M3_VIDEO_CIPHERTEXT_MAX_BYTES = 52 * 1024 * 1024;
export const M3_FILE_CIPHERTEXT_MAX_BYTES = 27 * 1024 * 1024;
export const M3_VOICE_CIPHERTEXT_MAX_BYTES = 17 * 1024 * 1024;

export const mediaKindSchema = z.enum(["image", "video", "file", "voice"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const mediaFormatCodeSchema = z.enum([
  "jpeg",
  "png",
  "webp",
  "avif",
  "mp4",
  "webm_video",
  "pdf",
  "text",
  "zip",
  "binary",
  "webm_opus",
  "ogg_opus",
  "m4a",
]);
export type MediaFormatCode = z.infer<typeof mediaFormatCodeSchema>;

export const mediaStateSchema = z.enum([
  "uploading",
  "ready_unbound",
  "bound",
  "deletion_pending",
  "failed",
]);
export type MediaState = z.infer<typeof mediaStateSchema>;

export const mediaBindingRoleSchema = z.enum(["attachment", "voice_message", "voice_letter"]);
export type MediaBindingRole = z.infer<typeof mediaBindingRoleSchema>;

const uuid = z.string().uuid();
const generation = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const bytes = z.number().int().min(1).max(M3_VIDEO_CIPHERTEXT_MAX_BYTES);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const cryptoProtocol = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/);

export const mediaIdParamsSchema = z.object({ mediaId: uuid }).strict();

export const mediaUploadCreateSchema = z
  .object({
    kind: mediaKindSchema,
    formatCode: mediaFormatCodeSchema,
    ciphertextBytes: bytes,
    ciphertextSha256: digest,
    cryptoProtocolVersion: cryptoProtocol,
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(M3_VOICE_MAX_DURATION_SECONDS)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((value, context) => {
    const max =
      value.kind === "image"
        ? M3_IMAGE_CIPHERTEXT_MAX_BYTES
        : value.kind === "video"
          ? M3_VIDEO_CIPHERTEXT_MAX_BYTES
          : value.kind === "file"
            ? M3_FILE_CIPHERTEXT_MAX_BYTES
            : M3_VOICE_CIPHERTEXT_MAX_BYTES;
    if (value.ciphertextBytes > max) {
      context.addIssue({ code: "custom", message: "ciphertext exceeds media policy" });
    }
    if (value.kind === "video") {
      if (value.durationSeconds === null || value.durationSeconds > M3_VIDEO_MAX_DURATION_SECONDS) {
        context.addIssue({ code: "custom", message: "video duration invalid" });
      }
    } else if (value.kind === "voice") {
      if (value.durationSeconds === null || value.durationSeconds > M3_VOICE_MAX_DURATION_SECONDS) {
        context.addIssue({ code: "custom", message: "voice duration invalid" });
      }
    } else if (value.durationSeconds !== null) {
      context.addIssue({ code: "custom", message: "duration only applies to video or voice" });
    }
  });

export const mediaUploadGenerationSchema = z
  .object({ expectedUploadGeneration: generation })
  .strict();

export const mediaPolicySchema = z.object({}).strict();

export const messageMediaAttachmentInputSchema = z
  .object({
    mediaId: uuid,
    role: z.enum(["attachment", "voice_message"]),
    position: z
      .number()
      .int()
      .min(0)
      .max(M3_ATTACHMENTS_PER_MESSAGE_MAX - 1),
  })
  .strict();

export const mediaAttachmentProjectionSchema = z.object({
  mediaId: uuid,
  kind: mediaKindSchema,
  formatCode: mediaFormatCodeSchema,
  role: mediaBindingRoleSchema,
  position: z.number().int().min(0).max(31),
  ciphertextBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  cryptoProtocolVersion: z.string().min(1).max(64),
});

export type MediaUploadCreateInput = z.infer<typeof mediaUploadCreateSchema>;
export type MediaUploadGenerationInput = z.infer<typeof mediaUploadGenerationSchema>;
export type MessageMediaAttachmentInput = z.infer<typeof messageMediaAttachmentInputSchema>;
export type MediaAttachmentProjection = z.infer<typeof mediaAttachmentProjectionSchema>;
