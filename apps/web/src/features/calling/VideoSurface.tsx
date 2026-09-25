import { useEffect, useRef, useState } from "react";

const REMOTE_FRAME_STALL_MS = 3_000;

/**
 * Remote video availability is derived from rendering progress. When the sender turns its camera
 * off the receiving track can stay live and unmuted, so the last decoded frame would otherwise stay
 * on screen indefinitely. This stays entirely inside the browser: no statistics leave the page and
 * no camera state is signalled or stored.
 */
function useRemoteFrameStall(element: HTMLVideoElement | null, active: boolean): boolean {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!element || !active) {
      setStalled(false);
      return undefined;
    }
    let disposed = false;
    let seenFrame = false;
    let lastAdvance = performance.now();
    let lastTotal = -1;
    let handle: number | null = null;
    const hasFrameCallback = typeof element.requestVideoFrameCallback === "function";

    const advanced = () => {
      seenFrame = true;
      lastAdvance = performance.now();
      setStalled(false);
    };
    const onFrame = () => {
      if (disposed) return;
      advanced();
      handle = element.requestVideoFrameCallback(onFrame);
    };
    if (hasFrameCallback) handle = element.requestVideoFrameCallback(onFrame);

    const timer = window.setInterval(() => {
      if (!hasFrameCallback) {
        const total = element.getVideoPlaybackQuality().totalVideoFrames;
        if (total !== lastTotal) {
          lastTotal = total;
          if (total > 0) advanced();
        }
      }
      if (seenFrame && performance.now() - lastAdvance > REMOTE_FRAME_STALL_MS) setStalled(true);
    }, 1_000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (handle !== null && typeof element.cancelVideoFrameCallback === "function") {
        element.cancelVideoFrameCallback(handle);
      }
    };
  }, [element, active]);

  return stalled;
}

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
  const [remoteElement, setRemoteElement] = useState<HTMLVideoElement | null>(null);
  const [remoteBlocked, setRemoteBlocked] = useState(false);
  const remoteStalled = useRemoteFrameStall(remoteElement, remoteStream !== null);

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
          <video
            ref={(element) => {
              remoteRef.current = element;
              setRemoteElement(element);
            }}
            className="remote-video"
            style={remoteStalled ? { visibility: "hidden" } : undefined}
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div className="video-placeholder">Waiting for partner video</div>
        )}
        {remoteStream && remoteStalled ? (
          <div className="video-placeholder video-stalled">Waiting for partner video</div>
        ) : null}
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
