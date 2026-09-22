import {
  M2_INTERNAL_NOTIFY_MAX_BYTES,
  M2_REALTIME_NOTIFY_CHANNEL,
  m2InternalRealtimeNotificationSchema,
} from "@shawtie/contracts";
import {
  createPostgresNotificationListener,
  type DatabasePool,
  type PostgresNotificationListener,
} from "@shawtie/db";
import type { RealtimeHub } from "./realtime-hub.ts";

export class RealtimeListener {
  readonly #listener: PostgresNotificationListener;

  constructor(database: DatabasePool, hub: RealtimeHub) {
    this.#listener = createPostgresNotificationListener(database, M2_REALTIME_NOTIFY_CHANNEL, {
      onPayload(payload) {
        if (Buffer.byteLength(payload, "utf8") > M2_INTERNAL_NOTIFY_MAX_BYTES) return;
        let raw: unknown;
        try {
          raw = JSON.parse(payload);
        } catch {
          return;
        }
        const parsed = m2InternalRealtimeNotificationSchema.safeParse(raw);
        if (parsed.success) hub.dispatch(parsed.data);
      },
      onReady(generation) {
        if (generation > 1) hub.requestResyncAll("listener_reset");
      },
      onError(error) {
        console.error("REALTIME_LISTENER_ERROR", { name: error.name });
      },
    });
  }

  start(): Promise<void> {
    return this.#listener.start();
  }

  stop(): Promise<void> {
    return this.#listener.stop();
  }
}
