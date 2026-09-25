import { useEffect, useRef, useState } from "react";
import type { CallProjection } from "@shawtie/contracts";
import { ApiClientError } from "../../lib/api-client.ts";
import {
  partnerDisplayName,
  useConversationContext,
} from "../../app/shell/useConversationContext.ts";
import { useM2Runtime, useM2SyncStatus } from "../../lib/realtime/runtime-context.tsx";
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
import type { CameraState } from "./camera-controller.ts";
import { CallMediaSession } from "./media-controller.ts";
import { reconcileCallPushSubscription } from "./push.ts";
import { CallEntry } from "./ui/CallEntry.tsx";
import { CallSurface } from "./ui/CallSurface.tsx";
import { derivePhase } from "./ui/call-model.ts";
import "./calling.css";

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
      FEATURE_NOT_AVAILABLE: "Video calling is temporarily unavailable.",
      CALL_MEDIA_PROFILE_UNSUPPORTED: "Update Shawtie pls to use video calling.",
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

export function CallingPanel({ deviceId }: { readonly deviceId: string | null }) {
  const runtime = useM2Runtime();
  const syncStatus = useM2SyncStatus();
  const [call, setCall] = useState<CallProjection | null>(null);
  const callRef = useRef<CallProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mediaState, setMediaState] = useState<string>("idle");
  const [cameraState, setCameraState] = useState<CameraState>("off");
  const [localVideo, setLocalVideo] = useState<MediaStream | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<MediaStream | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [pushState, setPushState] = useState<"unknown" | "enabled" | "denied" | "unavailable">(
    "unknown",
  );
  const mediaRef = useRef<CallMediaSession | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const pendingCameraIntentRef = useRef(false);

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
    pendingCameraIntentRef.current = false;
    pending?.getTracks().forEach((track) => track.stop());
    setLocalVideo(null);
    setRemoteVideo(null);
    setCameraState("off");
    setMediaState("idle");
    setAutoplayBlocked(false);
  }

  async function synchronize(): Promise<void> {
    try {
      const current = await fetchCurrentCall();
      if (current.call) {
        updateCall(current.call);
        if (
          mediaRef.current &&
          (current.call.id !== mediaRef.current.callId ||
            current.call.state === "ended" ||
            !current.call.isThisDeviceSelectedEndpoint)
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
      if (event.data?.type === "C1_CALL_NOTIFICATION_CLICK") {
        changed();
        return;
      }
      if (event.data?.type === "C1_PUSH_SUBSCRIPTION_CHANGED") {
        void reconcileCallPushSubscription(false)
          .then(setPushState)
          .catch(() => setPushState("unavailable"));
      }
    };
    window.addEventListener("shawtie:call-changed", changed);
    window.addEventListener("shawtie:partnership-changed", changed);
    window.addEventListener("shawtie:security-changed", changed);
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") {
        pendingCameraIntentRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    navigator.serviceWorker?.addEventListener("message", workerMessage);
    runtime.coordinator.markDirty();
    void runtime.coordinator.requestSync();

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void reconcileCallPushSubscription(false)
        .then(setPushState)
        .catch(() => setPushState("unavailable"));
    }

    return () => {
      unregister();
      window.removeEventListener("shawtie:call-changed", changed);
      window.removeEventListener("shawtie:partnership-changed", changed);
      window.removeEventListener("shawtie:security-changed", changed);
      document.removeEventListener("visibilitychange", visibilityChanged);
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
    cameraIntent = false,
  ): Promise<void> {
    if (!deviceId) throw new Error("This session has no callable device.");
    if (mediaRef.current?.callId === current.id) {
      if (cameraIntent && current.kind === "video") await mediaRef.current.enableCamera();
      return;
    }
    if (current.state !== "accepted" && current.state !== "connected") {
      throw new Error("The call must be accepted before media starts.");
    }
    if (!current.isThisDeviceSelectedEndpoint) {
      throw new Error("This call is active on another device.");
    }

    const local = stream ?? (await microphone());
    if (pendingStreamRef.current === local) pendingStreamRef.current = null;
    const media = new CallMediaSession(current.id, deviceId, local, current.kind, {
      onState: (state) => setMediaState(state),
      onAutoplayBlocked: setAutoplayBlocked,
      onCameraState: setCameraState,
      onLocalVideoStream: setLocalVideo,
      onRemoteVideoStream: setRemoteVideo,
      onOwnershipLost: () => {
        mediaRef.current = null;
        pendingCameraIntentRef.current = false;
        setLocalVideo(null);
        setRemoteVideo(null);
        setCameraState("off");
        setMediaState("observer");
        setError("Media moved to another tab on this device.");
      },
      onUnrecoverableFailure: (category) => {
        const latest = callRef.current;
        if (
          !latest ||
          latest.id !== current.id ||
          !latest.isThisDeviceSelectedEndpoint ||
          (latest.state !== "accepted" && latest.state !== "connected")
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
      if (cameraIntent && current.kind === "video") {
        pendingCameraIntentRef.current = false;
        if (document.visibilityState === "visible") {
          await media.enableCamera();
        }
      }
    } catch (mediaError) {
      if (mediaRef.current === media) mediaRef.current = null;
      await media.stop().catch(() => undefined);
      throw mediaError;
    }
  }

  async function startOutgoing(kind: "voice" | "video"): Promise<void> {
    const partnershipId = runtime.realtime.scope.partnershipId;
    if (!partnershipId) throw new Error("No current partnership.");
    if (syncStatus !== "live") throw new Error("Calling is waiting for realtime sync.");
    if (!navigator.onLine) throw new Error("Calls are unavailable while offline.");
    const stream = await microphone();
    pendingStreamRef.current = stream;
    pendingCameraIntentRef.current = kind === "video";
    try {
      const created = await createCall(partnershipId, kind);
      updateCall(created);
    } catch (createError) {
      pendingStreamRef.current = null;
      pendingCameraIntentRef.current = false;
      stream.getTracks().forEach((track) => track.stop());
      throw createError;
    }
  }

  async function acceptIncoming(cameraIntent: boolean): Promise<void> {
    if (!call) return;
    if (syncStatus !== "live") throw new Error("Calling is waiting for realtime sync.");
    const stream = await microphone();
    try {
      const accepted = await acceptCall(call.id, call.version, call.kind);
      updateCall(accepted);
      await startMedia(accepted, stream, call.kind === "video" && cameraIntent);
    } catch (acceptError) {
      stream.getTracks().forEach((track) => track.stop());
      throw acceptError;
    }
  }

  useEffect(() => {
    if (
      !call ||
      mediaRef.current ||
      !pendingStreamRef.current ||
      !call.isThisDeviceSelectedEndpoint ||
      (call.state !== "accepted" && call.state !== "connected")
    ) {
      return;
    }
    const stream = pendingStreamRef.current;
    const cameraIntent = pendingCameraIntentRef.current && call.kind === "video";
    void startMedia(call, stream, cameraIntent).catch((mediaError) => {
      pendingStreamRef.current = null;
      pendingCameraIntentRef.current = false;
      stream.getTracks().forEach((track) => track.stop());
      setError(errorMessage(mediaError));
    });
  }, [call?.id, call?.kind, call?.state, call?.version, call?.isThisDeviceSelectedEndpoint]);

  const partnerContext = useConversationContext();
  const partnerName = partnerContext ? partnerDisplayName(partnerContext) : null;

  const active = call?.state === "accepted" || call?.state === "connected";
  const canOwnMedia = Boolean(active && call?.isThisDeviceSelectedEndpoint && deviceId);
  const canStart =
    !busy &&
    syncStatus === "live" &&
    Boolean(deviceId) &&
    Boolean(runtime.realtime.scope.partnershipId);
  const showEntry = !call;
  const surfacePhase = call
    ? derivePhase({ call, mediaState, hasMedia: mediaRef.current !== null })
    : null;

  return (
    <section
      className={"call-panel" + (call ? " call-panel--surface" : "")}
      data-call-state={call?.state ?? "idle"}
    >
      {showEntry ? (
        <CallEntry
          partnerName={partnerName}
          canStart={canStart}
          waitingForSync={syncStatus !== "live"}
          error={error}
          pushState={pushState}
          pushBusy={busy}
          onVoice={() => void run(async () => startOutgoing("voice"))}
          onVideo={() => void run(async () => startOutgoing("video"))}
          onEnableNotifications={() =>
            void run(async () => {
              const state = await reconcileCallPushSubscription(true);
              setPushState(state);
            })
          }
        />
      ) : null}

      {call && surfacePhase ? (
        <CallSurface
          call={call}
          partnerName={partnerName}
          phase={surfacePhase}
          cameraState={cameraState}
          muted={mediaRef.current?.muted ?? false}
          hasMedia={mediaRef.current !== null}
          canResume={canOwnMedia && !mediaRef.current}
          busy={busy}
          canAnswer={!busy && syncStatus === "live" && Boolean(deviceId)}
          error={error}
          localVideo={localVideo}
          remoteVideo={remoteVideo}
          autoplayBlocked={autoplayBlocked}
          onAnswer={(cameraIntent) => void run(async () => acceptIncoming(cameraIntent))}
          onDecline={() =>
            void run(async () => {
              const ended = await rejectCall(call.id, call.version);
              updateCall(ended);
              await stopMedia();
            })
          }
          onCancel={() =>
            void run(async () => {
              const ended = await cancelCall(call.id, call.version);
              updateCall(ended);
              await stopMedia();
            })
          }
          onEnd={() =>
            void run(async () => {
              const ended = await endCall(call.id, call.version);
              updateCall(ended);
              await stopMedia();
            })
          }
          onResume={() => void run(async () => startMedia(call, undefined, false))}
          onToggleMute={() => {
            const currentMedia = mediaRef.current;
            if (!currentMedia) return;
            currentMedia.setMuted(!currentMedia.muted);
            setMediaState(currentMedia.muted ? "muted" : "connected");
          }}
          onCameraOn={() => void run(async () => void (await mediaRef.current?.enableCamera()))}
          onCameraOff={() => void run(async () => mediaRef.current?.disableCamera())}
          onSwitchCamera={() => void run(async () => void (await mediaRef.current?.switchCamera()))}
          onHearRemote={() => void mediaRef.current?.resumeRemoteAudio()}
          onDismiss={() => updateCall(null)}
          onTryAgain={() => {
            updateCall(null);
            void run(async () => startOutgoing(call.kind));
          }}
        />
      ) : null}
    </section>
  );
}
