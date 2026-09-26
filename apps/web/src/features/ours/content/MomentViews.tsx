import { useState } from "react";
import { Button, ErrorNotice, Notice, Sheet } from "../../../design/primitives.tsx";
import { createRelationshipItem } from "../../relationship-space/api.ts";
import { MediaAttachment } from "../../media/MediaAttachment.tsx";
import { ItemFeedback, ItemMenu, useItemActions } from "./actions.tsx";
import { useRelationshipItems } from "./data.ts";
import { messageFor, queuedMutation } from "./errors.ts";
import {
  buildSequencePages,
  buildSignalPayload,
  isCreator,
  itemHeading,
  readString,
  sealInfo,
  SIGNAL_OPTIONS,
  signalLabel,
  type RelationshipItem,
  type SignalKind,
} from "./model.ts";
import { cx, ListState, SealedBand, ViewHeader, whenLabel } from "./parts.tsx";
import type { ContentViewProps } from "./types.ts";

/**
 * Paced player over the existing sequence payload (intro, text steps, and any media
 * references). Progress is presentation state only; nothing is stored. Buttons and arrow
 * keys both turn pages, and reduced motion turns each page change into a crossfade.
 */
export function SequencePlayer({
  item,
  framing,
}: {
  readonly item: RelationshipItem;
  readonly framing: "surprise" | "proposal";
}) {
  const pages = buildSequencePages(item);
  const [index, setIndex] = useState(0);
  const total = pages.length;
  const lastIndex = total; // one closing page after the last step
  const safe = Math.min(index, lastIndex);
  const go = (delta: number) => setIndex(Math.max(0, Math.min(lastIndex, safe + delta)));
  const page = safe < total ? (pages[safe] ?? null) : null;
  return (
    <div
      className={cx("mem-player", "mem-player--" + framing)}
      tabIndex={0}
      role="group"
      aria-roledescription="sequence"
      aria-label={itemHeading(item) ?? (framing === "proposal" ? "A private moment" : "A surprise")}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
        }
      }}
    >
      <div className="mem-player__stage" key={safe} aria-live="polite">
        {page === null ? (
          <p className="mem-player__text mem-player__closing">
            {framing === "proposal"
              ? "That is everything they wanted you to have."
              : "That is all of it."}
          </p>
        ) : page.kind === "media" && page.mediaId ? (
          <div className="mem-player__media">
            {page.mediaRole === "voice_letter" ? (
              <p className="mem-voice__kicker">A voice letter</p>
            ) : null}
            <MediaAttachment mediaId={page.mediaId} />
          </div>
        ) : (
          <p className="mem-player__text">{page.text}</p>
        )}
      </div>
      <div className="mem-player__controls">
        <Button variant="secondary" icon="back" onClick={() => go(-1)} disabled={safe === 0}>
          Back
        </Button>
        <Button variant="primary" onClick={() => go(1)} disabled={safe === lastIndex}>
          Continue
        </Button>
      </div>
    </div>
  );
}

export function MomentCard({
  item,
  framing,
  accountId,
  disabled,
  onChanged,
  partnerName,
}: {
  readonly item: RelationshipItem;
  readonly framing: "surprise" | "proposal";
  readonly accountId: string;
  readonly disabled: boolean;
  readonly onChanged: () => Promise<void>;
  readonly partnerName?: string | undefined;
}) {
  const actions = useItemActions(item, onChanged);
  const [playing, setPlaying] = useState(false);
  const seal = sealInfo(item, accountId, disabled, whenLabel);
  const creator = isCreator(item, accountId);
  const recipientSealed = Boolean(seal) && !creator;
  const heading =
    itemHeading(item) ??
    (recipientSealed ? "Sealed" : framing === "proposal" ? "A private moment" : "A surprise");
  const playable = (!seal || creator) && buildSequencePages(item).length > 0;
  const from = creator ? "Prepared by you" : "Prepared by " + (partnerName ?? "your person");
  return (
    <article
      className={cx(
        "mem-moment",
        "mem-moment--" + (recipientSealed ? "sealed" : framing),
        seal && "is-sealed",
      )}
    >
      <div className="mem-moment__top">
        <div>
          {recipientSealed ? null : (
            <>
              <p className="mem-letter__kicker">
                {framing === "proposal" ? "Proposal" : "Surprise"}
              </p>
              <p className="mem-letter__from">{from}</p>
            </>
          )}
        </div>
        <ItemMenu
          item={item}
          accountId={accountId}
          disabled={disabled}
          actions={actions}
          allowStory={false}
        />
      </div>
      <h3 className="mem-letter__title">{heading}</h3>
      {framing === "proposal" && !seal ? (
        <p className="mem-hint">A private moment, shared only when it is time.</p>
      ) : null}
      {seal ? <SealedBand band={seal.band} detail={seal.detail} /> : null}
      <div className="mem-letter__actions">
        {playable ? (
          <Button variant={seal ? "secondary" : "primary"} onClick={() => setPlaying(true)}>
            {seal ? "Preview privately" : "Begin"}
          </Button>
        ) : null}
        {seal?.canRelease && seal.releaseLabel ? (
          <Button variant="primary" disabled={actions.busy} onClick={() => void actions.release()}>
            {seal.releaseLabel}
          </Button>
        ) : null}
      </div>
      <ItemFeedback actions={actions} />
      {playing ? (
        <Sheet open onClose={() => setPlaying(false)} title={heading}>
          <SequencePlayer item={item} framing={framing} />
        </Sheet>
      ) : null}
    </article>
  );
}

function MomentsList({
  props,
  kind,
  title,
  kicker,
  emptyTitle,
  emptyBody,
  addLabel,
}: {
  readonly props: ContentViewProps;
  readonly kind: "surprise" | "proposal";
  readonly title: string;
  readonly kicker: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly addLabel: string;
}) {
  const state = useRelationshipItems({ kind }, props.items);
  const disabled = props.disabled ?? false;
  const changed = async () => {
    await state.reload();
    await props.onChanged?.();
  };
  return (
    <section className="mem-view" aria-label={title}>
      {props.heading !== false ? <ViewHeader kicker={kicker} title={title} /> : null}
      <ListState
        state={state}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        emptyAction={
          props.onAdd && !disabled ? (
            <Button variant="primary" onClick={props.onAdd}>
              {addLabel}
            </Button>
          ) : undefined
        }
      >
        <div className="mem-letters">
          {state.items.map((item) => (
            <MomentCard
              key={item.itemId}
              item={item}
              framing={kind}
              accountId={props.accountId}
              disabled={disabled}
              onChanged={changed}
              partnerName={props.partnerName}
            />
          ))}
        </div>
      </ListState>
    </section>
  );
}

/** Surprise: a prepared sequence, paced. Existing creator-reveal release semantics. */
export function SurpriseView(props: ContentViewProps) {
  return (
    <MomentsList
      props={props}
      kind="surprise"
      kicker="Now"
      title="Surprise"
      emptyTitle="No surprises waiting"
      emptyBody="Prepare a few pages in private, then reveal them when you choose."
      addLabel="Prepare a surprise"
    />
  );
}

/**
 * Proposal: a privately prepared sequence with tasteful framing. There is no yes or no
 * control and no response mechanic; the moment happens in person.
 */
export function ProposalView(props: ContentViewProps) {
  return (
    <MomentsList
      props={props}
      kind="proposal"
      kicker="Next"
      title="Proposal"
      emptyTitle="Nothing prepared"
      emptyBody="A private sequence you can shape at your own pace, revealed only when you decide."
      addLabel="Prepare a moment"
    />
  );
}

export function SignalRow({
  item,
  accountId,
  disabled,
  onChanged,
}: {
  readonly item: RelationshipItem;
  readonly accountId: string;
  readonly disabled: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const actions = useItemActions(item, onChanged);
  const kind =
    item.featureState?.type === "relationship_signal" ? item.featureState.signalKind : "";
  const text = readString(item.content, "sharedFeelingText");
  const mine = isCreator(item, accountId);
  return (
    <li className="mem-signal">
      <div className="mem-signal__row">
        <p className="mem-signal__label">{signalLabel(kind)}</p>
        <ItemMenu
          item={item}
          accountId={accountId}
          disabled={disabled}
          actions={actions}
          allowStory={false}
        />
      </div>
      {text ? <p className="mem-signal__text">{text}</p> : null}
      <p className="mem-signal__meta">
        {mine ? "You sent this" : "Sent to you"} ·{" "}
        {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(item.createdAt),
        )}
      </p>
      <ItemFeedback actions={actions} />
    </li>
  );
}

/**
 * Signals: the existing explicit `relationship_signal` items, presented gently. This is not a
 * new primitive and adds no notification behavior. Sending uses the existing create flow.
 */
export function SignalsView(props: ContentViewProps) {
  const state = useRelationshipItems({ kind: "relationship_signal" }, props.items);
  const disabled = props.disabled ?? false;
  const [choice, setChoice] = useState<SignalKind>("thinking_of_you");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const changed = async () => {
    await state.reload();
    await props.onChanged?.();
  };

  async function send() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await createRelationshipItem(
        buildSignalPayload(choice, choice === "shared_feeling" ? text : ""),
      );
      if (queuedMutation(result)) {
        setNotice("Relationship item queued. It will replay after authority is refreshed.");
      } else {
        setText("");
        setNotice("Sent.");
        await changed();
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mem-view" aria-label="Signals">
      {props.heading !== false ? <ViewHeader kicker="Now" title="Signals" /> : null}
      {!disabled ? (
        <div className="mem-signal-send">
          <div className="mem-signal-choices" role="radiogroup" aria-label="Choose a signal">
            {SIGNAL_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={choice === value}
                className={cx("mem-signal-choice", choice === value && "is-selected")}
                onClick={() => setChoice(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {choice === "shared_feeling" ? (
            <label className="mem-field">
              <span>In your words, optional</span>
              <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
            </label>
          ) : null}
          <Button variant="primary" onClick={() => void send()} disabled={busy}>
            {busy ? "Sending" : "Send " + signalLabel(choice).toLowerCase()}
          </Button>
          {error ? <ErrorNotice>{error}</ErrorNotice> : null}
          {notice ? <Notice tone="success">{notice}</Notice> : null}
        </div>
      ) : null}
      <ListState
        state={state}
        emptyTitle="Nothing here yet"
        emptyBody="A small signal can say a lot: thinking of you, a hug, call me when you can."
      >
        <ul className="mem-signals">
          {state.items.map((item) => (
            <SignalRow
              key={item.itemId}
              item={item}
              accountId={props.accountId}
              disabled={disabled}
              onChanged={changed}
            />
          ))}
        </ul>
      </ListState>
    </section>
  );
}
