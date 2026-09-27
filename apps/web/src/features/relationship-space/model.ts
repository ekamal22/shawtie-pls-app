import type { RelationshipItemKindInput, RelationshipOccurrenceInput } from "@shawtie/contracts";
import type { DecryptedRelationshipItemProjection } from "../../lib/crypto/projection-decryption.ts";

export type RelationshipItemKind = RelationshipItemKindInput;
export type RelationshipOccurrence = NonNullable<RelationshipOccurrenceInput>;
export type RelationshipItem = DecryptedRelationshipItemProjection;

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
