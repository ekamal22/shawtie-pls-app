import { useState } from "react";
import type { IconName } from "../../design/icons.tsx";
import { Icon } from "../../design/icons.tsx";
import { Button, ConfirmDialog, Sheet } from "../../design/primitives.tsx";
import { MediaAttachment } from "../media/MediaAttachment.tsx";
import {
  deleteRelationshipItem,
  patchRelationshipItem,
  releaseRelationshipItem,
} from "../relationship-space/api.ts";
import type { RelationshipItem } from "../relationship-space/model.ts";
import {
  hasVoiceLetter,
  isLocked,
  itemAuthority,
  itemBody,
  itemTitle,
  kindLabel,
  occurrenceText,
  readString,
} from "./chapters.ts";
import { oursMessageFor, queuedMutation } from "./messages.ts";

const LETTER_KINDS = new Set(["for_you", "future_us", "surprise", "proposal"]);

function rowIcon(item: RelationshipItem): IconName | null {
  if (hasVoiceLetter(item)) return "mic";
  if (item.kind === "remember_this") return "ribbon";
  if (item.kind === "love") return "heart";
  if (LETTER_KINDS.has(item.kind)) return "letter";
  if (item.kind === "someday" || item.kind === "reunion") return "clock";
  return null;
}

/** One quiet row for a chapter. Unreleased items never show content, only the authorized preview. */
export function OursItemRow({
  item,
  onOpen,
}: {
  readonly item: RelationshipItem;
  readonly onOpen: (item: RelationshipItem) => void;
}) {
  const locked = isLocked(item);
  const icon = locked ? null : rowIcon(item);
  const date = occurrenceText(item);
  const paper = LETTER_KINDS.has(item.kind);
  // Unreleased items show only the authorized preview the server already exposes: the title
  // and the opening line. No date, countdown, or extra wording is added before release.
  const sealedNote = locked ? readString(item.preview, "conditionLabel") : null;
  return (
    <li>
      <button
        type="button"
        className={"ours-row" + (paper ? " ours-row--paper" : "")}
        data-kind={item.kind}
        data-sealed={locked ? "true" : undefined}
        onClick={() => onOpen(item)}
      >
        {icon ? (
          <span className="ours-row__icon">
            <Icon name={icon} size={20} />
          </span>
        ) : null}
        <span className="ours-row__text">
          <span className="ours-row__kicker">
            {kindLabel(item.kind)}
            {hasVoiceLetter(item) && !locked ? " · Voice letter" : ""}
          </span>
          <span className="ours-row__title">{locked ? previewTitle(item) : itemTitle(item)}</span>
          {sealedNote ? <span className="ours-row__meta">{sealedNote}</span> : null}
          {!locked && date ? <span className="ours-row__meta">{date}</span> : null}
        </span>
        <Icon name="forward" size={18} />
      </button>
    </li>
  );
}

function previewTitle(item: RelationshipItem): string {
  return readString(item.preview, "title") ?? kindLabel(item.kind);
}

function localDateTimeInputValue(iso: string): string {
  const value = new Date(iso);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Detail sheet for one item. Reads are shared by both partners. Edit and delete follow the
 * creator-only authority in `itemAuthority` (Remember This is never editable or deletable by
 * the partner), and every action goes through the unchanged R1 client calls.
 */
export function OursItemSheet({
  item,
  accountId,
  viewOnly,
  onClose,
  onChanged,
}: {
  readonly item: RelationshipItem | null;
  readonly accountId: string;
  readonly viewOnly: boolean;
  readonly onClose: () => void;
  readonly onChanged: (message?: string) => Promise<void>;
}) {
  return (
    <Sheet open={item !== null} onClose={onClose} title={item ? kindLabel(item.kind) : "Ours"}>
      {item ? (
        <ItemDetail
          key={item.itemId + ":" + item.version}
          item={item}
          accountId={accountId}
          viewOnly={viewOnly}
          onClose={onClose}
          onChanged={onChanged}
        />
      ) : null}
    </Sheet>
  );
}

function ItemDetail({
  item,
  accountId,
  viewOnly,
  onClose,
  onChanged,
}: {
  readonly item: RelationshipItem;
  readonly accountId: string;
  readonly viewOnly: boolean;
  readonly onClose: () => void;
  readonly onChanged: (message?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bodyKey =
    item.content && "body" in item.content
      ? "body"
      : item.content && "note" in item.content
        ? "note"
        : item.content && "snapshotText" in item.content
          ? "snapshotText"
          : item.content && "text" in item.content
            ? "text"
            : item.content && "intro" in item.content
              ? "intro"
              : null;
  const hasTitle = Boolean(item.content && "title" in item.content);
  const [draftTitle, setDraftTitle] = useState(
    readString(item.content, "title") ?? readString(item.preview, "title") ?? "",
  );
  const [draftBody, setDraftBody] = useState(
    bodyKey ? (readString(item.content, bodyKey) ?? "") : "",
  );
  const [draftUnlockAt, setDraftUnlockAt] = useState(
    item.release?.unlockAt ? localDateTimeInputValue(item.release.unlockAt) : "",
  );

  const { canEdit, canDelete, isCreator } = itemAuthority(item, accountId, viewOnly);
  const locked = isLocked(item);
  const canOpen = !viewOnly && locked && item.release?.mode === "recipient_open" && !isCreator;
  const canReveal = !viewOnly && locked && item.release?.mode === "creator_reveal" && isCreator;
  const canReschedule =
    !viewOnly && isCreator && locked && item.release?.mode === "scheduled" && item.release !== null;
  const voice = item.references.filter(
    (reference) => reference.referenceType === "media" && reference.role === "voice_letter",
  );
  const attachments = item.references.filter(
    (reference) => reference.referenceType === "media" && reference.role !== "voice_letter",
  );
  const body = itemBody(item);
  const date = occurrenceText(item);
  const paper = LETTER_KINDS.has(item.kind) || item.kind === "love";

  async function run(task: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await task();
      if (queuedMutation(result)) {
        setNotice("Change queued. Current authority will be rechecked before replay.");
        return;
      }
      await onChanged(success);
      onClose();
    } catch (caught) {
      setError(oursMessageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  function saveEdit() {
    if (!item.content) return;
    const next: Record<string, unknown> = { ...item.content };
    if ("title" in next) next.title = draftTitle.trim();
    if (bodyKey) next[bodyKey] = draftBody.trim() || null;
    void run(() =>
      patchRelationshipItem(item.itemId, { expectedVersion: item.version, content: next }),
    );
  }

  function advanceSomeday() {
    if (item.featureState?.type !== "someday") return;
    const state =
      item.featureState.state === "someday"
        ? "soon"
        : item.featureState.state === "soon"
          ? "completed"
          : "someday";
    void run(() =>
      patchRelationshipItem(item.itemId, {
        expectedVersion: item.version,
        featureState: { type: "someday", state },
      }),
    );
  }

  return (
    <div className="ours-detail">
      <article className={"ours-detail__page" + (paper ? " ours-detail__page--paper" : "")}>
        {item.kind === "remember_this" ? (
          <p className="ours-detail__kept">
            <Icon name="ribbon" size={18} filled />
            Kept for us.
          </p>
        ) : null}
        <h3 className="ours-detail__title">{locked ? previewTitle(item) : itemTitle(item)}</h3>
        {date && !locked ? <p className="ours-detail__date">{date}</p> : null}

        {locked && readString(item.preview, "conditionLabel") ? (
          <p className="ours-detail__meta">{readString(item.preview, "conditionLabel")}</p>
        ) : null}

        {!locked && voice.length ? (
          <div className="ours-detail__voice">
            {voice.map((reference) => (
              <div key={reference.referenceId}>
                <p className="ours-detail__meta">A voice letter</p>
                <MediaAttachment mediaId={reference.referenceId} />
              </div>
            ))}
          </div>
        ) : null}

        {!locked && attachments.length ? (
          <div className="ours-detail__media">
            {attachments.map((reference) => (
              <MediaAttachment key={reference.referenceId} mediaId={reference.referenceId} />
            ))}
          </div>
        ) : null}

        {!locked && body && !editing ? <p className="ours-detail__body">{body}</p> : null}

        {!locked && item.featureState?.type === "someday" ? (
          <p className="ours-detail__meta">
            {item.featureState.state === "completed"
              ? "We did it"
              : item.featureState.state === "soon"
                ? "Soon"
                : "Someday"}
          </p>
        ) : null}
        {item.featureState?.type === "reunion" ? (
          <p className="ours-detail__meta">Target date: {item.featureState.targetDate}</p>
        ) : null}
        {item.featureState?.type === "relationship_signal" ? (
          <p className="ours-detail__meta">{item.featureState.signalKind.replaceAll("_", " ")}</p>
        ) : null}

        {editing ? (
          <div className="ours-detail__editor stack">
            {hasTitle ? (
              <label className="field">
                <span>Title</span>
                <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
              </label>
            ) : null}
            {bodyKey ? (
              <label className="field">
                <span>Words</span>
                <textarea
                  rows={5}
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                />
              </label>
            ) : null}
            <div className="ours-actions">
              <Button variant="primary" compact disabled={busy} onClick={saveEdit}>
                Save
              </Button>
              <Button compact disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {canReschedule ? (
          <div className="ours-detail__schedule">
            <label className="field">
              <span>Release time</span>
              <input
                type="datetime-local"
                value={draftUnlockAt}
                disabled={busy}
                onChange={(event) => setDraftUnlockAt(event.target.value)}
              />
            </label>
            <Button
              compact
              disabled={busy || !draftUnlockAt}
              onClick={() =>
                void run(() =>
                  patchRelationshipItem(item.itemId, {
                    expectedVersion: item.version,
                    release: {
                      mode: "scheduled",
                      unlockAt: new Date(draftUnlockAt).toISOString(),
                    },
                  }),
                )
              }
            >
              Reschedule
            </Button>
          </div>
        ) : null}
      </article>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner success" role="status">
          {notice}
        </p>
      ) : null}

      {viewOnly ? (
        <p className="ours-detail__meta">
          Ours is view-only right now, so this can be read but not changed.
        </p>
      ) : null}

      <div className="ours-actions">
        {canOpen ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void run(() => releaseRelationshipItem(item.itemId, item.version))}
          >
            Open
          </Button>
        ) : null}
        {canReveal ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void run(() => releaseRelationshipItem(item.itemId, item.version))}
          >
            Reveal
          </Button>
        ) : null}
        {item.featureState?.type === "someday" && !viewOnly ? (
          <Button disabled={busy} onClick={advanceSomeday}>
            Next state
          </Button>
        ) : null}
        {!viewOnly && !locked ? (
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  patchRelationshipItem(item.itemId, {
                    expectedVersion: item.version,
                    storyIncluded: !item.storyIncluded,
                  }),
                item.storyIncluded ? "Removed from Our Story." : "Added to Our Story.",
              )
            }
          >
            {item.storyIncluded ? "Remove from Our Story" : "Add to Our Story"}
          </Button>
        ) : null}
        {canEdit && !editing ? (
          <Button disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
        {canDelete ? (
          <Button variant="quiet" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void run(() => deleteRelationshipItem(item.itemId, item.version), "Deleted.");
        }}
        title="Delete this item?"
        confirmLabel="Delete"
        destructive
      >
        Delete this relationship item?
      </ConfirmDialog>
    </div>
  );
}
