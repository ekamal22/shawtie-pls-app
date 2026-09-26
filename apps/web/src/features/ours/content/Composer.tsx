import { S1_CRYPTO_PROFILE } from "@shawtie/contracts";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { ApiClientError } from "../../../lib/api-client.ts";
import {
  discardMediaDraft,
  prepareMediaDraft,
  uploadMediaDraft,
} from "../../../lib/media/media-runtime.ts";
import { listMediaDrafts } from "../../../lib/media/media-local-db.ts";
import type { LocalMediaDraft } from "../../../lib/media/media-types.ts";
import { Button, ErrorNotice, Notice } from "../../../design/primitives.tsx";
import {
  createRelationshipItem,
  relationshipCryptoRequired,
} from "../../relationship-space/api.ts";
import { getActiveS1CryptoRuntime } from "../../../lib/crypto/runtime-context.tsx";
import type { RelationshipItemKind } from "../../relationship-space/model.ts";
import { VoiceRecorder } from "../../media/VoiceRecorder.tsx";
import { messageFor, queuedMutation } from "./errors.ts";
import { SIGNAL_OPTIONS } from "./model.ts";
import { cx } from "./parts.tsx";

/*
 * Composer for every creatable Relationship Space kind. Every existing field, validation
 * rule, offline rule, and payload shape is preserved. Media (photos, files, Voice Letters)
 * is created online only: a queued create never carries media, and going offline with media
 * drafts fails with OFFLINE_OPERATION_REQUIRES_CONNECTION, exactly as before. Creation keeps
 * the idempotent key flow inside createRelationshipItem.
 */

export const COMPOSER_GROUPS: ReadonlyArray<{
  label: string;
  kinds: ReadonlyArray<{ value: RelationshipItemKind; label: string }>;
}> = [
  {
    label: "Looking back",
    kinds: [
      { value: "memory", label: "Memory" },
      { value: "first", label: "First" },
      { value: "place", label: "Place" },
      { value: "remember_this", label: "Keep something" },
    ],
  },
  {
    label: "Right now",
    kinds: [
      { value: "for_you", label: "Letter for you" },
      { value: "love", label: "Love" },
      { value: "relationship_signal", label: "Signal" },
      { value: "surprise", label: "Surprise" },
    ],
  },
  {
    label: "Ahead of us",
    kinds: [
      { value: "future_us", label: "Future Us" },
      { value: "someday", label: "Someday" },
      { value: "reunion", label: "Reunion date" },
      { value: "proposal", label: "Proposal" },
    ],
  },
];

type Precision = "none" | "day" | "month" | "year" | "unknown";
type ReleaseMode = "immediate" | "scheduled" | "recipient_open" | "creator_reveal";

export function RelationshipComposer({
  accountId,
  partnershipId,
  disabled,
  onCreated,
  initialKind = "memory",
  collapseKinds = false,
}: {
  readonly accountId: string;
  readonly partnershipId: string | null;
  readonly disabled: boolean;
  readonly onCreated: () => Promise<void> | void;
  readonly initialKind?: RelationshipItemKind;
  /** Collapses the type chooser once the caller has already asked the person what to add. */
  readonly collapseKinds?: boolean;
}) {
  const [kind, setKind] = useState<RelationshipItemKind>(initialKind);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [occurrencePrecision, setOccurrencePrecision] = useState<Precision>("none");
  const [occurrenceDate, setOccurrenceDate] = useState("");
  const [occurrenceMonth, setOccurrenceMonth] = useState("");
  const [occurrenceYear, setOccurrenceYear] = useState("");
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>("immediate");
  const [unlockAt, setUnlockAt] = useState("");
  const [conditionLabel, setConditionLabel] = useState("");
  const [somedayState, setSomedayState] = useState<"someday" | "soon" | "completed">("someday");
  const [signalKind, setSignalKind] =
    useState<(typeof SIGNAL_OPTIONS)[number][0]>("thinking_of_you");
  const [reunionDate, setReunionDate] = useState("");
  const [loveCategory, setLoveCategory] = useState<"reason" | "noticed" | "remembered">("reason");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mediaDrafts, setMediaDrafts] = useState<LocalMediaDraft[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);

  async function refreshMediaDrafts() {
    if (!partnershipId) {
      setMediaDrafts([]);
      return;
    }
    setMediaDrafts(await listMediaDrafts(accountId, partnershipId, "relationship"));
  }

  async function prepareFiles(event: ChangeEvent<HTMLInputElement>) {
    if (!partnershipId) return;
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    if (mediaDrafts.length + files.length > 32) {
      setError("A relationship item can contain at most 32 references.");
      return;
    }
    setMediaBusy(true);
    setError("");
    try {
      const cryptoRequired = await relationshipCryptoRequired();
      const cryptoRuntime = getActiveS1CryptoRuntime();
      for (const file of files) {
        await prepareMediaDraft({
          accountId,
          partnershipId,
          ownerContext: "relationship",
          source: file,
          role: "attachment",
          cryptoRequired,
          cryptoRuntime,
        });
      }
      await refreshMediaDrafts();
      setNotice(
        navigator.onLine
          ? "Attachment ready to add."
          : "Attachment saved on this device. Connect before adding it to your space.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ").toLowerCase()
          : "Media preparation failed.",
      );
    } finally {
      setMediaBusy(false);
    }
  }

  async function prepareVoiceLetter(blob: Blob, durationSeconds: number) {
    if (!partnershipId) return;
    setMediaBusy(true);
    setError("");
    try {
      const cryptoRequired = await relationshipCryptoRequired();
      const cryptoRuntime = getActiveS1CryptoRuntime();
      await prepareMediaDraft({
        accountId,
        partnershipId,
        ownerContext: "relationship",
        source: blob,
        role: "voice_letter",
        kind: "voice",
        durationSeconds,
        cryptoRequired,
        cryptoRuntime,
      });
      await refreshMediaDrafts();
      setNotice(
        navigator.onLine
          ? "Voice Letter ready to add."
          : "Voice Letter saved on this device. Connect before adding it to your space.",
      );
    } finally {
      setMediaBusy(false);
    }
  }

  async function retryMediaDraft(draftId: string) {
    if (!navigator.onLine) return;
    setMediaBusy(true);
    setError("");
    try {
      await uploadMediaDraft(accountId, draftId);
      await refreshMediaDrafts();
      setNotice("Upload complete. It will be added with the rest.");
    } catch (caught) {
      await refreshMediaDrafts().catch(() => undefined);
      setError(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ").toLowerCase()
          : "Media retry failed.",
      );
    } finally {
      setMediaBusy(false);
    }
  }

  async function removeMediaDraft(draftId: string) {
    setMediaBusy(true);
    try {
      await discardMediaDraft(accountId, draftId);
      await refreshMediaDrafts();
    } finally {
      setMediaBusy(false);
    }
  }

  useEffect(() => {
    void refreshMediaDrafts().catch(() => undefined);
  }, [accountId, partnershipId]);

  const releaseKind = kind === "for_you" || kind === "future_us";
  const revealKind = kind === "surprise" || kind === "proposal";
  const currentYear = new Date().getUTCFullYear();

  useEffect(() => {
    if (revealKind) setReleaseMode("creator_reveal");
    else setReleaseMode("immediate");
  }, [kind, revealKind, releaseKind]);

  function occurrence() {
    if (occurrencePrecision === "none") return null;
    if (occurrencePrecision === "unknown") {
      return { precision: "unknown" as const, year: null, month: null, day: null };
    }
    if (occurrencePrecision === "year") {
      return { precision: "year" as const, year: Number(occurrenceYear), month: null, day: null };
    }
    if (occurrencePrecision === "month") {
      const [year, month] = occurrenceMonth.split("-").map(Number);
      return { precision: "month" as const, year, month, day: null };
    }
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
            conditionLabel: releaseMode === "recipient_open" ? conditionLabel.trim() || null : null,
          },
          content: { body: text.trim() },
          release:
            releaseMode === "scheduled"
              ? { mode: "scheduled", unlockAt: new Date(unlockAt).toISOString() }
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
          content: { title: title.trim() || null, note: note.trim() || null },
          release: null,
          featureState: { type: "curation", curationType: kind, anchorYear: currentYear },
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
          featureState: { type: "relationship_signal", signalKind },
        };
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const cryptoRequired = await relationshipCryptoRequired();
      if (
        cryptoRequired &&
        mediaDrafts.some(
          (draft) =>
            draft.cryptoProtocolVersion !== S1_CRYPTO_PROFILE ||
            !draft.contentEnvelope ||
            !draft.mediaId,
        )
      ) {
        throw new ApiClientError("CRYPTO_MEDIA_DRAFT_STALE", 409);
      }
      if (mediaDrafts.length > 0 && !navigator.onLine) {
        throw new ApiClientError("OFFLINE_OPERATION_REQUIRES_CONNECTION", 0);
      }
      const references: Array<{
        referenceType: "media";
        referenceId: string;
        role: "attachment" | "voice_letter";
        position: number;
      }> = [];
      for (const [position, draft] of mediaDrafts.entries()) {
        const uploaded = await uploadMediaDraft(accountId, draft.draftId);
        references.push({
          referenceType: "media",
          referenceId: uploaded.media.mediaId,
          role: draft.role === "voice_letter" ? "voice_letter" : "attachment",
          position,
        });
      }

      const basePayload = payload() as Record<string, unknown>;
      const result = await createRelationshipItem({ ...basePayload, references });
      if (queuedMutation(result)) {
        setNotice("Relationship item queued. It will replay after authority is refreshed.");
      } else {
        for (const draft of mediaDrafts) {
          await discardMediaDraft(accountId, draft.draftId, false);
        }
        setMediaDrafts([]);
        setTitle("");
        setText("");
        setNote("");
        setOccurrencePrecision("none");
        setOccurrenceDate("");
        setOccurrenceMonth("");
        setOccurrenceYear("");
        setConditionLabel("");
        setUnlockAt("");
        setLatitude("");
        setLongitude("");
        await onCreated();
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const locked = busy || disabled;
  const dated = ["memory", "remember_this", "first", "place", "love"].includes(kind);
  const textLabel =
    kind === "surprise" || kind === "proposal"
      ? "Pages, one per line"
      : kind === "remember_this"
        ? "Saved text"
        : kind === "for_you" || kind === "future_us"
          ? "Your letter"
          : "Text";

  const kindChooser = (
    <fieldset className="mem-kinds">
      <legend className="mem-legend">What would you like to add?</legend>
      {COMPOSER_GROUPS.map((group) => (
        <div
          key={group.label}
          className="mem-kinds__group"
          role="radiogroup"
          aria-label={group.label}
        >
          <p className="mem-kinds__label">{group.label}</p>
          <div className="mem-kinds__row">
            {group.kinds.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={kind === entry.value}
                disabled={locked}
                className={cx("mem-kind", kind === entry.value && "is-selected")}
                onClick={() => setKind(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );

  return (
    <form className="mem-composer" onSubmit={submit}>
      {collapseKinds ? (
        <details className="mem-details mem-kinds-details">
          <summary>Change type</summary>
          {kindChooser}
        </details>
      ) : (
        kindChooser
      )}

      {kind !== "relationship_signal" ? (
        <label className="mem-field">
          <span>Title</span>
          <input
            value={title}
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
            required={["memory", "first", "place", "someday"].includes(kind)}
          />
        </label>
      ) : null}

      {[
        "remember_this",
        "for_you",
        "future_us",
        "love",
        "surprise",
        "proposal",
        "relationship_signal",
      ].includes(kind) ? (
        <label className="mem-field">
          <span>{textLabel}</span>
          <textarea
            rows={kind === "for_you" || kind === "future_us" ? 8 : 5}
            className={cx((kind === "for_you" || kind === "future_us") && "mem-field__letter")}
            value={text}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
            required={["for_you", "future_us", "love"].includes(kind)}
          />
        </label>
      ) : null}

      {[
        "memory",
        "remember_this",
        "first",
        "place",
        "someday",
        "our_year",
        "anniversary",
        "surprise",
        "reunion",
        "proposal",
      ].includes(kind) ? (
        <label className="mem-field">
          <span>{kind === "surprise" || kind === "proposal" ? "Intro" : "Note"}</span>
          <textarea
            rows={3}
            value={note}
            disabled={locked}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      ) : null}

      {dated ? (
        <div className="mem-form">
          <label className="mem-field">
            <span>When did this happen?</span>
            <select
              value={occurrencePrecision}
              disabled={locked}
              onChange={(event) => setOccurrencePrecision(event.target.value as Precision)}
            >
              <option value="none">No date</option>
              <option value="day">Exact day</option>
              <option value="month">Month only</option>
              <option value="year">Year only</option>
              <option value="unknown">Unknown date</option>
            </select>
          </label>
          {occurrencePrecision === "day" ? (
            <label className="mem-field">
              <span>Date</span>
              <input
                type="date"
                value={occurrenceDate}
                disabled={locked}
                required
                onChange={(event) => setOccurrenceDate(event.target.value)}
              />
            </label>
          ) : null}
          {occurrencePrecision === "month" ? (
            <label className="mem-field">
              <span>Month</span>
              <input
                type="month"
                value={occurrenceMonth}
                disabled={locked}
                required
                onChange={(event) => setOccurrenceMonth(event.target.value)}
              />
            </label>
          ) : null}
          {occurrencePrecision === "year" ? (
            <label className="mem-field">
              <span>Year</span>
              <input
                type="number"
                min="1900"
                max="9999"
                value={occurrenceYear}
                disabled={locked}
                required
                onChange={(event) => setOccurrenceYear(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {kind === "place" ? (
        <div className="mem-coordinates">
          <label className="mem-field">
            <span>Latitude, optional</span>
            <input
              inputMode="decimal"
              value={latitude}
              disabled={locked}
              onChange={(event) => setLatitude(event.target.value)}
            />
          </label>
          <label className="mem-field">
            <span>Longitude, optional</span>
            <input
              inputMode="decimal"
              value={longitude}
              disabled={locked}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {releaseKind ? (
        <>
          <label className="mem-field">
            <span>Opening</span>
            <select
              value={releaseMode}
              disabled={locked}
              onChange={(event) =>
                setReleaseMode(event.target.value as "immediate" | "scheduled" | "recipient_open")
              }
            >
              <option value="immediate">Share now</option>
              <option value="scheduled">Open on a date</option>
              <option value="recipient_open">Open when...</option>
            </select>
          </label>
          {releaseMode === "scheduled" ? (
            <label className="mem-field">
              <span>Release time</span>
              <input
                type="datetime-local"
                value={unlockAt}
                disabled={locked}
                required
                onChange={(event) => setUnlockAt(event.target.value)}
              />
            </label>
          ) : null}
          {releaseMode === "recipient_open" ? (
            <label className="mem-field">
              <span>Opening label</span>
              <input
                value={conditionLabel}
                disabled={locked}
                placeholder="Open when you need reassurance"
                onChange={(event) => setConditionLabel(event.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : null}

      {revealKind ? (
        <label className="mem-field">
          <span>Reveal</span>
          <select
            value={releaseMode}
            disabled={locked}
            onChange={(event) =>
              setReleaseMode(event.target.value as "immediate" | "creator_reveal")
            }
          >
            <option value="creator_reveal">Keep private until I reveal it</option>
            <option value="immediate">Share now</option>
          </select>
        </label>
      ) : null}

      {kind === "someday" ? (
        <label className="mem-field">
          <span>State</span>
          <select
            value={somedayState}
            disabled={locked}
            onChange={(event) =>
              setSomedayState(event.target.value as "someday" | "soon" | "completed")
            }
          >
            <option value="someday">Someday</option>
            <option value="soon">Soon</option>
            <option value="completed">We did it</option>
          </select>
        </label>
      ) : null}

      {kind === "love" ? (
        <label className="mem-field">
          <span>Category</span>
          <select
            value={loveCategory}
            disabled={locked}
            onChange={(event) =>
              setLoveCategory(event.target.value as "reason" | "noticed" | "remembered")
            }
          >
            <option value="reason">A reason</option>
            <option value="noticed">Something I noticed</option>
            <option value="remembered">Something I remembered</option>
          </select>
        </label>
      ) : null}

      {kind === "reunion" ? (
        <label className="mem-field">
          <span>Reunion date</span>
          <input
            type="date"
            value={reunionDate}
            disabled={locked}
            required
            onChange={(event) => setReunionDate(event.target.value)}
          />
        </label>
      ) : null}

      {kind === "relationship_signal" ? (
        <label className="mem-field">
          <span>Signal</span>
          <select
            value={signalKind}
            disabled={locked}
            onChange={(event) =>
              setSignalKind(event.target.value as (typeof SIGNAL_OPTIONS)[number][0])
            }
          >
            {SIGNAL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="mem-media-composer">
        <label className="ds-button ds-button--secondary ds-button--compact mem-file-button">
          Add a photo or file
          <input
            type="file"
            multiple
            hidden
            disabled={locked || mediaBusy || !partnershipId}
            accept="image/*,video/mp4,video/webm,application/pdf,text/plain,application/zip,.zip"
            onChange={(event) => void prepareFiles(event)}
          />
        </label>
        <VoiceRecorder
          disabled={locked || mediaBusy || !partnershipId}
          onReady={prepareVoiceLetter}
        />
      </div>

      {mediaDrafts.length > 0 ? (
        <ul className="mem-drafts">
          {mediaDrafts.map((draft) => (
            <li className="mem-draft" key={draft.draftId}>
              <span>
                {draft.role === "voice_letter" ? "Voice Letter" : draft.kind} ·{" "}
                {Math.ceil(draft.ciphertextBytes / 1024)} KB saved on this device · {draft.state}
              </span>
              <span className="mem-draft__actions">
                {draft.state === "failed" ? (
                  <Button
                    compact
                    disabled={busy || mediaBusy || !navigator.onLine}
                    onClick={() => void retryMediaDraft(draft.draftId)}
                  >
                    Retry upload
                  </Button>
                ) : null}
                <Button
                  variant="quiet"
                  compact
                  disabled={busy || mediaBusy}
                  onClick={() => void removeMediaDraft(draft.draftId)}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <Button type="submit" variant="primary" disabled={locked}>
        {busy ? "Saving" : "Add to Ours"}
      </Button>

      <p className="mem-hint">
        Photos, files and Voice Letters follow this item's opening. Adding media needs a connection;
        drafts stay on this device until the upload succeeds.
      </p>
    </form>
  );
}
