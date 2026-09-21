import { z } from "zod";

const uuid = z.string().uuid();
const cursor = z.string().min(1).max(2048);

export const accountNotificationEventTypeSchema = z.enum([
  "partnership_formed",
  "relationship_start_date_changed",
]);

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: cursor.optional(),
});

export const notificationCursorSchema = z.object({
  v: z.literal(1),
  snapshotAt: z.string().min(20).max(40),
  createdAt: z.string().min(20).max(40),
  notificationId: uuid,
});

export const notificationIdParamsSchema = z.object({
  notificationId: uuid,
});

export const notificationReadBodySchema = z.undefined();

export type AccountNotificationEventType = z.infer<typeof accountNotificationEventTypeSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationCursor = z.infer<typeof notificationCursorSchema>;
export type NotificationIdParams = z.infer<typeof notificationIdParamsSchema>;
