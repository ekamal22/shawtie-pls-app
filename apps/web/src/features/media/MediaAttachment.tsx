import { useEffect, useState } from "react";
import type { MediaAttachmentProjection } from "@shawtie/contracts";
import { loadDecryptedMedia } from "../../lib/media/media-runtime.ts";
import type { MediaServerProjection } from "../../lib/media/media-types.ts";

function fileName(media: MediaServerProjection): string {
  const extension: Record<string, string> = {
    jpeg: "jpg", png: "png", webp: "webp", avif: "avif",
    mp4: "mp4", webm_video: "webm", pdf: "pdf", text: "txt", zip: "zip",
    binary: "bin", webm_opus: "webm", ogg_opus: "ogg", m4a: "m4a",
  };
  return "attachment." + (extension[media.formatCode] ?? "bin");
}

export function MediaAttachment({
  mediaId,
  projection,
}: {
  mediaId: string;
  projection?: MediaAttachmentProjection;
}) {
  const [loaded, setLoaded] = useState<{
    media: MediaServerProjection;
    url: string;
    revoke: () => void;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | null = null;
    setLoading(true);
    setError("");
    void loadDecryptedMedia(mediaId)
      .then((value) => {
        if (!active) {
          value.revoke();
          return;
        }
        revoke = value.revoke;
        setLoaded({ media: value.media, url: value.url, revoke: value.revoke });
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "MEDIA_UNAVAILABLE");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      revoke?.();
    };
  }, [mediaId]);

  const kind = loaded?.media.kind ?? projection?.kind;
  if (loading) return <div className="media-card muted">Loading protected media...</div>;
  if (error || !loaded) {
    return (
      <div className="media-card media-unavailable">
        Protected media unavailable.
        <span className="hint">
          {error.includes("S1") ? " Production media decryption activates with S1." : ""}
        </span>
      </div>
    );
  }

  if (kind === "image") {
    return <img className="media-image" src={loaded.url} alt="Shared attachment" />;
  }
  if (kind === "video") {
    return <video className="media-video" src={loaded.url} controls playsInline preload="metadata" />;
  }
  if (kind === "voice") {
    return <audio className="media-audio" src={loaded.url} controls preload="metadata" />;
  }
  return (
    <a className="media-file" href={loaded.url} download={fileName(loaded.media)}>
      Download protected file
    </a>
  );
}
