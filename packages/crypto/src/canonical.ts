import { utf8 } from "./bytes.ts";

type CanonicalPrimitive = null | boolean | number | string;
export type CanonicalValue =
  | CanonicalPrimitive
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function encode(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON rejects non-finite numbers");
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((item) => encode(item)).join(",") + "]";

  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return (
    "{" +
    entries
      .map(([key, item]) => JSON.stringify(key) + ":" + encode(item))
      .join(",") +
    "}"
  );
}

export function canonicalJson(value: CanonicalValue): string {
  return encode(value);
}

export function canonicalBytes(value: CanonicalValue): Uint8Array<ArrayBuffer> {
  return utf8(canonicalJson(value));
}
