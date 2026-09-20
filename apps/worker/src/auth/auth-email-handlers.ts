import {
  getChallengeForDelivery,
  getClockTimestamp,
  getSecurityEmailDelivery,
  markSecurityEmailDelivered,
  type DatabasePool,
} from "@shawtie/db";
import { PermanentWorkerError } from "../runtime/errors.ts";
import type { OutboxHandler } from "../outbox/outbox-handler.ts";
import type { EmailDeliveryPort } from "./email-delivery-port.ts";
import type { WorkerAuthKeyRing } from "./worker-auth-key-ring.ts";

function objectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PermanentWorkerError("INVALID_AUTH_EMAIL_PAYLOAD");
  }
  return payload as Record<string, unknown>;
}

export function createEmailChallengeOutboxHandler(
  database: DatabasePool,
  email: EmailDeliveryPort,
  keys: WorkerAuthKeyRing,
): OutboxHandler {
  return {
    eventType: "auth.email_challenge",
    payloadVersion: 1,
    async deliver({ event, signal }) {
      const payload = objectPayload(event.payload);
      const challengeId = payload.challengeId;
      if (typeof challengeId !== "string") {
        throw new PermanentWorkerError("INVALID_AUTH_EMAIL_PAYLOAD");
      }
      const challenge = await getChallengeForDelivery(database.pool, challengeId);
      if (
        !challenge ||
        !challenge.challengeNonce ||
        challenge.consumedAt ||
        challenge.supersededAt ||
        challenge.attemptCount >= challenge.maxAttempts
      ) {
        throw new PermanentWorkerError("EMAIL_CHALLENGE_INACTIVE");
      }
      const now = await getClockTimestamp(database.pool);
      if (now.getTime() >= challenge.expiresAt.getTime()) {
        throw new PermanentWorkerError("EMAIL_CHALLENGE_EXPIRED");
      }

      let code: string;
      try {
        code = keys.deriveEmailCode(
          challenge.id,
          challenge.purpose,
          challenge.challengeNonce,
          challenge.verifierKeyVersion,
        );
      } catch {
        throw new PermanentWorkerError("AUTH_KEY_VERSION_UNAVAILABLE");
      }

      await email.sendSecurityEmail(
        {
          deliveryId: challenge.id,
          destination: challenge.emailDisplay ?? challenge.emailNormalized,
          template: "verification_code",
          parameters: { code, purpose: challenge.purpose },
        },
        signal,
      );
    },
  };
}

export function createSecurityEmailOutboxHandler(
  database: DatabasePool,
  email: EmailDeliveryPort,
): OutboxHandler {
  return {
    eventType: "auth.security_email",
    payloadVersion: 1,
    async deliver({ event, signal }) {
      const payload = objectPayload(event.payload);
      const deliveryId = payload.securityEmailDeliveryId;
      if (typeof deliveryId !== "string") {
        throw new PermanentWorkerError("INVALID_AUTH_EMAIL_PAYLOAD");
      }
      const delivery = await getSecurityEmailDelivery(database.pool, deliveryId);
      if (!delivery || delivery.deliveredAt) return;
      const now = await getClockTimestamp(database.pool);
      if (now.getTime() >= delivery.expiresAt.getTime()) {
        throw new PermanentWorkerError("SECURITY_EMAIL_EXPIRED");
      }

      const parameters: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(delivery.parameters)) {
        if (
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          parameters[key] = value;
        }
      }

      await email.sendSecurityEmail(
        {
          deliveryId,
          destination: delivery.destinationEmail,
          template: delivery.template,
          parameters,
        },
        signal,
      );
      await markSecurityEmailDelivered(database.pool, deliveryId, now);
    },
  };
}
