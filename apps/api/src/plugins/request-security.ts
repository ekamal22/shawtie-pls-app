import {
  M2_CLIENT_COMPATIBILITY_VERSION,
  M2_CLIENT_PROTOCOL_HEADER,
  M2_LOCAL_SCHEMA_HEADER,
  M2_LOCAL_SCHEMA_VERSION,
} from "@shawtie/contracts";
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


function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1) return value[0] ?? null;
  return null;
}

export function installM2Compatibility(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/v1/")) return;

    const clientProtocol = headerValue(
      request.headers[M2_CLIENT_PROTOCOL_HEADER],
    );
    const localSchema = headerValue(
      request.headers[M2_LOCAL_SCHEMA_HEADER],
    );

    // Headerless callers remain compatible with the verified pre-M2 HTTP API.
    // Once either M2 compatibility header is advertised, both must match.
    if (clientProtocol === null && localSchema === null) return;

    if (
      clientProtocol !== String(M2_CLIENT_COMPATIBILITY_VERSION) ||
      localSchema !== String(M2_LOCAL_SCHEMA_VERSION)
    ) {
      throw new ApiError(
        426,
        "CLIENT_UPDATE_REQUIRED",
        "CLIENT_UPDATE_REQUIRED",
      );
    }
  });
}
