export interface DurableClaim {
  readonly id: string;
  readonly claimedBy: string;
  readonly claimVersion: bigint;
}
