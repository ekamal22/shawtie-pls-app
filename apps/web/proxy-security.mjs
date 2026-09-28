import { BlockList, isIP } from "node:net";

function normalizeAddress(value) {
  if (typeof value !== "string") return null;
  let address = value.trim();
  if (!address) return null;

  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];

  return isIP(address) ? address : null;
}

function addressFamily(address) {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

export function createTrustedProxyPolicy(raw) {
  const blockList = new BlockList();
  const entries = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry === "*" || entry === "true" || /^\d+$/.test(entry)) {
      throw new Error("WEB_TRUSTED_PROXY must use explicit IP or CIDR entries");
    }

    const slash = entry.lastIndexOf("/");
    if (slash >= 0) {
      const address = normalizeAddress(entry.slice(0, slash));
      const prefix = Number.parseInt(entry.slice(slash + 1), 10);
      if (!address || !Number.isInteger(prefix)) {
        throw new Error("Invalid WEB_TRUSTED_PROXY CIDR: " + entry);
      }
      const family = addressFamily(address);
      const max = family === "ipv6" ? 128 : 32;
      if (prefix < 0 || prefix > max) {
        throw new Error("Invalid WEB_TRUSTED_PROXY CIDR prefix: " + entry);
      }
      blockList.addSubnet(address, prefix, family);
      continue;
    }

    const address = normalizeAddress(entry);
    if (!address) throw new Error("Invalid WEB_TRUSTED_PROXY address: " + entry);
    blockList.addAddress(address, addressFamily(address));
  }

  return Object.freeze({
    configured: entries.length > 0,
    trusts(value) {
      const address = normalizeAddress(value);
      if (!address) return false;
      return blockList.check(address, addressFamily(address));
    },
  });
}

function forwardedChain(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const values = raw.split(",").map((value) => normalizeAddress(value));
  if (values.some((value) => value === null)) return null;
  return values;
}

export function resolveClientAddress(socketAddress, forwardedFor, policy) {
  const socket = normalizeAddress(socketAddress);
  if (!socket) throw new Error("Unable to resolve proxy socket address");

  if (!policy.trusts(socket)) return socket;

  const forwarded = forwardedChain(forwardedFor);
  if (!forwarded || forwarded.length === 0) return socket;

  const chain = [...forwarded, socket];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const address = chain[index];
    if (index === chain.length - 1 || policy.trusts(address)) continue;
    return address;
  }

  return chain[0];
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function connectionTokens(value) {
  if (Array.isArray(value)) value = value.join(",");
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function sanitizedForwardHeaders(
  request,
  { backendTarget, appOrigin, trustedProxyPolicy, upgrade = false },
) {
  const headers = {};
  const dynamicHopByHop = connectionTokens(request.headers.connection);
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || dynamicHopByHop.has(lower)) continue;
    if (lower === "forwarded" || lower.startsWith("x-forwarded-") || lower === "x-real-ip") {
      continue;
    }
    headers[lower] = value;
  }

  if (upgrade) {
    for (const name of [
      "upgrade",
      "connection",
      "sec-websocket-key",
      "sec-websocket-version",
      "sec-websocket-protocol",
      "sec-websocket-extensions",
      "origin",
    ]) {
      const value = request.headers[name];
      if (value !== undefined) headers[name] = value;
    }
  }

  const clientAddress = resolveClientAddress(
    request.socket.remoteAddress,
    request.headers["x-forwarded-for"],
    trustedProxyPolicy,
  );
  const app = new URL(appOrigin);

  headers.host = backendTarget.host;
  headers["x-forwarded-for"] = clientAddress;
  headers["x-forwarded-host"] = app.host;
  headers["x-forwarded-proto"] = app.protocol.slice(0, -1);

  return headers;
}


export function sanitizedProxyResponseHeaders(sourceHeaders, securityHeaders) {
  const headers = {};
  const dynamicHopByHop = connectionTokens(sourceHeaders.connection);

  for (const [name, value] of Object.entries(sourceHeaders)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || dynamicHopByHop.has(lower)) continue;
    if (value !== undefined) headers[lower] = value;
  }

  for (const [name, value] of Object.entries(securityHeaders)) {
    headers[name.toLowerCase()] = value;
  }

  return headers;
}
