import { useEffect, useState, type ReactNode } from "react";
import { Button, ErrorNotice, Sheet } from "../../../design/primitives.tsx";
import { createRelationshipItem, patchRelationshipItem } from "../../relationship-space/api.ts";
import type { RelationshipItem } from "../../relationship-space/model.ts";
import { messageFor } from "./errors.ts";
import {
  attachmentReferences,
  describeOccurrence,
  itemBody,
  itemHeading,
  itemTitle,
  kindLabel,
  readString,
} from "./model.ts";
import { OccurrenceDate, PhotoStack, VoiceLetterListening } from "./parts.tsx";

/*
 * Curation: the existing "choose which moments belong" behavior for Our Year, Anniversary,
 * and reunion preparation. Payloads, link types, positions, and create-or-patch behavior are
 * the same as before; only the presentation changed.
 */

export interface CurationTarget {
  curationType: "our_year" | "anniversary";
  anchorYear: number;
  title: string;
  savedCuration: RelationshipItem | null;
}

export async function saveCuration(target: CurationTarget, ids: readonly string[]) {
  const links = ids.map((targetItemId, position) => ({
    linkType: "curation" as const,
    targetItemId,
    position,
  }));
  if (target.savedCuration) {
    return patchRelationshipItem(target.savedCuration.itemId, {
      expectedVersion: target.savedCuration.version,
      links,
    });
  }
  return createRelationshipItem({
    kind: target.curationType,
    contentSchemaVersion: 1,
    preview: null,
    content: { title: target.title, note: null },
    occurrence: null,
    storyIncluded: false,
    release: null,
    featureState: {
      type: "curation",
      curationType: target.curationType,
      anchorYear: target.anchorYear,
    },
    references: [],
    links,
  });
}

export async function saveReunionPlan(reunion: RelationshipItem, ids: readonly string[]) {
  const links = ids.map((targetItemId, position) => ({
    linkType: "prepared_content" as const,
    targetItemId,
    position,
  }));
  return patchRelationshipItem(reunion.itemId, { expectedVersion: reunion.version, links });
}

export function initialSelection(
  source: RelationshipItem | null,
  linkType: "curation" | "prepared_content",
): string[] {
  return (source?.links ?? [])
    .filter((link) => link.linkType === linkType)
    .sort((a, b) => a.position - b.position)
    .map((link) => link.targetItemId);
}

export function CurationPicker({
  open,
  title,
  hint,
  candidates,
  initialIds,
  checkLabel,
  saveLabel,
  disabled,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly hint: string;
  readonly candidates: readonly RelationshipItem[];
  readonly initialIds: readonly string[];
  readonly checkLabel: string;
  readonly saveLabel: string;
  readonly disabled: boolean;
  readonly onClose: () => void;
  readonly onSave: (ids: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([...initialIds]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) setSelected([...initialIds]);
  }, [open]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave(selected);
      onClose();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || disabled} onClick={() => void save()}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <p className="mem-hint">{hint}</p>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {candidates.length === 0 ? (
        <p className="mem-hint">Nothing is ready to choose from yet.</p>
      ) : (
        <ul className="mem-pick">
          {candidates.map((item) => (
            <li key={item.itemId}>
              <label className="mem-pick__row">
                <input
                  type="checkbox"
                  checked={selected.includes(item.itemId)}
                  disabled={disabled}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(item.itemId)
                        ? current.filter((value) => value !== item.itemId)
                        : [...current, item.itemId],
                    )
                  }
                />
                <span>
                  <span className="mem-pick__title">{itemTitle(item)}</span>
                  <span className="mem-pick__meta">
                    {kindLabel(item.kind)}
                    {item.occurrence ? " · " + describeOccurrence(item.occurrence).full : ""}
                  </span>
                  <span className="ds-sr-only">{checkLabel}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function BookPage({ item }: { readonly item: RelationshipItem }) {
  const heading = itemHeading(item);
  const body = readString(item.content, "note") ?? itemBody(item);
  const hasPhoto = attachmentReferences(item).length > 0;
  return (
    <article className="mem-book__page" data-kind={item.kind}>
      <PhotoStack item={item} />
      <VoiceLetterListening item={item} />
      <div className="mem-print__caption">
        {item.occurrence ? <OccurrenceDate occurrence={item.occurrence} /> : null}
        {heading ? <h3 className="mem-print__title">{heading}</h3> : null}
        {body && body !== heading ? (
          <p className={hasPhoto ? "mem-print__text" : "mem-book__quote"}>{body}</p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * A paged book over existing candidate items. No metrics, no ranking: a cover, the moments in
 * their curated (or occurrence) order, and a quiet closing page. Page turns are buttons with
 * keyboard arrows; reduced motion collapses the page change to a crossfade.
 */
export function Book({
  label,
  cover,
  pages,
  closing,
  actions,
  empty,
}: {
  readonly label: string;
  readonly cover: ReactNode;
  readonly pages: readonly RelationshipItem[];
  readonly closing: string;
  readonly actions?: ReactNode;
  readonly empty?: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const last = pages.length + 1;
  const safe = Math.min(index, last);
  const atStart = safe === 0;
  const atEnd = safe === last;
  const go = (delta: number) => setIndex(Math.max(0, Math.min(last, safe + delta)));

  return (
    <div
      className="mem-book"
      role="group"
      aria-roledescription="book"
      aria-label={label}
      tabIndex={0}
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
      <div className="mem-book__stage" key={safe} aria-live="polite">
        {safe === 0 ? (
          <div className="mem-book__cover">{cover}</div>
        ) : safe === last ? (
          <div className="mem-book__closing">
            <p>{closing}</p>
          </div>
        ) : (
          <BookPage item={pages[safe - 1] as RelationshipItem} />
        )}
      </div>
      {pages.length === 0 && safe === 0 && empty ? empty : null}
      <div className="mem-book__controls">
        <Button variant="secondary" onClick={() => go(-1)} disabled={atStart} icon="back">
          Back
        </Button>
        <Button variant="secondary" onClick={() => go(1)} disabled={atEnd}>
          {atStart ? "Open the book" : "Turn the page"}
        </Button>
      </div>
      {actions}
    </div>
  );
}
