import { type ZodError, type ZodType } from "zod";

export type BoundarySchema<Output> = ZodType<Output>;

export class BoundaryValidationError extends Error {
  readonly issues: ZodError["issues"];

  constructor(error: ZodError) {
    super("External input failed runtime validation");
    this.name = "BoundaryValidationError";
    this.issues = error.issues;
  }
}

export function parseAtBoundary<Output>(schema: BoundarySchema<Output>, input: unknown): Output {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new BoundaryValidationError(result.error);
  }

  return result.data;
}

export function safeParseAtBoundary<Output>(schema: BoundarySchema<Output>, input: unknown) {
  return schema.safeParse(input);
}
