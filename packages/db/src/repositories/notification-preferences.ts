import type { QueryExecutor } from "../types/query-executor.ts";

export interface NotificationPreferences {
  readonly messagePreviewEnabled: boolean;
  readonly updatedAt: Date | null;
}

export async function loadNotificationPreferences(
  executor: QueryExecutor,
  accountId: string,
): Promise<NotificationPreferences> {
  const result = await executor.query<{
    message_preview_enabled: boolean;
    updated_at: Date;
  }>(
    `SELECT message_preview_enabled, updated_at
     FROM account_notification_preferences
     WHERE account_id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  return row
    ? { messagePreviewEnabled: row.message_preview_enabled, updatedAt: row.updated_at }
    : { messagePreviewEnabled: false, updatedAt: null };
}

export async function upsertNotificationPreferences(
  executor: QueryExecutor,
  input: {
    readonly accountId: string;
    readonly messagePreviewEnabled: boolean;
    readonly updatedAt: Date;
  },
): Promise<NotificationPreferences> {
  const result = await executor.query<{
    message_preview_enabled: boolean;
    updated_at: Date;
  }>(
    `INSERT INTO account_notification_preferences (
       account_id, message_preview_enabled, updated_at
     ) VALUES ($1,$2,$3)
     ON CONFLICT (account_id) DO UPDATE
     SET message_preview_enabled = EXCLUDED.message_preview_enabled,
         updated_at = EXCLUDED.updated_at
     RETURNING message_preview_enabled, updated_at`,
    [input.accountId, input.messagePreviewEnabled, input.updatedAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Notification preference upsert returned no row");
  return { messagePreviewEnabled: row.message_preview_enabled, updatedAt: row.updated_at };
}
