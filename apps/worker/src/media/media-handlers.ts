import {
  deleteMediaObjectMetadata,
  deletePartnershipMediaObjectMetadata,
  getMediaDeletionGeneration,
  getMediaUploadGeneration,
  listPartnershipMediaForDeletion,
  loadMediaForDeletion,
  loadMediaObject,
  markMediaDeletionPending,
  type DatabasePool,
} from "@shawtie/db";
import type { MediaObjectStore } from "@shawtie/media-storage";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";
import type { DeletionHandler } from "../deletion/deletion-handler.ts";
import { RetryableWorkerError } from "../runtime/errors.ts";

function requireStore(store: MediaObjectStore | null): MediaObjectStore {
  if (!store) throw new RetryableWorkerError("MEDIA_STORAGE_UNAVAILABLE");
  return store;
}

export function createMediaDeleteScheduledHandler(
  store: MediaObjectStore | null,
): ScheduledActionHandler {
  return {
    actionType: "m3.media_delete",
    payloadVersion: 1,
    loadCurrentGeneration: (transaction, action) =>
      getMediaDeletionGeneration(transaction, action.aggregateId),
    async execute({ transaction, action }) {
      const media = await loadMediaForDeletion(
        transaction,
        action.aggregateId,
        action.expectedGeneration ?? undefined,
      );
      if (!media) return { outcome: "stale" };
      await requireStore(store).deleteObject(media.storageObjectKey);
      await deleteMediaObjectMetadata(
        transaction,
        media.id,
        action.expectedGeneration ?? undefined,
      );
    },
  };
}

export function createMediaUploadExpireScheduledHandler(
  store: MediaObjectStore | null,
): ScheduledActionHandler {
  return {
    actionType: "m3.media_upload_expire",
    payloadVersion: 1,
    loadCurrentGeneration: (transaction, action) =>
      getMediaUploadGeneration(transaction, action.aggregateId),
    async execute({ transaction, action, now }) {
      const media = await loadMediaObject(transaction, action.aggregateId);
      if (!media || !["uploading", "ready_unbound"].includes(media.state)) {
        return { outcome: "stale" };
      }
      if (media.uploadExpiresAt && media.uploadExpiresAt.getTime() > now.getTime()) {
        return { outcome: "reschedule", availableAt: media.uploadExpiresAt };
      }
      const generation = await markMediaDeletionPending(transaction, media.id, now);
      if (generation === null) return { outcome: "stale" };
      await requireStore(store).deleteObject(media.storageObjectKey);
      await deleteMediaObjectMetadata(transaction, media.id, generation);
    },
  };
}

export function createPartnershipMediaDeletionHandler(
  database: DatabasePool,
  store: MediaObjectStore | null,
): DeletionHandler {
  return {
    targetType: "partnership_media_objects",
    async execute(context) {
      for (;;) {
        if (context.signal.aborted) throw new RetryableWorkerError("WORKER_SHUTDOWN");
        const rows = await listPartnershipMediaForDeletion(
          database.pool,
          context.target.targetKey,
          100,
        );
        if (rows.length === 0) return;
        const objectStore = requireStore(store);
        for (const media of rows) {
          await objectStore.deleteObject(media.storageObjectKey);
          await deletePartnershipMediaObjectMetadata(
            database.pool,
            context.target.targetKey,
            media.id,
          );
        }
        const renewed = await context.renewLease();
        if (!renewed) throw new RetryableWorkerError("DELETION_LEASE_LOST");
      }
    },
  };
}
