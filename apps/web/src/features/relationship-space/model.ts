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

export interface RelationshipOccurrence {
  precision: "day" | "month" | "year" | "unknown";
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface RelationshipItem {
  itemId: string;
  kind: RelationshipItemKind;
  creatorAccountId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  occurrence: RelationshipOccurrence | null;
  storyIncluded: boolean;
  release: {
    mode: "immediate" | "scheduled" | "recipient_open" | "creator_reveal";
    generation: number;
    unlockAt: string | null;
    releasedAt: string | null;
    state: "locked" | "released";
  } | null;
  featureState:
    | { type: "someday"; state: "someday" | "soon" | "completed" }
    | { type: "relationship_signal"; signalKind: string }
    | { type: "reunion"; targetDate: string }
    | { type: "curation"; curationType: "our_year" | "anniversary"; anchorYear: number }
    | null;
  contentSchemaVersion: number;
  preview: Record<string, unknown> | null;
  content: Record<string, unknown> | null;
  references: Array<{
    referenceType: "message" | "media";
    referenceId: string;
    role: "source" | "attachment" | "voice_letter";
    position: number;
  }>;
  links: Array<{
    linkType: "curation" | "prepared_content";
    targetItemId: string;
    position: number;
  }>;
}

export interface RelationshipSpaceHome {
  mode:
    | "active"
    | "breakup_pending_view_only"
    | "account_deletion_view_only"
    | "terminated_or_unavailable";
  relationshipStartDate: string;
  serverDate: string;
  relationshipDuration: { years: number; months: number; days: number };
  capabilities: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    manualRelease: boolean;
    curate: boolean;
    sendSignal: boolean;
  };
  recentItems: RelationshipItem[];
  upcomingReleases: RelationshipItem[];
  reunion: RelationshipItem | null;
  anniversary: { date: string; savedCurationItemId: string | null };
  recentSignals: RelationshipItem[];
}

export interface RelationshipSpaceResponse {
  space: RelationshipSpaceHome | null;
}

export interface RelationshipItemListResponse {
  items: RelationshipItem[];
  nextCursor: string | null;
}
