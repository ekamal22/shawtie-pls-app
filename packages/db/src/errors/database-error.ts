import { postgresSqlState } from "./postgres-error-codes.ts";

export class DatabaseError extends Error {
  readonly sqlState: string | null;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "DatabaseError";
    this.sqlState = postgresSqlState(cause);
  }
}

export function normalizeDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;
  return new DatabaseError("Database operation failed", error);
}
