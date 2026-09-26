import { useEffect, useRef, useState } from "react";
import { signatureDuration } from "../../../design/motion/reduced.ts";
import { Button } from "../../../design/primitives.tsx";
import { ItemFeedback, ItemMenu, localDateTimeInputValue, useItemActions } from "./actions.tsx";
import { useRelationshipItems } from "./data.ts";
import { isCreator, itemBody, itemHeading, sealInfo, type RelationshipItem } from "./model.ts";
import {
  cx,
  ListState,
  PhotoStack,
  SealedBand,
  ViewHeader,
  VoiceLetterListening,
  whenLabel,
} from "./parts.tsx";
import type { ContentViewProps } from "./types.ts";

/**
 * The Letter Unfolds. Runs over an already-released item after the existing release/open
 * action succeeds. Total under one second, skippable by tap or Escape, never blocks input,
 * and under reduced motion it becomes a single short crossfade (see mem.css).
 */
export const UNFOLD_MS = 800;
export const UNFOLD_REDUCED_MS = 150;

function useUnfold(active: boolean, done: () => void) {
  useEffect(() => {
    if (!active) return;
    // Starts once the letter is actually visible, and never exceeds the token duration.
    const timer = window.setTimeout(done, signatureDuration(UNFOLD_MS, UNFOLD_REDUCED_MS));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") done();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [active]);
}

export function LetterCard({
  item,
  accountId,
  disabled,
  onChanged,
  partnerName,
  unfolding,
  onOpening,
  onOpenFailed,
  onUnfoldDone,
}: {
  readonly item: RelationshipItem;
  readonly accountId: string;
  readonly disabled: boolean;
  readonly onChanged: () => Promise<void>;
  readonly partnerName?: string | undefined;
  readonly unfolding: boolean;
  readonly onOpening: (itemId: string) => void;
  readonly onOpenFailed: (itemId: string) => void;
  readonly onUnfoldDone: (itemId: string) => void;
}) {
  const actions = useItemActions(item, onChanged);
  const seal = sealInfo(item, accountId, disabled, whenLabel);
  const creator = isCreator(item, accountId);
  const heading = itemHeading(item);
  const body = itemBody(item);
  const recipientSealed = Boolean(seal) && !creator;
  // A recipient of a sealed item sees only what the projection already exposes: no type cue,
  // no creator line. Styling the capsule would reveal the kind before release.
  const capsule = item.kind === "future_us" && !recipientSealed;
  const [rescheduling, setRescheduling] = useState(
    item.release?.unlockAt ? localDateTimeInputValue(item.release.unlockAt) : "",
  );
  const revealVisible = !seal || creator;
  const revealRef = useRef<HTMLDivElement>(null);
  useUnfold(unfolding && revealVisible, () => onUnfoldDone(item.itemId));
  // The Open button disappears once the letter is released; move focus to the letter itself so
  // keyboard and screen-reader users land on what just opened instead of the page start.
  useEffect(() => {
    if (unfolding && revealVisible) revealRef.current?.focus({ preventScroll: true });
  }, [unfolding, revealVisible]);

  const from = creator ? "Written by you" : "From " + (partnerName ?? "your person");

  async function open() {
    onOpening(item.itemId);
    const ok = await actions.release();
    if (!ok) onOpenFailed(item.itemId);
  }

  return (
    <article
      className={cx(
        "mem-letter",
        capsule && "mem-letter--capsule",
        seal && "is-sealed",
        unfolding && "is-unfolding",
      )}
      data-kind={item.kind}
      onClick={() => {
        if (unfolding) onUnfoldDone(item.itemId);
      }}
    >
      <div className="mem-letter__top">
        <div>
          {recipientSealed ? null : (
            <>
              <p className="mem-letter__kicker">
                {item.kind === "future_us" ? "Future Us" : "For you"}
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
          allowStory={!seal}
        />
      </div>

      {heading ? <h3 className="mem-letter__title">{heading}</h3> : null}

      {seal ? (
        <SealedBand band={seal.band} detail={seal.detail === heading ? null : seal.detail} />
      ) : null}

      {seal && seal.canRelease && seal.releaseLabel ? (
        <div className="mem-letter__actions">
          <Button variant="primary" disabled={actions.busy} onClick={() => void open()}>
            {seal.releaseLabel}
          </Button>
        </div>
      ) : null}

      {!seal || creator ? (
        <div
          ref={revealRef}
          tabIndex={-1}
          aria-label={unfolding ? "Your letter, opened" : undefined}
          className={cx("mem-letter__reveal", unfolding && "mem-letter__reveal--unfold")}
        >
          {body ? <p className="mem-letter__body ds-letter">{body}</p> : null}
          <VoiceLetterListening item={item} from={from} />
          <PhotoStack item={item} />
        </div>
      ) : null}

      {seal && creator && item.release?.mode === "scheduled" && !disabled ? (
        <details className="mem-details">
          <summary>Change when it arrives</summary>
          <div className="mem-inline">
            <label className="mem-field">
              <span>Release time</span>
              <input
                type="datetime-local"
                value={rescheduling}
                disabled={actions.busy}
                onChange={(event) => setRescheduling(event.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              disabled={actions.busy || !rescheduling}
              onClick={() => void actions.saveSchedule(rescheduling)}
            >
              Reschedule
            </Button>
          </div>
        </details>
      ) : null}

      <ItemFeedback actions={actions} />
    </article>
  );
}

function LettersList({
  props,
  kind,
  title,
  kicker,
  emptyTitle,
  emptyBody,
  addLabel,
}: {
  readonly props: ContentViewProps;
  readonly kind: "for_you" | "future_us";
  readonly title: string;
  readonly kicker: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly addLabel: string;
}) {
  const state = useRelationshipItems({ kind }, props.items);
  const disabled = props.disabled ?? false;
  const [unfoldingId, setUnfoldingId] = useState<string | null>(null);
  const changed = async () => {
    await state.reload();
    await props.onChanged?.();
  };
  const sealed = state.items.filter((item) => item.release?.state === "locked");
  const opened = state.items.filter((item) => item.release?.state !== "locked");
  const card = (item: RelationshipItem) => (
    <LetterCard
      key={item.itemId}
      item={item}
      accountId={props.accountId}
      disabled={disabled}
      onChanged={changed}
      partnerName={props.partnerName}
      unfolding={unfoldingId === item.itemId}
      onOpening={setUnfoldingId}
      onOpenFailed={(id) => setUnfoldingId((current) => (current === id ? null : current))}
      onUnfoldDone={(id) => setUnfoldingId((current) => (current === id ? null : current))}
    />
  );
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
        {sealed.length ? (
          <div className="mem-letters" role="list" aria-label="Sealed">
            {sealed.map((item) => (
              <div role="listitem" key={item.itemId}>
                {card(item)}
              </div>
            ))}
          </div>
        ) : null}
        {opened.length ? (
          <div className="mem-letters" role="list" aria-label="Opened">
            {opened.map((item) => (
              <div role="listitem" key={item.itemId}>
                {card(item)}
              </div>
            ))}
          </div>
        ) : null}
      </ListState>
    </section>
  );
}

/** For You: paper letters with a sealed band for anything not yet opened. */
export function ForYouView(props: ContentViewProps) {
  return (
    <LettersList
      props={props}
      kind="for_you"
      kicker="Now"
      title="For you"
      emptyTitle="No letters yet"
      emptyBody="A note, a few lines, something to open when the moment is right."
      addLabel="Write a letter"
    />
  );
}

/** Future Us: sealed time capsules under the existing release semantics. */
export function FutureUsView(props: ContentViewProps) {
  return (
    <LettersList
      props={props}
      kind="future_us"
      kicker="Next"
      title="Future Us"
      emptyTitle="Nothing set aside yet"
      emptyBody="Write something now for a day still ahead. It opens when the time comes."
      addLabel="Set something aside"
    />
  );
}

/**
 * Voice Letters listing: every For You and Future Us item that carries a `voice_letter`
 * media reference, shown as a letter you listen to. Persistence is unchanged.
 */
export function VoiceLettersView(props: ContentViewProps) {
  const forYou = useRelationshipItems({ kind: "for_you" }, props.items);
  const future = useRelationshipItems({ kind: "future_us" }, props.items);
  const disabled = props.disabled ?? false;
  const [unfoldingId, setUnfoldingId] = useState<string | null>(null);
  const merged = [...forYou.items, ...future.items].filter((item) =>
    item.references.some(
      (reference) => reference.referenceType === "media" && reference.role === "voice_letter",
    ),
  );
  const state = {
    ...forYou,
    items: merged,
    status:
      forYou.status === "loading" || future.status === "loading"
        ? ("loading" as const)
        : forYou.status,
    reload: async () => {
      await Promise.all([forYou.reload(), future.reload()]);
    },
  };
  return (
    <section className="mem-view" aria-label="Voice Letters">
      {props.heading !== false ? <ViewHeader kicker="Now" title="Voice Letters" /> : null}
      <ListState
        state={state}
        emptyTitle="No voice letters yet"
        emptyBody="Record a few words in your own voice and attach them to a letter."
      >
        <div className="mem-letters">
          {merged.map((item) => (
            <LetterCard
              key={item.itemId}
              item={item}
              accountId={props.accountId}
              disabled={disabled}
              onChanged={async () => {
                await state.reload();
                await props.onChanged?.();
              }}
              partnerName={props.partnerName}
              unfolding={unfoldingId === item.itemId}
              onOpening={setUnfoldingId}
              onOpenFailed={() => setUnfoldingId(null)}
              onUnfoldDone={() => setUnfoldingId(null)}
            />
          ))}
        </div>
      </ListState>
    </section>
  );
}
