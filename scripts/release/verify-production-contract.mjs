function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function enabled(env, name) {
  if (required(env, name) !== "1") throw new Error(name + " must be 1 for Stable Release");
}

function httpsOrigin(value, name) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(name + " must be a bare HTTPS origin");
  }
  return url;
}

function databaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error("DATABASE_URL must identify a database");
  }
}

function completeMedia(env) {
  const endpoint = required(env, "MEDIA_S3_ENDPOINT");
  httpsOrigin(endpoint, "MEDIA_S3_ENDPOINT");
  required(env, "MEDIA_S3_BUCKET");
  required(env, "MEDIA_S3_REGION");
  required(env, "MEDIA_S3_ACCESS_KEY_ID");
  required(env, "MEDIA_S3_SECRET_ACCESS_KEY");
}

function base(env) {
  if (required(env, "NODE_ENV") !== "production") {
    throw new Error("NODE_ENV must be production");
  }
  httpsOrigin(required(env, "APP_ORIGIN"), "APP_ORIGIN");
}

function api(env) {
  base(env);
  databaseUrl(required(env, "DATABASE_URL"));
  required(env, "AUTH_HMAC_KEYS");
  required(env, "AUTH_HMAC_ACTIVE_VERSION");
  if (required(env, "PARTNER_REQUEST_MODE") !== "paired") {
    throw new Error("PARTNER_REQUEST_MODE must be paired for Stable Release");
  }
  enabled(env, "MEDIA_UPLOAD_INITIATION_ENABLED");
  enabled(env, "MEDIA_BINDING_ENABLED");
  enabled(env, "MEDIA_DOWNLOAD_GRANT_ENABLED");
  completeMedia(env);
  enabled(env, "C1_CALLING_ENABLED");
  enabled(env, "C1_TRANSPORT_ENABLED");
  enabled(env, "C2_VIDEO_ENABLED");
  required(env, "C1_TURN_URLS");
  required(env, "C1_TURN_SHARED_SECRET");
  required(env, "C1_PUSH_VAPID_PUBLIC_KEY");
}

function worker(env) {
  base(env);
  databaseUrl(required(env, "DATABASE_URL"));
  required(env, "AUTH_HMAC_KEYS");
  required(env, "AUTH_HMAC_ACTIVE_VERSION");
  completeMedia(env);
  if (required(env, "EMAIL_PROVIDER").toLowerCase() !== "brevo") {
    throw new Error("EMAIL_PROVIDER must be brevo for Stable Release");
  }
  required(env, "BREVO_API_KEY");
  required(env, "BREVO_SENDER_EMAIL");
  required(env, "BREVO_SENDER_NAME");
  required(env, "C1_PUSH_VAPID_SUBJECT");
  required(env, "C1_PUSH_VAPID_PUBLIC_KEY");
  required(env, "C1_PUSH_VAPID_PRIVATE_KEY");
}

function web(env) {
  base(env);
  const backend = new URL(required(env, "BACKEND_PROXY_TARGET"));
  if (backend.protocol !== "https:" && backend.protocol !== "http:") {
    throw new Error("BACKEND_PROXY_TARGET must use HTTPS or a reviewed private HTTP hop");
  }
  if (backend.protocol === "http:" && env.WEB_ALLOW_PRIVATE_BACKEND_HTTP !== "1") {
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(backend.hostname);
    const ipv4Private =
      /^10\./.test(backend.hostname) ||
      /^192\.168\./.test(backend.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(backend.hostname);
    if (!loopback && !ipv4Private) {
      throw new Error(
        "HTTP BACKEND_PROXY_TARGET must be private/loopback or explicitly reviewed",
      );
    }
  }
  required(env, "WEB_TRUSTED_PROXY");
  required(env, "WEB_MEDIA_CONNECT_SRC");
}

const role = process.env.R2_SERVICE_ROLE?.trim() || process.argv[2];
if (role === "api") api(process.env);
else if (role === "worker") worker(process.env);
else if (role === "web") web(process.env);
else throw new Error("R2_SERVICE_ROLE must be api, worker, or web");

console.log("R2_PRODUCTION_CONTRACT_PASS role=" + role);
