import {
  appendCallEvent,
  insertOutboxEvent,
  loadCallDeadlineGeneration,
  loadCallParticipants,
  timeoutCall,
} from "@shawtie/db";
import { randomUUID } from "node:crypto";
import { PermanentWorkerError } from "../runtime/errors.ts";
import type { ScheduledActionHandler } from "../scheduled/scheduled-handler.ts";

function payload(value: unknown): {
  readonly callId: string;
  readonly expectedState: "ringing" | "accepted" | "connected";
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PermanentWorkerError("INVALID_C1_CALL_TIMEOUT_PAYLOAD");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "callId,expectedState" ||
    typeof record.callId !== "string" ||
    !["ringing", "accepted", "connected"].includes(String(record.expectedState))
  ) {
    throw new PermanentWorkerError("INVALID_C1_CALL_TIMEOUT_PAYLOAD");
  }
  return {
    callId: record.callId,
    expectedState: record.expectedState as "ringing" | "accepted" | "connected",
  };
}

function handler(expectedState: "ringing" | "accepted" | "connected"): ScheduledActionHandler {
  return {
    actionType: `c1.call.${expectedState}_timeout`,
    payloadVersion: 1,
    loadCurrentGeneration(transaction, action) {
      return loadCallDeadlineGeneration(transaction, action.aggregateId);
    },
    async execute({ transaction, action, now }) {
      const parsed = payload(action.payload);
      if (
        parsed.callId !== action.aggregateId ||
        parsed.expectedState !== expectedState ||
        action.aggregateType !== "call" ||
        action.expectedGeneration === null
      ) {
        throw new PermanentWorkerError("INVALID_C1_CALL_TIMEOUT_PAYLOAD");
      }

      const ended = await timeoutCall(transaction, {
        callId: parsed.callId,
        expectedGeneration: action.expectedGeneration,
        expectedState,
        reason: expectedState === "ringing" ? "missed" : "failed",
        now,
      });
      if (!ended) return { outcome: "stale" as const };

      await appendCallEvent(transaction, {
        id: randomUUID(),
        callId: ended.id,
        partnershipId: ended.partnershipId,
        eventType: expectedState === "ringing" ? "missed" : "timeout_failed",
        actorAccountId: null,
        callVersion: ended.version,
        now,
      });
      const participants = await loadCallParticipants(transaction, ended.id);
      const accountIds = participants.map((item) => item.accountId).sort();
      if (accountIds.length !== 2 || accountIds[0] === accountIds[1]) {
        throw new PermanentWorkerError("INVALID_C1_CALL_PARTICIPANTS");
      }
      const version = Number(ended.version);
      if (!Number.isSafeInteger(version)) {
        throw new PermanentWorkerError("INVALID_C1_CALL_VERSION");
      }
      await insertOutboxEvent(transaction, {
        id: randomUUID(),
        eventType: "c1.call.changed",
        aggregateType: "call",
        aggregateId: ended.id,
        deduplicationKey: `c1:call-changed:${ended.id}:${version}`,
        payload: {
          partnershipId: ended.partnershipId,
          callId: ended.id,
          version,
        },
        payloadVersion: 1,
      });
      await insertOutboxEvent(transaction, {
        id: randomUUID(),
        eventType: "c1.call.push",
        aggregateType: "call",
        aggregateId: ended.id,
        deduplicationKey: `c1:call-push:${ended.id}:${version}`,
        payload: { accountIds },
        payloadVersion: 1,
      });
    },
  };
}

export function createC1CallTimeoutHandlers(): readonly ScheduledActionHandler[] {
  return [handler("ringing"), handler("accepted"), handler("connected")];
}
