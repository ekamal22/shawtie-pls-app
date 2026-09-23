import type {
  RelationshipItemKindInput,
  RelationshipItemProjection,
  RelationshipOccurrenceInput,
} from "@shawtie/contracts";

export type RelationshipItemKind = RelationshipItemKindInput;
export type RelationshipOccurrence = NonNullable<RelationshipOccurrenceInput>;
export type RelationshipItem = RelationshipItemProjection;

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
