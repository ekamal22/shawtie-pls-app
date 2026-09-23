export interface AuthKeyConfig {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export type PartnerRequestMode = "disabled" | "request_only_test" | "paired";

export interface MediaApiConfig {
  readonly uploadInitiationEnabled: boolean;
  readonly bindingEnabled: boolean;
  readonly downloadGrantEnabled: boolean;
  readonly uploadGrantTtlMs: number;
  readonly downloadGrantTtlMs: number;
  readonly uploadRetentionMs: number;
  readonly unboundRetentionMs: number;
}

export interface ApiConfig {
  readonly environment: "development" | "test" | "production";
  readonly appOrigin: string;
  readonly allowInsecureLoopbackCookies: boolean;
  readonly trustedProxy: false | string[];
  readonly authKeys: AuthKeyConfig;
  readonly partnerRequestMode?: PartnerRequestMode;
  readonly media?: MediaApiConfig;
}

function parseAuthKeys(raw: string | undefined, activeRaw: string | undefined): AuthKeyConfig {
  if (!raw) throw new Error("AUTH_HMAC_KEYS is required");
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(",")) {
    const [versionRaw, value] = part.split(":");
    const version = Number.parseInt(versionRaw ?? "", 10);
    if (!Number.isInteger(version) || version <= 0 || !value) {
      throw new Error("AUTH_HMAC_KEYS must use version:base64 entries");
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.length < 32)
      throw new Error("AUTH_HMAC_KEYS entries must contain at least 32 bytes");
    if (keys.has(version)) throw new Error("AUTH_HMAC_KEYS contains a duplicate version");
    keys.set(version, decoded);
  }
  const activeVersion = Number.parseInt(activeRaw ?? "", 10);
  if (!Number.isInteger(activeVersion) || !keys.has(activeVersion)) {
    throw new Error("AUTH_HMAC_ACTIVE_VERSION must identify a configured key");
  }
  return { activeVersion, keys };
}

function parseOrigin(raw: string | undefined, environment: ApiConfig["environment"]): string {
  if (!raw) throw new Error("APP_ORIGIN is required");
  const url = new URL(raw);
  if (environment === "production" && url.protocol !== "https:") {
    throw new Error("Production APP_ORIGIN must use HTTPS");
  }
  return url.origin;
}

function parseTrustedProxy(raw: string | undefined): false | string[] {
  if (!raw) return false;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) return false;
  if (values.some((value) => value === "*" || value === "true" || /^\d+$/.test(value))) {
    throw new Error("TRUSTED_PROXY must use explicit IP or CIDR entries");
  }
  return values;
}

function parsePartnerRequestMode(
  raw: string | undefined,
  environment: ApiConfig["environment"],
): PartnerRequestMode {
  const mode = raw ?? "disabled";
  if (mode !== "disabled" && mode !== "request_only_test" && mode !== "paired") {
    throw new Error("PARTNER_REQUEST_MODE must be disabled, request_only_test, or paired");
  }
  if (environment === "production" && mode === "request_only_test") {
    throw new Error("request_only_test partner-request mode is forbidden in production");
  }
  return mode;
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(name + " must be a positive integer");
  return parsed;
}

function flag(raw: string | undefined, fallback = true): boolean {
  if (raw === undefined) return fallback;
  if (raw === "1") return true;
  if (raw === "0") return false;
  throw new Error("Feature flags must be 0 or 1");
}

export function resolveMediaApiConfig(config: ApiConfig): MediaApiConfig {
  return config.media ?? {
    uploadInitiationEnabled: true,
    bindingEnabled: true,
    downloadGrantEnabled: true,
    uploadGrantTtlMs: 5 * 60_000,
    downloadGrantTtlMs: 60_000,
    uploadRetentionMs: 15 * 60_000,
    unboundRetentionMs: 24 * 60 * 60_000,
  };
}

export function apiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const environment =
    env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  const allowInsecureLoopbackCookies = env.ALLOW_INSECURE_LOOPBACK_COOKIES === "1";
  if (environment === "production" && allowInsecureLoopbackCookies) {
    throw new Error("Insecure loopback cookies are forbidden in production");
  }
  return {
    environment,
    appOrigin: parseOrigin(env.APP_ORIGIN, environment),
    allowInsecureLoopbackCookies,
    trustedProxy: parseTrustedProxy(env.TRUSTED_PROXY),
    authKeys: parseAuthKeys(env.AUTH_HMAC_KEYS, env.AUTH_HMAC_ACTIVE_VERSION),
    partnerRequestMode: parsePartnerRequestMode(env.PARTNER_REQUEST_MODE, environment),
    media: {
      uploadInitiationEnabled: flag(env.MEDIA_UPLOAD_INITIATION_ENABLED),
      bindingEnabled: flag(env.MEDIA_BINDING_ENABLED),
      downloadGrantEnabled: flag(env.MEDIA_DOWNLOAD_GRANT_ENABLED),
      uploadGrantTtlMs: parsePositiveInteger(env.MEDIA_UPLOAD_GRANT_TTL_MS, 5 * 60_000, "MEDIA_UPLOAD_GRANT_TTL_MS"),
      downloadGrantTtlMs: parsePositiveInteger(env.MEDIA_DOWNLOAD_GRANT_TTL_MS, 60_000, "MEDIA_DOWNLOAD_GRANT_TTL_MS"),
      uploadRetentionMs: parsePositiveInteger(env.MEDIA_UPLOAD_RETENTION_MS, 15 * 60_000, "MEDIA_UPLOAD_RETENTION_MS"),
      unboundRetentionMs: parsePositiveInteger(env.MEDIA_UNBOUND_RETENTION_MS, 24 * 60 * 60_000, "MEDIA_UNBOUND_RETENTION_MS"),
    },
  };
}
