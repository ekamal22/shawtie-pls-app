export class RetryableWorkerError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "RetryableWorkerError";
    this.code = code;
  }
}

export class PermanentWorkerError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "PermanentWorkerError";
    this.code = code;
  }
}

export function workerErrorCode(error: unknown): string {
  if (error instanceof RetryableWorkerError || error instanceof PermanentWorkerError) {
    return error.code;
  }
  return "UNEXPECTED_WORKER_ERROR";
}
