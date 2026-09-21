import type { PartnerRequestStatus } from "./types.ts";
import { partnerRequestExpired } from "./time.ts";

export interface PartnerRequestTransitionState {
  readonly status: PartnerRequestStatus;
  readonly expiresAt: string;
}

export function effectivePartnerRequestStatus(
  request: PartnerRequestTransitionState,
  now: string,
): PartnerRequestStatus {
  if (request.status === "pending" && partnerRequestExpired(request.expiresAt, now)) {
    return "expired";
  }
  return request.status;
}

export function canCancelPartnerRequest(
  request: PartnerRequestTransitionState,
  now: string,
): boolean {
  return effectivePartnerRequestStatus(request, now) === "pending";
}

export function canDeclinePartnerRequest(
  request: PartnerRequestTransitionState,
  now: string,
): boolean {
  return effectivePartnerRequestStatus(request, now) === "pending";
}
