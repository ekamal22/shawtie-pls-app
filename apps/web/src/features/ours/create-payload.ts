import type { RelationshipItemKind } from "../relationship-space/model.ts";

/*
 * Ours create intents (UX4). Groups the existing item kinds by what the person wants to do.
 * The create form itself is the UX6 `RelationshipComposer`, which sends the unchanged
 * `POST /api/v1/relationship-space/items` flow. Nothing here adds a kind, field, or endpoint
 * (PRESENTATION_ONLY).
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
    hint: "Hidden from them until you reveal it.",
    kinds: [
      { kind: "surprise", label: "A surprise" },
      { kind: "proposal", label: "A proposal" },
    ],
  },
];
