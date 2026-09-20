export const POSTGRES_SQLSTATE = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  serializationFailure: "40001",
  deadlockDetected: "40P01",
  lockNotAvailable: "55P03",
} as const;

export type KnownPostgresSqlState = (typeof POSTGRES_SQLSTATE)[keyof typeof POSTGRES_SQLSTATE];

export function postgresSqlState(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

export function isRetryableTransactionError(error: unknown): boolean {
  const code = postgresSqlState(error);
  return (
    code === POSTGRES_SQLSTATE.serializationFailure || code === POSTGRES_SQLSTATE.deadlockDetected
  );
}
