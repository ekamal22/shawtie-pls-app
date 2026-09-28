function unique(values) {
  return [...new Set(values)];
}

export function parseConnectOrigins(raw, { allowInsecureLoopback = false } = {}) {
  if (!raw || !raw.trim()) return [];
  const values = raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return unique(
    values.map((value) => {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Media connect origins must use http or https");
      }
      if (
        url.protocol === "http:" &&
        !(
          allowInsecureLoopback &&
          (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
        )
      ) {
        throw new Error("Insecure media connect origins are allowed only for loopback testing");
      }
      return url.origin;
    }),
  );
}

export function buildWebSecurityHeaders({
  appOrigin,
  mediaConnectSrc = "",
  allowInsecureLoopback = false,
}) {
  const app = new URL(appOrigin);
  if (app.protocol !== "https:" && app.protocol !== "http:") {
    throw new Error("APP_ORIGIN must use http or https");
  }
  if (
    app.protocol === "http:" &&
    !(
      allowInsecureLoopback &&
      (app.hostname === "127.0.0.1" || app.hostname === "localhost" || app.hostname === "::1")
    )
  ) {
    throw new Error("Production web origin must use HTTPS");
  }

  const websocket = new URL(app.origin);
  websocket.protocol = app.protocol === "https:" ? "wss:" : "ws:";

  const mediaOrigins = parseConnectOrigins(mediaConnectSrc, { allowInsecureLoopback });
  const connectSources = unique(["'self'", websocket.origin, ...mediaOrigins]).join(" ");

  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "worker-src 'self'",
    "connect-src " + connectSources,
  ];
  if (app.protocol === "https:") directives.push("upgrade-insecure-requests");

  const headers = {
    "Content-Security-Policy": directives.join("; ") + ";",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), microphone=(self)",
    "X-Frame-Options": "DENY",
  };

  if (app.protocol === "https:") {
    headers["Strict-Transport-Security"] = "max-age=31536000";
  }

  return Object.freeze(headers);
}
