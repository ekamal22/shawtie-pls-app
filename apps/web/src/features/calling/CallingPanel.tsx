import { useEffect, useRef, useState } from "react";
import type { CallProjection } from "@shawtie/contracts";
import { ApiClientError } from "../../lib/api-client.ts";
import {
  useM2Runtime,
  useM2SyncStatus,
} from "../../lib/realtime/runtime-context.tsx";
import {
  acceptCall,
  cancelCall,
  createCall,
  endCall,
  failCall,
  fetchCall,
  fetchCurrentCall,
  rejectCall,
} from "./api.ts";
import { CallMediaSession } from "./media-controller.ts";
import { reconcileCallPushSubscription } from "./push.ts";

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied.";
  }
  if (error instanceof ApiClientError) {
    const messages: Record<string, string> = {
      CALL_IN_PROGRESS: "A call is already in progress.",
      CALL_ANSWERED_ELSEWHERE: "This call was answered on another device.",
      CALL_NOT_RINGING: "This call is no longer ringing.",
      CALL_ACTION_NOT_ALLOWED: "That call action is no longer available.",
      CALL_TRANSPORT_UNAVAILABLE: "Private relay calling is temporarily unavailable.",
      CALLING_UNAVAILABLE: "Calling is temporarily unavailable.",
      CALLING_NOT_ALLOWED: "Calling is not available in the current relationship state.",
      VERSION_CONFLICT: "The call changed on another device. Refreshing...",
    };
    return messages[error.code] ?? "The call could not be updated.";
  }
  if (error instanceof Error && error.message === "CALL_ACTIVE_IN_ANOTHER_TAB") {
    return "This call is already active in another tab on this device.";
  }
  return error instanceof Error ? error.message : "Call operation failed.";
}

async function microphone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

export function CallingPanel({
  deviceId,
}: {
  readonly deviceId: string | null;
}) {
  const runtime = useM2Runtime();
  const syncStatus = useM2SyncStatus();
  const [call, setCall] = useState<CallProjection | null>(null);
  const callRef = useRef<CallProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mediaState, setMediaState] = useState<string>("idle");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [pushState, setPushState] = useState<
    "unknown" | "enabled" | "denied" | "unavailable"
  >("unknown");
  const mediaRef = useRef<CallMediaSession | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);

  function updateCall(next: CallProjection | null): void {
    callRef.current = next;
    setCall(next);
  }

  async function stopMedia(): Promise<void> {
    const media = mediaRef.current;
    mediaRef.current = null;
    if (media) await media.stop();
    const pending = pendingStreamRef.current;
    pendingStreamRef.current = null;
    pending?.getTracks().forEach((track) => track.stop());
    setMediaState("idle");
    setAutoplayBlocked(false);
  }

  async function synchronize(): Promise<void> {
    try {
      const current = await fetchCurrentCall();
      if (current.call) {
        updateCall(current.call);
        if (
          mediaRef.current
          && (
            current.call.id !== mediaRef.current.callId
            || current.call.state === "ended"
            || !current.call.isThisDeviceSelectedEndpoint
          )
        ) {
          await stopMedia();
        }
        return;
      }

      const previous = callRef.current;
      if (previous && previous.state !== "ended") {
        try {
          const detail = await fetchCall(previous.id);
          updateCall(detail);
          if (detail.state === "ended") await stopMedia();
          return;
        } catch (detailError) {
          if (!(detailError instanceof ApiClientError) || detailError.status !== 404) {
            throw detailError;
          }
        }
      }
      if (!previous || previous.state !== "ended") updateCall(null);
      await stopMedia();
    } catch (syncError) {
      if (syncError instanceof ApiClientError && syncError.status === 401) {
        await stopMedia();
      }
      throw syncError;
    }
  }

  useEffect(() => {
    const unregister = runtime.registerSynchronizer("c1-call", async () => {
      await synchronize();
    });
    const changed = () => {
      runtime.coordinator.markDirty();
      void runtime.coordinator.requestSync();
    };
    const workerMessage = (event: MessageEvent) => {
      if (event.data?.type === "C1_CALL_NOTIFICATION_CLICK") changed();
    };
    window.addEventListener("shawtie:call-changed", changed);
    window.addEventListener("shawtie:partnership-changed", changed);
    window.addEventListener("shawtie:security-changed", changed);
    navigator.serviceWorker?.addEventListener("message", workerMessage);
    runtime.coordinator.markDirty();
    void runtime.coordinator.requestSync();

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void reconcileCallPushSubscription(false).then(setPushState).catch(() => {
        setPushState("unavailable");
      });
    }

    return () => {
      unregister();
      window.removeEventListener("shawtie:call-changed", changed);
      window.removeEventListener("shawtie:partnership-changed", changed);
      window.removeEventListener("shawtie:security-changed", changed);
      navigator.serviceWorker?.removeEventListener("message", workerMessage);
      void stopMedia();
    };
  }, [runtime]);

  async function run(operation: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (operationError) {
      setError(errorMessage(operationError));
      if (operationError instanceof ApiClientError && operationError.code === "VERSION_CONFLICT") {
        runtime.coordinator.markDirty();
        await runtime.coordinator.requestSync();
      }
    } finally {
      setBusy(false);
    }
  }

  async function startMedia(
    current: CallProjection,
    stream?: MediaStream,
  ): Promise<void> {
    if (!deviceId) throw new Error("This session has no callable device.");
    if (mediaRef.current?.callId === current.id) return;
    if (current.state !== "accepted" && current.state !== "connected") {
      throw new Error("The call must be accepted before audio starts.");
    }
    if (!current.isThisDeviceSelectedEndpoint) {
      throw new Error("This call is active on another device.");
    }

    const local = stream ?? (await microphone());
    if (pendingStreamRef.current === local) pendingStreamRef.current = null;
    const media = new CallMediaSession(current.id, deviceId, local, {
      onState: (state) => setMediaState(state),
      onAutoplayBlocked: setAutoplayBlocked,
      onOwnershipLost: () => {
        mediaRef.current = null;
        setMediaState("observer");
        setError("Audio moved to another tab on this device.");
      },
      onUnrecoverableFailure: (category) => {
        const latest = callRef.current;
        if (
          !latest
          || latest.id !== current.id
          || !latest.isThisDeviceSelectedEndpoint
          || (latest.state !== "accepted" && latest.state !== "connected")
        ) {
          return;
        }
        void failCall(latest.id, latest.version, category)
          .then(async (ended) => {
            updateCall(ended);
            await stopMedia();
          })
          .catch((failureError) => {
            setError(errorMessage(failureError));
            runtime.coordinator.markDirty();
            void runtime.coordinator.requestSync();
          });
      },
      onError: setError,
    });
    mediaRef.current = media;
    try {
      await media.start();
    } catch (mediaError) {
      if (mediaRef.current === media) mediaRef.current = null;
      await media.stop().catch(() => undefined);
      throw mediaError;
    }
  }

  async function startOutgoing(): Promise<void> {
    const partnershipId = runtime.realtime.scope.partnershipId;
    if (!partnershipId) throw new Error("No current partnership.");
    if (syncStatus !== "live") throw new Error("Calling is waiting for realtime sync.");
    if (!navigator.onLine) throw new Error("Calls are unavailable while offline.");
    const stream = await microphone();
    pendingStreamRef.current = stream;
    try {
      const created = await createCall(partnershipId);
      updateCall(created);
    } catch (createError) {
      pendingStreamRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      throw createError;
    }
  }

  async function acceptIncoming(): Promise<void> {
    if (!call) return;
    if (syncStatus !== "live") throw new Error("Calling is waiting for realtime sync.");
    const stream = await microphone();
    try {
      const accepted = await acceptCall(call.id, call.version);
      updateCall(accepted);
      await startMedia(accepted, stream);
    } catch (acceptError) {
      stream.getTracks().forEach((track) => track.stop());
      throw acceptError;
    }
  }

  useEffect(() => {
    if (
      !call
      || mediaRef.current
      || !pendingStreamRef.current
      || !call.isThisDeviceSelectedEndpoint
      || (call.state !== "accepted" && call.state !== "connected")
    ) {
      return;
    }
    const stream = pendingStreamRef.current;
    void startMedia(call, stream).catch((mediaError) => {
      pendingStreamRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      setError(errorMessage(mediaError));
    });
  }, [call?.id, call?.state, call?.version, call?.isThisDeviceSelectedEndpoint]);

  const outgoing = call?.direction === "outgoing";
  const incoming = call?.direction === "incoming";
  const ringing = call?.state === "ringing";
  const active = call?.state === "accepted" || call?.state === "connected";
  const canOwnMedia = Boolean(active && call?.isThisDeviceSelectedEndpoint && deviceId);

  return (
    <section className="panel" aria-live="polite">
      <div className="row between">
        <div>
          <h2>Voice call</h2>
          <p className="hint">
            Calls use relay-only WebRTC and require an explicit answer.
          </p>
        </div>
        {!call || call.state === "ended" ? (
          <button
            className="primary"
            disabled={
              busy
              || syncStatus !== "live"
              || !deviceId
              || !runtime.realtime.scope.partnershipId
            }
            onClick={() => void run(startOutgoing)}
          >
            Call
          </button>
        ) : null}
      </div>

      {error ? <p className="banner error">{error}</p> : null}

      {call && call.state !== "ended" ? (
        <div className="stack">
          <p>
            <strong>
              {ringing
                ? outgoing
                  ? "Calling..."
                  : "Incoming voice call"
                : call.state === "connected"
                  ? "Connected"
                  : "Connecting audio..."}
            </strong>
          </p>
          <p className="hint">
            {mediaState === "observer"
              ? "Audio is active in another tab."
              : mediaState !== "idle"
                ? "Media: " + mediaState
                : call.isThisDeviceSelectedEndpoint
                  ? "This device is selected for the call."
                  : "Another device is handling this call."}
          </p>

          <div className="row">
            {incoming && ringing ? (
              <>
                <button
                  className="primary"
                  disabled={busy || syncStatus !== "live" || !deviceId}
                  onClick={() => void run(acceptIncoming)}
                >
                  Accept
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const ended = await rejectCall(call.id, call.version);
                      updateCall(ended);
                      await stopMedia();
                    })
                  }
                >
                  Reject
                </button>
              </>
            ) : null}

            {outgoing && ringing ? (
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const ended = await cancelCall(call.id, call.version);
                    updateCall(ended);
                    await stopMedia();
                  })
                }
              >
                Cancel
              </button>
            ) : null}

            {canOwnMedia && !mediaRef.current ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void run(async () => startMedia(call))}
              >
                Resume audio here
              </button>
            ) : null}

            {active && call.isThisDeviceSelectedEndpoint ? (
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const ended = await endCall(call.id, call.version);
                    updateCall(ended);
                    await stopMedia();
                  })
                }
              >
                End call
              </button>
            ) : null}
          </div>

          {mediaRef.current ? (
            <div className="row">
              <button
                className="secondary compact"
                onClick={() => {
                  const media = mediaRef.current;
                  if (!media) return;
                  media.setMuted(!media.muted);
                  setMediaState(media.muted ? "muted" : "connected");
                }}
              >
                {mediaRef.current.muted ? "Unmute" : "Mute"}
              </button>
              {autoplayBlocked ? (
                <button
                  className="primary compact"
                  onClick={() => void mediaRef.current?.resumeRemoteAudio()}
                >
                  Tap to hear
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {call?.state === "ended" ? (
        <div className="stack">
          <p>
            <strong>Call ended</strong>
            {call.outcome ? " · " + call.outcome : ""}
          </p>
          <button className="secondary compact" onClick={() => updateCall(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="row">
        <button
          className="secondary compact"
          disabled={busy || pushState === "enabled"}
          onClick={() =>
            void run(async () => {
              const state = await reconcileCallPushSubscription(true);
              setPushState(state);
            })
          }
        >
          {pushState === "enabled" ? "Call notifications enabled" : "Enable call notifications"}
        </button>
        {pushState === "denied" ? (
          <span className="hint">Background ringing is unavailable. Foreground calls still work.</span>
        ) : null}
      </div>
    </section>
  );
}
