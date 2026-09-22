import {
  M2_INTERNAL_NOTIFY_MAX_BYTES,
  M2_REALTIME_NOTIFY_CHANNEL,
  m2FrameByteLength,
  m2InternalRealtimeNotificationSchema,
  type M2InternalRealtimeNotification,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";
import { PermanentWorkerError } from "../runtime/errors.ts";

export interface RealtimeInvalidationPublisher {
  publish(notification: M2InternalRealtimeNotification): Promise<void>;
}

export class PostgresRealtimeInvalidationPublisher implements RealtimeInvalidationPublisher {
  constructor(private readonly database: DatabasePool) {}

  async publish(notification: M2InternalRealtimeNotification): Promise<void> {
    const parsed = m2InternalRealtimeNotificationSchema.safeParse(notification);
    if (!parsed.success) throw new PermanentWorkerError("INVALID_M2_REALTIME_NOTIFICATION");
    if (m2FrameByteLength(parsed.data) > M2_INTERNAL_NOTIFY_MAX_BYTES) {
      throw new PermanentWorkerError("M2_REALTIME_NOTIFICATION_TOO_LARGE");
    }

    await this.database.pool.query("SELECT pg_notify($1, $2)", [
      M2_REALTIME_NOTIFY_CHANNEL,
      JSON.stringify(parsed.data),
    ]);
  }
}
