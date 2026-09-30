import type { FastifyInstance } from "fastify";
import { BoundaryValidationError } from "@shawtie/contracts";
import { POSTGRES_SQLSTATE, postgresSqlState } from "@shawtie/db";
import { ApiError } from "../lib/api-error.ts";

function fastifyClientError(
  error: unknown,
): { readonly statusCode: number; readonly code: "REQUEST_TOO_LARGE" | "VALIDATION_FAILED" } | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { readonly statusCode?: unknown; readonly code?: unknown };
  if (
    typeof candidate.statusCode !== "number" ||
    candidate.statusCode < 400 ||
    candidate.statusCode >= 500 ||
    typeof candidate.code !== "string" ||
    !candidate.code.startsWith("FST_")
  ) {
    return null;
  }
  return {
    statusCode: candidate.statusCode,
    code: candidate.statusCode === 413 ? "REQUEST_TOO_LARGE" : "VALIDATION_FAILED",
  };
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BoundaryValidationError) {
      void reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
      return;
    }
    if (error instanceof ApiError) {
      if (error.retryAfterSeconds !== undefined) {
        reply.header("retry-after", String(error.retryAfterSeconds));
      }
      void reply.status(error.statusCode).send({ error: { code: error.code } });
      return;
    }
    const clientError = fastifyClientError(error);
    if (clientError) {
      void reply.status(clientError.statusCode).send({ error: { code: clientError.code } });
      return;
    }
    const sqlState = postgresSqlState(error);
    if (
      sqlState === POSTGRES_SQLSTATE.uniqueViolation ||
      sqlState === POSTGRES_SQLSTATE.checkViolation ||
      sqlState === POSTGRES_SQLSTATE.foreignKeyViolation
    ) {
      void reply.status(409).send({ error: { code: "CONFLICT" } });
      return;
    }
    console.error("API_UNEXPECTED_ERROR", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    void reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
}
