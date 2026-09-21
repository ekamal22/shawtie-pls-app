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

export const accountNotificationSchema = z.object({
  notificationId: uuid,
  eventType: accountNotificationEventTypeSchema,
  actorAccountId: uuid.nullable(),
  partnershipId: uuid.nullable(),
  createdAt: z.string().min(20).max(40),
  readAt: z.string().min(20).max(40).nullable(),
});

export const notificationListResponseSchema = z.object({
  items: z.array(accountNotificationSchema),
  nextCursor: cursor.nullable(),
});

export const notificationReadResponseSchema = z.object({
  notificationId: uuid,
  readAt: z.string().min(20).max(40),
});

export type AccountNotification = z.infer<typeof accountNotificationSchema>;
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
export type NotificationReadResponse = z.infer<typeof notificationReadResponseSchema>;
