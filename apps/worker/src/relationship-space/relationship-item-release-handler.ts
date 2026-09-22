import { randomUUID } from "node:crypto";
import {
  appendRelationshipEvent,
  getRelationshipReleaseGeneration,
  loadRelationshipReleaseItem,
  lockPartnershipLifecycle,
  lockRelationshipItemsByIds,
  markRelationshipItemReleased,
  type ScheduledAction,
} from "@shawtie/db";
import { evaluateScheduledRelationshipRelease } from "@shawtie/domain";
import { PermanentWorkerError } from "../runtime/errors.ts";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";

export const relationshipItemReleaseHandler: ScheduledActionHandler = {
  actionType: "relationship_item_release",
  payloadVersion: 1,
  loadCurrentGeneration(transaction, action: ScheduledAction) {
    return getRelationshipReleaseGeneration(transaction, action.aggregateId);
  },
  async execute({ transaction, action, now }) {
    if (action.aggregateType !== "relationship_item") {
      throw new PermanentWorkerError("RELATIONSHIP_RELEASE_AGGREGATE_INVALID");
    }
    if (action.expectedGeneration === null) {
      throw new PermanentWorkerError("RELATIONSHIP_RELEASE_GENERATION_REQUIRED");
    }

    const initial = await loadRelationshipReleaseItem(transaction, action.aggregateId);
    if (!initial) return { outcome: "stale" as const };

    const lifecycle = await lockPartnershipLifecycle(transaction, initial.partnershipId);
    if (!lifecycle) return { outcome: "stale" as const };

    const locked = await lockRelationshipItemsByIds(transaction, initial.partnershipId, [
      action.aggregateId,
    ]);
    const item = locked[0];
    if (!item) return { outcome: "stale" as const };

    if (item.releaseGeneration !== action.expectedGeneration) {
      return { outcome: "stale" as const };
    }
    if (item.contentSchemaVersion !== 1) {
      throw new PermanentWorkerError("RELATIONSHIP_CONTENT_SCHEMA_UNSUPPORTED");
    }

    const decision = evaluateScheduledRelationshipRelease({
      now: now.toISOString(),
      releaseMode: item.releaseMode,
      unlockAt: item.unlockAt?.toISOString() ?? null,
      releasedAt: item.releasedAt?.toISOString() ?? null,
      lifecycle: lifecycle.lifecycleState,
      breakupFinalDeadline: lifecycle.breakup?.finalDeadline.toISOString() ?? null,
      accountDeletionRecoverUntil: lifecycle.accountDeletion?.recoverUntil.toISOString() ?? null,
    });

    if (decision.action === "stale") {
      return { outcome: "stale" as const };
    }
    if (decision.action === "too_early") {
      if (!item.unlockAt) return { outcome: "stale" as const };
      return { outcome: "reschedule" as const, availableAt: item.unlockAt };
    }
    if (decision.action === "pause") {
      return { outcome: "reschedule" as const, availableAt: new Date(decision.until) };
    }

    const nextVersion = await markRelationshipItemReleased(transaction, {
      partnershipId: item.partnershipId,
      itemId: item.id,
      expectedGeneration: item.releaseGeneration,
      releasedAt: now,
    });
    if (nextVersion === null) return { outcome: "stale" as const };

    await appendRelationshipEvent(transaction, {
      id: randomUUID(),
      partnershipId: item.partnershipId,
      itemId: item.id,
      eventType: "item_released",
      actorAccountId: null,
      itemVersion: nextVersion,
      createdAt: now,
    });
  },
};
