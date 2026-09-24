export type MediaKind = "image" | "video" | "file" | "voice";
export type MediaFormatCode =
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "mp4"
  | "webm_video"
  | "pdf"
  | "text"
  | "zip"
  | "binary"
  | "webm_opus"
  | "ogg_opus"
  | "m4a";

const formats: Readonly<Record<MediaKind, readonly MediaFormatCode[]>> = {
  image: ["jpeg", "png", "webp", "avif"],
  video: ["mp4", "webm_video"],
  file: ["pdf", "text", "zip", "binary"],
  voice: ["webm_opus", "ogg_opus", "m4a"],
};

export function mediaFormatAllowed(kind: MediaKind, format: MediaFormatCode): boolean {
  return formats[kind].includes(format);
}

export function mediaRoleAllowed(
  kind: MediaKind,
  role: "attachment" | "voice_message" | "voice_letter",
): boolean {
  if (role === "voice_message" || role === "voice_letter") return kind === "voice";
  return kind !== "voice";
}

export function mediaBindingAllowed(
  bindingType: "message" | "relationship_item",
  role: "attachment" | "voice_message" | "voice_letter",
): boolean {
  return bindingType === "message"
    ? role === "attachment" || role === "voice_message"
    : role === "attachment" || role === "voice_letter";
}
