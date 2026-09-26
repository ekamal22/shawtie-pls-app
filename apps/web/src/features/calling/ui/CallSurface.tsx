import type { CallProjection } from "@shawtie/contracts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../design/icons.tsx";
import { Avatar, ErrorNotice, MediaStateIndicator } from "../../../design/primitives.tsx";
import type { CameraState } from "../camera-controller.ts";
import { VideoSurface } from "../VideoSurface.tsx";
import { CallControl } from "./CallControls.tsx";
import { type CallPhase, type PhaseCopy, phaseCopy } from "./call-model.ts";
import { CallTimer } from "./CallTimer.tsx";

const CONTROLS_HIDE_MS = 4_500;

export interface CallSurfaceProps {
  readonly call: CallProjection;
  readonly partnerName: string | null;
  readonly phase: CallPhase;
  readonly cameraState: CameraState;
  readonly muted: boolean;
  /** True while this tab owns local media for the call. */
  readonly hasMedia: boolean;
  readonly canResume: boolean;
  readonly busy: boolean;
  readonly canAnswer: boolean;
  readonly error: string;
  readonly localVideo: MediaStream | null;
  readonly remoteVideo: MediaStream | null;
  readonly autoplayBlocked: boolean;
  readonly onAnswer: (cameraIntent: boolean) => void;
  readonly onDecline: () => void;
  readonly onCancel: () => void;
  readonly onEnd: () => void;
  readonly onResume: () => void;
  readonly onToggleMute: () => void;
  readonly onCameraOn: () => void;
  readonly onCameraOff: () => void;
  readonly onSwitchCamera: () => void;
  readonly onHearRemote: () => void;
  readonly onDismiss: () => void;
  readonly onTryAgain: () => void;
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]';

function restoreFocus(previous: HTMLElement | null): void {
  if (previous && previous.isConnected && previous.matches("button, a, [role='button']")) {
    previous.focus({ preventScroll: true });
    return;
  }
  // The control that opened the surface is gone or is a text field (avoid raising a keyboard).
  requestAnimationFrame(() => {
    const entry = document.querySelector<HTMLElement>("[data-call-entry]:not(:disabled)");
    (entry ?? document.getElementById("main"))?.focus({ preventScroll: true });
  });
}

function announcement(props: CallSurfaceProps, copy: PhaseCopy): string {
  const parts = [copy.eyebrow, copy.title, copy.status].filter((part): part is string =>
    Boolean(part),
  );
  if (props.phase === "connected" || props.phase === "reconnecting") {
    parts.push(props.muted ? "Your microphone is off." : "Your microphone is on.");
    if (props.call.kind === "video") {
      const cameraOn = props.cameraState === "on" || props.cameraState === "switching";
      parts.push(cameraOn ? "Your camera is on." : "Your camera is off.");
    }
  }
  const finish = (text: string) => (/[.!?]$/.test(text) ? text : text + ".");
  return parts.map(finish).join(" ");
}

/**
 * Full-screen call surface: a modal dialog with managed focus, a live region for state changes,
 * and controls that are always labelled. Purely presentational. Every action is a callback the
 * panel already owns, so consent, media ownership, and lifecycle rules stay where they were.
 */
export function CallSurface(props: CallSurfaceProps) {
  const { call, partnerName, phase, cameraState, muted, hasMedia, busy, canAnswer } = props;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const titleId = useId();
  const statusId = useId();
  const copy = phaseCopy(phase, call, partnerName);
  const video = call.kind === "video";
  const active = phase !== "ended" && phase !== "incoming-ringing" && phase !== "outgoing-ringing";
  const videoLayout = video && active && phase !== "observer" && phase !== "elsewhere";
  const cameraOn = cameraState === "on" || cameraState === "switching";

  // Modal behavior: focus in on open, restore on close, and no page scroll behind the surface.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add("call-open");
    titleRef.current?.focus({ preventScroll: true });
    // Modal: if something else grabs focus (for example route focus management), bring it back.
    const keepFocusInside = (event: FocusEvent) => {
      const surface = surfaceRef.current;
      if (surface && event.target instanceof Node && !surface.contains(event.target)) {
        titleRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      document.documentElement.classList.remove("call-open");
      restoreFocus(previous);
    };
  }, []);

  // When the focused control disappears with a state change, land on the heading.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const focused = document.activeElement;
    if (!focused || focused === document.body || !surface.contains(focused)) {
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [phase]);

  // Note when the camera paused because the app was in the background (browser behavior).
  const [backgrounded, setBackgrounded] = useState(false);
  useEffect(() => {
    if (!video) return undefined;
    const changed = () => {
      if (document.visibilityState === "hidden") setBackgrounded(true);
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, [video]);
  useEffect(() => {
    if (cameraOn) setBackgrounded(false);
  }, [cameraOn]);

  // Auto-hide the glass bar on touch inactivity. Badges and the timer stay visible, and the
  // bar stays reachable to keyboard and screen reader users while hidden.
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);
  function revealControls(): void {
    setControlsVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    if (!videoLayout) return;
    hideTimer.current = window.setTimeout(() => {
      const surface = surfaceRef.current;
      if (surface?.querySelector("button:focus-visible")) {
        revealControls();
        return;
      }
      setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }
  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [videoLayout, phase]);

  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>): void {
    revealControls();
    if (event.key !== "Tab") return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const items = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const focused = document.activeElement;
    if (event.shiftKey && (focused === first || focused === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && focused === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const showBadges = hasMedia && (phase === "connected" || phase === "reconnecting" || active);
  const badges =
    showBadges && phase !== "observer" && phase !== "elsewhere" ? (
      <div className="call-badges">
        <MediaStateIndicator device="microphone" on={!muted} />
        {video ? <MediaStateIndicator device="camera" on={cameraOn} /> : null}
      </div>
    ) : null;

  const cameraNote = !video
    ? null
    : cameraState === "unavailable"
      ? "Camera unavailable. You can keep talking."
      : cameraState === "acquiring"
        ? "Starting camera..."
        : backgrounded && !cameraOn && hasMedia
          ? "Your camera paused while the app was in the background. Turn it back on when you're ready."
          : null;

  const connectedSince =
    phase === "connected" || phase === "reconnecting" ? (call.connectedAt ?? null) : null;

  const controls = (
    <>
      {phase === "incoming-ringing" ? (
        <>
          <CallControl
            label="Decline"
            icon="phone"
            tone="end"
            hangup
            disabled={busy}
            onClick={props.onDecline}
          />
          {video ? (
            <>
              <CallControl
                label="Accept with camera off"
                icon="videoOff"
                disabled={!canAnswer}
                onClick={() => props.onAnswer(false)}
              />
              <CallControl
                label="Accept video"
                icon="video"
                tone="accept"
                disabled={!canAnswer}
                onClick={() => props.onAnswer(true)}
              />
            </>
          ) : (
            <CallControl
              label="Answer"
              icon="phone"
              tone="accept"
              disabled={!canAnswer}
              onClick={() => props.onAnswer(false)}
            />
          )}
        </>
      ) : null}

      {phase === "outgoing-ringing" ? (
        <CallControl
          label="Cancel call"
          icon="phone"
          tone="end"
          hangup
          disabled={busy}
          onClick={props.onCancel}
        />
      ) : null}

      {active && call.isThisDeviceSelectedEndpoint ? (
        <>
          {hasMedia ? (
            <>
              <CallControl
                label={muted ? "Unmute" : "Mute"}
                icon={muted ? "micOff" : "mic"}
                tone={muted ? "warn" : "neutral"}
                onClick={props.onToggleMute}
              />
              {video ? (
                cameraOn ? (
                  <>
                    <CallControl
                      label="Turn camera off"
                      icon="video"
                      disabled={busy}
                      onClick={props.onCameraOff}
                    />
                    <CallControl
                      label="Switch camera"
                      icon="flip"
                      disabled={busy || cameraState === "switching"}
                      onClick={props.onSwitchCamera}
                    />
                  </>
                ) : (
                  <CallControl
                    label="Turn camera on"
                    icon="videoOff"
                    tone="warn"
                    disabled={busy || cameraState === "acquiring"}
                    onClick={props.onCameraOn}
                  />
                )
              ) : null}
              {props.autoplayBlocked ? (
                <CallControl
                  label="Tap to hear"
                  icon="speaker"
                  tone="accept"
                  onClick={props.onHearRemote}
                />
              ) : null}
            </>
          ) : props.canResume ? (
            <CallControl
              label="Resume call here"
              icon="phone"
              disabled={busy}
              onClick={props.onResume}
            />
          ) : null}
          <CallControl
            label="End call"
            icon="phone"
            tone="end"
            hangup
            disabled={busy}
            onClick={props.onEnd}
          />
        </>
      ) : null}

      {phase === "ended" ? (
        <>
          {call.outcome === "failed" ? (
            <CallControl
              label="Try again"
              icon={video ? "video" : "phone"}
              tone="accept"
              disabled={busy}
              onClick={props.onTryAgain}
            />
          ) : null}
          <CallControl label="Done" icon="check" disabled={busy} onClick={props.onDismiss} />
        </>
      ) : null}
    </>
  );

  const live = announcement(props, copy);
  const breathing =
    phase === "outgoing-ringing" || phase === "incoming-ringing" || phase === "connecting";

  const surface = (
    <div
      ref={surfaceRef}
      className={"call-surface force-midnight call-surface--" + (videoLayout ? "video" : "voice")}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      data-call-state={call.state}
      data-call-phase={phase}
      data-call-kind={call.kind}
      data-controls={videoLayout && !controlsVisible ? "hidden" : "visible"}
      onKeyDown={trapTab}
      onPointerDown={revealControls}
    >
      <p className="ds-sr-only" role="status" aria-live="polite">
        {live}
      </p>

      {videoLayout ? (
        <VideoSurface
          localStream={props.localVideo}
          remoteStream={props.remoteVideo}
          partnerName={partnerName}
          cameraState={cameraState}
        />
      ) : (
        <div
          className="call-ambience"
          data-breathing={breathing ? "true" : "false"}
          aria-hidden="true"
        />
      )}

      <div className="call-content">
        <header className={"call-head" + (videoLayout ? " call-head--overlay" : "")}>
          {copy.eyebrow ? <p className="call-eyebrow">{copy.eyebrow}</p> : null}
          {!videoLayout ? (
            <div className="call-portrait" data-breathing={breathing ? "true" : "false"}>
              {partnerName ? (
                <Avatar name={partnerName} size={144} />
              ) : (
                <span className="call-portrait__blank" aria-hidden="true">
                  <Icon name="us" size={56} />
                </span>
              )}
            </div>
          ) : null}
          <h2 ref={titleRef} id={titleId} className="call-title" tabIndex={-1}>
            {copy.title}
          </h2>
          <p id={statusId} className="call-status">
            {copy.status}
          </p>
          <CallTimer since={connectedSince} />
          {cameraNote ? <p className="call-note">{cameraNote}</p> : null}
          {badges}
          {!videoLayout && phase !== "ended" ? (
            <p className="call-privacy">Private relay calling</p>
          ) : null}
        </header>

        <div className="call-lower">
          {props.error ? <ErrorNotice>{props.error}</ErrorNotice> : null}
          <div className="call-bar" role="group" aria-label="Call controls">
            {controls}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(surface, document.body);
}
