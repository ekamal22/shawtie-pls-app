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
  return trimmed.includes("@") ? normalizeEmail(trimmed).normalized : normalizeUsername(trimmed).normalized;
}

export function networkPrefix(ip: string): string {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  const normalized = ip.toLowerCase().split("%")[0] ?? ip.toLowerCase();
  const parts = normalized.split(":");
  return `${parts.slice(0, 4).join(":")}::/64`;
}
