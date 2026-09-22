export type RelationshipItemKind =
  | "memory"
  | "remember_this"
  | "first"
  | "place"
  | "for_you"
  | "future_us"
  | "love"
  | "someday"
  | "our_year"
  | "anniversary"
  | "surprise"
  | "reunion"
  | "proposal"
  | "relationship_signal";

export type RelationshipOccurrencePrecision = "day" | "month" | "year" | "unknown";

export interface RelationshipOccurrence {
  readonly precision: RelationshipOccurrencePrecision;
  readonly year: number | null;
  readonly month: number | null;
  readonly day: number | null;
}

export type RelationshipReleaseMode =
  | "immediate"
  | "scheduled"
  | "recipient_open"
  | "creator_reveal";

export type SomedayState = "someday" | "soon" | "completed";

export type RelationshipSignalKind =
  | "i_need_you"
  | "call_me_when_you_can"
  | "i_need_reassurance"
  | "shared_feeling"
  | "thinking_of_you"
  | "kiss"
  | "hug";

export type RelationshipSharedStateKind = "someday" | "reunion" | "our_year" | "anniversary";

export type RelationshipContentActorRule = "creator" | "either_partner";

export interface RelationshipItemPolicy {
  readonly contentEditor: RelationshipContentActorRule;
  readonly deleter: RelationshipContentActorRule;
  readonly sharedStateEditor: "none" | "either_partner";
  readonly releaseModes: readonly RelationshipReleaseMode[];
  readonly manualReleaseActor: "none" | "creator" | "recipient";
  readonly immutableAfterRelease: boolean;
}

export type RelationshipItemMutationDenial =
  | "RELATIONSHIP_ITEM_NOT_OWNED"
  | "RELATIONSHIP_ITEM_IMMUTABLE"
  | "RELATIONSHIP_RELEASE_NOT_ALLOWED"
  | "RELATIONSHIP_SHARED_STATE_NOT_ALLOWED";

export type RelationshipScheduledReleaseDecision =
  | { readonly action: "release" }
  | { readonly action: "too_early" }
  | { readonly action: "pause"; readonly until: string }
  | { readonly action: "stale"; readonly reason: "released" | "invalid_mode" | "terminated" | "destructive_deadline" };
