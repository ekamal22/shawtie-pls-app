import { useEffect, useState } from "react";
import type { MediaAttachmentProjection } from "@shawtie/contracts";
import { Dialog, Skeleton } from "../../design/primitives.tsx";
import { loadDecryptedMedia } from "../../lib/media/media-runtime.ts";
import { useS1CryptoRuntime } from "../../lib/crypto/runtime-context.tsx";
import type { MediaServerProjection } from "../../lib/media/media-types.ts";

function mediaUnavailableCopy(error: string): {
  readonly text: string;
  readonly state: string;
  readonly alert: boolean;
} {
  if (error === "CRYPTO_HISTORY_UNAVAILABLE") {
    return {
      text: "This older protected attachment is unavailable on this device.",
      state: "history_unavailable",
      alert: false,
    };
  }
  if (error === "CRYPTO_CIPHERTEXT_INVALID" || error === "CRYPTO_SIGNATURE_INVALID") {
    return {
      text: "This protected attachment could not be safely verified.",
      state: "integrity_failed",
      alert: true,
    };
  }
  if (error.startsWith("CRYPTO_")) {
    return {
      text: "This protected attachment is unavailable until protected sharing is ready.",
      state: "temporarily_unavailable",
      alert: false,
    };
  }
  return {
    text: "This attachment can't be opened right now.",
    state: "media_unavailable",
    alert: false,
  };
}

function fileName(media: MediaServerProjection): string {
  const extension: Record<string, string> = {
    jpeg: "jpg",
    png: "png",
    webp: "webp",
    avif: "avif",
    mp4: "mp4",
    webm_video: "webm",
    pdf: "pdf",
    text: "txt",
    zip: "zip",
    binary: "bin",
    webm_opus: "webm",
    ogg_opus: "ogg",
    m4a: "m4a",
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
  const { runtime: cryptoRuntime } = useS1CryptoRuntime();
  const [loaded, setLoaded] = useState<{
    media: MediaServerProjection;
    url: string;
    revoke: () => void;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    let active = true;
    let revoke: (() => void) | null = null;
    setLoading(true);
    setError("");
    void loadDecryptedMedia(mediaId, cryptoRuntime)
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
  }, [cryptoRuntime, mediaId]);

  const kind = loaded?.media.kind ?? projection?.kind;
  if (loading) {
    return (
      <div className="media-card talk-media-loading" role="status" aria-label="Loading attachment">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (error || !loaded) {
    const unavailable = mediaUnavailableCopy(error || "MEDIA_UNAVAILABLE");
    return (
      <div
        className="media-card media-unavailable talk-media-unavailable"
        data-crypto-state={unavailable.state}
        role={unavailable.alert ? "alert" : "status"}
      >
        {unavailable.text}
      </div>
    );
  }

  if (kind === "image") {
    return (
      <>
        <button
          type="button"
          className="talk-image-button"
          aria-label="Open photo"
          onClick={() => setViewing(true)}
        >
          <img className="media-image" src={loaded.url} alt="Shared attachment" />
        </button>
        <Dialog open={viewing} onClose={() => setViewing(false)} title="Photo">
          <img className="talk-image-viewer" src={loaded.url} alt="Shared attachment, full size" />
        </Dialog>
      </>
    );
  }
  if (kind === "video") {
    return (
      <video className="media-video" src={loaded.url} controls playsInline preload="metadata" />
    );
  }
  if (kind === "voice") {
    const seconds = loaded.media.durationSeconds;
    return (
      <div className="talk-voice-note">
        <span className="talk-voice-note__label">
          Voice message{seconds ? " · " + seconds + "s" : ""}
        </span>
        <audio
          className="media-audio"
          src={loaded.url}
          controls
          preload="metadata"
          aria-label="Voice message"
        />
      </div>
    );
  }
  return (
    <a className="media-file" href={loaded.url} download={fileName(loaded.media)}>
      Download file
    </a>
  );
}
