import {
  M2_CLIENT_COMPATIBILITY_VERSION,
  M2_CLIENT_PROTOCOL_HEADER,
  M2_LOCAL_SCHEMA_HEADER,
  M2_LOCAL_SCHEMA_VERSION,
} from "@shawtie/contracts";

export class ApiNetworkError extends Error {
  constructor(readonly originalError: unknown) {
    super("NETWORK_ERROR");
    this.name = "ApiNetworkError";
  }
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: HeadersInit;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  headers.set(M2_CLIENT_PROTOCOL_HEADER, String(M2_CLIENT_COMPATIBILITY_VERSION));
  headers.set(M2_LOCAL_SCHEMA_HEADER, String(M2_LOCAL_SCHEMA_VERSION));
  if (method !== "GET") {
    headers.set("x-shawtie-csrf", "1");
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    throw new ApiNetworkError(error);
  }

  const payload = (await response.json().catch(() => null)) as
    { error?: { code?: string } } | T | null;

  if (!response.ok) {
    const code =
      payload && typeof payload === "object" && "error" in payload && payload.error?.code
        ? payload.error.code
        : "REQUEST_FAILED";
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
    if (code === "CLIENT_UPDATE_REQUIRED") {
      window.dispatchEvent(new CustomEvent("shawtie:update-required"));
    }
    throw new ApiClientError(code, response.status, retryAfterSeconds);
  }

  return payload as T;
}
