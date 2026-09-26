import { useState } from "react";
import {
  ConfirmDialog,
  ErrorNotice,
  Menu,
  Notice,
  Sheet,
  Button,
} from "../../../design/primitives.tsx";
import type { MenuItem } from "../../../design/primitives.tsx";
import {
  deleteRelationshipItem,
  patchRelationshipItem,
  releaseRelationshipItem,
} from "../../relationship-space/api.ts";
import type { RelationshipItem } from "../../relationship-space/model.ts";
import { messageFor, queuedMutation } from "./errors.ts";
import { canDeleteItem, canEditItem, readString, type SomedayStateValue } from "./model.ts";

/*
 * Item mutations over the existing R1 client. Every call is the same api.ts function the
 * previous panel used, with the same expectedVersion, idempotency and offline behavior. The
 * server re-authorizes each one; capability here only decides what to show.
 */

export interface ItemActions {
  busy: boolean;
  error: string;
  notice: string;
  clear: () => void;
  toggleStory: () => Promise<boolean>;
  setSomedayState: (state: SomedayStateValue) => Promise<boolean>;
  release: () => Promise<boolean>;
  remove: () => Promise<boolean>;
  saveContent: (draft: {
    title?: string | undefined;
    body?: string | null | undefined;
  }) => Promise<boolean>;
  saveSchedule: (unlockAtLocal: string) => Promise<boolean>;
  saveReunionDate: (targetDate: string) => Promise<boolean>;
}

export function bodyKeyFor(item: RelationshipItem): string | null {
  const content = item.content;
  if (!content) return null;
  for (const key of ["body", "note", "snapshotText", "text", "intro"]) {
    if (key in content) return key;
  }
  return null;
}

export function localDateTimeInputValue(iso: string): string {
  const value = new Date(iso);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function useItemActions(
  item: RelationshipItem,
  onChanged: () => Promise<void>,
): ItemActions {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(task: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await task();
      if (queuedMutation(result)) {
        setNotice("Change queued. Current authority will be rechecked before replay.");
        return false;
      }
      await onChanged();
      return true;
    } catch (caught) {
      setError(messageFor(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    notice,
    clear: () => {
      setError("");
      setNotice("");
    },
    toggleStory: () =>
      run(() =>
        patchRelationshipItem(item.itemId, {
          expectedVersion: item.version,
          storyIncluded: !item.storyIncluded,
        }),
      ),
    setSomedayState: (state) =>
      run(() =>
        patchRelationshipItem(item.itemId, {
          expectedVersion: item.version,
          featureState: { type: "someday", state },
        }),
      ),
    release: () => run(() => releaseRelationshipItem(item.itemId, item.version)),
    remove: () => run(() => deleteRelationshipItem(item.itemId, item.version)),
    saveContent: (draft) => {
      if (!item.content) return Promise.resolve(false);
      const nextContent: Record<string, unknown> = { ...item.content };
      if ("title" in nextContent && draft.title !== undefined)
        nextContent.title = draft.title.trim();
      const key = bodyKeyFor(item);
      if (key && draft.body !== undefined) nextContent[key] = draft.body?.trim() || null;
      return run(() =>
        patchRelationshipItem(item.itemId, { expectedVersion: item.version, content: nextContent }),
      );
    },
    saveSchedule: (unlockAtLocal) =>
      run(() =>
        patchRelationshipItem(item.itemId, {
          expectedVersion: item.version,
          release: { mode: "scheduled", unlockAt: new Date(unlockAtLocal).toISOString() },
        }),
      ),
    saveReunionDate: (targetDate) =>
      run(() =>
        patchRelationshipItem(item.itemId, {
          expectedVersion: item.version,
          featureState: { type: "reunion", targetDate },
        }),
      ),
  };
}

export function ItemFeedback({ actions }: { readonly actions: ItemActions }) {
  return (
    <>
      {actions.error ? <ErrorNotice>{actions.error}</ErrorNotice> : null}
      {actions.notice ? <Notice tone="info">{actions.notice}</Notice> : null}
    </>
  );
}

/** Quiet overflow menu: edit, story membership, delete. Shown only for what is permitted. */
export function ItemMenu({
  item,
  accountId,
  disabled,
  actions,
  allowStory = true,
  label,
}: {
  readonly item: RelationshipItem;
  readonly accountId: string;
  readonly disabled: boolean;
  readonly actions: ItemActions;
  readonly allowStory?: boolean;
  readonly label?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editable = canEditItem(item, accountId, disabled);
  const deletable = canDeleteItem(item, accountId, disabled);
  const storyCapable = allowStory && item.kind !== "relationship_signal";

  const entries: MenuItem[] = [];
  if (editable) entries.push({ id: "edit", label: "Edit", onSelect: () => setEditing(true) });
  if (storyCapable) {
    entries.push({
      id: "story",
      label: item.storyIncluded ? "Remove from Our Story" : "Add to Our Story",
      disabled: disabled || actions.busy,
      onSelect: () => void actions.toggleStory(),
    });
  }
  if (deletable) {
    entries.push({
      id: "delete",
      label: "Delete",
      danger: true,
      onSelect: () => setConfirming(true),
    });
  }
  if (entries.length === 0) return null;

  return (
    <>
      <Menu label={label ?? "More for this item"} items={entries} />
      {editing ? (
        <EditSheet item={item} actions={actions} onClose={() => setEditing(false)} />
      ) : null}
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void actions.remove();
        }}
        title="Delete this?"
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
      >
        This removes it from your shared space for both of you.
      </ConfirmDialog>
    </>
  );
}

function EditSheet({
  item,
  actions,
  onClose,
}: {
  readonly item: RelationshipItem;
  readonly actions: ItemActions;
  readonly onClose: () => void;
}) {
  const key = bodyKeyFor(item);
  const hasTitle = Boolean(item.content && "title" in item.content);
  const [title, setTitle] = useState(
    readString(item.content, "title") ?? readString(item.preview, "title") ?? "",
  );
  const [body, setBody] = useState(key ? (readString(item.content, key) ?? "") : "");

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit"
      footer={
        <>
          <Button onClick={onClose} disabled={actions.busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={actions.busy}
            onClick={() =>
              void actions
                .saveContent({ title: hasTitle ? title : undefined, body: key ? body : undefined })
                .then((ok) => {
                  if (ok) onClose();
                })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="mem-form">
        {hasTitle ? (
          <label className="mem-field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        ) : null}
        {key ? (
          <label className="mem-field">
            <span>Text</span>
            <textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
        ) : null}
        <ItemFeedback actions={actions} />
      </div>
    </Sheet>
  );
}
