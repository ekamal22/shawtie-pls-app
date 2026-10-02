import { assertWebSecurityHeaders } from "../security/check-web-security-headers.mjs";

const raw = process.env.R2_PUBLIC_ORIGIN?.trim() || process.argv[2];
if (!raw) throw new Error("R2_PUBLIC_ORIGIN or an origin argument is required");
const origin = new URL(raw);
if (origin.protocol !== "https:") throw new Error("R2 public origin must use HTTPS");
if (
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
) {
  throw new Error("R2 public origin must be a bare HTTPS origin");
}

await assertWebSecurityHeaders(origin.origin);

const health = await fetch(new URL("/health", origin), {
  cache: "no-store",
  redirect: "manual",
});
if (!health.ok) throw new Error("Public web health failed with HTTP " + health.status);
const healthBody = await health.json().catch(() => null);
if (healthBody?.status !== "ok") throw new Error("Public web health body is invalid");

const worker = await fetch(new URL("/sw.js", origin), {
  cache: "no-store",
  redirect: "manual",
});
if (!worker.ok) throw new Error("Service worker fetch failed with HTTP " + worker.status);
const workerSource = await worker.text();
if (!workerSource.includes('"shawtie-shell-" + safeReleaseId')) {
  throw new Error("Deployed service worker is not release-aware");
}

const privacy = await fetch(new URL("/privacy.html", origin), {
  cache: "no-store",
  redirect: "manual",
});
const terms = await fetch(new URL("/terms.html", origin), {
  cache: "no-store",
  redirect: "manual",
});
if (!privacy.ok || !terms.ok) {
  throw new Error("Public Privacy/Terms surfaces are unavailable");
}

console.log("R2_PUBLIC_ORIGIN_PASS origin=" + origin.origin);
