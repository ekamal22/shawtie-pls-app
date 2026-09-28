import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { normalizeUsername } from "@shawtie/domain";

export interface NormalizedEmail {
  readonly normalized: string;
  readonly display: string;
}

export function normalizeEmail(value: string): NormalizedEmail {
  const display = value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
  const at = display.lastIndexOf("@");
  if (at <= 0 || at === display.length - 1 || display.length > 254) {
    throw new Error("Invalid email address");
  }
  const local = display.slice(0, at);
  const domain = domainToASCII(display.slice(at + 1));
  if (!domain || local.length > 64) throw new Error("Invalid email address");
  return { display, normalized: `${local.toLowerCase()}@${domain.toLowerCase()}` };
}

export function normalizeLoginIdentifier(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes("@")
    ? normalizeEmail(trimmed).normalized
    : normalizeUsername(trimmed).normalized;
}

function canonicalIpv6(value: string): string {
  const stripped = value.toLowerCase().split("%", 1)[0] ?? value.toLowerCase();
  const url = new URL("http://[" + stripped + "]/");
  return url.hostname.slice(1, -1);
}

function expandIpv6(value: string): string[] {
  const canonical = canonicalIpv6(value);
  const pieces = canonical.split("::");
  if (pieces.length > 2) throw new Error("Invalid IPv6 address");
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (pieces.length === 1 && missing !== 0)) {
    throw new Error("Invalid IPv6 address");
  }
  return [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) =>
    Number.parseInt(part, 16).toString(16),
  );
}

export function networkPrefix(ip: string): string {
  const stripped = ip.toLowerCase().split("%", 1)[0] ?? ip.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(stripped);
  const candidate = mapped?.[1] ?? stripped;

  if (isIP(candidate) === 4) {
    const octets = candidate.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (isIP(candidate) !== 6) {
    throw new Error("Invalid network address");
  }

  const parts = expandIpv6(candidate);
  return `${parts.slice(0, 4).join(":")}::/64`;
}
