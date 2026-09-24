import { useEffect, useRef, useState } from "react";

function bindStream(
  element: HTMLVideoElement | null,
  stream: MediaStream | null,
  onBlocked?: (blocked: boolean) => void,
): void {
  if (!element) return;
  element.srcObject = stream;
  if (!stream) {
    element.pause();
    onBlocked?.(false);
    return;
  }
  void element.play().then(
    () => onBlocked?.(false),
    () => onBlocked?.(true),
  );
}

export function VideoSurface({
  localStream,
  remoteStream,
}: {
  readonly localStream: MediaStream | null;
  readonly remoteStream: MediaStream | null;
}) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const [remoteBlocked, setRemoteBlocked] = useState(false);

  useEffect(() => {
    bindStream(localRef.current, localStream);
    return () => {
      if (localRef.current) localRef.current.srcObject = null;
    };
  }, [localStream]);

  useEffect(() => {
    bindStream(remoteRef.current, remoteStream, setRemoteBlocked);
    return () => {
      if (remoteRef.current) remoteRef.current.srcObject = null;
    };
  }, [remoteStream]);

  return (
    <div className="video-stage" aria-label="Video call">
      <div className="remote-video-shell">
        {remoteStream ? (
          <video ref={remoteRef} className="remote-video" autoPlay playsInline muted />
        ) : (
          <div className="video-placeholder">Waiting for partner video</div>
        )}
        {remoteBlocked ? (
          <button
            className="primary compact video-retry"
            onClick={() => {
              const video = remoteRef.current;
              if (!video) return;
              void video.play().then(
                () => setRemoteBlocked(false),
                () => setRemoteBlocked(true),
              );
            }}
          >
            Tap to show video
          </button>
        ) : null}
      </div>
      <div className="local-video-shell">
        {localStream ? (
          <video ref={localRef} className="local-video" autoPlay playsInline muted />
        ) : (
          <div className="local-video-placeholder">Camera off</div>
        )}
      </div>
    </div>
  );
}
