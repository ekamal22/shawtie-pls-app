export class ApiClientError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  if (method !== "GET") {
    headers.set("x-shawtie-csrf", "1");
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "include",
    cache: "no-store",
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string } }
    | T
    | null;

  if (!response.ok) {
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error?.code
        ? payload.error.code
        : "REQUEST_FAILED";
    throw new ApiClientError(code, response.status);
  }

  return payload as T;
}
