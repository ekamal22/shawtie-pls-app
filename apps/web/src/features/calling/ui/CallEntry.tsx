import { Avatar, Button, ErrorNotice } from "../../../design/primitives.tsx";

export type CallPushState = "unknown" | "enabled" | "denied" | "unavailable";

export interface CallEntryProps {
  readonly partnerName: string | null;
  readonly canStart: boolean;
  readonly waitingForSync: boolean;
  readonly error: string;
  readonly pushState: CallPushState;
  readonly pushBusy: boolean;
  readonly onVoice: () => void;
  readonly onVideo: () => void;
  readonly onEnableNotifications: () => void;
}

/** Idle presentation: two clear ways to call, and the notification opt-in. */
export function CallEntry({
  partnerName,
  canStart,
  waitingForSync,
  error,
  pushState,
  pushBusy,
  onVoice,
  onVideo,
  onEnableNotifications,
}: CallEntryProps) {
  return (
    <section className="call-entry" aria-labelledby="call-entry-title">
      <div className="call-entry__who">
        {partnerName ? <Avatar name={partnerName} size={48} /> : null}
        <div>
          <h2 id="call-entry-title" className="call-entry__title">
            {partnerName ? "Call " + partnerName : "Calls"}
          </h2>
          <p className="call-entry__hint">
            Private relay calling. Every call waits for an explicit answer.
          </p>
        </div>
      </div>
      <div className="call-entry__actions">
        <Button
          variant="secondary"
          icon="phone"
          className="call-entry__button"
          disabled={!canStart}
          data-call-entry=""
          onClick={onVoice}
        >
          Voice call
        </Button>
        <Button
          variant="primary"
          icon="video"
          className="call-entry__button"
          disabled={!canStart}
          onClick={onVideo}
        >
          Video call
        </Button>
      </div>
      {waitingForSync ? (
        <p className="call-entry__hint" role="status">
          Calling opens as soon as you're connected.
        </p>
      ) : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="call-entry__notify">
        <Button
          variant="quiet"
          compact
          disabled={pushBusy || pushState === "enabled"}
          onClick={onEnableNotifications}
        >
          {pushState === "enabled" ? "Call notifications enabled" : "Enable call notifications"}
        </Button>
        {pushState === "denied" ? (
          <span className="call-entry__hint">
            Background ringing is unavailable. Foreground calls still work.
          </span>
        ) : null}
      </div>
    </section>
  );
}
