import {
  getTransactionTimestamp,
  listAccountNotifications,
  markAccountNotificationRead,
  withTransaction,
  type DatabasePool,
} from "@shawtie/db";
import {
  notificationCursorSchema,
  parseAtBoundary,
  type NotificationCursor,
  type NotificationListQuery,
  type NotificationListResponse,
} from "@shawtie/contracts";
import { ApiError } from "../../lib/api-error.ts";
import type { AuthContext } from "../../plugins/authentication.ts";

function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): NotificationCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    return parseAtBoundary(notificationCursorSchema, parsed);
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED");
  }
}

function validDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export class NotificationService {
  readonly database: DatabasePool;

  constructor(database: DatabasePool) {
    this.database = database;
  }

  async list(auth: AuthContext, input: NotificationListQuery): Promise<NotificationListResponse> {
    return withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      let snapshotAt = now;
      let cursorCreatedAt: Date | undefined;
      let cursorNotificationId: string | undefined;

      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        const parsedSnapshot = validDate(cursor.snapshotAt);
        const parsedCreatedAt = validDate(cursor.createdAt);
        if (!parsedSnapshot || !parsedCreatedAt || parsedSnapshot.getTime() > now.getTime()) {
          throw new ApiError(400, "VALIDATION_FAILED");
        }
        snapshotAt = parsedSnapshot;
        cursorCreatedAt = parsedCreatedAt;
        cursorNotificationId = cursor.notificationId;
      }

      const rows = await listAccountNotifications(transaction, {
        recipientAccountId: auth.session.accountId,
        snapshotAt,
        ...(cursorCreatedAt ? { cursorCreatedAt } : {}),
        ...(cursorNotificationId ? { cursorNotificationId } : {}),
        limit: input.limit + 1,
      });
      const visible = rows.slice(0, input.limit);
      const last = visible.at(-1);

      return {
        items: visible.map((row) => ({
          notificationId: row.id,
          eventType: row.eventType,
          actorAccountId: row.actorAccountId,
          partnershipId: row.partnershipId,
          createdAt: row.createdAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
        })),
        nextCursor:
          rows.length > input.limit && last
            ? encodeCursor({
                v: 1,
                snapshotAt: snapshotAt.toISOString(),
                createdAt: last.createdAt.toISOString(),
                notificationId: last.id,
              })
            : null,
      };
    });
  }

  async markRead(
    auth: AuthContext,
    notificationId: string,
  ): Promise<{ notificationId: string; readAt: string }> {
    const result = await withTransaction(this.database, async (transaction) => {
      const now = await getTransactionTimestamp(transaction);
      return markAccountNotificationRead(transaction, auth.session.accountId, notificationId, now);
    });

    if (!result?.readAt) throw new ApiError(404, "NOTIFICATION_NOT_FOUND");
    return {
      notificationId: result.id,
      readAt: result.readAt.toISOString(),
    };
  }
}
