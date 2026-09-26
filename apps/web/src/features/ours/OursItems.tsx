import { useState } from "react";
import type { IconName } from "../../design/icons.tsx";
import { Icon } from "../../design/icons.tsx";
import { Sheet } from "../../design/primitives.tsx";
import { ItemByKind, openSourceMessage } from "./content/index.ts";
import type { RelationshipItem } from "../relationship-space/model.ts";
import {
  hasVoiceLetter,
  isLocked,
  itemTitle,
  kindLabel,
  occurrenceText,
  readString,
} from "./chapters.ts";

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

/**
 * Detail sheet content for one item. The kind-specific treatment, creator-only authority, and
 * every R1 action (open, reveal, reschedule, edit, delete, Our Story) come from the UX6
 * content views, so Ours and the full space present an item identically. Reads are shared by
 * both partners; only the creator may edit or delete.
 */
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
  const [unfoldingId, setUnfoldingId] = useState<string | null>(null);
  return (
    <div className="ours-detail">
      <ItemByKind
        item={item}
        accountId={accountId}
        disabled={viewOnly}
        onChanged={async () => {
          await onChanged();
        }}
        onOpenMessage={(messageId) => {
          onClose();
          openSourceMessage(messageId);
        }}
        unfoldingId={unfoldingId}
        setUnfoldingId={setUnfoldingId}
      />
      {viewOnly ? (
        <p className="ours-detail__meta">
          Ours is view-only right now, so this can be read but not changed.
        </p>
      ) : null}
    </div>
  );
}
