import { type FormEvent, useEffect, useState } from "react";
import { Button, Sheet } from "../../design/primitives.tsx";
import { createRelationshipItem } from "../relationship-space/api.ts";
import {
  buildCreatePayload,
  CREATE_INTENTS,
  type CreatableKind,
  type CreateDraft,
  draftProblem,
  emptyDraft,
  hasOccurrence,
  needsText,
  needsTitle,
  SIGNALS,
  type SignalKind,
} from "./create-payload.ts";
import { oursMessageFor, queuedMutation } from "./messages.ts";

const KIND_LABEL = new Map(
  CREATE_INTENTS.flatMap((intent) => intent.kinds.map((entry) => [entry.kind, entry.label])),
);

function textLabel(kind: CreatableKind): string {
  if (kind === "surprise" || kind === "proposal") return "Steps, one per line";
  if (kind === "remember_this") return "Words to keep";
  if (kind === "for_you" || kind === "future_us") return "Your letter";
  if (kind === "relationship_signal") return "A few words, if you like";
  return "Words";
}

/**
 * Create sheet grouped by intent. Sends the same request bodies as the existing Relationship
 * Space create form through the unchanged create flow (offline queue included).
 * Photos, files, and voice letters are added in the full editor (`onOpenFullEditor`).
 */
export function OursCreateSheet({
  open,
  onClose,
  onCreated,
  onOpenFullEditor,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (message: string) => Promise<void>;
  readonly onOpenFullEditor: () => void;
}) {
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setError("");
      setBusy(false);
    }
  }, [open]);

  function patch(next: Partial<CreateDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createRelationshipItem(buildCreatePayload(draft));
      onClose();
      await onCreated(
        queuedMutation(result)
          ? "Saved. It will be added as soon as you are back online."
          : "Added to Ours.",
      );
    } catch (caught) {
      setError(oursMessageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const kind = draft?.kind;
  const letter = kind === "for_you" || kind === "future_us";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={draft ? (KIND_LABEL.get(draft.kind) ?? "Add") : "Add to Ours"}
    >
      {!draft ? (
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
                      onClick={() => setDraft(emptyDraft(entry.kind))}
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
        <form className="ours-create__form stack" onSubmit={submit}>
          {kind !== "relationship_signal" ? (
            <label className="field">
              <span>
                {kind === "remember_this" || letter || kind === "surprise" || kind === "proposal"
                  ? "Title, optional"
                  : "Title"}
              </span>
              <input
                value={draft.title}
                disabled={busy}
                onChange={(event) => patch({ title: event.target.value })}
                required={needsTitle(draft.kind)}
              />
            </label>
          ) : null}

          {kind &&
          [
            "remember_this",
            "for_you",
            "future_us",
            "love",
            "surprise",
            "proposal",
            "relationship_signal",
          ].includes(kind) ? (
            <label className="field">
              <span>{textLabel(draft.kind)}</span>
              <textarea
                rows={letter ? 8 : 5}
                value={draft.text}
                disabled={busy}
                onChange={(event) => patch({ text: event.target.value })}
                required={needsText(draft.kind)}
              />
            </label>
          ) : null}

          {kind &&
          [
            "memory",
            "remember_this",
            "first",
            "place",
            "someday",
            "surprise",
            "reunion",
            "proposal",
          ].includes(kind) ? (
            <label className="field">
              <span>
                {kind === "surprise" || kind === "proposal" ? "Intro, optional" : "Note, optional"}
              </span>
              <textarea
                rows={3}
                value={draft.note}
                disabled={busy}
                onChange={(event) => patch({ note: event.target.value })}
              />
            </label>
          ) : null}

          {hasOccurrence(draft.kind) ? (
            <div className="stack">
              <label className="field">
                <span>When was this?</span>
                <select
                  value={draft.precision}
                  disabled={busy}
                  onChange={(event) =>
                    patch({ precision: event.target.value as CreateDraft["precision"] })
                  }
                >
                  <option value="none">No date</option>
                  <option value="day">An exact day</option>
                  <option value="month">A month</option>
                  <option value="year">A year</option>
                  <option value="unknown">I am not sure</option>
                </select>
              </label>
              {draft.precision === "day" ? (
                <label className="field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={draft.date}
                    disabled={busy}
                    required
                    onChange={(event) => patch({ date: event.target.value })}
                  />
                </label>
              ) : null}
              {draft.precision === "month" ? (
                <label className="field">
                  <span>Month</span>
                  <input
                    type="month"
                    value={draft.month}
                    disabled={busy}
                    required
                    onChange={(event) => patch({ month: event.target.value })}
                  />
                </label>
              ) : null}
              {draft.precision === "year" ? (
                <label className="field">
                  <span>Year</span>
                  <input
                    type="number"
                    min="1900"
                    max="9999"
                    value={draft.year}
                    disabled={busy}
                    required
                    onChange={(event) => patch({ year: event.target.value })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {kind === "place" ? (
            <div className="ours-create__pair">
              <label className="field">
                <span>Latitude, optional</span>
                <input
                  inputMode="decimal"
                  value={draft.latitude}
                  disabled={busy}
                  onChange={(event) => patch({ latitude: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Longitude, optional</span>
                <input
                  inputMode="decimal"
                  value={draft.longitude}
                  disabled={busy}
                  onChange={(event) => patch({ longitude: event.target.value })}
                />
              </label>
            </div>
          ) : null}

          {letter ? (
            <>
              <label className="field">
                <span>When should it open?</span>
                <select
                  value={draft.releaseMode}
                  disabled={busy}
                  onChange={(event) =>
                    patch({ releaseMode: event.target.value as CreateDraft["releaseMode"] })
                  }
                >
                  <option value="immediate">Share now</option>
                  <option value="scheduled">On a date</option>
                  <option value="recipient_open">When they choose</option>
                </select>
              </label>
              {draft.releaseMode === "scheduled" ? (
                <label className="field">
                  <span>Opens on</span>
                  <input
                    type="datetime-local"
                    value={draft.unlockAt}
                    disabled={busy}
                    required
                    onChange={(event) => patch({ unlockAt: event.target.value })}
                  />
                </label>
              ) : null}
              {draft.releaseMode === "recipient_open" ? (
                <label className="field">
                  <span>A line on the envelope</span>
                  <input
                    value={draft.conditionLabel}
                    disabled={busy}
                    placeholder="Open when you need reassurance"
                    onChange={(event) => patch({ conditionLabel: event.target.value })}
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {kind === "surprise" || kind === "proposal" ? (
            <label className="field">
              <span>Reveal</span>
              <select
                value={draft.releaseMode}
                disabled={busy}
                onChange={(event) =>
                  patch({ releaseMode: event.target.value as CreateDraft["releaseMode"] })
                }
              >
                <option value="creator_reveal">Keep private until I reveal it</option>
                <option value="immediate">Share now</option>
              </select>
            </label>
          ) : null}

          {kind === "someday" ? (
            <label className="field">
              <span>Where is it</span>
              <select
                value={draft.somedayState}
                disabled={busy}
                onChange={(event) =>
                  patch({ somedayState: event.target.value as CreateDraft["somedayState"] })
                }
              >
                <option value="someday">Someday</option>
                <option value="soon">Soon</option>
                <option value="completed">We did it</option>
              </select>
            </label>
          ) : null}

          {kind === "love" ? (
            <label className="field">
              <span>What kind</span>
              <select
                value={draft.loveCategory}
                disabled={busy}
                onChange={(event) =>
                  patch({ loveCategory: event.target.value as CreateDraft["loveCategory"] })
                }
              >
                <option value="reason">A reason</option>
                <option value="noticed">Something I noticed</option>
                <option value="remembered">Something I remembered</option>
              </select>
            </label>
          ) : null}

          {kind === "reunion" ? (
            <label className="field">
              <span>Reunion date</span>
              <input
                type="date"
                value={draft.reunionDate}
                disabled={busy}
                required
                onChange={(event) => patch({ reunionDate: event.target.value })}
              />
            </label>
          ) : null}

          {kind === "relationship_signal" ? (
            <label className="field">
              <span>Signal</span>
              <select
                value={draft.signalKind}
                disabled={busy}
                onChange={(event) => patch({ signalKind: event.target.value as SignalKind })}
              >
                {SIGNALS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {kind && kind !== "relationship_signal" ? (
            <p className="ours-create__hint">
              Photos, files, and voice letters can be added in the{" "}
              <button type="button" className="link" onClick={onOpenFullEditor}>
                full editor
              </button>
              .
            </p>
          ) : null}

          {error ? (
            <p className="banner error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="ours-actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving..." : "Add to Ours"}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setDraft(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
