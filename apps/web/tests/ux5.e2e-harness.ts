import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CallProjection } from "@shawtie/contracts";
import "../src/design/tokens.css";
import "../src/design/design.css";
import "../src/styles.css";
import "../src/features/calling/calling.css";
import type { CameraState } from "../src/features/calling/camera-controller.ts";
import { CallSurface, type CallSurfaceProps } from "../src/features/calling/ui/CallSurface.tsx";
import { derivePhase } from "../src/features/calling/ui/call-model.ts";

/**
 * Presentation-only harness: renders CallSurface with fixed props so browser tests can inspect
 * connected, muted, reconnecting, and camera states that need live media in the real app.
 */
export interface HarnessScenario {
  readonly kind: "voice" | "video";
  readonly direction?: "incoming" | "outgoing";
  readonly state?: CallProjection["state"];
  readonly outcome?: CallProjection["outcome"];
  readonly mediaState?: string;
  readonly cameraState?: CameraState;
  readonly muted?: boolean;
  readonly hasMedia?: boolean;
  readonly remote?: boolean;
  readonly local?: boolean;
  readonly partnerName?: string | null;
  readonly error?: string;
  readonly selected?: boolean;
}

const log: string[] = [];
let root: Root | null = null;

function syntheticStream(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  context?.fillRect(0, 0, 64, 48);
  return canvas.captureStream(5);
}

function render(scenario: HarnessScenario): void {
  const host = document.getElementById("host") as HTMLElement;
  root?.unmount();
  root = createRoot(host);
  const state = scenario.state ?? "connected";
  const call: CallProjection = {
    id: "11111111-1111-4111-8111-111111111111",
    partnershipId: "22222222-2222-4222-8222-222222222222",
    kind: scenario.kind,
    direction: scenario.direction ?? "outgoing",
    state,
    version: 3,
    initiatedAt: "2026-01-01T10:00:00.000Z",
    ringExpiresAt: null,
    acceptedAt: state === "ringing" ? null : "2026-01-01T10:00:05.000Z",
    connectedAt:
      state === "connected" || state === "ended"
        ? new Date(Date.now() - 754_000).toISOString()
        : null,
    endedAt: state === "ended" ? "2026-01-01T10:12:39.000Z" : null,
    outcome: scenario.outcome ?? null,
    isThisDeviceSelectedEndpoint: scenario.selected ?? true,
  };
  const hasMedia = scenario.hasMedia ?? true;
  const mediaState = scenario.mediaState ?? "connected";
  const noop = (name: string) => () => {
    log.push(name);
  };
  const props: CallSurfaceProps = {
    call,
    partnerName: scenario.partnerName === undefined ? "Maya" : scenario.partnerName,
    phase: derivePhase({ call, mediaState, hasMedia }),
    cameraState: scenario.cameraState ?? "off",
    muted: scenario.muted ?? false,
    hasMedia,
    canResume: !hasMedia,
    busy: false,
    canAnswer: true,
    error: scenario.error ?? "",
    localVideo: scenario.local ? syntheticStream() : null,
    remoteVideo: scenario.remote ? syntheticStream() : null,
    autoplayBlocked: false,
    onAnswer: (camera) => log.push("answer:" + camera),
    onDecline: noop("decline"),
    onCancel: noop("cancel"),
    onEnd: noop("end"),
    onResume: noop("resume"),
    onToggleMute: noop("mute"),
    onCameraOn: noop("camera-on"),
    onCameraOff: noop("camera-off"),
    onSwitchCamera: noop("switch"),
    onHearRemote: noop("hear"),
    onDismiss: () => {
      log.push("dismiss");
      root?.unmount();
      root = null;
    },
    onTryAgain: noop("try-again"),
  };
  root.render(createElement(CallSurface, props));
}

declare global {
  interface Window {
    ux5Harness: {
      render: (scenario: HarnessScenario) => void;
      log: () => string[];
    };
  }
}

window.ux5Harness = { render, log: () => [...log] };
(document.getElementById("status") as HTMLElement).textContent = "ready";
