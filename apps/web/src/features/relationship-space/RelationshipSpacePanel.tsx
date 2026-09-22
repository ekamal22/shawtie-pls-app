import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../../lib/api-client.ts";
import {
  createRelationshipItem,
  deleteRelationshipItem,
  listRelationshipItems,
  loadAnniversary,
  loadOurYear,
  loadRelationshipHome,
  loadThisDay,
  patchRelationshipItem,
  releaseRelationshipItem,
} from "./api.ts";
import type {
  RelationshipItem,
  RelationshipItemKind,
  RelationshipSpaceHome,
} from "./model.ts";

const KINDS: readonly { value: RelationshipItemKind; label: string }[] = [
  { value: "memory", label: "Memory" },
  { value: "remember_this", label: "Remember This" },
  { value: "first", label: "First" },
  { value: "place", label: "Place" },
  { value: "for_you", label: "For You" },
  { value: "future_us", label: "Future Us" },
  { value: "love", label: "Love" },
  { value: "someday", label: "Someday" },
  { value: "our_year", label: "Our Year" },
  { value: "anniversary", label: "Anniversary" },
  { value: "surprise", label: "Surprise" },
  { value: "reunion", label: "Until We're Together Again" },
  { value: "proposal", label: "Proposal" },
  { value: "relationship_signal", label: "Signal" },
];

const SIGNALS = [
  ["i_need_you", "I need you"],
  ["call_me_when_you_can", "Call me when you can"],
  ["i_need_reassurance", "I need reassurance"],
  ["shared_feeling", "Share a feeling"],
  ["thinking_of_you", "Thinking of you"],
  ["kiss", "Kiss"],
  ["hug", "Hug"],
] as const;

function messageFor(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "Something went wrong.";
  const known: Record<string, string> = {
    AUTH_REQUIRED: "Please sign in again.",
    IDEMPOTENCY_KEY_REUSED: "That action changed. Try again.",
    INVALID_ITEM_LINK: "One selected relationship item is no longer available.",
    INVALID_OCCURRENCE: "Check the date and try again.",
    INVALID_REFERENCE: "That attachment or source is not available here.",
    ITEM_ALREADY_RELEASED: "This has already been opened.",
    ITEM_IMMUTABLE_AFTER_RELEASE: "Opened content cannot be edited.",
    NO_CURRENT_PARTNERSHIP: "There is no current relationship space.",
    REFERENCE_TYPE_UNAVAILABLE: "That attachment type is not available yet.",
    RELATIONSHIP_ITEM_IMMUTABLE: "This item can no longer be edited.",
    RELATIONSHIP_ITEM_NOT_FOUND: "That relationship item is no longer available.",
    RELATIONSHIP_ITEM_NOT_OWNED: "Only the person who created this can change it.",
    RELATIONSHIP_SHARED_STATE_NOT_ALLOWED: "That shared state cannot be changed.",
    RELATIONSHIP_SPACE_VIEW_ONLY: "Relationship Space is currently view-only.",
    RELEASE_NOT_ALLOWED: "This item cannot be opened from this account.",
    RELEASE_TIME_INVALID: "Choose a future release time.",
    REUNION_DATE_INVALID: "Choose today or a future reunion date.",
    UNSUPPORTED_CONTENT_SCHEMA_VERSION: "This relationship item needs a newer app version.",
    VERSION_CONFLICT: "This changed on another device. Refresh and try again.",
  };
  return known[error.code] ?? error.code.replaceAll("_", " ").toLowerCase();
}

function titleForKind(kind: RelationshipItemKind): string {
  return KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

function readString(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const item = value?.[key];
  return typeof item === "string" && item.trim() ? item : null;
}

function readSequenceSteps(
  value: Record<string, unknown> | null,
): string[] {
  const steps = value?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const text = (entry as Record<string, unknown>).text;
    return typeof text === "string" && text.trim() ? [text] : [];
  });
}

function readCoordinate(
  value: Record<string, unknown> | null,
  key: "latitude" | "longitude",
): number | null {
  const coordinate = value?.[key];
  return typeof coordinate === "number" && Number.isFinite(coordinate)
    ? coordinate
    : null;
}

function daysUntil(serverDate: string, targetDate: string): number {
  const start = new Date(serverDate + "T00:00:00.000Z").getTime();
  const target = new Date(targetDate + "T00:00:00.000Z").getTime();
  return Math.max(0, Math.ceil((target - start) / (24 * 60 * 60_000)));
}

function itemTitle(item: RelationshipItem): string {
  return (
    readString(item.preview, "title") ??
    readString(item.content, "title") ??
    readString(item.content, "text") ??
    readString(item.content, "snapshotText") ??
    readString(item.content, "body") ??
    titleForKind(item.kind)
  );
}

function occurrenceLabel(item: RelationshipItem): string | null {
  const value = item.occurrence;
  if (!value || value.precision === "unknown" || value.year === null) return null;
  if (value.precision === "year") return String(value.year);
  if (value.month === null) return String(value.year);
  const month = String(value.month).padStart(2, "0");
  if (value.precision === "month") return value.year + "-" + month;
  return (
    value.year +
    "-" +
    month +
    "-" +
    String(value.day ?? 1).padStart(2, "0")
  );
}

function durationLabel(home: RelationshipSpaceHome): string {
  const parts = [
    home.relationshipDuration.years
      ? home.relationshipDuration.years + "y"
      : "",
    home.relationshipDuration.months
      ? home.relationshipDuration.months + "m"
      : "",
    home.relationshipDuration.days
      ? home.relationshipDuration.days + "d"
      : "",
  ].filter(Boolean);
  return parts.join(" ") || "Today";
}

function ItemCard({
  item,
  accountId,
  disabled,
  onChanged,
}: {
  item: RelationshipItem;
  accountId: string;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(
    readString(item.content, "title") ?? readString(item.preview, "title") ?? "",
  );
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
  const [draftBody, setDraftBody] = useState(
    bodyKey ? readString(item.content, bodyKey) ?? "" : "",
  );
  const [draftReunionDate, setDraftReunionDate] = useState(
    item.featureState?.type === "reunion" ? item.featureState.targetDate : "",
  );
  const isCreator = item.creatorAccountId === accountId;
  const locked = item.release?.state === "locked";
  const canOpen =
    !disabled &&
    locked &&
    item.release?.mode === "recipient_open" &&
    !isCreator;
  const canReveal =
    !disabled &&
    locked &&
    item.release?.mode === "creator_reveal" &&
    isCreator;
  const canDelete =
    !disabled &&
    (isCreator ||
      item.kind === "our_year" ||
      item.kind === "anniversary" ||
      item.kind === "reunion");
  const canEdit =
    !disabled &&
    item.kind !== "relationship_signal" &&
    item.release?.state !== "released" &&
    Boolean(item.content) &&
    (isCreator ||
      item.kind === "our_year" ||
      item.kind === "anniversary" ||
      item.kind === "reunion");

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await onChanged();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggleStory() {
    await run(async () => {
      await patchRelationshipItem(item.itemId, {
        expectedVersion: item.version,
        storyIncluded: !item.storyIncluded,
      });
    });
  }

  async function advanceSomeday() {
    if (item.featureState?.type !== "someday") return;
    const state =
      item.featureState.state === "someday"
        ? "soon"
        : item.featureState.state === "soon"
          ? "completed"
          : "someday";
    await run(async () => {
      await patchRelationshipItem(item.itemId, {
        expectedVersion: item.version,
        featureState: { type: "someday", state },
      });
    });
  }

  async function release() {
    await run(async () => {
      await releaseRelationshipItem(item.itemId, item.version);
    });
  }

  async function remove() {
    if (!window.confirm("Delete this relationship item?")) return;
    await run(async () => {
      await deleteRelationshipItem(item.itemId, item.version);
    });
  }

  async function saveEdit() {
    if (!item.content) return;
    const nextContent: Record<string, unknown> = { ...item.content };
    if ("title" in nextContent) nextContent.title = draftTitle.trim();
    if (bodyKey) nextContent[bodyKey] = draftBody.trim() || null;
    await run(async () => {
      await patchRelationshipItem(item.itemId, {
        expectedVersion: item.version,
        content: nextContent,
      });
      setEditing(false);
    });
  }

  async function saveReunionDate() {
    if (item.featureState?.type !== "reunion" || !draftReunionDate) return;
    await run(async () => {
      await patchRelationshipItem(item.itemId, {
        expectedVersion: item.version,
        featureState: {
          type: "reunion",
          targetDate: draftReunionDate,
        },
      });
    });
  }

  const sequenceSteps = readSequenceSteps(item.content);
  const latitude = readCoordinate(item.content, "latitude");
  const longitude = readCoordinate(item.content, "longitude");

  return (
    <article className="relationship-item-card">
      <div className="relationship-item-card__top">
        <div>
          <span className="relationship-kicker">{titleForKind(item.kind)}</span>
          <strong>{itemTitle(item)}</strong>
        </div>
        {item.storyIncluded ? <span className="pill">Our Story</span> : null}
      </div>

      {occurrenceLabel(item) ? (
        <span className="hint">{occurrenceLabel(item)}</span>
      ) : null}

      {item.release?.state === "locked" ? (
        <div className="relationship-lock">
          <span>Locked</span>
          {readString(item.preview, "conditionLabel") ? (
            <p>{readString(item.preview, "conditionLabel")}</p>
          ) : null}
          {item.release.unlockAt ? (
            <p className="hint">
              Scheduled for {new Date(item.release.unlockAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}

      {item.content ? (
        <p className="relationship-item-body">
          {readString(item.content, "body") ??
            readString(item.content, "note") ??
            readString(item.content, "snapshotText") ??
            readString(item.content, "text") ??
            readString(item.content, "intro") ??
            ""}
        </p>
      ) : null}

      {sequenceSteps.length ? (
        <ol className="relationship-sequence">
          {sequenceSteps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      ) : null}

      {latitude !== null && longitude !== null ? (
        <p className="hint">
          Coordinates: {latitude}, {longitude}
        </p>
      ) : null}

      {item.featureState?.type === "someday" ? (
        <p className="hint">State: {item.featureState.state.replace("_", " ")}</p>
      ) : null}

      {item.featureState?.type === "reunion" ? (
        <div className="relationship-reunion-editor">
          <p className="hint">Target: {item.featureState.targetDate}</p>
          {!disabled ? (
            <div className="relationship-actions">
              <input
                type="date"
                value={draftReunionDate}
                disabled={busy}
                onChange={(event) => setDraftReunionDate(event.target.value)}
              />
              <button
                type="button"
                className="secondary compact"
                disabled={busy || !draftReunionDate}
                onClick={() => void saveReunionDate()}
              >
                Update date
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {item.featureState?.type === "relationship_signal" ? (
        <p className="relationship-signal">
          {item.featureState.signalKind.replaceAll("_", " ")}
        </p>
      ) : null}

      {editing ? (
        <div className="relationship-inline-editor stack">
          {item.content && "title" in item.content ? (
            <label className="field">
              <span>Title</span>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            </label>
          ) : null}
          {bodyKey ? (
            <label className="field">
              <span>Text</span>
              <textarea
                rows={4}
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
              />
            </label>
          ) : null}
          <div className="relationship-actions">
            <button
              type="button"
              className="primary compact"
              disabled={busy}
              onClick={() => void saveEdit()}
            >
              Save
            </button>
            <button
              type="button"
              className="secondary compact"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="banner error">{error}</p> : null}

      <div className="relationship-actions">
        {canEdit && !editing ? (
          <button
            type="button"
            className="secondary compact"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="secondary compact"
          disabled={busy || disabled}
          onClick={() => void toggleStory()}
        >
          {item.storyIncluded ? "Remove from Story" : "Add to Story"}
        </button>

        {item.featureState?.type === "someday" ? (
          <button
            type="button"
            className="secondary compact"
            disabled={busy || disabled}
            onClick={() => void advanceSomeday()}
          >
            Next state
          </button>
        ) : null}

        {canOpen ? (
          <button
            type="button"
            className="primary compact"
            disabled={busy}
            onClick={() => void release()}
          >
            Open
          </button>
        ) : null}

        {canReveal ? (
          <button
            type="button"
            className="primary compact"
            disabled={busy}
            onClick={() => void release()}
          >
            Reveal
          </button>
        ) : null}

        {canDelete ? (
          <button
            type="button"
            className="link compact"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}

function CreateRelationshipItem({
  disabled,
  onCreated,
}: {
  disabled: boolean;
  onCreated: () => Promise<void>;
}) {
  const [kind, setKind] = useState<RelationshipItemKind>("memory");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [occurrenceDate, setOccurrenceDate] = useState("");
  const [releaseMode, setReleaseMode] = useState<
    "immediate" | "scheduled" | "recipient_open" | "creator_reveal"
  >("immediate");
  const [unlockAt, setUnlockAt] = useState("");
  const [conditionLabel, setConditionLabel] = useState("");
  const [somedayState, setSomedayState] = useState<
    "someday" | "soon" | "completed"
  >("someday");
  const [signalKind, setSignalKind] = useState<(typeof SIGNALS)[number][0]>(
    "thinking_of_you",
  );
  const [reunionDate, setReunionDate] = useState("");
  const [loveCategory, setLoveCategory] = useState<
    "reason" | "noticed" | "remembered"
  >("reason");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const releaseKind = kind === "for_you" || kind === "future_us";
  const revealKind = kind === "surprise" || kind === "proposal";
  const currentYear = new Date().getUTCFullYear();

  useEffect(() => {
    if (revealKind) setReleaseMode("creator_reveal");
    else if (releaseKind) setReleaseMode("immediate");
    else setReleaseMode("immediate");
  }, [kind, revealKind, releaseKind]);

  function occurrence() {
    if (!occurrenceDate) return null;
    const [year, month, day] = occurrenceDate.split("-").map(Number);
    return { precision: "day" as const, year, month, day };
  }

  function payload(): unknown {
    const base = {
      kind,
      contentSchemaVersion: 1,
      occurrence: occurrence(),
      storyIncluded: false,
      references: [],
      links: [],
    };

    switch (kind) {
      case "memory":
      case "first":
        return {
          ...base,
          preview: null,
          content: { title: title.trim(), note: note.trim() || null },
          release: null,
          featureState: null,
        };
      case "remember_this":
        return {
          ...base,
          preview: null,
          content: {
            title: title.trim() || null,
            snapshotText: text.trim() || null,
            note: note.trim() || null,
          },
          release: null,
          featureState: null,
        };
      case "place":
        return {
          ...base,
          preview: null,
          content: {
            title: title.trim(),
            note: note.trim() || null,
            latitude: latitude ? Number(latitude) : null,
            longitude: longitude ? Number(longitude) : null,
          },
          release: null,
          featureState: null,
        };
      case "for_you":
      case "future_us":
        return {
          ...base,
          preview: {
            title: title.trim() || null,
            conditionLabel:
              releaseMode === "recipient_open"
                ? conditionLabel.trim() || null
                : null,
          },
          content: { body: text.trim() },
          release:
            releaseMode === "scheduled"
              ? {
                  mode: "scheduled",
                  unlockAt: new Date(unlockAt).toISOString(),
                }
              : releaseMode === "recipient_open"
                ? { mode: "recipient_open", unlockAt: null }
                : { mode: "immediate", unlockAt: null },
          featureState: null,
        };
      case "love":
        return {
          ...base,
          preview: null,
          content: { category: loveCategory, text: text.trim() },
          release: null,
          featureState: null,
        };
      case "someday":
        return {
          ...base,
          preview: null,
          content: { title: title.trim(), note: note.trim() || null },
          release: null,
          featureState: { type: "someday", state: somedayState },
        };
      case "our_year":
      case "anniversary":
        return {
          ...base,
          preview: null,
          content: {
            title: title.trim() || null,
            note: note.trim() || null,
          },
          release: null,
          featureState: {
            type: "curation",
            curationType: kind,
            anchorYear: currentYear,
          },
        };
      case "surprise":
      case "proposal":
        return {
          ...base,
          preview: { title: title.trim() || null },
          content: {
            intro: note.trim() || null,
            steps: text
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => ({ type: "text", text: line })),
          },
          release:
            releaseMode === "immediate"
              ? { mode: "immediate", unlockAt: null }
              : { mode: "creator_reveal", unlockAt: null },
          featureState: null,
        };
      case "reunion":
        return {
          ...base,
          preview: null,
          content: { title: title.trim() || null, note: note.trim() || null },
          release: null,
          featureState: { type: "reunion", targetDate: reunionDate },
        };
      case "relationship_signal":
        return {
          ...base,
          preview: null,
          content: { sharedFeelingText: text.trim() || null },
          occurrence: null,
          storyIncluded: false,
          release: null,
          featureState: {
            type: "relationship_signal",
            signalKind,
          },
        };
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createRelationshipItem(payload());
      setTitle("");
      setText("");
      setNote("");
      setOccurrenceDate("");
      setConditionLabel("");
      setUnlockAt("");
      setLatitude("");
      setLongitude("");
      await onCreated();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="relationship-create stack" onSubmit={submit}>
      <div className="relationship-create__heading">
        <div>
          <span className="relationship-kicker">Create</span>
          <strong>Add something to your space</strong>
        </div>
      </div>

      <label className="field">
        <span>Type</span>
        <select
          value={kind}
          disabled={busy || disabled}
          onChange={(event) => setKind(event.target.value as RelationshipItemKind)}
        >
          {KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      {kind !== "relationship_signal" ? (
        <label className="field">
          <span>Title</span>
          <input
            value={title}
            disabled={busy || disabled}
            onChange={(event) => setTitle(event.target.value)}
            required={["memory", "first", "place", "someday"].includes(kind)}
          />
        </label>
      ) : null}

      {["remember_this", "for_you", "future_us", "love", "surprise", "proposal", "relationship_signal"].includes(
        kind,
      ) ? (
        <label className="field">
          <span>
            {kind === "surprise" || kind === "proposal"
              ? "Sequence steps, one per line"
              : kind === "remember_this"
                ? "Saved text"
                : "Text"}
          </span>
          <textarea
            rows={5}
            value={text}
            disabled={busy || disabled}
            onChange={(event) => setText(event.target.value)}
            required={["for_you", "future_us", "love"].includes(kind)}
          />
        </label>
      ) : null}

      {["memory", "remember_this", "first", "place", "someday", "our_year", "anniversary", "surprise", "reunion", "proposal"].includes(
        kind,
      ) ? (
        <label className="field">
          <span>{kind === "surprise" || kind === "proposal" ? "Intro" : "Note"}</span>
          <textarea
            rows={3}
            value={note}
            disabled={busy || disabled}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      ) : null}

      {["memory", "remember_this", "first", "place", "love"].includes(kind) ? (
        <label className="field">
          <span>Date, optional</span>
          <input
            type="date"
            value={occurrenceDate}
            disabled={busy || disabled}
            onChange={(event) => setOccurrenceDate(event.target.value)}
          />
        </label>
      ) : null}

      {kind === "place" ? (
        <div className="relationship-coordinate-grid">
          <label className="field">
            <span>Latitude, optional</span>
            <input
              inputMode="decimal"
              value={latitude}
              disabled={busy || disabled}
              onChange={(event) => setLatitude(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Longitude, optional</span>
            <input
              inputMode="decimal"
              value={longitude}
              disabled={busy || disabled}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {releaseKind ? (
        <>
          <label className="field">
            <span>Opening</span>
            <select
              value={releaseMode}
              disabled={busy || disabled}
              onChange={(event) =>
                setReleaseMode(
                  event.target.value as
                    | "immediate"
                    | "scheduled"
                    | "recipient_open",
                )
              }
            >
              <option value="immediate">Share now</option>
              <option value="scheduled">Open on a date</option>
              <option value="recipient_open">Open when...</option>
            </select>
          </label>
          {releaseMode === "scheduled" ? (
            <label className="field">
              <span>Release time</span>
              <input
                type="datetime-local"
                value={unlockAt}
                disabled={busy || disabled}
                required
                onChange={(event) => setUnlockAt(event.target.value)}
              />
            </label>
          ) : null}
          {releaseMode === "recipient_open" ? (
            <label className="field">
              <span>Opening label</span>
              <input
                value={conditionLabel}
                disabled={busy || disabled}
                placeholder="Open when you need reassurance"
                onChange={(event) => setConditionLabel(event.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : null}

      {revealKind ? (
        <label className="field">
          <span>Reveal</span>
          <select
            value={releaseMode}
            disabled={busy || disabled}
            onChange={(event) =>
              setReleaseMode(
                event.target.value as "immediate" | "creator_reveal",
              )
            }
          >
            <option value="creator_reveal">Keep private until I reveal it</option>
            <option value="immediate">Share now</option>
          </select>
        </label>
      ) : null}

      {kind === "someday" ? (
        <label className="field">
          <span>State</span>
          <select
            value={somedayState}
            disabled={busy || disabled}
            onChange={(event) =>
              setSomedayState(
                event.target.value as "someday" | "soon" | "completed",
              )
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
          <span>Category</span>
          <select
            value={loveCategory}
            disabled={busy || disabled}
            onChange={(event) =>
              setLoveCategory(
                event.target.value as "reason" | "noticed" | "remembered",
              )
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
            value={reunionDate}
            disabled={busy || disabled}
            required
            onChange={(event) => setReunionDate(event.target.value)}
          />
        </label>
      ) : null}

      {kind === "relationship_signal" ? (
        <label className="field">
          <span>Signal</span>
          <select
            value={signalKind}
            disabled={busy || disabled}
            onChange={(event) =>
              setSignalKind(event.target.value as (typeof SIGNALS)[number][0])
            }
          >
            {SIGNALS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? <p className="banner error">{error}</p> : null}

      <button className="primary" disabled={busy || disabled}>
        {busy ? "Saving..." : "Add to Relationship Space"}
      </button>

      <p className="hint">
        Voice Letters attach to relationship objects through the media milestone.
        R1 keeps their visibility tied to the item they belong to.
      </p>
    </form>
  );
}

export function RelationshipSpacePanel({ accountId }: { accountId: string }) {
  const [home, setHome] = useState<RelationshipSpaceHome | null | undefined>(
    undefined,
  );
  const [items, setItems] = useState<RelationshipItem[]>([]);
  const [filter, setFilter] = useState<RelationshipItemKind | "all" | "story">(
    "all",
  );
  const [experience, setExperience] = useState<{
    title: string;
    items: RelationshipItem[];
    curationType?: "our_year" | "anniversary";
    anchorYear?: number;
    savedCuration?: RelationshipItem | null;
  } | null>(null);
  const [selectedCurationIds, setSelectedCurationIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const viewOnly = home ? home.mode !== "active" : true;

  async function load() {
    const [homeResult, itemResult] = await Promise.all([
      loadRelationshipHome(),
      listRelationshipItems(
        filter === "story"
          ? { storyOnly: true, sort: "occurred_asc" }
          : filter === "all"
            ? {}
            : { kind: filter },
      ),
    ]);
    setHome(homeResult.space);
    setItems(homeResult.space ? itemResult.items : []);
  }

  useEffect(() => {
    void load().catch((caught) => setError(messageFor(caught)));
  }, [filter]);

  useEffect(() => {
    const refresh = () => void load().catch(() => undefined);
    const resetAndRefresh = () => {
      setHome(undefined);
      setItems([]);
      setExperience(null);
      setNotice("");
      setError("");
      void load().catch((caught) => setError(messageFor(caught)));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("shawtie:partnership-changed", resetAndRefresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("shawtie:partnership-changed", resetAndRefresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [filter]);

  const modeMessage = useMemo(() => {
    if (!home) return "";
    if (home.mode === "breakup_pending_view_only") {
      return "Relationship Space is view-only during the breakup process. Existing scheduled letters may still arrive before the final deadline.";
    }
    if (home.mode === "account_deletion_view_only") {
      return "Relationship Space is view-only during account recovery. Unreleased letters and reveals are paused.";
    }
    return "";
  }, [home]);

  async function runExperience(
    task: () => Promise<{
      title: string;
      items: RelationshipItem[];
      curationType?: "our_year" | "anniversary";
      anchorYear?: number;
      savedCuration?: RelationshipItem | null;
    }>,
  ) {
    setBusy(true);
    setError("");
    try {
      const next = await task();
      setExperience(next);
      setSelectedCurationIds(
        next.savedCuration?.links
          .filter((link) => link.linkType === "curation")
          .sort((left, right) => left.position - right.position)
          .map((link) => link.targetItemId) ?? [],
      );
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  function toggleCurationItem(itemId: string) {
    setSelectedCurationIds((current) =>
      current.includes(itemId)
        ? current.filter((value) => value !== itemId)
        : [...current, itemId],
    );
  }

  async function saveExperienceCuration() {
    if (
      !experience?.curationType ||
      experience.anchorYear === undefined ||
      viewOnly
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const links = selectedCurationIds.map((targetItemId, position) => ({
        linkType: "curation" as const,
        targetItemId,
        position,
      }));
      if (experience.savedCuration) {
        await patchRelationshipItem(experience.savedCuration.itemId, {
          expectedVersion: experience.savedCuration.version,
          links,
        });
      } else {
        await createRelationshipItem({
          kind: experience.curationType,
          contentSchemaVersion: 1,
          preview: null,
          content: {
            title: experience.title,
            note: null,
          },
          occurrence: null,
          storyIncluded: false,
          release: null,
          featureState: {
            type: "curation",
            curationType: experience.curationType,
            anchorYear: experience.anchorYear,
          },
          references: [],
          links,
        });
      }
      setExperience(null);
      await refresh("Curation saved.");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refresh(message?: string) {
    await load();
    if (message) setNotice(message);
  }

  if (home === undefined) {
    return (
      <section className="panel relationship-space">
        <h2>Relationship Space</h2>
        <p className="muted">Loading your shared space...</p>
      </section>
    );
  }

  if (!home) {
    return null;
  }

  return (
    <section className="panel relationship-space">
      <div className="relationship-home-hero">
        <div>
          <span className="relationship-kicker">Us</span>
          <h2>Relationship Space</h2>
          <p className="muted">
            Together for {durationLabel(home)}. Since {home.relationshipStartDate}.
          </p>
        </div>
        <div className="relationship-anniversary">
          <span>Anniversary</span>
          <strong>{home.anniversary.date}</strong>
        </div>
      </div>

      {modeMessage ? <p className="banner error">{modeMessage}</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner success">{notice}</p> : null}

      {home.reunion?.featureState?.type === "reunion" ? (
        <div className="relationship-reunion">
          <span className="relationship-kicker">Until we're together again</span>
          <strong>
            {daysUntil(home.serverDate, home.reunion.featureState.targetDate)} days
          </strong>
          <span className="hint">{home.reunion.featureState.targetDate}</span>
        </div>
      ) : null}

      {home.upcomingReleases.length ? (
        <div className="relationship-section">
          <h3>Waiting for you</h3>
          <div className="relationship-card-grid">
            {home.upcomingReleases.map((item) => (
              <ItemCard
                key={item.itemId}
                item={item}
                accountId={accountId}
                disabled={viewOnly}
                onChanged={() => refresh()}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="relationship-filter-strip" role="tablist" aria-label="Relationship Space">
        <button
          className={filter === "all" ? "active" : ""}
          type="button"
          onClick={() => setFilter("all")}
        >
          Recent
        </button>
        <button
          className={filter === "story" ? "active" : ""}
          type="button"
          onClick={() => setFilter("story")}
        >
          Our Story
        </button>
        {KINDS.filter(
          (entry) =>
            !["our_year", "anniversary", "relationship_signal"].includes(entry.value),
        ).map((entry) => (
          <button
            key={entry.value}
            className={filter === entry.value ? "active" : ""}
            type="button"
            onClick={() => setFilter(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="relationship-card-grid">
        {items.length ? (
          items.map((item) => (
            <ItemCard
              key={item.itemId}
              item={item}
              accountId={accountId}
              disabled={viewOnly}
              onChanged={() => refresh("Relationship Space updated.")}
            />
          ))
        ) : (
          <p className="muted">Nothing here yet.</p>
        )}
      </div>

      <div className="relationship-section">
        <h3>Experiences</h3>
        <div className="relationship-experience-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void runExperience(async () => {
                const on = home.serverDate;
                const result = await loadThisDay(on);
                return { title: "This Day in Us", items: result.items };
              })
            }
          >
            This Day in Us
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void runExperience(async () => {
                const year = Number(home.serverDate.slice(0, 4));
                const result = await loadOurYear(year);
                return {
                  title: "Our Year " + year,
                  items: result.candidates,
                  curationType: "our_year" as const,
                  anchorYear: year,
                  savedCuration: result.savedCuration,
                };
              })
            }
          >
            Our Year
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void runExperience(async () => {
                const result = await loadAnniversary(home.serverDate);
                const year = Number(home.serverDate.slice(0, 4));
                return {
                  title: "Anniversary " + (result.anniversaryDate ?? ""),
                  items: result.eligibleItems,
                  curationType: "anniversary" as const,
                  anchorYear: year,
                  savedCuration: result.savedCuration,
                };
              })
            }
          >
            Anniversary
          </button>
        </div>

        {experience ? (
          <div className="relationship-experience">
            <div className="relationship-item-card__top">
              <strong>{experience.title}</strong>
              <button
                type="button"
                className="link compact"
                onClick={() => setExperience(null)}
              >
                Close
              </button>
            </div>
            {experience.curationType ? (
              <div className="relationship-curation-toolbar">
                <p className="hint">
                  Select the moments you want to keep in this saved curation.
                </p>
                <button
                  type="button"
                  className="primary compact"
                  disabled={busy || viewOnly}
                  onClick={() => void saveExperienceCuration()}
                >
                  {experience.savedCuration ? "Update curation" : "Save curation"}
                </button>
              </div>
            ) : null}
            {experience.items.length ? (
              <div className="relationship-card-grid">
                {experience.items.map((item) => (
                  <div key={item.itemId} className="relationship-curation-item">
                    {experience.curationType ? (
                      <label className="relationship-curation-choice">
                        <input
                          type="checkbox"
                          checked={selectedCurationIds.includes(item.itemId)}
                          disabled={viewOnly}
                          onChange={() => toggleCurationItem(item.itemId)}
                        />
                        <span>Include in curation</span>
                      </label>
                    ) : null}
                    <ItemCard
                      item={item}
                      accountId={accountId}
                      disabled={viewOnly}
                      onChanged={() => refresh()}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No eligible memories for this view yet.</p>
            )}
          </div>
        ) : null}
      </div>

      <CreateRelationshipItem
        disabled={!home.capabilities.create}
        onCreated={() => refresh("Added to Relationship Space.")}
      />
    </section>
  );
}
