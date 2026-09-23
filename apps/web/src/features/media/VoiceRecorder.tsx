import { useEffect, useRef, useState } from "react";

export function VoiceRecorder({
  disabled,
  onReady,
}: {
  disabled?: boolean;
  onReady: (blob: Blob, durationSeconds: number) => Promise<void> | void;
}) {
  const [state, setState] = useState<
    "idle" | "requesting" | "recording" | "preview" | "sending"
  >("idle");
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
    <div className="voice-recorder">
      {state === "idle" ? (
        <button type="button" className="secondary compact" disabled={disabled} onClick={() => void start()}>
          Record voice
        </button>
      ) : null}
      {state === "requesting" ? <span className="hint">Requesting microphone...</span> : null}
      {state === "recording" ? (
        <>
          <span className="hint">Recording...</span>
          <button type="button" className="secondary compact" onClick={stop}>Stop</button>
          <button type="button" className="link compact" onClick={cancelRecording}>Cancel</button>
        </>
      ) : null}
      {state === "preview" && preview ? (
        <div className="voice-preview">
          <audio controls preload="metadata" src={preview.url} />
          <span className="hint">Preview before sending · {preview.durationSeconds}s</span>
          <button type="button" className="primary compact" disabled={disabled} onClick={() => void sendPreview()}>
            Send voice
          </button>
          <button type="button" className="link compact" onClick={reset}>Discard</button>
        </div>
      ) : null}
      {state === "sending" ? <span className="hint">Preparing protected voice...</span> : null}
      {error ? <span className="banner error">{error}</span> : null}
    </div>
  );
}
