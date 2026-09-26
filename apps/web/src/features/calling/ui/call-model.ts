import type { CallProjection } from "@shawtie/contracts";

/**
 * Presentation-only model for the call surfaces. Everything here is derived from the existing
 * call projection and the local media state the panel already tracks. It introduces no call
 * state, no signaling, and no durable state.
 */
export type CallPhase =
  | "outgoing-ringing"
  | "incoming-ringing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "observer"
  | "elsewhere"
  | "ended";

export interface PhaseInput {
  readonly call: Pick<CallProjection, "state" | "direction" | "isThisDeviceSelectedEndpoint">;
  readonly mediaState: string;
  readonly hasMedia: boolean;
}

export function derivePhase({ call, mediaState, hasMedia }: PhaseInput): CallPhase {
  if (call.state === "ended") return "ended";
  if (call.state === "ringing") {
    return call.direction === "incoming" ? "incoming-ringing" : "outgoing-ringing";
  }
  if (!call.isThisDeviceSelectedEndpoint) return "elsewhere";
  if (mediaState === "observer") return "observer";
  if (!hasMedia) return "connecting";
  if (mediaState === "disconnected" || mediaState === "failed") return "reconnecting";
  if (mediaState === "connected" || mediaState === "muted") return "connected";
  return "connecting";
}

export interface PhaseCopy {
  /** Small line above the name (incoming calls). */
  readonly eyebrow: string | null;
  /** Heading of the surface; also the accessible name anchor. */
  readonly title: string;
  /** Quiet status line under the heading. */
  readonly status: string;
}

function who(name: string | null): string {
  return name ?? "your partner";
}

export function elapsedLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? hours + ":" + pad(minutes) + ":" + pad(seconds) : minutes + ":" + pad(seconds);
}

export function callDurationSeconds(
  call: Pick<CallProjection, "connectedAt" | "endedAt">,
): number | null {
  if (!call.connectedAt || !call.endedAt) return null;
  const seconds = (Date.parse(call.endedAt) - Date.parse(call.connectedAt)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null;
}

/** Calm, blame-free wording for how a call ended. */
export function endedCopy(
  call: Pick<CallProjection, "kind" | "direction" | "outcome" | "connectedAt" | "endedAt">,
  name: string | null,
): PhaseCopy {
  const title = call.kind === "video" ? "Video call ended" : "Call ended";
  const incoming = call.direction === "incoming";
  switch (call.outcome) {
    case "completed": {
      const duration = callDurationSeconds(call);
      return {
        eyebrow: null,
        title,
        status: duration === null ? "Call ended." : "Call lasted " + elapsedLabel(duration) + ".",
      };
    }
    case "rejected":
      return {
        eyebrow: null,
        title,
        status: incoming ? "You declined the call." : who(name) + " can't talk right now.",
      };
    case "cancelled":
      return {
        eyebrow: null,
        title,
        status: incoming
          ? who(name) + " ended the call before it was answered."
          : "Call cancelled.",
      };
    case "missed":
      return { eyebrow: null, title, status: incoming ? "Missed call." : "No answer." };
    case "failed":
      return {
        eyebrow: null,
        title: "Call ended",
        status: "Couldn't connect. Check your connection and try again.",
      };
    case "unavailable":
      return {
        eyebrow: null,
        title: "Call ended",
        status: "The call couldn't be placed right now. Try again in a moment.",
      };
    default:
      return { eyebrow: null, title, status: "Call ended." };
  }
}

export function phaseCopy(
  phase: CallPhase,
  call: Pick<CallProjection, "kind" | "direction" | "outcome" | "connectedAt" | "endedAt">,
  name: string | null,
): PhaseCopy {
  const video = call.kind === "video";
  switch (phase) {
    case "outgoing-ringing":
      return {
        eyebrow: null,
        title: (video ? "Video calling" : "Calling") + (name ? " " + name : "") + "...",
        status: "Waiting for an answer",
      };
    case "incoming-ringing":
      return {
        eyebrow: video ? "Incoming video call" : "Incoming voice call",
        title: name ?? "Incoming call",
        status: video ? "Answer with camera on, or with camera off." : "Ready when you are.",
      };
    case "connecting":
      return {
        eyebrow: null,
        title: name ?? "Call",
        status: video ? "Connecting video..." : "Connecting audio...",
      };
    case "connected":
      return {
        eyebrow: null,
        title: name ?? "Call",
        status: video ? "Video call connected" : "Connected",
      };
    case "reconnecting":
      return {
        eyebrow: null,
        title: name ?? "Call",
        status: "Reconnecting... you are still in the call.",
      };
    case "observer":
      return {
        eyebrow: null,
        title: name ?? "Call",
        status: "This call is open in another tab on this device.",
      };
    case "elsewhere":
      return {
        eyebrow: null,
        title: name ?? "Call",
        status: "This call is on another device.",
      };
    case "ended":
      return endedCopy(call, name);
  }
}

export function callDialogLabel(name: string | null): string {
  return name ? "Call with " + name : "Call";
}
