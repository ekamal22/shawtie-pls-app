import { relationshipStartDateAllowed } from "../partner-request/time.ts";

export type RelationshipStartDateMutationDecision =
  | {
      readonly ok: true;
      readonly changed: false;
      readonly metadataVersion: number;
    }
  | {
      readonly ok: true;
      readonly changed: true;
      readonly metadataVersion: number;
    }
  | {
      readonly ok: false;
      readonly reason: "RELATIONSHIP_DATE_FUTURE" | "VERSION_CONFLICT";
    };

export function relationshipStartDateAllowedForPartnership(
  relationshipStartDate: string,
  trustedServerDate: string,
): boolean {
  return relationshipStartDateAllowed(relationshipStartDate, trustedServerDate);
}

export function evaluateRelationshipStartDateMutation(input: {
  readonly currentRelationshipStartDate: string;
  readonly requestedRelationshipStartDate: string;
  readonly currentMetadataVersion: number;
  readonly expectedMetadataVersion: number;
  readonly trustedServerDate: string;
}): RelationshipStartDateMutationDecision {
  if (
    !relationshipStartDateAllowedForPartnership(
      input.requestedRelationshipStartDate,
      input.trustedServerDate,
    )
  ) {
    return { ok: false, reason: "RELATIONSHIP_DATE_FUTURE" };
  }

  if (input.requestedRelationshipStartDate === input.currentRelationshipStartDate) {
    return {
      ok: true,
      changed: false,
      metadataVersion: input.currentMetadataVersion,
    };
  }

  if (input.expectedMetadataVersion !== input.currentMetadataVersion) {
    return { ok: false, reason: "VERSION_CONFLICT" };
  }

  return {
    ok: true,
    changed: true,
    metadataVersion: input.currentMetadataVersion + 1,
  };
}
