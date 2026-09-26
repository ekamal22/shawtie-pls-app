import type { ReactNode } from "react";
import { Icon } from "../../../design/icons.tsx";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Skeleton,
  SkeletonGroup,
} from "../../../design/primitives.tsx";
import { MediaAttachment } from "../../media/MediaAttachment.tsx";
import type { ItemsState } from "./data.ts";
import {
  attachmentReferences,
  describeOccurrence,
  voiceLetterReferences,
  type RelationshipItem,
  type RelationshipOccurrence,
} from "./model.ts";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * The editorial date for memories. Precision is explicit: a day shows a large day number, a
 * month shows the month name, a year shows the year, and an unknown date says so quietly.
 * Values are formatted from the stored parts, never through a timezone conversion.
 */
export function OccurrenceDate({
  occurrence,
  size = "large",
  showPrecision = true,
}: {
  readonly occurrence: RelationshipOccurrence | null;
  readonly size?: "large" | "small";
  readonly showPrecision?: boolean;
}) {
  const display = describeOccurrence(occurrence);
  const body = (
    <>
      <span className="mem-date__lead">{display.lead}</span>
      {display.rest ? <span className="mem-date__rest">{display.rest}</span> : null}
      {showPrecision && display.precisionLabel ? (
        <span className="mem-date__precision">{display.precisionLabel}</span>
      ) : null}
    </>
  );
  const className = cx("mem-date", size === "small" && "mem-date--small");
  return display.dateTime ? (
    <time className={className} dateTime={display.dateTime} aria-label={display.full}>
      {body}
    </time>
  ) : (
    <span className={className}>{body}</span>
  );
}

/** Ribbon mark for kept moments. Candle when it is one of the first two on the screen. */
export function Ribbon({ emphasis = false }: { readonly emphasis?: boolean }) {
  return (
    <span className={cx("mem-ribbon", emphasis && "mem-ribbon--candle")} aria-hidden="true">
      <Icon name="ribbon" size={20} filled />
    </span>
  );
}

export function SealedBand({
  band,
  detail,
  tone = "sealed",
}: {
  readonly band: string;
  readonly detail?: string | null;
  readonly tone?: "sealed" | "open";
}) {
  return (
    <div className={cx("mem-band", "mem-band--" + tone)}>
      <Icon name="letter" size={18} />
      <div>
        <p className="mem-band__title">{band}</p>
        {detail ? <p className="mem-band__detail">{detail}</p> : null}
      </div>
    </div>
  );
}

/** Existing M3 media fetch, presented as photography (edge to edge) or as an attachment. */
export function PhotoStack({ item }: { readonly item: RelationshipItem }) {
  const references = attachmentReferences(item);
  if (references.length === 0) return null;
  return (
    <div className="mem-photos">
      {references.map((reference) => (
        <div key={reference.referenceId} className="mem-photo">
          <MediaAttachment mediaId={reference.referenceId} />
        </div>
      ))}
    </div>
  );
}

/**
 * Listening view for a Voice Letter. It is still a `media` reference with role `voice_letter`;
 * the playback is the existing M3 protected media fetch. Presented as a letter you listen to.
 */
export function VoiceLetterListening({
  item,
  from,
}: {
  readonly item: RelationshipItem;
  readonly from?: string;
}) {
  const references = voiceLetterReferences(item);
  if (references.length === 0) return null;
  return (
    <div className="mem-voice">
      {references.map((reference) => (
        <section
          key={reference.referenceId}
          className="mem-voice__letter"
          aria-label="Voice Letter"
        >
          <p className="mem-voice__kicker">
            <Icon name="mic" size={16} /> A voice letter
          </p>
          <p className="mem-voice__from">{from ?? "Press play and listen"}</p>
          <MediaAttachment mediaId={reference.referenceId} />
        </section>
      ))}
    </div>
  );
}

export function ViewHeader({
  kicker,
  title,
  children,
}: {
  readonly kicker?: string;
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <header className="mem-view-header">
      {kicker ? <p className="ds-kicker">{kicker}</p> : null}
      <h2 className="mem-view-title">{title}</h2>
      {children}
    </header>
  );
}

/** Loading, error, empty, and content states for a list-backed view. */
export function ListState({
  state,
  emptyTitle,
  emptyBody,
  emptyAction,
  children,
}: {
  readonly state: ItemsState;
  readonly emptyTitle: string;
  readonly emptyBody?: string;
  readonly emptyAction?: ReactNode;
  readonly children: ReactNode;
}) {
  if (state.status === "loading") {
    return (
      <SkeletonGroup label="Loading">
        <Skeleton shape="block" />
        <Skeleton width="60%" />
      </SkeletonGroup>
    );
  }
  if (state.status === "error") {
    return (
      <ErrorNotice
        action={
          <Button compact onClick={() => void state.reload()}>
            Try again
          </Button>
        }
      >
        {state.error || "That could not load."}
      </ErrorNotice>
    );
  }
  if (state.items.length === 0) {
    return (
      <EmptyState title={emptyTitle} action={emptyAction}>
        {emptyBody}
      </EmptyState>
    );
  }
  return (
    <>
      {state.error ? <ErrorNotice>{state.error}</ErrorNotice> : null}
      {children}
      {state.hasMore ? (
        <div className="mem-more">
          <Button onClick={() => void state.loadMore()} disabled={state.loadingMore}>
            {state.loadingMore ? "Loading" : "Show more"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function whenLabel(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(
    new Date(iso),
  );
}
