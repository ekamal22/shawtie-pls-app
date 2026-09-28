function directiveMap(csp) {
  const map = new Map();
  for (const raw of csp.split(";")) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    map.set(parts[0], parts.slice(1));
  }
  return map;
}

function requireHeader(headers, name) {
  const value = headers.get(name);
  if (!value) throw new Error("Missing required header: " + name);
  return value;
}

function requireSource(map, directive, source) {
  const values = map.get(directive) ?? [];
  if (!values.includes(source)) {
    throw new Error("CSP " + directive + " is missing " + source);
  }
}

function forbidSource(map, directive, source) {
  const values = map.get(directive) ?? [];
  if (values.includes(source)) {
    throw new Error("CSP " + directive + " must not include " + source);
  }
}

function expectedWebsocketOrigin(url) {
  const websocket = new URL(url.origin);
  websocket.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return websocket.origin;
}

function mediaOrigins(raw) {
  if (!raw || !raw.trim()) return [];
  return [...new Set(
    raw
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).origin),
  )];
}

export async function assertWebSecurityHeaders(target, options = {}) {
  const url = new URL(target);
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("SEC1 header target returned HTTP " + response.status);
  }

  const csp = requireHeader(response.headers, "content-security-policy");
  const directives = directiveMap(csp);

  requireSource(directives, "default-src", "'self'");
  requireSource(directives, "base-uri", "'none'");
  requireSource(directives, "object-src", "'none'");
  requireSource(directives, "frame-ancestors", "'none'");
  requireSource(directives, "script-src", "'self'");
  requireSource(directives, "script-src", "'wasm-unsafe-eval'");
  forbidSource(directives, "script-src", "'unsafe-eval'");
  forbidSource(directives, "script-src", "'unsafe-inline'");
  requireSource(directives, "style-src", "'self'");
  forbidSource(directives, "style-src", "'unsafe-inline'");
  requireSource(directives, "connect-src", "'self'");
  requireSource(directives, "connect-src", expectedWebsocketOrigin(url));

  for (const origin of mediaOrigins(options.mediaConnectSrc ?? process.env.SEC1_MEDIA_CONNECT_SRC)) {
    requireSource(directives, "connect-src", origin);
  }

  if (url.protocol === "https:") {
    const hsts = requireHeader(response.headers, "strict-transport-security");
    if (!/(?:^|;)\s*max-age=(\d+)/i.test(hsts)) {
      throw new Error("HSTS is missing max-age");
    }
    const maxAge = Number(hsts.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1] ?? "0");
    if (maxAge < 31_536_000) throw new Error("HSTS max-age is below one year");
    if (/includesubdomains|preload/i.test(hsts)) {
      throw new Error("SEC1 HSTS must not enable includeSubDomains or preload yet");
    }
  }

  if (requireHeader(response.headers, "x-content-type-options").toLowerCase() !== "nosniff") {
    throw new Error("X-Content-Type-Options must be nosniff");
  }
  if (requireHeader(response.headers, "referrer-policy").toLowerCase() !== "no-referrer") {
    throw new Error("Referrer-Policy must be no-referrer");
  }
  if (requireHeader(response.headers, "x-frame-options").toUpperCase() !== "DENY") {
    throw new Error("X-Frame-Options must be DENY");
  }
  const permissions = requireHeader(response.headers, "permissions-policy");
  if (!permissions.includes("camera=(self)") || !permissions.includes("microphone=(self)")) {
    throw new Error("Permissions-Policy must restrict camera and microphone to self");
  }

  return { status: response.status, csp };
}

async function main() {
  const target = process.argv[2] ?? process.env.SEC1_WEB_URL;
  if (!target) {
    throw new Error("Usage: node scripts/security/check-web-security-headers.mjs <url>");
  }
  await assertWebSecurityHeaders(target);
  console.log("SEC1_BROWSER_HEADERS_PASS");
}

if (process.argv[1]?.endsWith("check-web-security-headers.mjs")) {
  main().catch((error) => {
    console.error("SEC1_BROWSER_HEADERS_FAIL", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
