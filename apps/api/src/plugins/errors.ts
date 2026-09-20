import type { FastifyInstance } from "fastify";
import { BoundaryValidationError } from "@shawtie/contracts";
import { POSTGRES_SQLSTATE, postgresSqlState } from "@shawtie/db";
import { ApiError } from "../lib/api-error.ts";

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
    const sqlState = postgresSqlState(error);
    if (
      sqlState === POSTGRES_SQLSTATE.uniqueViolation ||
      sqlState === POSTGRES_SQLSTATE.checkViolation ||
      sqlState === POSTGRES_SQLSTATE.foreignKeyViolation
    ) {
      void reply.status(409).send({ error: { code: "CONFLICT" } });
      return;
    }
    console.error("API_UNEXPECTED_ERROR", { name: error.name });
    void reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
}
