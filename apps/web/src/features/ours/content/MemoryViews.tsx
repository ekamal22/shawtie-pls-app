import { useState } from "react";
import { Button, IconButton } from "../../../design/primitives.tsx";
import { ItemFeedback, ItemMenu, useItemActions } from "./actions.tsx";
import { useRelationshipItems } from "./data.ts";
import {
  groupStoryByYear,
  isCreator,
  itemBody,
  itemHeading,
  kindLabel,
  LOVE_CATEGORY_LABELS,
  messageReferenceId,
  readCoordinate,
  readString,
  type RelationshipItem,
} from "./model.ts";
import {
  cx,
  ListState,
  OccurrenceDate,
  PhotoStack,
  Ribbon,
  ViewHeader,
  VoiceLetterListening,
} from "./parts.tsx";
import { openSourceMessage, useMessageSource } from "./source.ts";
import type { ContentViewProps } from "./types.ts";

interface EntryProps {
  readonly item: RelationshipItem;
  readonly accountId: string;
  readonly disabled: boolean;
  readonly onChanged: () => Promise<void>;
  readonly partnerName?: string | undefined;
  readonly onOpenMessage?: ((messageId: string) => void) | undefined;
  readonly showKind?: boolean;
  readonly emphasis?: boolean;
}

/* Memory Return: only where the loose reference exists and resolves. */
function SourceLine({
  item,
  onOpenMessage,
}: {
  readonly item: RelationshipItem;
  readonly onOpenMessage?: ((messageId: string) => void) | undefined;
}) {
  const messageId = messageReferenceId(item);
  const state = useMessageSource(messageId);
  if (!messageId || state === "unknown" || state === "checking") return null;
  if (state === "available") {
    return (
      <Button
        variant="quiet"
        compact
        className="mem-source-button"
        onClick={() => (onOpenMessage ?? openSourceMessage)(messageId)}
      >
        Take me there
      </Button>
    );
  }
  return (
    <p className="mem-source-note">
      {state === "offline"
        ? "The original message can't be checked while you're offline."
        : "The original message is no longer available."}
    </p>
  );
}

/** Kept moment: a typographic pull-quote with a ribbon. Edit and delete are creator-only. */
export function KeptCard({
  item,
  accountId,
  disabled,
  onChanged,
  partnerName,
  onOpenMessage,
  emphasis = false,
}: EntryProps) {
  const actions = useItemActions(item, onChanged);
  const quote = readString(item.content, "snapshotText") ?? itemBody(item) ?? itemHeading(item);
  const heading = itemHeading(item);
  const note = readString(item.content, "note");
  const keptBy = isCreator(item, accountId) ? "Kept by you" : "Kept by " + (partnerName ?? "them");
  return (
    <article className="mem-kept" data-kind="remember_this">
      <div className="mem-kept__mark">
        <Ribbon emphasis={emphasis} />
        <ItemMenu
          item={item}
          accountId={accountId}
          disabled={disabled}
          actions={actions}
          allowStory
        />
      </div>
      {quote ? <blockquote className="mem-kept__quote">{quote}</blockquote> : null}
      {heading && heading !== quote ? <p className="mem-kept__title">{heading}</p> : null}
      {note && note !== quote ? <p className="mem-kept__note">{note}</p> : null}
      <PhotoStack item={item} />
      <footer className="mem-kept__footer">
        <span>{keptBy}</span>
        {item.occurrence ? <OccurrenceDate occurrence={item.occurrence} size="small" /> : null}
        <SourceLine item={item} onOpenMessage={onOpenMessage} />
      </footer>
      <ItemFeedback actions={actions} />
    </article>
  );
}

/** Photo-book entry: photography first, caption below, whitespace around. */
export function PrintEntry({
  item,
  accountId,
  disabled,
  onChanged,
  partnerName,
  onOpenMessage,
  showKind = false,
  emphasis = false,
}: EntryProps) {
  const actions = useItemActions(item, onChanged);
  if (item.kind === "remember_this") {
    return (
      <KeptCard
        item={item}
        accountId={accountId}
        disabled={disabled}
        onChanged={onChanged}
        partnerName={partnerName}
        onOpenMessage={onOpenMessage}
        emphasis={emphasis}
      />
    );
  }
  const heading = itemHeading(item);
  const body = readString(item.content, "note") ?? itemBody(item);
  const latitude = readCoordinate(item.content, "latitude");
  const longitude = readCoordinate(item.content, "longitude");
  return (
    <article className="mem-print" data-kind={item.kind}>
      <PhotoStack item={item} />
      <VoiceLetterListening item={item} />
      <div className="mem-print__caption">
        <div className="mem-print__row">
          {item.occurrence ? <OccurrenceDate occurrence={item.occurrence} /> : <span />}
          <ItemMenu item={item} accountId={accountId} disabled={disabled} actions={actions} />
        </div>
        {showKind ? <p className="ds-kicker">{kindLabel(item.kind)}</p> : null}
        {heading ? <h3 className="mem-print__title">{heading}</h3> : null}
        {body && body !== heading ? <p className="mem-print__text">{body}</p> : null}
        {latitude !== null && longitude !== null ? (
          <p className="mem-print__meta">
            Pinned at {latitude}, {longitude}
          </p>
        ) : null}
        <ItemFeedback actions={actions} />
      </div>
    </article>
  );
}

function useViewItems(props: ContentViewProps, query: Parameters<typeof useRelationshipItems>[0]) {
  const state = useRelationshipItems(query, props.items);
  const disabled = props.disabled ?? false;
  const changed = async () => {
    await state.reload();
    await props.onChanged?.();
  };
  return { state, disabled, changed };
}

function addAction(props: ContentViewProps, label: string) {
  if (!props.onAdd || props.disabled) return undefined;
  return (
    <Button variant="primary" onClick={props.onAdd}>
      {label}
    </Button>
  );
}

function scrollToId(id: string) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

/**
 * Our Story: a living editorial timeline over the existing story projection (storyOnly,
 * occurred_asc). Occurrence precision is shown explicitly. The year rail is derived only
 * from the years that exist in the data.
 */
export function StoryView(props: ContentViewProps) {
  const { state, disabled, changed } = useViewItems(props, {
    storyOnly: true,
    sort: "occurred_asc",
  });
  const groups = groupStoryByYear(state.items);
  return (
    <section className="mem-view mem-story" aria-label="Our Story">
      {props.heading !== false ? <ViewHeader kicker="Then" title="Our Story" /> : null}
      <ListState
        state={state}
        emptyTitle="Your story starts wherever you like"
        emptyBody="Add a memory, a first, or a kept moment to Our Story and it gathers here."
        emptyAction={addAction(props, "Add a memory")}
      >
        {groups.length > 1 ? (
          <nav className="mem-rail" aria-label="Jump to a year">
            {groups.map((group) => (
              <button
                key={group.key}
                type="button"
                className="mem-rail__year"
                onClick={() => scrollToId("mem-year-" + group.key)}
              >
                {group.year === null ? "Undated" : group.label}
              </button>
            ))}
          </nav>
        ) : null}
        {groups.map((group) => (
          <div key={group.key} className="mem-year" id={"mem-year-" + group.key}>
            <h3 className="mem-year__label">{group.label}</h3>
            {group.items.map((item, index) => (
              <PrintEntry
                key={item.itemId}
                item={item}
                accountId={props.accountId}
                disabled={disabled}
                onChanged={changed}
                partnerName={props.partnerName}
                onOpenMessage={props.onOpenMessage}
                showKind
                emphasis={index < 1}
              />
            ))}
          </div>
        ))}
      </ListState>
    </section>
  );
}

export function MemoriesView(props: ContentViewProps) {
  const { state, disabled, changed } = useViewItems(props, {
    kind: "memory",
    sort: "occurred_asc",
  });
  return (
    <section className="mem-view" aria-label="Memories">
      {props.heading !== false ? <ViewHeader kicker="Then" title="Memories" /> : null}
      <ListState
        state={state}
        emptyTitle="No memories here yet"
        emptyBody="A photo, a day, a small thing you do not want to lose."
        emptyAction={addAction(props, "Add a memory")}
      >
        {state.items.map((item) => (
          <PrintEntry
            key={item.itemId}
            item={item}
            accountId={props.accountId}
            disabled={disabled}
            onChanged={changed}
          />
        ))}
      </ListState>
    </section>
  );
}

/** Remember This, presented as kept moments. */
export function KeptView(props: ContentViewProps) {
  const { state, disabled, changed } = useViewItems(props, { kind: "remember_this" });
  return (
    <section className="mem-view mem-kept-list" aria-label="Kept">
      {props.heading !== false ? <ViewHeader kicker="Then" title="Kept" /> : null}
      <ListState
        state={state}
        emptyTitle="Nothing kept yet"
        emptyBody="When a message or a moment matters, keep it here for the two of you."
        emptyAction={addAction(props, "Keep something")}
      >
        {state.items.map((item, index) => (
          <KeptCard
            key={item.itemId}
            item={item}
            accountId={props.accountId}
            disabled={disabled}
            onChanged={changed}
            partnerName={props.partnerName}
            onOpenMessage={props.onOpenMessage}
            emphasis={index < 2}
          />
        ))}
      </ListState>
    </section>
  );
}

function FirstRow({
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
  const heading = itemHeading(item);
  const note = readString(item.content, "note");
  return (
    <li className="mem-first">
      <div className="mem-first__main">
        <h3 className="mem-first__title">{heading ?? "A first"}</h3>
        {note ? <p className="mem-first__note">{note}</p> : null}
        <PhotoStack item={item} />
        <ItemFeedback actions={actions} />
      </div>
      <div className="mem-first__side">
        <OccurrenceDate occurrence={item.occurrence} size="small" />
        <ItemMenu item={item} accountId={accountId} disabled={disabled} actions={actions} />
      </div>
    </li>
  );
}

/** Firsts as a typographic list. */
export function FirstsView(props: ContentViewProps) {
  const { state, disabled, changed } = useViewItems(props, { kind: "first", sort: "occurred_asc" });
  return (
    <section className="mem-view" aria-label="Our Firsts">
      {props.heading !== false ? <ViewHeader kicker="Then" title="Our Firsts" /> : null}
      <ListState
        state={state}
        emptyTitle="Firsts will gather here"
        emptyBody="The first time for anything, in your own words."
        emptyAction={addAction(props, "Add a first")}
      >
        <ol className="mem-firsts">
          {state.items.map((item) => (
            <FirstRow
              key={item.itemId}
              item={item}
              accountId={props.accountId}
              disabled={disabled}
              onChanged={changed}
            />
          ))}
        </ol>
      </ListState>
    </section>
  );
}

function PlaceRow({
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
  const heading = itemHeading(item);
  const note = readString(item.content, "note");
  const latitude = readCoordinate(item.content, "latitude");
  const longitude = readCoordinate(item.content, "longitude");
  return (
    <li className="mem-place">
      <PhotoStack item={item} />
      <div className="mem-place__row">
        <h3 className="mem-place__title">{heading ?? "A place"}</h3>
        <ItemMenu item={item} accountId={accountId} disabled={disabled} actions={actions} />
      </div>
      {item.occurrence ? <OccurrenceDate occurrence={item.occurrence} size="small" /> : null}
      {note ? <p className="mem-place__note">{note}</p> : null}
      {latitude !== null && longitude !== null ? (
        <p className="mem-print__meta">
          Pinned at {latitude}, {longitude}
        </p>
      ) : null}
      <ItemFeedback actions={actions} />
    </li>
  );
}

/** Places, list first. A map is DEFERRED and would be client behavior with no tracking. */
export function PlacesView(props: ContentViewProps) {
  const { state, disabled, changed } = useViewItems(props, { kind: "place", sort: "occurred_asc" });
  return (
    <section className="mem-view" aria-label="Places we became us">
      {props.heading !== false ? <ViewHeader kicker="Then" title="Places" /> : null}
      <ListState
        state={state}
        emptyTitle="Places will gather here"
        emptyBody="A cafe, a corner, a city. Anywhere that became yours."
        emptyAction={addAction(props, "Add a place")}
      >
        <ul className="mem-places">
          {state.items.map((item) => (
            <PlaceRow
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

/**
 * Love and reasons: a calm deck. One at a time, no counts, no streaks, no daily pressure and
 * no progress toward any total. "Another" simply turns to the next card.
 */
export function LoveView(props: ContentViewProps) {
  const { state, disabled, changed } = useViewItems(props, { kind: "love" });
  const [index, setIndex] = useState(0);
  const total = state.items.length;
  const current = total ? state.items[((index % total) + total) % total] : null;
  return (
    <section className="mem-view" aria-label="Love">
      {props.heading !== false ? <ViewHeader kicker="Now" title="Love" /> : null}
      <ListState
        state={state}
        emptyTitle="Nothing here yet"
        emptyBody="A reason, something you noticed, something you remembered. There is no rush."
        emptyAction={addAction(props, "Write one")}
      >
        {current ? (
          <div className="mem-deck">
            <LoveCard
              key={current.itemId}
              item={current}
              accountId={props.accountId}
              disabled={disabled}
              onChanged={changed}
            />
            {total > 1 ? (
              <div className="mem-deck__controls">
                <IconButton
                  label="Previous"
                  icon="back"
                  variant="secondary"
                  onClick={() => setIndex((value) => value - 1)}
                />
                <Button variant="secondary" onClick={() => setIndex((value) => value + 1)}>
                  Another
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </ListState>
    </section>
  );
}

export function LoveCard({
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
  const category = readString(item.content, "category");
  const text = readString(item.content, "text") ?? "";
  return (
    <article className="mem-love" aria-live="polite">
      <div className="mem-love__row">
        <p className="ds-kicker">
          {category ? (LOVE_CATEGORY_LABELS[category] ?? "A reason") : "A reason"}
        </p>
        <ItemMenu item={item} accountId={accountId} disabled={disabled} actions={actions} />
      </div>
      <p className={cx("mem-love__text")}>{text}</p>
      <VoiceLetterListening item={item} />
      {item.occurrence ? <OccurrenceDate occurrence={item.occurrence} size="small" /> : null}
      <ItemFeedback actions={actions} />
    </article>
  );
}
