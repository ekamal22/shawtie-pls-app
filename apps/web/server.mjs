import { createReadStream, statSync } from "node:fs";
import { access } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWebSecurityHeaders } from "./server-security.mjs";

const DIST_DIR = fileURLToPath(new URL("./dist/", import.meta.url));

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function positivePort(raw) {
  const value = Number.parseInt(raw ?? "4173", 10);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return value;
}

function forwardedHeaders(request, backendTarget, appOrigin) {
  const headers = { ...request.headers, host: backendTarget.host };
  const remote = request.socket.remoteAddress;
  const existing = request.headers["x-forwarded-for"];
  if (remote) {
    headers["x-forwarded-for"] = existing ? String(existing) + ", " + remote : remote;
  }
  headers["x-forwarded-host"] = request.headers.host ?? new URL(appOrigin).host;
  headers["x-forwarded-proto"] = new URL(appOrigin).protocol.slice(0, -1);
  return headers;
}

function backendTransport(target) {
  return target.protocol === "https:" ? httpsRequest : httpRequest;
}

function proxyHttp(request, reply, backendTarget, appOrigin, securityHeaders) {
  const target = new URL(request.url ?? "/", backendTarget);
  const proxy = backendTransport(target)({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: request.method,
    path: target.pathname + target.search,
    headers: forwardedHeaders(request, backendTarget, appOrigin),
  });

  proxy.on("response", (response) => {
    const headers = { ...response.headers };
    for (const [name, value] of Object.entries(securityHeaders)) {
      headers[name.toLowerCase()] = value;
    }
    reply.writeHead(response.statusCode ?? 502, response.statusMessage, headers);
    response.pipe(reply);
  });
  proxy.on("error", () => {
    if (!reply.headersSent) {
      reply.writeHead(502, {
        ...securityHeaders,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
    }
    reply.end(JSON.stringify({ error: { code: "BACKEND_UNAVAILABLE" } }));
  });
  request.pipe(proxy);
}

function writeUpgradeResponse(socket, response) {
  let head = `HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}\r\n`;
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    head += response.rawHeaders[index] + ": " + response.rawHeaders[index + 1] + "\r\n";
  }
  socket.write(head + "\r\n");
}

function proxyUpgrade(request, socket, head, backendTarget, appOrigin) {
  const target = new URL(request.url ?? "/", backendTarget);
  const proxy = backendTransport(target)({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: "GET",
    path: target.pathname + target.search,
    headers: forwardedHeaders(request, backendTarget, appOrigin),
  });

  proxy.on("upgrade", (response, backendSocket, backendHead) => {
    writeUpgradeResponse(socket, response);
    if (backendHead.length > 0) socket.write(backendHead);
    if (head.length > 0) backendSocket.write(head);
    backendSocket.pipe(socket);
    socket.pipe(backendSocket);
  });
  proxy.on("response", (response) => {
    writeUpgradeResponse(socket, response);
    response.pipe(socket);
  });
  proxy.on("error", () => socket.destroy());
  proxy.end();
}

async function existingFile(pathname) {
  try {
    await access(pathname);
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}

function safeDistPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(DIST_DIR, relative);
  const root = resolve(DIST_DIR);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error("Path escapes dist");
  }
  return candidate;
}

function requestUsesCanonicalHost(request, appOrigin) {
  const host = typeof request.headers.host === "string" ? request.headers.host.trim().toLowerCase() : "";
  return host === new URL(appOrigin).host.toLowerCase();
}

function cacheControl(pathname) {
  if (pathname === "/" || pathname.endsWith(".html")) return "no-cache";
  if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

async function serveStatic(request, reply, headers) {
  const url = new URL(request.url ?? "/", "http://local.invalid");
  let file;
  try {
    file = safeDistPath(url.pathname);
  } catch {
    reply.writeHead(400, { ...headers, "content-type": "text/plain; charset=utf-8" });
    reply.end("Bad request");
    return;
  }

  if (!(await existingFile(file))) {
    if (extname(url.pathname)) {
      reply.writeHead(404, { ...headers, "content-type": "text/plain; charset=utf-8" });
      reply.end("Not found");
      return;
    }
    file = resolve(DIST_DIR, "index.html");
  }

  const type = MIME_TYPES.get(extname(file).toLowerCase()) ?? "application/octet-stream";
  reply.writeHead(200, {
    ...headers,
    "content-type": type,
    "cache-control": cacheControl(url.pathname),
  });
  if (request.method === "HEAD") {
    reply.end();
    return;
  }
  createReadStream(file).pipe(reply);
}

export function createProductionWebServer(env = process.env) {
  const port = positivePort(env.PORT);
  const host = env.HOST?.trim() || "0.0.0.0";
  const appOrigin = env.APP_ORIGIN?.trim();
  const backendRaw = env.BACKEND_PROXY_TARGET?.trim();
  if (!appOrigin) throw new Error("APP_ORIGIN is required");
  if (!backendRaw) throw new Error("BACKEND_PROXY_TARGET is required");

  const backendTarget = new URL(backendRaw);
  if (backendTarget.protocol !== "http:" && backendTarget.protocol !== "https:") {
    throw new Error("BACKEND_PROXY_TARGET must use http or https");
  }

  const allowInsecureLoopback =
    env.NODE_ENV !== "production" && env.ALLOW_INSECURE_LOOPBACK_WEB_ORIGIN === "1";
  const securityHeaders = buildWebSecurityHeaders({
    appOrigin,
    mediaConnectSrc: env.WEB_MEDIA_CONNECT_SRC ?? env.VITE_S3_CONNECT_SRC ?? "",
    allowInsecureLoopback,
  });

  const server = createServer(async (request, reply) => {
    if (request.url === "/health") {
      reply.writeHead(200, {
        ...securityHeaders,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      reply.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (!requestUsesCanonicalHost(request, appOrigin)) {
      reply.writeHead(421, {
        ...securityHeaders,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      reply.end("Misdirected request");
      return;
    }

    if (request.url === "/api" || request.url?.startsWith("/api/")) {
      proxyHttp(request, reply, backendTarget, appOrigin, securityHeaders);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      reply.writeHead(405, {
        ...securityHeaders,
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      });
      reply.end("Method not allowed");
      return;
    }

    await serveStatic(request, reply, securityHeaders);
  });

  server.on("upgrade", (request, socket, head) => {
    if (!requestUsesCanonicalHost(request, appOrigin)) {
      socket.destroy();
      return;
    }
    if (request.url === "/api" || request.url?.startsWith("/api/")) {
      proxyUpgrade(request, socket, head, backendTarget, appOrigin);
      return;
    }
    socket.destroy();
  });

  return {
    host,
    port,
    server,
    listen() {
      return new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolveListen();
        });
      });
    },
  };
}

async function main() {
  const application = createProductionWebServer(process.env);
  await application.listen();
  console.log("SHAWTIE_WEB_READY", { host: application.host, port: application.port });
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((error) => {
    console.error("SHAWTIE_WEB_START_FAILED", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    process.exitCode = 1;
  });
}
