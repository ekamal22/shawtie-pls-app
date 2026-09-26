import { useState } from "react";
import { LetterCard } from "./LetterViews.tsx";
import { LoveCard, PrintEntry } from "./MemoryViews.tsx";
import { MomentCard, SignalRow } from "./MomentViews.tsx";
import { ListState, ViewHeader } from "./parts.tsx";
import { useRelationshipItems } from "./data.ts";
import type { RelationshipItem } from "./model.ts";
import type { ContentViewProps } from "./types.ts";

/** Renders any relationship item with the treatment that belongs to its kind. */
export function ItemByKind({
  item,
  accountId,
  disabled,
  onChanged,
  partnerName,
  onOpenMessage,
  unfoldingId,
  setUnfoldingId,
}: {
  readonly item: RelationshipItem;
  readonly accountId: string;
  readonly disabled: boolean;
  readonly onChanged: () => Promise<void>;
  readonly partnerName?: string | undefined;
  readonly onOpenMessage?: ((messageId: string) => void) | undefined;
  readonly unfoldingId: string | null;
  readonly setUnfoldingId: (id: string | null) => void;
}) {
  switch (item.kind) {
    case "for_you":
    case "future_us":
      return (
        <LetterCard
          item={item}
          accountId={accountId}
          disabled={disabled}
          onChanged={onChanged}
          partnerName={partnerName}
          unfolding={unfoldingId === item.itemId}
          onOpening={setUnfoldingId}
          onOpenFailed={() => setUnfoldingId(null)}
          onUnfoldDone={() => setUnfoldingId(null)}
        />
      );
    case "surprise":
    case "proposal":
      return (
        <MomentCard
          item={item}
          framing={item.kind}
          accountId={accountId}
          disabled={disabled}
          onChanged={onChanged}
          partnerName={partnerName}
        />
      );
    case "love":
      return (
        <LoveCard item={item} accountId={accountId} disabled={disabled} onChanged={onChanged} />
      );
    case "relationship_signal":
      return (
        <ul className="mem-signals">
          <SignalRow item={item} accountId={accountId} disabled={disabled} onChanged={onChanged} />
        </ul>
      );
    default:
      return (
        <PrintEntry
          item={item}
          accountId={accountId}
          disabled={disabled}
          onChanged={onChanged}
          partnerName={partnerName}
          onOpenMessage={onOpenMessage}
          showKind
        />
      );
  }
}

/** Items that are waiting to be opened or revealed, shown as sealed letters and moments. */
export function WaitingView(
  props: ContentViewProps & { readonly items: readonly RelationshipItem[] },
) {
  const [unfoldingId, setUnfoldingId] = useState<string | null>(null);
  if (props.items.length === 0) return null;
  return (
    <section className="mem-view mem-waiting" aria-label="Not opened yet">
      {props.heading !== false ? <ViewHeader title="Not opened yet" /> : null}
      <div className="mem-letters">
        {props.items.map((item) => (
          <ItemByKind
            key={item.itemId}
            item={item}
            accountId={props.accountId}
            disabled={props.disabled ?? false}
            onChanged={async () => {
              await props.onChanged?.();
            }}
            partnerName={props.partnerName}
            unfoldingId={unfoldingId}
            setUnfoldingId={setUnfoldingId}
          />
        ))}
      </div>
    </section>
  );
}

/** The most recently added things, across every kind. */
export function RecentView(props: ContentViewProps) {
  const state = useRelationshipItems({}, props.items);
  const [unfoldingId, setUnfoldingId] = useState<string | null>(null);
  const changed = async () => {
    await state.reload();
    await props.onChanged?.();
  };
  return (
    <section className="mem-view" aria-label="Recent">
      {props.heading !== false ? <ViewHeader title="Recently added" /> : null}
      <ListState
        state={state}
        emptyTitle="Your space is ready"
        emptyBody="Add a memory, a letter, or a small note whenever you like. It stays here for the two of you."
        emptyAction={
          props.onAdd && !props.disabled ? (
            <button type="button" className="ds-button ds-button--primary" onClick={props.onAdd}>
              Add something
            </button>
          ) : undefined
        }
      >
        <div className="mem-recent">
          {state.items.map((item) => (
            <ItemByKind
              key={item.itemId}
              item={item}
              accountId={props.accountId}
              disabled={props.disabled ?? false}
              onChanged={changed}
              partnerName={props.partnerName}
              onOpenMessage={props.onOpenMessage}
              unfoldingId={unfoldingId}
              setUnfoldingId={setUnfoldingId}
            />
          ))}
        </div>
      </ListState>
    </section>
  );
}
