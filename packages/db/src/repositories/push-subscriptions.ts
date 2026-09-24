import type { QueryExecutor } from "../types/query-executor.ts";

export interface PushSubscriptionRecord {
  readonly deviceId: string;
  readonly accountId: string;
  readonly endpoint: string;
  readonly endpointFingerprint: Buffer;
  readonly endpointKeyVersion: number;
  readonly p256dh: string;
  readonly auth: string;
  readonly expirationTimeMs: bigint | null;
}

export async function upsertPushSubscription(
  executor: QueryExecutor,
  input: PushSubscriptionRecord & { readonly now: Date },
): Promise<void> {
  await executor.query(
    `UPDATE push_subscriptions
     SET revoked_at=$5, updated_at=$5
     WHERE (
         endpoint=$1
         OR (endpoint_key_version=$3 AND endpoint_fingerprint=$4)
       )
       AND device_id<>$2
       AND revoked_at IS NULL`,
    [
      input.endpoint,
      input.deviceId,
      input.endpointKeyVersion,
      input.endpointFingerprint,
      input.now,
    ],
  );
  await executor.query(
    `INSERT INTO push_subscriptions (
       device_id, account_id, endpoint, endpoint_fingerprint, endpoint_key_version,
       p256dh, auth, expiration_time_ms, created_at, updated_at, revoked_at, failure_count
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,NULL,0)
     ON CONFLICT (device_id) DO UPDATE
     SET endpoint=EXCLUDED.endpoint,
         endpoint_fingerprint=EXCLUDED.endpoint_fingerprint,
         endpoint_key_version=EXCLUDED.endpoint_key_version,
         p256dh=EXCLUDED.p256dh,
         auth=EXCLUDED.auth,
         expiration_time_ms=EXCLUDED.expiration_time_ms,
         updated_at=EXCLUDED.updated_at,
         revoked_at=NULL,
         failure_count=0`,
    [
      input.deviceId,
      input.accountId,
      input.endpoint,
      input.endpointFingerprint,
      input.endpointKeyVersion,
      input.p256dh,
      input.auth,
      input.expirationTimeMs?.toString() ?? null,
      input.now,
    ],
  );
}

export async function revokePushSubscriptionForDevice(
  executor: QueryExecutor,
  deviceId: string,
  accountId: string,
  now: Date,
): Promise<void> {
  await executor.query(
    "UPDATE push_subscriptions SET revoked_at=$3, updated_at=$3 WHERE device_id=$1 AND account_id=$2 AND revoked_at IS NULL",
    [deviceId, accountId, now],
  );
}

export async function listActivePushSubscriptionsForAccounts(
  executor: QueryExecutor,
  accountIds: readonly string[],
): Promise<readonly PushSubscriptionRecord[]> {
  if (accountIds.length === 0) return [];
  const result = await executor.query<{
    device_id: string;
    account_id: string;
    endpoint: string;
    endpoint_fingerprint: Buffer;
    endpoint_key_version: number;
    p256dh: string;
    auth: string;
    expiration_time_ms: string | number | bigint | null;
  }>(
    `SELECT subscription.device_id, subscription.account_id, subscription.endpoint,
            subscription.endpoint_fingerprint, subscription.endpoint_key_version,
            subscription.p256dh, subscription.auth, subscription.expiration_time_ms
     FROM push_subscriptions AS subscription
     JOIN accounts AS account ON account.id=subscription.account_id
     JOIN account_devices AS device
       ON device.id=subscription.device_id
      AND device.account_id=subscription.account_id
     WHERE subscription.account_id = ANY($1::uuid[])
       AND subscription.revoked_at IS NULL
       AND account.status='active'
       AND device.revoked_at IS NULL
       AND (
         subscription.expiration_time_ms IS NULL
         OR subscription.expiration_time_ms > (extract(epoch from clock_timestamp()) * 1000)::bigint
       )`,
    [[...accountIds]],
  );
  return result.rows.map((row) => ({
    deviceId: row.device_id,
    accountId: row.account_id,
    endpoint: row.endpoint,
    endpointFingerprint: row.endpoint_fingerprint,
    endpointKeyVersion: row.endpoint_key_version,
    p256dh: row.p256dh,
    auth: row.auth,
    expirationTimeMs:
      row.expiration_time_ms === null ? null : BigInt(row.expiration_time_ms),
  }));
}

export async function markPushDeliverySuccess(
  executor: QueryExecutor,
  deviceId: string,
  now: Date,
): Promise<void> {
  await executor.query(
    "UPDATE push_subscriptions SET last_success_at=$2,last_failure_at=NULL,failure_count=0 WHERE device_id=$1",
    [deviceId, now],
  );
}

export async function markPushDeliveryFailure(
  executor: QueryExecutor,
  deviceId: string,
  now: Date,
  revoke: boolean,
): Promise<void> {
  await executor.query(
    `UPDATE push_subscriptions
     SET last_failure_at=$2,
         failure_count=failure_count+1,
         revoked_at=CASE WHEN $3 THEN COALESCE(revoked_at,$2) ELSE revoked_at END
     WHERE device_id=$1`,
    [deviceId, now, revoke],
  );
}

export async function deletePushSubscriptionsForAccount(
  executor: QueryExecutor,
  accountId: string,
): Promise<void> {
  await executor.query("DELETE FROM push_subscriptions WHERE account_id=$1", [accountId]);
}
