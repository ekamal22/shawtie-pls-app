import type { AccountState, PartnershipState } from "../src/index.ts";

export const A = "account-a";
export const B = "account-b";
export const START = "2026-09-20T12:00:00.000Z";

export function activeAccount(id: string): AccountState {
  return {
    id,
    status: "active",
    nextUsernameChangeEligibleAt: null,
  };
}

export function activePartnership(): PartnershipState {
  return {
    id: "partnership-1",
    members: [A, B],
    lifecycle: "active",
    generation: 1,
    breakup: null,
    accountDeletion: null,
    terminatedAt: null,
    terminationReason: null,
    partnerEligibleAt: { [A]: null, [B]: null },
  };
}
