export interface RetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  baseDelayMs: 1_000,
  maxDelayMs: 15 * 60_000,
  jitterRatio: 0.2,
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function retryDelayMs(
  attemptCount: number,
  key: string,
  policy: RetryPolicy = defaultRetryPolicy,
): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 20));
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  const unit = stableHash(`${key}:${attemptCount}`) / 0xffffffff;
  const jitter = base * policy.jitterRatio * unit;
  return Math.min(policy.maxDelayMs, Math.round(base + jitter));
}
