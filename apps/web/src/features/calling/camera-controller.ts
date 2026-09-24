export type CameraFacingMode = "user" | "environment";
export type CameraState = "off" | "acquiring" | "on" | "switching" | "unavailable";

export interface CameraControllerCallbacks {
  readonly verifyAuthority: () => Promise<boolean>;
  readonly onState: (state: CameraState) => void;
  readonly onLocalStream: (stream: MediaStream | null) => void;
  readonly onError: (message: string) => void;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function preferredConstraints(
  facingMode: CameraFacingMode,
  exactFacing: boolean,
): readonly MediaTrackConstraints[] {
  const facingModeConstraint = exactFacing ? { exact: facingMode } : { ideal: facingMode };
  return [
    {
      facingMode: facingModeConstraint,
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 24, max: 30 },
    },
    {
      facingMode: facingModeConstraint,
      frameRate: { ideal: 24, max: 30 },
    },
    {
      facingMode: facingModeConstraint,
      frameRate: { max: 30 },
    },
  ];
}

export class CameraController {
  #generation = 0;
  #stream: MediaStream | null = null;
  #facingMode: CameraFacingMode = "user";
  #state: CameraState = "off";
  #stopped = false;

  constructor(
    private readonly sender: RTCRtpSender,
    private readonly callbacks: CameraControllerCallbacks,
  ) {}

  get state(): CameraState {
    return this.#state;
  }

  get facingMode(): CameraFacingMode {
    return this.#facingMode;
  }

  get stream(): MediaStream | null {
    return this.#stream;
  }

  async enable(
    facingMode: CameraFacingMode = this.#facingMode,
    exactFacing = false,
  ): Promise<boolean> {
    if (this.#stopped) return false;
    const generation = ++this.#generation;
    this.#setState(this.#stream ? "switching" : "acquiring");

    if (!(await this.#hasAuthority()) || generation !== this.#generation || this.#stopped) {
      this.#setState(this.#stream ? "on" : "off");
      return false;
    }

    let acquired: MediaStream | null = null;
    let lastError: unknown = null;
    for (const constraints of preferredConstraints(facingMode, exactFacing)) {
      try {
        acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
        break;
      } catch (error) {
        lastError = error;
        if (!(error instanceof DOMException) || error.name !== "OverconstrainedError") break;
      }
    }

    if (!acquired) {
      if (generation === this.#generation && !this.#stopped) {
        this.#setState("unavailable");
        if (lastError instanceof DOMException && lastError.name === "NotAllowedError") {
          this.callbacks.onError("Camera permission was denied. Audio can continue.");
        } else {
          this.callbacks.onError("Camera is unavailable. Audio can continue.");
        }
      }
      return false;
    }

    const track = acquired.getVideoTracks()[0] ?? null;
    const authorized =
      track !== null &&
      generation === this.#generation &&
      !this.#stopped &&
      (await this.#hasAuthority());
    if (!authorized || !track) {
      stopStream(acquired);
      if (generation === this.#generation && !this.#stopped) this.#setState("off");
      return false;
    }

    track.addEventListener(
      "ended",
      () => {
        if (this.#stream?.getVideoTracks()[0] !== track) return;
        void this.disable();
      },
      { once: true },
    );

    const previous = this.#stream;
    try {
      await this.sender.replaceTrack(track);
    } catch (error) {
      stopStream(acquired);
      if (generation === this.#generation && !this.#stopped) {
        this.#setState(previous ? "on" : "unavailable");
        this.callbacks.onError(error instanceof Error ? error.message : "Camera could not start.");
      }
      return false;
    }

    if (generation !== this.#generation || this.#stopped) {
      await this.sender.replaceTrack(null).catch(() => undefined);
      stopStream(acquired);
      return false;
    }

    this.#stream = acquired;
    this.#facingMode = facingMode;
    stopStream(previous);
    this.callbacks.onLocalStream(acquired);
    this.#setState("on");
    return true;
  }

  async disable(): Promise<void> {
    ++this.#generation;
    const previous = this.#stream;
    this.#stream = null;
    await this.sender.replaceTrack(null).catch(() => undefined);
    stopStream(previous);
    this.callbacks.onLocalStream(null);
    if (!this.#stopped) this.#setState("off");
  }

  async switchFacingMode(): Promise<boolean> {
    if (this.#stopped) return false;
    const next: CameraFacingMode = this.#facingMode === "user" ? "environment" : "user";
    await this.disable();
    return this.enable(next, true);
  }

  async invalidate(): Promise<void> {
    ++this.#generation;
    await this.disable();
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    ++this.#generation;
    const previous = this.#stream;
    this.#stream = null;
    await this.sender.replaceTrack(null).catch(() => undefined);
    stopStream(previous);
    this.callbacks.onLocalStream(null);
    this.#setState("off");
  }

  async #hasAuthority(): Promise<boolean> {
    try {
      return await this.callbacks.verifyAuthority();
    } catch {
      return false;
    }
  }

  #setState(state: CameraState): void {
    this.#state = state;
    this.callbacks.onState(state);
  }
}
