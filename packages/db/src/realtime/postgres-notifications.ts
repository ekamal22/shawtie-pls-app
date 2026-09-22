import type { PoolClient } from "pg";
import type { DatabasePool } from "../connection/pool.ts";

const RECONNECT_DELAY_MS = 1_000;

function validChannel(channel: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/.test(channel);
}

export interface PostgresNotificationListener {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly generation: number;
}

export function createPostgresNotificationListener(
  database: DatabasePool,
  channel: string,
  handlers: {
    readonly onPayload: (payload: string) => void | Promise<void>;
    readonly onReady?: (generation: number) => void | Promise<void>;
    readonly onError?: (error: Error) => void;
  },
): PostgresNotificationListener {
  if (!validChannel(channel)) throw new Error("Invalid PostgreSQL notification channel");

  let client: PoolClient | null = null;
  let stopped = false;
  let connecting: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RECONNECT_DELAY_MS);
  };

  const disconnect = (current: PoolClient, destroy: boolean) => {
    current.removeListener("notification", onNotification);
    current.removeListener("error", onError);
    if (client === current) client = null;
    current.release(destroy);
  };

  const onNotification = (message: { channel: string; payload?: string }) => {
    if (message.channel !== channel || typeof message.payload !== "string") return;
    Promise.resolve(handlers.onPayload(message.payload)).catch((error: unknown) => {
      handlers.onError?.(error instanceof Error ? error : new Error("Notification handler failed"));
    });
  };

  const onError = (error: Error) => {
    handlers.onError?.(error);
    const current = client;
    if (current) disconnect(current, true);
    scheduleReconnect();
  };

  const connect = async (): Promise<void> => {
    if (stopped || client) return;
    if (connecting) return connecting;

    connecting = (async () => {
      let next: PoolClient | null = null;
      try {
        next = await database.pool.connect();
        if (stopped) {
          next.release();
          return;
        }

        next.on("notification", onNotification);
        next.on("error", onError);
        await next.query(`LISTEN "${channel}"`);

        if (stopped) {
          disconnect(next, false);
          return;
        }

        client = next;
        generation += 1;
        await handlers.onReady?.(generation);
      } catch (error) {
        if (next && client !== next) {
          next.removeListener("notification", onNotification);
          next.removeListener("error", onError);
          next.release(true);
        }
        handlers.onError?.(error instanceof Error ? error : new Error("LISTEN connection failed"));
        scheduleReconnect();
      } finally {
        connecting = null;
      }
    })();

    return connecting;
  };

  return {
    get generation() {
      return generation;
    },
    async start() {
      await connect();
    },
    async stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (connecting) await connecting.catch(() => undefined);
      const current = client;
      client = null;
      if (current) {
        current.removeListener("notification", onNotification);
        current.removeListener("error", onError);
        try {
          await current.query(`UNLISTEN "${channel}"`);
        } finally {
          current.release();
        }
      }
    },
  };
}
