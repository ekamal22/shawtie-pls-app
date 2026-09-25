import { useEffect, useRef, useState } from "react";
import { Button } from "../../design/primitives.tsx";

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes + ":" + String(seconds % 60).padStart(2, "0");
}

export function VoiceRecorder({
  disabled,
  onReady,
  autoStart = false,
  onIdle,
  onError,
}: {
  disabled?: boolean;
  onReady: (blob: Blob, durationSeconds: number) => Promise<void> | void;
  /** Start capturing as soon as the recorder mounts (Talk opens it from the composer). */
  autoStart?: boolean;
  /** Called when the recorder returns to idle after being active (finished, cancelled, or failed). */
  onIdle?: () => void;
  /** Called with a plain-language message whenever the recorder surfaces an error. */
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "preview" | "sending">(
    "idle",
  );
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    readonly blob: Blob;
    readonly durationSeconds: number;
    readonly url: string;
  } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  function stopCapture() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function clearPreview() {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  function reset() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    stopCapture();
    chunksRef.current = [];
    clearPreview();
    setState("idle");
  }

  function interruptRecording(message: string) {
    cancelRecording();
    setError(message);
  }

  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (state !== "idle") {
      wasActiveRef.current = true;
    } else if (wasActiveRef.current) {
      wasActiveRef.current = false;
      onIdle?.();
    }
  }, [onIdle, state]);

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void start();
    // start() is intentionally captured once; it only reads refs and setters.
  }, [autoStart]);

  // Display-only elapsed clock. The capture and the ten-minute stop live in start().
  useEffect(() => {
    if (state !== "recording") return undefined;
    setElapsedSeconds(0);
    const tick = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1_000,
    );
    return () => window.clearInterval(tick);
  }, [state]);

  // A recording must never keep capturing while the page is hidden (app switch,
  // screen lock, tab switch). Cleanup is deterministic and nothing is uploaded.
  useEffect(() => {
    if (state !== "recording") return undefined;
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        interruptRecording(
          "Recording stopped because the app moved to the background. Nothing was saved.",
        );
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
    };
  }, [state]);

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      stopCapture();
      chunksRef.current = [];
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function start() {
    setError("");
    clearPreview();
    setState("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Voice recording is not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => finishStopped(recorder.mimeType);
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (recorderRef.current === recorder) {
            interruptRecording("The microphone was interrupted. Nothing was saved.");
          }
        };
      });
      startedAtRef.current = Date.now();
      recorder.start(1_000);
      setState("recording");
      timerRef.current = window.setTimeout(() => stop(), 10 * 60_000);
    } catch (caught) {
      stopCapture();
      chunksRef.current = [];
      setState("idle");
      setError(caught instanceof Error ? caught.message : "Microphone unavailable.");
    }
  }

  function finishStopped(mimeType: string) {
    const durationSeconds = Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000));
    const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
    stopCapture();
    chunksRef.current = [];
    const url = URL.createObjectURL(blob);
    setPreview({ blob, durationSeconds, url });
    setState("preview");
  }

  function stop() {
    if (recorderRef.current?.state === "recording") {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      recorderRef.current.stop();
    }
  }

  function cancelRecording() {
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
    }
    stopCapture();
    chunksRef.current = [];
    setState("idle");
  }

  async function sendPreview() {
    if (!preview) return;
    setError("");
    setState("sending");
    try {
      await onReady(preview.blob, preview.durationSeconds);
      clearPreview();
      setState("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Voice message failed.");
      setState("preview");
    }
  }

  return (
    <div className="voice-recorder talk-voice" data-state={state}>
      {state === "idle" ? (
        <Button variant="secondary" icon="mic" disabled={disabled} onClick={() => void start()}>
          Record voice
        </Button>
      ) : null}
      {state === "requesting" ? (
        <span className="hint" role="status">
          Requesting microphone...
        </span>
      ) : null}
      {state === "recording" ? (
        <>
          <span className="talk-voice__live" role="status">
            <span className="talk-voice__dot" aria-hidden="true" />
            Recording {formatElapsed(elapsedSeconds)}
          </span>
          <Button variant="primary" onClick={stop}>
            Stop
          </Button>
          <Button variant="quiet" onClick={cancelRecording}>
            Cancel
          </Button>
        </>
      ) : null}
      {state === "preview" && preview ? (
        <div className="voice-preview talk-voice__preview">
          <audio controls preload="metadata" src={preview.url} aria-label="Voice message preview" />
          <span className="hint">Preview before sending · {preview.durationSeconds}s</span>
          <div className="talk-voice__actions">
            <Button
              variant="primary"
              icon="send"
              disabled={disabled}
              onClick={() => void sendPreview()}
            >
              Send voice
            </Button>
            <Button variant="quiet" onClick={reset}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      {state === "sending" ? (
        <span className="hint" role="status">
          Preparing voice message...
        </span>
      ) : null}
      {error ? (
        <span className="talk-voice__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
