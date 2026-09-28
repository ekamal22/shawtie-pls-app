import { createHash } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4190;
const allowedOrigin = "http://127.0.0.1:4180";
const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function json(reply, status, body) {
  reply.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  reply.end(JSON.stringify(body));
}

const server = createServer((request, reply) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health") {
    json(reply, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/media") {
    reply.writeHead(200, {
      "content-type": "application/octet-stream",
      "access-control-allow-origin": allowedOrigin,
      "cache-control": "no-store",
    });
    reply.end(Buffer.from("sec1-ciphertext"));
    return;
  }

  if (url.pathname === "/api/v1/auth/session") {
    json(reply, 401, { error: { code: "AUTH_REQUIRED" } });
    return;
  }

  json(reply, 404, { error: { code: "TEST_NOT_FOUND" } });
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + websocketGuid).digest("base64");
  const protocolHeader = request.headers["sec-websocket-protocol"];
  const protocol =
    typeof protocolHeader === "string" ? protocolHeader.split(",")[0]?.trim() : undefined;

  const lines = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Accept: " + accept,
    ...(protocol ? ["Sec-WebSocket-Protocol: " + protocol] : []),
    "",
    "",
  ];
  socket.write(lines.join("\r\n"));
  socket.on("error", () => {});
});

server.listen(port, host, () => {
  console.log("SEC1_TEST_BACKEND_READY", { host, port });
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
