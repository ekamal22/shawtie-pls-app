export type PartnershipFormationSource = "explicit_accept" | "reciprocal_request";

export type P2DenialCode =
  | "REQUEST_NOT_FOUND"
  | "REQUEST_NOT_AVAILABLE"
  | "PARTNERSHIP_UNAVAILABLE"
  | "RELATIONSHIP_DATE_FUTURE"
  | "PARTNERSHIP_METADATA_LOCKED"
  | "VERSION_CONFLICT";

export interface FormationRequestConsent {
  readonly requestId: string;
  readonly senderAccountId: string;
  readonly recipientAccountId: string;
  readonly relationshipStartDate: string;
}

export type FormationConsentInput =
  | {
      readonly source: "explicit_accept";
      readonly request: FormationRequestConsent;
    }
  | {
      readonly source: "reciprocal_request";
      readonly requests: readonly [FormationRequestConsent, FormationRequestConsent];
      readonly triggeringRequestId: string;
    };

export interface ResolvedFormationConsent {
  readonly source: PartnershipFormationSource;
  readonly actorAccountId: string;
  readonly requestIds: readonly string[];
  readonly triggeringRequestId: string;
  readonly relationshipStartDate: string;
}

export type FormationConsentResolution =
  | { readonly ok: true; readonly consent: ResolvedFormationConsent }
  | { readonly ok: false; readonly reason: "REQUEST_NOT_AVAILABLE" };

function reciprocalPairIsValid(
  first: FormationRequestConsent,
  second: FormationRequestConsent,
): boolean {
  return (
    first.requestId !== second.requestId &&
    first.senderAccountId !== first.recipientAccountId &&
    first.senderAccountId === second.recipientAccountId &&
    first.recipientAccountId === second.senderAccountId
  );
}

export function resolveFormationConsent(input: FormationConsentInput): FormationConsentResolution {
  if (input.source === "explicit_accept") {
    if (input.request.senderAccountId === input.request.recipientAccountId) {
      return { ok: false, reason: "REQUEST_NOT_AVAILABLE" };
    }

    return {
      ok: true,
      consent: {
        source: input.source,
        actorAccountId: input.request.recipientAccountId,
        requestIds: [input.request.requestId],
        triggeringRequestId: input.request.requestId,
        relationshipStartDate: input.request.relationshipStartDate,
      },
    };
  }

  const [first, second] = input.requests;
  if (!reciprocalPairIsValid(first, second)) {
    return { ok: false, reason: "REQUEST_NOT_AVAILABLE" };
  }

  const triggering =
    first.requestId === input.triggeringRequestId
      ? first
      : second.requestId === input.triggeringRequestId
        ? second
        : null;

  if (!triggering) {
    return { ok: false, reason: "REQUEST_NOT_AVAILABLE" };
  }

  return {
    ok: true,
    consent: {
      source: input.source,
      actorAccountId: triggering.senderAccountId,
      requestIds: [first.requestId, second.requestId],
      triggeringRequestId: triggering.requestId,
      relationshipStartDate: triggering.relationshipStartDate,
    },
  };
}
