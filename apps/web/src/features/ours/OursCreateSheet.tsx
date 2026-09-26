import { useEffect, useState } from "react";
import { Sheet } from "../../design/primitives.tsx";
import { RelationshipComposer } from "./content/index.ts";
import { CREATE_INTENTS, type CreatableKind } from "./create-payload.ts";

const KIND_LABEL = new Map(
  CREATE_INTENTS.flatMap((intent) => intent.kinds.map((entry) => [entry.kind, entry.label])),
);

/**
 * Create sheet grouped by intent. Choosing what to add opens the UX6 composer for that kind,
 * which sends the unchanged create flow (offline queue, idempotency key, and media drafts
 * included), so Ours and the full space create items identically.
 */
export function OursCreateSheet({
  open,
  onClose,
  onCreated,
  accountId,
  partnershipId,
  disabled,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (message: string) => Promise<void>;
  readonly accountId: string;
  readonly partnershipId: string | null;
  readonly disabled: boolean;
}) {
  const [kind, setKind] = useState<CreatableKind | null>(null);

  useEffect(() => {
    if (!open) setKind(null);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={kind ? (KIND_LABEL.get(kind) ?? "Add") : "Add to Ours"}
    >
      {!kind ? (
        <div className="ours-create">
          {CREATE_INTENTS.map((intent) => (
            <section key={intent.id} className="ours-create__group" aria-label={intent.title}>
              <h3 className="ours-create__heading">{intent.title}</h3>
              <p className="ours-create__hint">{intent.hint}</p>
              <ul className="ours-create__list">
                {intent.kinds.map((entry) => (
                  <li key={entry.kind}>
                    <button
                      type="button"
                      className="ours-create__choice"
                      onClick={() => setKind(entry.kind)}
                    >
                      {entry.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <RelationshipComposer
          accountId={accountId}
          partnershipId={partnershipId}
          disabled={disabled}
          initialKind={kind}
          onCreated={async () => {
            onClose();
            await onCreated("Added to Ours.");
          }}
        />
      )}
    </Sheet>
  );
}
