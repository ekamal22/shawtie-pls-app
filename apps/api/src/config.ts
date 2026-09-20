export interface AuthKeyConfig {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export interface ApiConfig {
  readonly environment: "development" | "test" | "production";
  readonly appOrigin: string;
  readonly allowInsecureLoopbackCookies: boolean;
  readonly trustedProxy: false | readonly string[];
  readonly authKeys: AuthKeyConfig;
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
    if (decoded.length < 32) throw new Error("AUTH_HMAC_KEYS entries must contain at least 32 bytes");
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

function parseTrustedProxy(raw: string | undefined): false | readonly string[] {
  if (!raw) return false;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return false;
  if (values.some((value) => value === "*" || value === "true" || /^\d+$/.test(value))) {
    throw new Error("TRUSTED_PROXY must use explicit IP or CIDR entries");
  }
  return values;
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
  };
}
