import type { QueryExecutor } from "../types/query-executor.ts";

export type AccountNotificationEventType = "partnership_formed" | "relationship_start_date_changed";

export interface AccountNotification {
  readonly id: string;
  readonly recipientAccountId: string;
  readonly actorAccountId: string | null;
  readonly partnershipId: string | null;
  readonly eventType: AccountNotificationEventType;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

interface NotificationRow {
  id: string;
  recipient_account_id: string;
  actor_account_id: string | null;
  partnership_id: string | null;
  event_type: AccountNotificationEventType;
  created_at: Date;
  read_at: Date | null;
}

function mapNotification(row: NotificationRow): AccountNotification {
  return {
    id: row.id,
    recipientAccountId: row.recipient_account_id,
    actorAccountId: row.actor_account_id,
    partnershipId: row.partnership_id,
    eventType: row.event_type,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export async function insertAccountNotification(
  executor: QueryExecutor,
  input: {
    readonly id: string;
    readonly recipientAccountId: string;
    readonly actorAccountId?: string | null;
    readonly partnershipId?: string | null;
    readonly eventType: AccountNotificationEventType;
    readonly deduplicationKey: string;
    readonly createdAt: Date;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO account_notifications (
       id, recipient_account_id, actor_account_id, partnership_id,
       event_type, deduplication_key, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (deduplication_key) DO NOTHING`,
    [
      input.id,
      input.recipientAccountId,
      input.actorAccountId ?? null,
      input.partnershipId ?? null,
      input.eventType,
      input.deduplicationKey,
      input.createdAt,
    ],
  );
}

export async function listAccountNotifications(
  executor: QueryExecutor,
  input: {
    readonly recipientAccountId: string;
    readonly snapshotAt: Date;
    readonly cursorCreatedAt?: Date;
    readonly cursorNotificationId?: string;
    readonly limit: number;
  },
): Promise<readonly AccountNotification[]> {
  const result = await executor.query<NotificationRow>(
    `SELECT id, recipient_account_id, actor_account_id, partnership_id,
            event_type, created_at, read_at
     FROM account_notifications
     WHERE recipient_account_id = $1
       AND created_at <= $2
       AND (
         $3::timestamptz IS NULL
         OR (created_at, id) < ($3::timestamptz, $4::uuid)
       )
     ORDER BY created_at DESC, id DESC
     LIMIT $5`,
    [
      input.recipientAccountId,
      input.snapshotAt,
      input.cursorCreatedAt ?? null,
      input.cursorNotificationId ?? null,
      input.limit,
    ],
  );
  return result.rows.map(mapNotification);
}

export async function markAccountNotificationRead(
  executor: QueryExecutor,
  recipientAccountId: string,
  notificationId: string,
  readAt: Date,
): Promise<AccountNotification | null> {
  const result = await executor.query<NotificationRow>(
    `UPDATE account_notifications
     SET read_at = COALESCE(read_at, $3)
     WHERE id = $1
       AND recipient_account_id = $2
     RETURNING id, recipient_account_id, actor_account_id, partnership_id,
               event_type, created_at, read_at`,
    [notificationId, recipientAccountId, readAt],
  );
  const row = result.rows[0];
  return row ? mapNotification(row) : null;
}
