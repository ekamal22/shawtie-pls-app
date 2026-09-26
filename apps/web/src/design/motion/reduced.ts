/**
 * Shared reduced-motion helpers for the signature moments. Presentation only: nothing here
 * changes product state. Every signature transition reads this instead of duplicating the
 * media query, and every one also has a CSS fallback under `prefers-reduced-motion`.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Duration in ms for a signature transition, collapsed to a short fade when reduced. */
export function signatureDuration(normalMs: number, reducedMs = 120): number {
  return prefersReducedMotion() ? reducedMs : normalMs;
}
