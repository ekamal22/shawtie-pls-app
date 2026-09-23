import { randomUUID } from "node:crypto";
import {
  M2_INTERNAL_NOTIFY_MAX_BYTES,
  M2_REALTIME_NOTIFY_CHANNEL,
  M2_REALTIME_PROTOCOL_VERSION,
  m2FrameByteLength,
  m2InternalRealtimeNotificationSchema,
  type M2InternalRealtimeNotification,
} from "@shawtie/contracts";
import type { DatabasePool } from "@shawtie/db";

export class RealtimeTransientPublisher {
  private readonly database: DatabasePool;

  constructor(database: DatabasePool) {
    this.database = database;
  }

  async publish(notification: M2InternalRealtimeNotification): Promise<void> {
    const parsed = m2InternalRealtimeNotificationSchema.safeParse(notification);
    if (!parsed.success) throw new Error("Invalid M2 transient notification");
    if (m2FrameByteLength(parsed.data) > M2_INTERNAL_NOTIFY_MAX_BYTES) {
      throw new Error("M2 transient notification exceeds payload ceiling");
    }
    await this.database.pool.query("SELECT pg_notify($1, $2)", [
      M2_REALTIME_NOTIFY_CHANNEL,
      JSON.stringify(parsed.data),
    ]);
  }

  async presence(input: {
    partnershipId: string | null;
    accountId: string;
    online: boolean;
  }): Promise<void> {
    if (!input.partnershipId) return;
    await this.publish({
      v: M2_REALTIME_PROTOCOL_VERSION,
      kind: "presence.changed",
      scope: { partnershipId: input.partnershipId },
      data: {
        eventId: randomUUID(),
        actorAccountId: input.accountId,
        online: input.online,
      },
    });
  }

  async typing(input: {
    conversationId: string;
    accountId: string;
    typing: boolean;
    expiresAt: string | null;
  }): Promise<void> {
    await this.publish({
      v: M2_REALTIME_PROTOCOL_VERSION,
      kind: "typing.changed",
      scope: { conversationId: input.conversationId },
      data: {
        eventId: randomUUID(),
        actorAccountId: input.accountId,
        conversationId: input.conversationId,
        typing: input.typing,
        expiresAt: input.expiresAt,
      },
    });
  }
}
