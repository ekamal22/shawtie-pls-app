import type { MediaAttachmentProjection } from "@shawtie/contracts";
import { type MouseEvent, useState } from "react";
import { Icon } from "../../design/icons.tsx";
import { MediaAttachment } from "../media/MediaAttachment.tsx";
import {
  type DeliveryLabel,
  type GroupPosition,
  isLongMessage,
  messageTimeLabel,
} from "./talk-model.ts";

export interface TalkBubbleMessage {
  readonly messageId: string;
  readonly senderAccountId: string;
  readonly body: string | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deletedAt: string | null;
  readonly replyContext: {
    readonly messageId: string;
    readonly senderAccountId: string;
    readonly body: string | null;
    readonly deleted: boolean;
  } | null;
  readonly reactions: ReadonlyArray<{ readonly accountId: string; readonly emoji: string }>;
  readonly attachments: readonly MediaAttachmentProjection[];
}

export interface TalkBubbleProps {
  readonly message: TalkBubbleMessage;
  readonly own: boolean;
  readonly position: GroupPosition;
  readonly authorName: string;
  readonly selfAccountId: string;
  readonly replyAuthorName: (accountId: string) => string;
  /** Delivery label, shown only on the last own message of a group. */
  readonly delivery: DeliveryLabel | null;
  readonly showTime: boolean;
  readonly kept: boolean;
  readonly highlighted: boolean;
  readonly canOpenActions: boolean;
  readonly onOpenActions: (messageId: string) => void;
  readonly onJumpTo: (messageId: string) => void;
}

const INTERACTIVE = "a, button, audio, video, input, textarea, select, summary, [role=button]";

/**
 * One message. No avatars, no tails. Tapping the bubble (or the named "Message actions"
 * button, which is always reachable by keyboard and screen reader) opens the action sheet.
 * A deleted message renders a placeholder only and never reveals its previous content.
 */
export function TalkBubble({
  message,
  own,
  position,
  authorName,
  selfAccountId,
  replyAuthorName,
  delivery,
  showTime,
  kept,
  highlighted,
  canOpenActions,
  onOpenActions,
  onJumpTo,
}: TalkBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const deleted = message.deletedAt !== null;
  const long = !deleted && isLongMessage(message.body);
  const created = new Date(message.createdAt);
  const actionable = canOpenActions && !deleted;

  function onBubbleClick(event: MouseEvent<HTMLDivElement>) {
    if (!actionable) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    onOpenActions(message.messageId);
  }

  const reactionCounts = new Map<string, { count: number; mine: boolean }>();
  if (!deleted) {
    for (const reaction of message.reactions) {
      const current = reactionCounts.get(reaction.emoji) ?? { count: 0, mine: false };
      reactionCounts.set(reaction.emoji, {
        count: current.count + 1,
        mine: current.mine || reaction.accountId === selfAccountId,
      });
    }
  }

  return (
    <article
      id={"talk-msg-" + message.messageId}
      className="talk-message"
      data-own={own ? "true" : "false"}
      data-position={position}
      data-deleted={deleted ? "true" : "false"}
      data-highlighted={highlighted ? "true" : "false"}
      aria-label={authorName + ", " + messageTimeLabel(created)}
    >
      <div className="talk-bubble" onClick={onBubbleClick} data-actionable={actionable}>
        {message.replyContext && !deleted ? (
          <button
            type="button"
            className="talk-quote"
            onClick={() => onJumpTo(message.replyContext!.messageId)}
            aria-label={
              "Replying to " +
              replyAuthorName(message.replyContext.senderAccountId) +
              ". Jump to original message"
            }
          >
            <span className="talk-quote__who">
              {replyAuthorName(message.replyContext.senderAccountId)}
            </span>
            <span className="talk-quote__text">
              {message.replyContext.deleted
                ? "Deleted message"
                : (message.replyContext.body ?? "A message from earlier")}
            </span>
          </button>
        ) : null}

        {deleted ? (
          <p className="talk-text talk-text--deleted">This message has been deleted</p>
        ) : message.body ? (
          <>
            <p
              className="talk-text"
              data-collapsed={long && !expanded ? "true" : "false"}
              id={"talk-text-" + message.messageId}
            >
              {message.body}
            </p>
            {long ? (
              <button
                type="button"
                className="talk-readmore"
                aria-expanded={expanded}
                aria-controls={"talk-text-" + message.messageId}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            ) : null}
          </>
        ) : null}

        {!deleted && message.attachments.length > 0 ? (
          <div className="talk-media">
            {message.attachments.map((attachment) => (
              <MediaAttachment
                key={attachment.mediaId}
                mediaId={attachment.mediaId}
                projection={attachment}
              />
            ))}
          </div>
        ) : null}

        {actionable ? (
          <button
            type="button"
            className="talk-more"
            aria-label={"Message actions for " + authorName + ", " + messageTimeLabel(created)}
            onClick={() => onOpenActions(message.messageId)}
          >
            <Icon name="more" size={18} />
          </button>
        ) : null}
      </div>

      {reactionCounts.size > 0 || kept ? (
        <div className="talk-reactions">
          {[...reactionCounts.entries()].map(([emoji, info]) => (
            <span
              key={emoji}
              className="talk-reaction"
              data-mine={info.mine ? "true" : "false"}
              aria-label={
                emoji +
                (info.count > 1 ? " from both of you" : info.mine ? " from you" : " from them")
              }
            >
              {emoji}
            </span>
          ))}
          {kept ? (
            <span className="talk-kept" aria-label="Kept">
              <Icon name="ribbon" size={14} filled />
              Kept
            </span>
          ) : null}
        </div>
      ) : null}

      {showTime || delivery || message.editedAt ? (
        <p className="talk-meta">
          {showTime ? <span>{messageTimeLabel(created)}</span> : null}
          {message.editedAt && !deleted ? <span>Edited</span> : null}
          {delivery ? <span data-delivery={delivery.toLowerCase()}>{delivery}</span> : null}
        </p>
      ) : null}
    </article>
  );
}
