import { randomUUID } from "node:crypto";
import {
  insertOutboxEvent,
  type QueryExecutor,
} from "@shawtie/db";

function safeVersion(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Realtime version exceeds safe integer range");
  }
  return number;
}

export async function queueRealtimeReceiptChanged(
  transaction: QueryExecutor,
  input: {
    conversationId: string;
    deliveredThrough: bigint;
    readThrough: bigint;
  },
): Promise<void> {
  const id = randomUUID();
  await insertOutboxEvent(transaction, {
    id,
    eventType: "m2.conversation.receipt_changed",
    aggregateType: "conversation",
    aggregateId: input.conversationId,
    deduplicationKey: "m2-receipt:" + id,
    payload: {
      conversationId: input.conversationId,
      deliveredThrough: safeVersion(input.deliveredThrough),
      readThrough: safeVersion(input.readThrough),
    },
    payloadVersion: 1,
  });
}

export async function queueRealtimeNicknameChanged(
  transaction: QueryExecutor,
  input: {
    partnershipId: string;
    subjectAccountId: string;
    version: bigint;
  },
): Promise<void> {
  const id = randomUUID();
  await insertOutboxEvent(transaction, {
    id,
    eventType: "m2.conversation.nickname_changed",
    aggregateType: "partnership",
    aggregateId: input.partnershipId,
    deduplicationKey: "m2-nickname:" + id,
    payload: {
      partnershipId: input.partnershipId,
      subjectAccountId: input.subjectAccountId,
      version: safeVersion(input.version),
    },
    payloadVersion: 1,
  });
}

export async function queueRealtimePartnershipChanged(
  transaction: QueryExecutor,
  input: {
    partnershipId: string;
    accountIds: readonly string[];
    generation: bigint;
    metadataVersion: bigint;
  },
): Promise<void> {
  if (
    input.accountIds.length !== 2 ||
    new Set(input.accountIds).size !== 2
  ) {
    throw new Error("Realtime partnership routing requires exactly two distinct accounts");
  }
  const id = randomUUID();
  const accountIds = [...input.accountIds].sort();
  await insertOutboxEvent(transaction, {
    id,
    eventType: "m2.partnership.changed",
    aggregateType: "partnership",
    aggregateId: input.partnershipId,
    deduplicationKey: "m2-partnership:" + id,
    payload: {
      partnershipId: input.partnershipId,
      accountIds,
      generation: safeVersion(input.generation),
      metadataVersion: safeVersion(input.metadataVersion),
    },
    payloadVersion: 1,
  });
}

export async function queueRealtimeRelationshipChanged(
  transaction: QueryExecutor,
  input: {
    partnershipId: string;
    itemId: string | null;
    itemVersion: bigint | null;
  },
): Promise<void> {
  const id = randomUUID();
  await insertOutboxEvent(transaction, {
    id,
    eventType: "m2.relationship.changed",
    aggregateType: "partnership",
    aggregateId: input.partnershipId,
    deduplicationKey: "m2-relationship:" + id,
    payload: {
      partnershipId: input.partnershipId,
      itemId: input.itemId,
      itemVersion:
        input.itemVersion === null ? null : safeVersion(input.itemVersion),
    },
    payloadVersion: 1,
  });
}

export async function queueRealtimeAccountSecurityChanged(
  transaction: QueryExecutor,
  accountId: string,
): Promise<void> {
  const id = randomUUID();
  await insertOutboxEvent(transaction, {
    id,
    eventType: "m2.account.security_changed",
    aggregateType: "account",
    aggregateId: accountId,
    deduplicationKey: "m2-account-security:" + id,
    payload: { accountId },
    payloadVersion: 1,
  });
}
