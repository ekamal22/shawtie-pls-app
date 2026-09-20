export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(statusCode: number, code: string, message = code, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
