export interface AuthKeyConfig {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export type PartnerRequestMode = "disabled" | "request_only_test" | "paired";

export interface CallingConfig {
  readonly enabled: boolean;
  readonly transportEnabled: boolean;
  readonly ringTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly hardTimeoutMs: number;
  readonly turnUrls: readonly string[];
  readonly turnSharedSecret: string | null;
  readonly turnCredentialTtlMs: number;
  readonly pushVapidPublicKey: string | null;
}

export interface ApiConfig {
  readonly environment: "development" | "test" | "production";
  readonly appOrigin: string;
  readonly allowInsecureLoopbackCookies: boolean;
  readonly trustedProxy: false | string[];
  readonly authKeys: AuthKeyConfig;
  readonly partnerRequestMode?: PartnerRequestMode;
  readonly calling?: CallingConfig;
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

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(name + " must be a positive integer");
  return value;
}

function boundedPositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  const value = positiveInteger(raw, fallback, name);
  if (value > maximum) throw new Error(name + " must not exceed " + maximum);
  return value;
}

function callingConfig(
  env: NodeJS.ProcessEnv,
  environment: ApiConfig["environment"],
): CallingConfig {
  const defaultEnabled = environment === "production" ? false : true;
  const enabled =
    env.C1_CALLING_ENABLED === undefined ? defaultEnabled : env.C1_CALLING_ENABLED === "1";
  const transportEnabled =
    env.C1_TRANSPORT_ENABLED === undefined ? defaultEnabled : env.C1_TRANSPORT_ENABLED === "1";
  const turnUrls = (env.C1_TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (turnUrls.some((url) => !/^turns?:/i.test(url))) {
    throw new Error("C1_TURN_URLS must contain only turn: or turns: URLs");
  }
  if (environment === "production" && enabled && transportEnabled) {
    if (turnUrls.length === 0 || !env.C1_TURN_SHARED_SECRET) {
      throw new Error(
        "C1 relay-only production calling requires C1_TURN_URLS and C1_TURN_SHARED_SECRET",
      );
    }
  }
  return {
    enabled,
    transportEnabled,
    ringTimeoutMs: boundedPositiveInteger(
      env.C1_RING_TIMEOUT_MS,
      60_000,
      "C1_RING_TIMEOUT_MS",
      5 * 60_000,
    ),
    connectTimeoutMs: boundedPositiveInteger(
      env.C1_CONNECT_TIMEOUT_MS,
      120_000,
      "C1_CONNECT_TIMEOUT_MS",
      10 * 60_000,
    ),
    hardTimeoutMs: boundedPositiveInteger(
      env.C1_HARD_TIMEOUT_MS,
      6 * 60 * 60_000,
      "C1_HARD_TIMEOUT_MS",
      24 * 60 * 60_000,
    ),
    turnUrls,
    turnSharedSecret: env.C1_TURN_SHARED_SECRET ?? null,
    turnCredentialTtlMs: boundedPositiveInteger(
      env.C1_TURN_CREDENTIAL_TTL_MS,
      10 * 60_000,
      "C1_TURN_CREDENTIAL_TTL_MS",
      15 * 60_000,
    ),
    pushVapidPublicKey: env.C1_PUSH_VAPID_PUBLIC_KEY ?? null,
  };
}

export function resolveCallingConfig(config: ApiConfig): CallingConfig {
  return (
    config.calling ?? {
      enabled: config.environment !== "production",
      transportEnabled: config.environment !== "production",
      ringTimeoutMs: 60_000,
      connectTimeoutMs: 120_000,
      hardTimeoutMs: 6 * 60 * 60_000,
      turnUrls: [],
      turnSharedSecret: null,
      turnCredentialTtlMs: 10 * 60_000,
      pushVapidPublicKey: null,
    }
  );
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
    calling: callingConfig(env, environment),
  };
}
