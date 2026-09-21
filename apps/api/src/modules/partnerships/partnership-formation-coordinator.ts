import type {
  PartnershipFormationCoordinator,
  ReciprocalPairCandidate,
} from "../partner-requests/partner-request-service.ts";
import type { QueryExecutor } from "@shawtie/db";

export type ReciprocalFormationDelegate = (
  executor: QueryExecutor,
  candidate: ReciprocalPairCandidate,
  now: Date,
) => Promise<{ partnershipId: string }>;

export function createP2PartnershipFormationCoordinator(
  delegate: ReciprocalFormationDelegate,
): PartnershipFormationCoordinator {
  return {
    handleReciprocalCandidate(executor, candidate, now) {
      return delegate(executor, candidate, now);
    },
  };
}
