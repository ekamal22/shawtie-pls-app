import type { FastifyInstance } from "fastify";
import { ApiError } from "../lib/api-error.ts";
import type { ApiConfig } from "../config.ts";

function originFromReferer(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function installMutationSecurity(app: FastifyInstance, config: ApiConfig): void {
  app.addHook("onRequest", async (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;

    const fetchSite = request.headers["sec-fetch-site"];
    if (fetchSite === "cross-site") throw new ApiError(403, "CSRF_REJECTED");

    const originHeader = request.headers.origin;
    const actualOrigin =
      typeof originHeader === "string"
        ? originHeader
        : typeof request.headers.referer === "string"
          ? originFromReferer(request.headers.referer)
          : null;

    if (actualOrigin !== config.appOrigin) throw new ApiError(403, "CSRF_REJECTED");
    if (request.headers["x-shawtie-csrf"] !== "1") {
      throw new ApiError(403, "CSRF_REJECTED");
    }

    const contentType = request.headers["content-type"];
    if (request.method !== "DELETE" && contentType && !contentType.includes("application/json")) {
      throw new ApiError(415, "VALIDATION_FAILED");
    }
  });
}
