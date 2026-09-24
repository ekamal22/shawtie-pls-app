import type {
  CallFailureCategory,
  CallHistoryQuery,
  CallProjection,
  PushSubscriptionInput,
} from "@shawtie/contracts";
import { apiRequest } from "../../lib/api-client.ts";

function mutationHeaders(idempotencyKey = crypto.randomUUID()): HeadersInit {
  return { "idempotency-key": idempotencyKey };
}

export function fetchCurrentCall(): Promise<{ call: CallProjection | null }> {
  return apiRequest("/api/v1/calls/current");
}

export function fetchCall(callId: string): Promise<CallProjection> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId));
}

export function createCall(
  partnershipId: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<CallProjection> {
  return apiRequest("/api/v1/calls", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: { expectedPartnershipId: partnershipId, kind: "voice" },
  });
}

export function acceptCall(
  callId: string,
  expectedVersion: number,
  idempotencyKey = crypto.randomUUID(),
): Promise<CallProjection> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId) + "/accept", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: { expectedVersion },
  });
}

export function rejectCall(
  callId: string,
  expectedVersion: number,
  idempotencyKey = crypto.randomUUID(),
): Promise<CallProjection> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId) + "/reject", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: { expectedVersion },
  });
}

export function cancelCall(
  callId: string,
  expectedVersion: number,
  idempotencyKey = crypto.randomUUID(),
): Promise<CallProjection> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId) + "/cancel", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: { expectedVersion },
  });
}

export function endCall(
  callId: string,
  expectedVersion: number,
  idempotencyKey = crypto.randomUUID(),
): Promise<CallProjection> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId) + "/end", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: { expectedVersion },
  });
}

export function failCall(
  callId: string,
  expectedVersion: number,
  category: CallFailureCategory,
  idempotencyKey = crypto.randomUUID(),
): Promise<CallProjection> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId) + "/fail", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: { expectedVersion, category },
  });
}

export function reportEndpointConnected(
  callId: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<CallProjection> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId) + "/endpoint-connected", {
    method: "POST",
    headers: mutationHeaders(idempotencyKey),
    body: {},
  });
}

export interface TurnCredential {
  readonly urls: readonly string[];
  readonly username: string;
  readonly credential: string;
  readonly expiresAt: string;
  readonly iceTransportPolicy: "relay";
}

export function fetchTurnCredentials(callId: string): Promise<TurnCredential> {
  return apiRequest("/api/v1/calls/" + encodeURIComponent(callId) + "/turn-credentials", {
    method: "POST",
  });
}

export interface PushConfig {
  readonly enabled: boolean;
  readonly applicationServerKey: string | null;
}

export function fetchPushConfig(): Promise<PushConfig> {
  return apiRequest("/api/v1/push/config");
}

export function savePushSubscription(input: PushSubscriptionInput): Promise<{ ok: true }> {
  return apiRequest("/api/v1/push/subscriptions", {
    method: "POST",
    headers: mutationHeaders(),
    body: input,
  });
}

export function removePushSubscription(): Promise<void> {
  return apiRequest("/api/v1/push/subscriptions/current", { method: "DELETE" });
}

export function fetchCallHistory(query: CallHistoryQuery = { limit: 20 }) {
  const parameters = new URLSearchParams();
  parameters.set("limit", String(query.limit ?? 20));
  if (query.cursor) parameters.set("cursor", query.cursor);
  return apiRequest<{
    items: readonly unknown[];
    nextCursor: string | null;
  }>("/api/v1/calls?" + parameters.toString());
}
