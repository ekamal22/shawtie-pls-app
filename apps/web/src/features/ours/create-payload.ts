import type { RelationshipItemKind } from "../relationship-space/model.ts";

/*
 * Ours create sheet model (UX4). Builds the same request bodies the existing Relationship
 * Space create form sends to the unchanged `POST /api/v1/relationship-space/items` flow, and
 * groups the kinds by intent. Nothing here adds a kind, field, or endpoint (PRESENTATION_ONLY).
 *
 * ADAPTER: this mirrors `CreateRelationshipItem` in RelationshipSpacePanel.tsx because that
 * component is not exported and UX4 may not edit it. If UX6 exports it with an initial-kind
 * prop, this module and OursCreateSheet can be deleted in favor of that export.
 */

export type CreatableKind = Exclude<RelationshipItemKind, "our_year" | "anniversary">;

export interface CreateIntent {
  readonly id: "remember" | "say" | "plan" | "surprise";
  readonly title: string;
  readonly hint: string;
  readonly kinds: ReadonlyArray<{ readonly kind: CreatableKind; readonly label: string }>;
}

export const CREATE_INTENTS: readonly CreateIntent[] = [
  {
    id: "remember",
    title: "Remember something",
    hint: "For the story behind us.",
    kinds: [
      { kind: "memory", label: "A memory" },
      { kind: "first", label: "A first" },
      { kind: "place", label: "A place" },
      { kind: "remember_this", label: "Something to keep" },
    ],
  },
  {
    id: "say",
    title: "Say something",
    hint: "For right now.",
    kinds: [
      { kind: "for_you", label: "A letter for you" },
      { kind: "love", label: "A reason or a noticing" },
      { kind: "relationship_signal", label: "A small signal" },
    ],
  },
  {
    id: "plan",
    title: "Look ahead",
    hint: "For what comes next.",
    kinds: [
      { kind: "someday", label: "A someday" },
      { kind: "future_us", label: "A letter for later" },
      { kind: "reunion", label: "Until we're together again" },
    ],
  },
  {
    id: "surprise",
    title: "Plan a surprise",
    hint: "Kept private until you reveal it.",
    kinds: [
      { kind: "surprise", label: "A surprise" },
      { kind: "proposal", label: "A proposal" },
    ],
  },
];

export const SIGNALS = [
  ["i_need_you", "I need you"],
  ["call_me_when_you_can", "Call me when you can"],
  ["i_need_reassurance", "I need reassurance"],
  ["shared_feeling", "Share a feeling"],
  ["thinking_of_you", "Thinking of you"],
  ["kiss", "Kiss"],
  ["hug", "Hug"],
] as const;

export type SignalKind = (typeof SIGNALS)[number][0];
export type OccurrencePrecision = "none" | "day" | "month" | "year" | "unknown";
export type ReleaseMode = "immediate" | "scheduled" | "recipient_open" | "creator_reveal";

export interface CreateDraft {
  kind: CreatableKind;
  title: string;
  text: string;
  note: string;
  precision: OccurrencePrecision;
  date: string;
  month: string;
  year: string;
  releaseMode: ReleaseMode;
  unlockAt: string;
  conditionLabel: string;
  somedayState: "someday" | "soon" | "completed";
  signalKind: SignalKind;
  reunionDate: string;
  loveCategory: "reason" | "noticed" | "remembered";
  latitude: string;
  longitude: string;
}

export function defaultReleaseMode(kind: CreatableKind): ReleaseMode {
  return kind === "surprise" || kind === "proposal" ? "creator_reveal" : "immediate";
}

export function emptyDraft(kind: CreatableKind): CreateDraft {
  return {
    kind,
    title: "",
    text: "",
    note: "",
    precision: "none",
    date: "",
    month: "",
    year: "",
    releaseMode: defaultReleaseMode(kind),
    unlockAt: "",
    conditionLabel: "",
    somedayState: "someday",
    signalKind: "thinking_of_you",
    reunionDate: "",
    loveCategory: "reason",
    latitude: "",
    longitude: "",
  };
}

const DATED_KINDS: readonly CreatableKind[] = ["memory", "remember_this", "first", "place", "love"];

export function hasOccurrence(kind: CreatableKind): boolean {
  return DATED_KINDS.includes(kind);
}

export function needsTitle(kind: CreatableKind): boolean {
  return kind === "memory" || kind === "first" || kind === "place" || kind === "someday";
}

export function needsText(kind: CreatableKind): boolean {
  return kind === "for_you" || kind === "future_us" || kind === "love";
}

function occurrence(draft: CreateDraft) {
  switch (draft.precision) {
    case "none":
      return null;
    case "unknown":
      return { precision: "unknown" as const, year: null, month: null, day: null };
    case "year":
      return { precision: "year" as const, year: Number(draft.year), month: null, day: null };
    case "month": {
      const [year, month] = draft.month.split("-").map(Number);
      return { precision: "month" as const, year, month, day: null };
    }
    case "day": {
      const [year, month, day] = draft.date.split("-").map(Number);
      return { precision: "day" as const, year, month, day };
    }
  }
}

/** Plain-language reason a draft cannot be sent yet, or null when it is ready. */
export function draftProblem(draft: CreateDraft): string | null {
  if (needsTitle(draft.kind) && !draft.title.trim()) return "Give it a short title.";
  if (needsText(draft.kind) && !draft.text.trim()) return "Add a few words.";
  if (draft.kind === "reunion" && !draft.reunionDate) return "Choose the reunion date.";
  if (draft.precision === "day" && !draft.date) return "Choose the date.";
  if (draft.precision === "month" && !draft.month) return "Choose the month.";
  if (draft.precision === "year" && !draft.year) return "Choose the year.";
  if (
    (draft.kind === "for_you" || draft.kind === "future_us") &&
    draft.releaseMode === "scheduled" &&
    !draft.unlockAt
  ) {
    return "Choose when it should open.";
  }
  return null;
}

export function buildCreatePayload(draft: CreateDraft): Record<string, unknown> {
  const kind = draft.kind;
  const title = draft.title.trim();
  const text = draft.text.trim();
  const note = draft.note.trim();
  const base = {
    kind,
    contentSchemaVersion: 1,
    occurrence: hasOccurrence(kind) ? occurrence(draft) : null,
    storyIncluded: false,
    references: [] as unknown[],
    links: [] as unknown[],
  };

  switch (kind) {
    case "memory":
    case "first":
      return {
        ...base,
        preview: null,
        content: { title, note: note || null },
        release: null,
        featureState: null,
      };
    case "remember_this":
      return {
        ...base,
        preview: null,
        content: { title: title || null, snapshotText: text || null, note: note || null },
        release: null,
        featureState: null,
      };
    case "place":
      return {
        ...base,
        preview: null,
        content: {
          title,
          note: note || null,
          latitude: draft.latitude ? Number(draft.latitude) : null,
          longitude: draft.longitude ? Number(draft.longitude) : null,
        },
        release: null,
        featureState: null,
      };
    case "for_you":
    case "future_us":
      return {
        ...base,
        preview: {
          title: title || null,
          conditionLabel:
            draft.releaseMode === "recipient_open" ? draft.conditionLabel.trim() || null : null,
        },
        content: { body: text },
        release:
          draft.releaseMode === "scheduled"
            ? { mode: "scheduled", unlockAt: new Date(draft.unlockAt).toISOString() }
            : draft.releaseMode === "recipient_open"
              ? { mode: "recipient_open", unlockAt: null }
              : { mode: "immediate", unlockAt: null },
        featureState: null,
      };
    case "love":
      return {
        ...base,
        preview: null,
        content: { category: draft.loveCategory, text },
        release: null,
        featureState: null,
      };
    case "someday":
      return {
        ...base,
        preview: null,
        content: { title, note: note || null },
        release: null,
        featureState: { type: "someday", state: draft.somedayState },
      };
    case "surprise":
    case "proposal":
      return {
        ...base,
        preview: { title: title || null },
        content: {
          intro: note || null,
          steps: text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => ({ type: "text", text: line })),
        },
        release:
          draft.releaseMode === "immediate"
            ? { mode: "immediate", unlockAt: null }
            : { mode: "creator_reveal", unlockAt: null },
        featureState: null,
      };
    case "reunion":
      return {
        ...base,
        preview: null,
        content: { title: title || null, note: note || null },
        release: null,
        featureState: { type: "reunion", targetDate: draft.reunionDate },
      };
    case "relationship_signal":
      return {
        ...base,
        occurrence: null,
        preview: null,
        content: { sharedFeelingText: text || null },
        release: null,
        featureState: { type: "relationship_signal", signalKind: draft.signalKind },
      };
  }
}
