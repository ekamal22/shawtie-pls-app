import { useState } from "react";
import { Icon, type IconName } from "../../design/icons.tsx";
import { Sheet } from "../../design/primitives.tsx";

export const QUICK_REACTIONS = ["❤️", "😂", "😭", "😮", "😡", "👍"] as const;

export interface TalkActionsProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Reaction controls follow the existing `mutable` rule. */
  readonly canReact: boolean;
  readonly myReaction: string | null;
  readonly canReply: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canKeep: boolean;
  readonly kept: boolean;
  readonly busy: boolean;
  readonly onReact: (emoji: string) => void;
  readonly onRemoveReaction: () => void;
  readonly onReply: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onKeep: () => void;
}

function ActionButton({
  icon,
  label,
  hint,
  danger = false,
  disabled = false,
  onClick,
}: {
  readonly icon?: IconName;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"talk-action" + (danger ? " is-danger" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? (
        <Icon name={icon} size={22} />
      ) : (
        <span className="talk-action__gap" aria-hidden="true" />
      )}
      <span>
        <span className="talk-action__label">{label}</span>
        {hint ? <span className="talk-action__hint">{hint}</span> : null}
      </span>
    </button>
  );
}

/**
 * Message actions in the shared Sheet. Every action here already exists in M1 (reply, edit,
 * delete, react) or R1 (keep as Remember This). Capability flags come from the same rules the
 * legacy inline buttons used.
 */
export function TalkActions(props: TalkActionsProps) {
  const [other, setOther] = useState("");
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Message">
      {props.canReact ? (
        <div className="talk-reactpick" role="group" aria-label="React">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="talk-reactpick__emoji"
              aria-pressed={props.myReaction === emoji}
              aria-label={"React " + emoji}
              disabled={props.busy}
              onClick={() => props.onReact(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      {props.canReact ? (
        <form
          className="talk-otheremoji"
          onSubmit={(event) => {
            event.preventDefault();
            const emoji = other.trim();
            if (!emoji) return;
            setOther("");
            props.onReact(emoji);
          }}
        >
          <label htmlFor="talk-other-emoji">Other emoji</label>
          <input
            id="talk-other-emoji"
            value={other}
            onChange={(event) => setOther(event.target.value)}
            maxLength={16}
            autoComplete="off"
          />
          <button type="submit" className="ds-button ds-button--secondary ds-button--compact">
            React
          </button>
          {props.myReaction ? (
            <button
              type="button"
              className="ds-button ds-button--quiet ds-button--compact"
              disabled={props.busy}
              onClick={props.onRemoveReaction}
            >
              Remove my reaction
            </button>
          ) : null}
        </form>
      ) : null}
      <div className="talk-actionlist">
        {props.canReply ? <ActionButton icon="back" label="Reply" onClick={props.onReply} /> : null}
        {props.canKeep ? (
          <ActionButton
            icon="ribbon"
            label={props.kept ? "Kept in Remember This" : "Keep in Remember This"}
            hint={
              props.kept
                ? undefined
                : "Both of you can see what is kept. Only you can change or remove it."
            }
            disabled={props.kept || props.busy}
            onClick={props.onKeep}
          />
        ) : null}
        {props.canEdit ? (
          <ActionButton label="Edit" disabled={props.busy} onClick={props.onEdit} />
        ) : null}
        {props.canDelete ? (
          <ActionButton
            icon="close"
            label="Delete"
            danger
            disabled={props.busy}
            onClick={props.onDelete}
          />
        ) : null}
      </div>
    </Sheet>
  );
}
