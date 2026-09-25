import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../../design/icons.tsx";
import type { CameraState } from "./camera-controller.ts";

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

type PreviewCorner = "bottom-right" | "bottom-left" | "top-left" | "top-right";
const PREVIEW_CORNERS: readonly PreviewCorner[] = [
  "bottom-right",
  "bottom-left",
  "top-left",
  "top-right",
];
const DRAG_THRESHOLD_PX = 6;

function localPlaceholder(cameraState: CameraState | undefined): string {
  if (cameraState === "acquiring") return "Starting camera...";
  if (cameraState === "unavailable") return "Camera unavailable";
  return "Camera off";
}

/**
 * Full-bleed remote video with a small local preview. The preview tile snaps to the nearest
 * corner after a drag; a tap or key press cycles the corner so the gesture always has a button
 * alternative. Presentation only: streams and camera state come from the caller.
 */
export function VideoSurface({
  localStream,
  remoteStream,
  partnerName,
  cameraState,
}: {
  readonly localStream: MediaStream | null;
  readonly remoteStream: MediaStream | null;
  readonly partnerName?: string | null;
  readonly cameraState?: CameraState;
}) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const tileRef = useRef<HTMLButtonElement | null>(null);
  const previousRect = useRef<DOMRect | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [remoteElement, setRemoteElement] = useState<HTMLVideoElement | null>(null);
  const [remoteBlocked, setRemoteBlocked] = useState(false);
  const [corner, setCorner] = useState<PreviewCorner>("bottom-right");
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
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

  // Glide the preview tile from where it was to its new corner.
  useLayoutEffect(() => {
    const element = tileRef.current;
    const before = previousRect.current;
    previousRect.current = null;
    if (!element || !before) return undefined;
    const after = element.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (!dx && !dy) return undefined;
    element.style.transition = "none";
    element.style.transform = "translate(" + dx + "px, " + dy + "px)";
    const frame = requestAnimationFrame(() => {
      element.style.transition = "";
      element.style.transform = "";
    });
    return () => cancelAnimationFrame(frame);
  }, [corner]);

  function snapshot(): void {
    previousRect.current = tileRef.current?.getBoundingClientRect() ?? null;
  }

  function cycleCorner(): void {
    snapshot();
    setCorner((current) => {
      const index = PREVIEW_CORNERS.indexOf(current);
      return PREVIEW_CORNERS[(index + 1) % PREVIEW_CORNERS.length] as PreviewCorner;
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    state.moved = true;
    setOffset({ x: dx, y: dy });
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLButtonElement>): void {
    const state = drag.current;
    drag.current = null;
    if (!state || state.pointerId !== event.pointerId || !state.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const stage = stageRef.current?.getBoundingClientRect();
    const tile = tileRef.current?.getBoundingClientRect();
    snapshot();
    if (stage && tile) {
      const centerX = tile.left + tile.width / 2 - stage.left;
      const centerY = tile.top + tile.height / 2 - stage.top;
      const horizontal = centerX < stage.width / 2 ? "left" : "right";
      const vertical = centerY < stage.height / 2 ? "top" : "bottom";
      setCorner((vertical + "-" + horizontal) as PreviewCorner);
    }
    setOffset(null);
  }

  const waitingText = partnerName
    ? "Waiting for " + partnerName + "'s video"
    : "Waiting for partner video";

  return (
    <div className="video-stage call-video-stage" aria-label="Video call" ref={stageRef}>
      <div className="remote-video-shell call-remote">
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
          <div className="video-placeholder call-remote__placeholder">{waitingText}</div>
        )}
        {remoteStream && remoteStalled ? (
          <div className="video-placeholder video-stalled call-remote__placeholder">
            {waitingText}
            <small>Their camera may be off, or the connection is catching up.</small>
          </div>
        ) : null}
        {remoteBlocked ? (
          <button
            className="primary compact video-retry call-remote__retry"
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
      <button
        type="button"
        ref={tileRef}
        className={"local-video-shell call-preview" + (offset ? " is-dragging" : "")}
        data-corner={corner}
        aria-label="Your camera preview. Press to move it to another corner."
        style={
          offset ? { transform: "translate(" + offset.x + "px, " + offset.y + "px)" } : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={() => {
          if (suppressClick.current) return;
          cycleCorner();
        }}
      >
        {localStream ? (
          <video ref={localRef} className="local-video" autoPlay playsInline muted />
        ) : (
          <span className="local-video-placeholder call-preview__off">
            <Icon name="videoOff" size={22} />
            {localPlaceholder(cameraState)}
          </span>
        )}
      </button>
    </div>
  );
}
