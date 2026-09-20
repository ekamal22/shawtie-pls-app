import type { QueryExecutor } from "../types/query-executor.ts";

export type LifecycleMetadataKey =
  | "reason"
  | "generation"
  | "previousGeneration"
  | "deadline"
  | "source"
  | "status";

export type LifecycleMetadataValue = string | number | boolean | null;
export type LifecycleMetadata = Partial<
  Record<LifecycleMetadataKey, LifecycleMetadataValue>
>;

const allowedKeys = new Set<LifecycleMetadataKey>([
  "reason",
  "generation",
  "previousGeneration",
  "deadline",
  "source",
  "status",
]);

export function validateLifecycleMetadata(
  metadata: Readonly<Record<string, unknown>>,
): asserts metadata is LifecycleMetadata {
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedKeys.has(key as LifecycleMetadataKey)) {
      throw new Error(`Lifecycle metadata key is not allowed: ${key}`);
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(`Lifecycle metadata value is not scalar: ${key}`);
    }
  }
}

export interface AppendLifecycleEvent {
  readonly id: string;
  readonly partnershipId?: string | null;
  readonly actorAccountId?: string | null;
  readonly eventType: string;
  readonly aggregateVersion: bigint;
  readonly metadata?: LifecycleMetadata;
}

export async function appendLifecycleEvent(
  executor: QueryExecutor,
  event: AppendLifecycleEvent,
): Promise<void> {
  const metadata = event.metadata ?? {};
  validateLifecycleMetadata(metadata);

  await executor.query(
    `INSERT INTO partnership_lifecycle_events (
       id, partnership_id, actor_account_id, event_type, aggregate_version, metadata_json
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      event.id,
      event.partnershipId ?? null,
      event.actorAccountId ?? null,
      event.eventType,
      event.aggregateVersion.toString(),
      JSON.stringify(metadata),
    ],
  );
}
