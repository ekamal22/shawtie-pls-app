import { randomUUID } from "node:crypto";
import {
  getAccountProfile,
  insertAccountNotification,
  insertOutboxEvent,
  insertSecurityEmailDelivery,
  type AccountNotificationEventType,
  type QueryExecutor,
} from "@shawtie/db";

const DAY = 24 * 60 * 60_000;

export async function queueWorkerSecurityEmail(
  transaction: QueryExecutor,
  input: {
    readonly accountId?: string | null;
    readonly destinationEmail: string;
    readonly template: string;
    readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
    readonly deduplicationKey: string;
    readonly now: Date;
  },
): Promise<void> {
  const deliveryId = randomUUID();
  await insertSecurityEmailDelivery(transaction, {
    id: deliveryId,
    accountId: input.accountId ?? null,
    destinationEmail: input.destinationEmail,
    template: input.template,
    parameters: input.parameters ?? {},
    expiresAt: new Date(input.now.getTime() + 7 * DAY),
    at: input.now,
  });
  await insertOutboxEvent(transaction, {
    id: randomUUID(),
    eventType: "auth.security_email",
    aggregateType: "security_email_delivery",
    aggregateId: deliveryId,
    deduplicationKey: input.deduplicationKey,
    payload: { securityEmailDeliveryId: deliveryId },
    payloadVersion: 1,
  });
}

export async function queueWorkerLifecycleNotice(
  transaction: QueryExecutor,
  input: {
    readonly recipientAccountId: string;
    readonly actorAccountId?: string | null;
    readonly partnershipId: string;
    readonly eventType: AccountNotificationEventType;
    readonly deduplicationKey: string;
    readonly now: Date;
    readonly emailTemplate?: string;
    readonly emailParameters?: Readonly<Record<string, string | number | boolean | null>>;
    readonly emailAccountId?: string | null;
  },
): Promise<void> {
  await insertAccountNotification(transaction, {
    id: randomUUID(),
    recipientAccountId: input.recipientAccountId,
    actorAccountId: input.actorAccountId ?? null,
    partnershipId: input.partnershipId,
    eventType: input.eventType,
    deduplicationKey: input.deduplicationKey,
    createdAt: input.now,
  });

  if (!input.emailTemplate) return;
  const profile = await getAccountProfile(transaction, input.recipientAccountId);
  if (!profile) return;
  await queueWorkerSecurityEmail(transaction, {
    accountId: input.emailAccountId === undefined ? input.recipientAccountId : input.emailAccountId,
    destinationEmail: profile.email,
    template: input.emailTemplate,
    ...(input.emailParameters ? { parameters: input.emailParameters } : {}),
    deduplicationKey: "lifecycle-email:" + input.deduplicationKey,
    now: input.now,
  });
}
